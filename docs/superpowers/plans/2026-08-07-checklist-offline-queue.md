# Checklist Offline Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the checklist form submit offline — queue the submission in IndexedDB (text + photos) when the network is down, then replay the queued server action automatically when connectivity returns.

**Architecture:** A framework-agnostic queue module (`lib/offline-queue.ts`) owns all IndexedDB read/write and the replay loop. A React hook (`hooks/use-offline-submit.ts`) wraps the existing `submitChecklist` server action: on call, it runs the action; if the underlying fetch rejects (network failure / offline), it captures the `FormData` (photos base64-encoded into the record), stores a queued job, and drives the background replay loop on `online` / visibility / mount. The server action `submitChecklist` stays untouched — it already returns `{ success: true }` on success and `{ message: string }` on failure, and calls `revalidatePath` server-side, which is exactly what replay needs. No new dependencies; IndexedDB is stdlib in every target browser.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, IndexedDB (via a 60-line raw wrapper — no Dexie/localforage), Vitest.

---

## Global Constraints

- **No new runtime dependencies.** IndexedDB, `navigator.onLine`, and `window.addEventListener` are all stdlib. Do not add `idb`, `localforage`, `dexie`, or `workbox`.
- **Server action signature is frozen.** `submitChecklist(prevState: unknown, formData: FormData)` returns `{ success: true }` or `{ message: string }`. Do not modify `actions/checklist.ts`. Replay calls the action function directly — Next.js turns a client-side call to a `"use server"` function into an RPC POST automatically.
- **Photos are binary.** `submitChecklist` reads `photo-${deviceId}` as `File` and writes it to disk via `fs.writeFile` on the server. localStorage cannot hold `File`/`Blob`. Queue records must live in IndexedDB; photos base64-encoded into the record so a replay can reconstruct a real `File` object.
- **Storage limits.** IndexedDB origin quota is large but not infinite. Each photo is capped at 10MB by the existing `FieldAuditCard` `onChange` guard. Queue is best-effort — a full store is a `QuotaExceededError`, surfaced to the user, not a silent drop.
- **Replay idempotency is the server's job, not the queue's.** `submitChecklist` creates a fresh `checklistEntries` row per call. Do not attempt client-side dedup — instead surface "submit once" in the UI (Task 5). Never auto-retry a job whose failure was a validation message (`message` set, not a network throw) — that is a permanent rejection, mark it `failed`.
- **Existing test pattern.** Pure logic tests live next to the source as `*.test.ts` and run under `vitest run` (config already at `vitest.config.ts`). No new test harness.

---

## File Structure

- Create `lib/offline-queue.ts` — framework-agnostic IndexedDB queue: open DB, add/list/delete/update jobs, retry-loop driver. Pure async functions, no React. Holds the `QueuedJob` type.
- Create `lib/offline-queue.test.ts` — unit tests for the pure helpers (encode/decode, classification of failure, queue ordering). IndexedDB calls are faked via a minimal in-memory store so tests run under `vitest` with `environment: "node"`.
- Create `hooks/use-offline-submit.ts` — React hook wrapping `submitChecklist`: tries the action live, on network rejection captures `FormData` + photos into a queued job, exposes `{ isOnline, pendingCount, lastError }`, drives replay on `online`/visibility/mount.
- Modify `components/checklist/checklist-form.tsx` — replace `useActionState(submitChecklist, …)` with the hook; show a pending-count badge + offline banner; keep the existing success/error message rendering.

No other files change. The server action, the `FieldAuditCard` photo input, and the DB schema are untouched.

---

### Task 1: Offline queue core module

**Files:**
- Create: `lib/offline-queue.ts`
- Test: `lib/offline-queue.test.ts`

**Interfaces:**
- Produces (used by Task 2's hook and by the test):

```ts
export type QueuedJob = {
  id: string;              // crypto.randomUUID()
  actionName: "submitChecklist";
  createdAt: number;      // ms epoch (caller passes in; Date.now() banned in modules per repo rule? no — that's workflow scripts only. Use Date.now() here.)
  fields: Record<string, string>;     // non-file form fields, last write wins
  multiFields: Record<string, string[]>; // repeated fields (deviceId list)
  photos: { fieldName: string; fileName: string; fileType: string; base64: string }[];
  status: "queued" | "in_flight" | "failed";
  attempts: number;
  lastError: string | null;
};

export async function openQueueDB(): Promise<IDBDatabase>;
export async function enqueueJob(job: Omit<QueuedJob, "id" | "status" | "attempts" | "lastError">): Promise<QueuedJob>;
export async function listQueuedJobs(): Promise<QueuedJob[]>;
export async function deleteJob(id: string): Promise<void>;
export async function markJobFailed(id: string, error: string): Promise<void>;
export async function fileToBase64(file: File): Promise<string>;
export async function base64ToFile(part: { fileName: string; fileType: string; base64: string }): Promise<File>;
export function classifyFailure(error: unknown): "network" | "permanent";
export function jobToFormData(job: QueuedJob): FormData;
```

- Consumes: nothing (leaf module).

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `lib/offline-queue.test.ts` with only the pure-function tests first (DB tests come in Step 4 once the in-memory fake exists):

```ts
import { describe, expect, it } from "vitest";
import { classifyFailure, jobToFormData, type QueuedJob } from "./offline-queue";

describe("classifyFailure", () => {
  it("treats TypeError / network-shaped errors as network failures", () => {
    expect(classifyFailure(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyFailure(new Error("Network request failed"))).toBe("network");
  });

  it("treats a generic server error as permanent (validation-shaped)", () => {
    expect(classifyFailure(new Error("something else"))).toBe("permanent");
  });
});

describe("jobToFormData", () => {
  it("reconstructs simple, repeated, and file fields", () => {
    const job: QueuedJob = {
      id: "j1",
      actionName: "submitChecklist",
      createdAt: 0,
      fields: { checkDate: "2026-08-07", shift: "Pagi" },
      multiFields: { deviceId: ["1", "2"] },
      photos: [
        { fieldName: "photo-1", fileName: "a.jpg", fileType: "image/jpeg", base64: "AAAA" },
      ],
      status: "queued",
      attempts: 0,
      lastError: null,
    };

    const fd = jobToFormData(job);
    expect(fd.get("checkDate")).toBe("2026-08-07");
    expect(fd.getAll("deviceId")).toEqual(["1", "2"]);
    const photo = fd.get("photo-1") as File;
    expect(photo).toBeInstanceOf(File);
    expect(photo.name).toBe("a.jpg");
    expect(photo.type).toBe("image/jpeg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/offline-queue.test.ts`
Expected: FAIL — `Cannot find module './offline-queue'` or import errors.

- [ ] **Step 3: Write minimal implementation of the pure helpers**

Create `lib/offline-queue.ts`. Implement only `classifyFailure`, `jobToFormData`, and the `QueuedJob` type for now (DB functions can throw `not implemented` until Step 4):

```ts
export type QueuedJob = {
  id: string;
  actionName: "submitChecklist";
  createdAt: number;
  fields: Record<string, string>;
  multiFields: Record<string, string[]>;
  photos: { fieldName: string; fileName: string; fileType: string; base64: string }[];
  status: "queued" | "in_flight" | "failed";
  attempts: number;
  lastError: string | null;
};

const NETWORK_MARKERS = ["failed to fetch", "network request failed", "networkerror", "load failed"] as const;

export function classifyFailure(error: unknown): "network" | "permanent" {
  const msg = String(error instanceof Error ? error.message : error).toLowerCase();
  if (NETWORK_MARKERS.some((m) => msg.includes(m))) return "network";
  // ponytail: treat unrecognized errors as permanent to avoid silent retry loops;
  // upgrade path: add markers here as new offline failure shapes appear.
  return "permanent";
}

export function jobToFormData(job: QueuedJob): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(job.fields)) fd.set(key, value);
  for (const [key, values] of Object.entries(job.multiFields)) {
    for (const v of values) fd.append(key, v);
  }
  for (const photo of job.photos) {
    const blob = base64ToBlob(photo.base64, photo.fileType);
    const file = new File([blob], photo.fileName, { type: photo.fileType });
    fd.set(photo.fieldName, file);
  }
  return fd;
}

// base64 helpers shared with the hook + jobToFormData
export function base64ToBlob(base64: string, type: string): Blob {
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type });
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function base64ToFile(part: { fileName: string; fileType: string; base64: string }): Promise<File> {
  const blob = base64ToBlob(part.base64, part.fileType);
  return new File([blob], part.fileName, { type: part.fileType });
}
```

- [ ] **Step 4: Run test to verify the pure helpers pass**

Run: `npx vitest run lib/offline-queue.test.ts`
Expected: PASS — both `describe` blocks green.

- [ ] **Step 5: Add the IndexedDB functions with an in-memory test fake**

Append the DB layer to `lib/offline-queue.ts`:

```ts
const DB_NAME = "dc-check-offline";
const STORE = "jobs";

export async function openQueueDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openQueueDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function enqueueJob(
  job: Omit<QueuedJob, "id" | "status" | "attempts" | "lastError">,
): Promise<QueuedJob> {
  const full: QueuedJob = { ...job, id: crypto.randomUUID(), status: "queued", attempts: 0, lastError: null };
  await tx("readwrite", (s) => s.add(full));
  return full;
}

export async function listQueuedJobs(): Promise<QueuedJob[]> {
  const all = (await tx<QueuedJob[]>("readonly", (s) => s.getAll())) ?? [];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteJob(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  const job = (await tx<QueuedJob>("readonly", (s) => s.get(id))) as QueuedJob | undefined;
  if (!job) return;
  job.status = "failed";
  job.lastError = error;
  await tx("readwrite", (s) => s.put(job));
}
```

Now add a fake-IndexedDB test block at the bottom of `lib/offline-queue.test.ts` (Node has no IndexedDB, so a tiny in-memory fake replaces it):

```ts
import { beforeEach, vi } from "vitest";
import { enqueueJob, listQueuedJobs, deleteJob, markJobFailed } from "./offline-queue";

// Minimal in-memory IDB fake: enough for add/getAll/delete/put + onupgradeneeded.
function makeFakeIDB() {
  let store = new Map<string, any>();
  const fakeReq = (result: any) => ({ result, onsuccess: null as null | (() => void), onerror: null as null | (() => void), });
  const fakeDB = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        add: (v: any) => { store.set(v.id, v); return fakeReq(undefined); },
        getAll: () => fakeReq(Array.from(store.values())),
        get: (id: string) => fakeReq(store.get(id)),
        delete: (id: string) => { store.delete(id); return fakeReq(undefined); },
        put: (v: any) => { store.set(v.id, v); return fakeReq(undefined); },
      }),
      oncomplete: null as null | (() => void),
    }),
    close: () => {},
  };
  return {
    open: () => {
      const req = { ...fakeReq(fakeDB), onupgradeneeded: null as null | (() => void) };
      // fire async like a real IDBOpenRequest would
      setTimeout(() => { req.onupgradeneeded?.(new Event("upgradeneeded")); req.onsuccess?.(new Event("success")); }, 0);
      return req as unknown as IDBOpenRequest;
    },
    _store: store,
  };
}

describe("offline-queue DB layer", () => {
  beforeEach(() => {
    const fake = makeFakeIDB();
    (globalThis as any).indexedDB = fake;
    (globalThis as any).IDBDatabase = Object;
    vi.useFakeTimers();
  });

  it("enqueues and lists jobs in createdAt order", async () => {
    const a = await enqueueJob({ actionName: "submitChecklist", createdAt: 20, fields: {}, multiFields: {}, photos: [] });
    const b = await enqueueJob({ actionName: "submitChecklist", createdAt: 10, fields: {}, multiFields: {}, photos: [] });
    const list = await listQueuedJobs();
    expect(list.map((j) => j.id)).toEqual([b.id, a.id]);
    expect(list[0].status).toBe("queued");
  });

  it("marks a job failed and keeps it for inspection", async () => {
    const j = await enqueueJob({ actionName: "submitChecklist", createdAt: 0, fields: {}, multiFields: {}, photos: [] });
    await markJobFailed(j.id, "boom");
    const list = await listQueuedJobs();
    expect(list[0].status).toBe("failed");
    expect(list[0].lastError).toBe("boom");
  });

  it("deletes a job", async () => {
    const j = await enqueueJob({ actionName: "submitChecklist", createdAt: 0, fields: {}, multiFields: {}, photos: [] });
    await deleteJob(j.id);
    expect(await listQueuedJobs()).toEqual([]);
  });
});
```

Add `vi.useFakeTimers()` flush — since the fake fires `onsuccess` on a `setTimeout(0)`, the async `await` needs timers to advance. Replace the `enqueueJob` call sites in the DB tests with `await` already; for the promise to settle, add after each enqueue:

```ts
await vi.advanceTimersByTimeAsync(0);
```

inside each `it` before the first `listQueuedJobs()` call. (Viactor's `vi.useFakeTimers()` + `advanceTimersByTimeAsync(0)` flushes the microtask+macrotask queue.)

- [ ] **Step 6: Run the full test file**

Run: `npx vitest run lib/offline-queue.test.ts`
Expected: PASS — all five `it` blocks green.

- [ ] **Step 7: Commit**

```bash
git add lib/offline-queue.ts lib/offline-queue.test.ts
git commit -m "feat(offline): indexeddb queue core for checklist submissions"
```

---

### Task 2: React hook wrapping `submitChecklist`

**Files:**
- Create: `hooks/use-offline-submit.ts`

**Interfaces:**
- Consumes (from Task 1): `enqueueJob`, `listQueuedJobs`, `deleteJob`, `markJobFailed`, `fileToBase64`, `jobToFormData`, `classifyFailure`, `QueuedJob`.
- Consumes (existing): `submitChecklist` from `@/actions/checklist` — signature `submitChecklist(prevState: unknown, formData: FormData) => Promise<{ success?: true } | { message?: string }>`.
- Produces (used by the form in Task 3):

```ts
export type OfflineSubmitState = {
  success?: boolean;
  message?: string;
  pendingCount: number;        // queued jobs not yet replayed
  isOnline: boolean;
};

export type OfflineSubmitApi = {
  state: OfflineSubmitState;
  isPending: boolean;
  submit: (formData: FormData) => Promise<void>;  // call from a client form action
};

export function useOfflineSubmit(): OfflineSubmitApi;
```

- [ ] **Step 1: Write the hook**

Create `hooks/use-offline-submit.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { submitChecklist } from "@/actions/checklist";
import {
  enqueueJob,
  listQueuedJobs,
  deleteJob,
  markJobFailed,
  fileToBase64,
  classifyFailure,
  type QueuedJob,
} from "@/lib/offline-queue";

export type OfflineSubmitState = {
  success?: boolean;
  message?: string;
  pendingCount: number;
  isOnline: boolean;
};

export type OfflineSubmitApi = {
  state: OfflineSubmitState;
  isPending: boolean;
  submit: (formData: FormData) => Promise<void>;
};

const MAX_ATTEMPTS = 5;

async function captureFormData(formData: FormData, createdAt: number): Promise<Omit<QueuedJob, "id" | "status" | "attempts" | "lastError">> {
  const fields: Record<string, string> = {};
  const multiFields: Record<string, string[]> = {};
  const photos: QueuedJob["photos"] = [];

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      if (value.size === 0 || value.name === "undefined") continue; // mirror server's skip guard
      photos.push({
        fieldName: key,
        fileName: value.name,
        fileType: value.type || "application/octet-stream",
        base64: await fileToBase64(value),
      });
    } else if (key in multiFields) {
      multiFields[key].push(value);
    } else if (key in fields) {
      multiFields[key] = [fields[key], value];
      delete fields[key];
    } else {
      fields[key] = value;
    }
  }
  return { actionName: "submitChecklist", createdAt, fields, multiFields, photos };
}

export function useOfflineSubmit(): OfflineSubmitApi {
  const [state, setState] = useState<OfflineSubmitState>({ pendingCount: 0, isOnline: true });
  const [isPending, setIsPending] = useState(false);

  const refreshPending = useCallback(async () => {
    if (typeof window === "undefined") return;
    const jobs = await listQueuedJobs();
    setState((s) => ({ ...s, pendingCount: jobs.filter((j) => j.status !== "failed").length }));
  }, []);

  const replay = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!navigator.onLine) return;
    const jobs = await listQueuedJobs();
    for (const job of jobs) {
      if (job.status === "failed") continue;
      if (job.attempts >= MAX_ATTEMPTS) {
        await markJobFailed(job.id, "Max retries exceeded");
        continue;
      }
      const fd = new FormData();
      // rebuild FormData from job (reuse jobToFormData from Task 1)
      const { jobToFormData } = await import("@/lib/offline-queue");
      const rebuilt = jobToFormData(job);
      try {
        const res = await submitChecklist(undefined, rebuilt);
        if (res && "success" in res && res.success) {
          await deleteJob(job.id);
        } else if (res && "message" in res) {
          // validation/perm failure — do NOT retry
          await markJobFailed(job.id, res.message ?? "Rejected");
        }
      } catch (error) {
        if (classifyFailure(error) === "network") {
          // transient — leave queued, retry next online/visibility tick
          break;
        }
        await markJobFailed(job.id, String(error));
      }
    }
    await refreshPending();
  }, [refreshPending]);

  // mount + online/visibility → refresh + replay
  useEffect(() => {
    void refreshPending();
    const goOnline = () => { void replay(); };
    window.addEventListener("online", goOnline);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void replay(); });
    return () => window.removeEventListener("online", goOnline);
  }, [refreshPending, replay]);

  const submit = useCallback(async (formData: FormData) => {
    setIsPending(true);
    try {
      if (navigator.onLine) {
        try {
          const res = await submitChecklist(undefined, formData);
          if (res && "success" in res && res.success) {
            setState((s) => ({ ...s, success: true }));
            return;
          }
          if (res && "message" in res) {
            setState((s) => ({ ...s, success: false, message: res.message }));
            return;
          }
        } catch (error) {
          if (classifyFailure(error) !== "network") throw error;
          // else fall through to enqueue
        }
      }
      // offline or network-rejected → enqueue
      const captured = await captureFormData(formData, Date.now());
      await enqueueJob(captured);
      setState((s) => ({ ...s, success: false, message: "Saved offline — will submit when back online.", pendingCount: s.pendingCount + 1 }));
    } catch (error) {
      setState((s) => ({ ...s, success: false, message: String(error) }));
    } finally {
      setIsPending(false);
    }
  }, []);

  return { state, isPending, submit };
}
```

Note: `jobToFormData` is imported dynamically inside `replay` to keep the hook's module-eval surface small; it's already a sync function so this is purely a bundling nicety. If the dynamic `await import` causes friction in the build, replace with a top-level `import { jobToFormData } from "@/lib/offline-queue"` — behavior is identical.

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: exits 0. If `submitChecklist`'s `"use server"` type causes a client-import error under `tsc`, that's expected — Next's RSC type-stripping handles it at build time; confirm with `npm run build` in Task 3 instead. If `tsc` flags it, leave the import as-is (it's the documented Next pattern) and proceed.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-offline-submit.ts
git commit -m "feat(offline): useOfflineSubmit hook with enqueue + replay"
```

---

### Task 3: Wire the hook into `ChecklistForm`

**Files:**
- Modify: `components/checklist/checklist-form.tsx`

**Interfaces:**
- Consumes: `useOfflineSubmit` from `@/hooks/use-offline-submit` (Task 2).
- Produces: the form now submits via the offline-aware path.

- [ ] **Step 1: Replace `useActionState` with the hook**

In `components/checklist/checklist-form.tsx`, change the import line:

```ts
import { useActionState, useState } from "react";
import { submitChecklist } from "@/actions/checklist";
```

to:

```ts
import { useState } from "react";
import { useOfflineSubmit } from "@/hooks/use-offline-submit";
```

Replace the hook call:

```ts
const [state, action, isPending] = useActionState(submitChecklist, undefined);
```

with:

```ts
const { state, isPending, submit } = useOfflineSubmit();
```

Change the `<form action={action}>` to call the hook's submit through a client form action:

```tsx
<form action={submit} className="flex flex-col gap-5" suppressHydrationWarning>
```

`submit` is an async function accepting `FormData` — a valid React 19 client form action. React passes the `FormData` automatically on submit.

- [ ] **Step 2: Add offline banner + pending count**

Inside the existing sticky footer `<div className="flex flex-col gap-3 ...">`, before the `{state?.message && ...}` block, add:

```tsx
{state.pendingCount > 0 && (
  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-300">
    {state.pendingCount} queued offline
  </p>
)}
{!state.isOnline && (
  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted">
    Offline — entries saved locally
  </p>
)}
```

Keep the existing success/error message rendering exactly as-is — `state.message` and `state.success` still flow through.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds. The route compiles with the `"use server"` boundary intact.

- [ ] **Step 4: Manual smoke test**

1. Open the checklist form in the browser.
2. DevTools → Network → set to "Offline".
3. Fill the form, submit → expect the amber "queued offline" badge and the "Saved offline" message; no console error from `submitChecklist` (the fetch rejection is caught).
4. DevTools → Network → back to "Online".
5. Wait for the replay tick (fires immediately on the `online` event) → expect the queued badge to drop to 0 and the success message to appear. Verify the row landed in `/admin/incidents` (revalidatePath refreshed it).

- [ ] **Step 5: Commit**

```bash
git add components/checklist/checklist-form.tsx
git commit -m "feat(checklist): offline-aware submit with pending queue badge"
```

---

### Task 4: Edge-case pass and final verification

**Files:**
- No source changes unless verification finds a regression.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
npm run test
npx tsc --noEmit
npm run build
```

Expected: all green. `npm run test` includes `lib/offline-queue.test.ts`.

- [ ] **Step 2: Manual edge cases**

Verify these flows in the browser:

```text
queue a job with a photo (Warning + 1 image), go offline → online: photo lands on disk at /uploads/, checklist entry created
queue 3 jobs offline, go online: all 3 replay in createdAt order, badge 3 → 0
submit while online but server returns { message: "Date, Time, and Shift are required" }: job NOT enqueued, message shown (validation path stays live, never queued)
submit while offline, then permanently kill the server and come online: after MAX_ATTEMPTS (5) the job is marked failed and surfaced, not retried forever
open a second tab while a job is queued: pendingCount reflects DB state on mount (cross-tab not required, but mount refresh must show truth)
```

- [ ] **Step 3: Commit any regression fixes**

If manual verification surfaced a fix:

```bash
git add <files>
git commit -m "fix(offline): <what>"
```

If none, no empty commit — note the manual-pass result in the PR body.

---

## Self-Review

- **Spec coverage:** The user's stated research findings are all reflected: success shape `{ success: true }` (hook checks it), failure/throw shapes `{ message }` and thrown error (hook checks `"message"` and `classifyFailure`), `revalidatePath` runs server-side during replay (no client change needed — the hook just awaits the action). The one gap the user did not flag — photos as binary `File` — is covered by Task 1's base64 path and the `photo-${deviceId}` field reconstruction in `jobToFormData`.
- **Placeholder scan:** No "TBD", no "add error handling", no "similar to Task N". Every code step contains runnable code.
- **Type consistency:** `QueuedJob` fields (`fields`, `multiFields`, `photos`, `status`, `attempts`, `lastError`) match across Task 1 (definition), the Task 1 test (construction), and Task 2's `captureFormData` (producer) + `jobToFormData` consumer. `useOfflineSubmit` returns `{ state, isPending, submit }` consistently in Task 2 definition and Task 3 usage. `submitChecklist(prevState, formData)` signature matches the existing `actions/checklist.ts` exactly.
```
