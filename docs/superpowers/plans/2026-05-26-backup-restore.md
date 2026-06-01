# Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a superadmin-only Backup & Restore page that produces and consumes a single ZIP archive containing the Postgres dump and the uploads volume, so dccheck can be migrated from Windows Docker Desktop to Linux without using a shell.

**Architecture:** A Next.js app route at `/admin/backup` posts to two API routes (`GET /api/admin/backup`, `POST /api/admin/restore`). Backup pipes `pg_dump -Fc` into a streaming ZIP (using `archiver`) along with the uploads directory. Restore validates the ZIP (using `unzipper`), extracts to `/tmp`, runs `psql` and `pg_restore` against the configured database, syncs uploads, and writes audit logs. A `runShell` adapter keeps the library testable; the Dockerfile installs the Postgres client tools.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM, archiver, unzipper, vitest, pg_dump/pg_restore/psql/unzip from `postgresql-client` and `unzip` packages on Alpine.

**Spec:** `docs/superpowers/specs/2026-05-26-backup-restore-design.md`

---

### Task 1: Extend audit action types

**Files:**
- Modify: `lib/audit.ts:9-20`
- Test: `lib/audit-types.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// lib/audit-types.test.ts
import { describe, expect, it } from "vitest";
import type { AuditAction } from "./audit";

describe("AuditAction", () => {
  it("includes DOWNLOAD and RESTORE", () => {
    const download: AuditAction = "DOWNLOAD";
    const restore: AuditAction = "RESTORE";
    expect([download, restore]).toEqual(["DOWNLOAD", "RESTORE"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/audit-types.test.ts`
Expected: TypeScript error, `Type '"DOWNLOAD"' is not assignable to type 'AuditAction'`.

- [ ] **Step 3: Write minimal implementation**

In `lib/audit.ts`, replace the `AuditAction` union to include the two new values:

```ts
export type AuditAction =
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "LOGIN"
    | "LOGOUT"
    | "TOGGLE"
    | "UPLOAD"
    | "EXPORT"
    | "DOWNLOAD"
    | "RESTORE"
    | "TEST"
    | "SCHEMA_PUSH"
    | "SITE_SWITCH";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/audit-types.test.ts`
Expected: PASS, 1/1.

- [ ] **Step 5: Commit**

```bash
git add lib/audit.ts lib/audit-types.test.ts
git commit -m "feat: add DOWNLOAD and RESTORE audit actions"
```

---

### Task 2: Install archiver and unzipper

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto-generated)

- [ ] **Step 1: Install runtime and dev dependencies**

Run:

```bash
npm install archiver unzipper
npm install -D @types/archiver @types/unzipper
```

- [ ] **Step 2: Verify versions are pinned in package.json**

Open `package.json` and confirm the entries appear under `dependencies` and `devDependencies` with explicit versions, e.g. `"archiver": "^7.0.1"`, `"unzipper": "^0.12.3"`. Do not edit anything else.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `No errors found`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add archiver and unzipper for backup feature"
```

---

### Task 3: Add Postgres client tools to Docker image

**Files:**
- Modify: `Dockerfile:1-6`
- Modify: `Dockerfile:25-32`
- Test: `scripts/dockerfile.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// scripts/dockerfile.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Dockerfile", () => {
  it("installs postgresql-client and unzip in the base stage", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toMatch(/apk add[^\n]*postgresql-client[^\n]*unzip/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/dockerfile.test.ts`
Expected: FAIL, regex did not match.

- [ ] **Step 3: Write minimal implementation**

Edit `Dockerfile`. Replace the base stage `RUN apk add` line so the runner inherits the tools:

```dockerfile
FROM node:20-alpine AS base

# Install build tooling plus runtime utilities for backup/restore.
RUN apk add --no-cache libc6-compat python3 make g++ postgresql-client unzip
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/dockerfile.test.ts`
Expected: PASS, 1/1.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile scripts/dockerfile.test.ts
git commit -m "feat: bundle pg_dump and unzip in app image"
```

---

### Task 4: Build the runShell adapter

**Files:**
- Create: `lib/backup/run-shell.ts`
- Test: `lib/backup/run-shell.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/backup/run-shell.test.ts
import { describe, expect, it } from "vitest";
import { runShell } from "./run-shell";

describe("runShell", () => {
  it("captures stdout and exit code on success", async () => {
    const result = await runShell("node", ["-e", "process.stdout.write('ok')"]);
    expect(result.code).toBe(0);
    expect(result.stdout.toString()).toBe("ok");
  });

  it("captures stderr and non-zero exit code on failure", async () => {
    const result = await runShell("node", ["-e", "process.stderr.write('boom'); process.exit(2)"]);
    expect(result.code).toBe(2);
    expect(result.stderr.toString()).toContain("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/backup/run-shell.test.ts`
Expected: FAIL, `Cannot find module './run-shell'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/backup/run-shell.ts
import { spawn } from "node:child_process";

export type RunShellResult = {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
};

export type RunShellOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  input?: Buffer | string;
};

export async function runShell(command: string, args: string[], options: RunShellOptions = {}): Promise<RunShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code: code ?? -1,
      stdout: Buffer.concat(stdoutChunks),
      stderr: Buffer.concat(stderrChunks),
    }));
    if (options.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/backup/run-shell.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add lib/backup/run-shell.ts lib/backup/run-shell.test.ts
git commit -m "feat: add runShell adapter for backup tooling"
```

---

### Task 5: Build archive helper that streams pg_dump and uploads into a ZIP

**Files:**
- Create: `lib/backup/build-archive.ts`
- Test: `lib/backup/build-archive.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/backup/build-archive.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import unzipper from "unzipper";
import { buildBackupArchive } from "./build-archive";

function readZipEntries(buffer: Buffer) {
  return unzipper.Open.buffer(buffer).then((directory) =>
    Promise.all(directory.files.map(async (file) => ({
      path: file.path,
      type: file.type,
      content: file.type === "File" ? (await file.buffer()).toString("utf8") : null,
    }))),
  );
}

describe("buildBackupArchive", () => {
  const uploadsRoot = mkdtempSync(path.join(tmpdir(), "dccheck-uploads-"));

  function cleanup() {
    rmSync(uploadsRoot, { recursive: true, force: true });
  }

  it("includes a dump.dump entry from pg_dump and uploads files", async () => {
    mkdirSync(path.join(uploadsRoot, "logos"), { recursive: true });
    writeFileSync(path.join(uploadsRoot, "logos", "site.png"), "fake-png");

    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));

    const fakeRunShell = async () => ({ code: 0, stdout: Buffer.from("FAKE_DUMP_BYTES"), stderr: Buffer.from("") });

    await buildBackupArchive({
      output,
      uploadsDir: uploadsRoot,
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    });

    const buffer = Buffer.concat(chunks);
    const entries = await readZipEntries(buffer);
    const paths = entries.map((entry) => entry.path).sort();
    expect(paths).toContain("dump.dump");
    expect(paths).toContain("uploads/logos/site.png");
    cleanup();
  });

  it("rejects when pg_dump exits non-zero", async () => {
    const output = new PassThrough();
    const fakeRunShell = async () => ({ code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("connection refused") });

    await expect(buildBackupArchive({
      output,
      uploadsDir: uploadsRoot,
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    })).rejects.toThrow(/pg_dump failed.*connection refused/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/backup/build-archive.test.ts`
Expected: FAIL, `Cannot find module './build-archive'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/backup/build-archive.ts
import archiver from "archiver";
import { existsSync } from "node:fs";
import type { Writable } from "node:stream";
import type { RunShellResult } from "./run-shell";
import { runShell as defaultRunShell } from "./run-shell";

export type DatabaseTarget = {
  host: string;
  port: string;
  user: string;
  password: string;
  name: string;
};

export type BuildBackupOptions = {
  output: Writable;
  uploadsDir: string;
  database: DatabaseTarget;
  runShell?: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<RunShellResult>;
};

export async function buildBackupArchive(options: BuildBackupOptions): Promise<void> {
  const runShell = options.runShell ?? defaultRunShell;
  const dump = await runShell("pg_dump", [
    "-h", options.database.host,
    "-p", options.database.port,
    "-U", options.database.user,
    "-d", options.database.name,
    "-Fc",
  ], { env: { ...process.env, PGPASSWORD: options.database.password } });

  if (dump.code !== 0) {
    throw new Error(`pg_dump failed: ${dump.stderr.toString().trim()}`);
  }

  const archive = archiver("zip", { zlib: { level: 6 } });
  const finished = new Promise<void>((resolve, reject) => {
    archive.on("error", reject);
    options.output.on("error", reject);
    options.output.on("close", resolve);
    options.output.on("finish", resolve);
  });
  archive.pipe(options.output);
  archive.append(dump.stdout, { name: "dump.dump" });
  if (existsSync(options.uploadsDir)) {
    archive.directory(options.uploadsDir, "uploads");
  }
  await archive.finalize();
  await finished;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/backup/build-archive.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add lib/backup/build-archive.ts lib/backup/build-archive.test.ts
git commit -m "feat: stream pg_dump and uploads into ZIP archive"
```

---

### Task 6: Build restore archive helper

**Files:**
- Create: `lib/backup/restore-archive.ts`
- Test: `lib/backup/restore-archive.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/backup/restore-archive.test.ts
import archiver from "archiver";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { restoreBackupArchive } from "./restore-archive";

async function makeArchive(includeDump: boolean): Promise<Buffer> {
  const archive = archiver("zip");
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  archive.pipe(stream);
  if (includeDump) archive.append("DUMP_BYTES", { name: "dump.dump" });
  archive.append("payload", { name: "uploads/logos/site.png" });
  await archive.finalize();
  await new Promise<void>((resolve) => stream.on("finish", resolve).on("end", resolve));
  return Buffer.concat(chunks);
}

describe("restoreBackupArchive", () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));

  it("rejects an archive without dump.dump", async () => {
    const archive = await makeArchive(false);
    await expect(restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "wipe",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
    })).rejects.toThrow(/dump\.dump/);
  });

  it("runs DROP SCHEMA, pg_restore, and copies uploads in wipe mode", async () => {
    const archive = await makeArchive(true);
    const calls: { command: string; args: string[] }[] = [];
    const fakeRunShell = async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };
    const result = await restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "wipe",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    });
    expect(calls.map((call) => call.command)).toEqual(["psql", "pg_restore"]);
    expect(calls[0].args).toContain("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO administrator;");
    expect(calls[1].args).toContain("--dbname=dccheck");
    expect(result.mode).toBe("wipe");
    expect(readFileSync(path.join(workDir, "uploads", "logos", "site.png"), "utf8")).toBe("payload");
    rmSync(workDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/backup/restore-archive.test.ts`
Expected: FAIL, `Cannot find module './restore-archive'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/backup/restore-archive.ts
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import unzipper from "unzipper";
import type { DatabaseTarget } from "./build-archive";
import type { RunShellResult } from "./run-shell";
import { runShell as defaultRunShell } from "./run-shell";

export type RestoreMode = "wipe" | "append";

export type RestoreOptions = {
  archive: Buffer;
  uploadsDir: string;
  mode: RestoreMode;
  database: DatabaseTarget;
  runShell?: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv; input?: Buffer | string }) => Promise<RunShellResult>;
};

export type RestoreResult = {
  mode: RestoreMode;
  warnings: string[];
};

async function extractArchive(archive: Buffer): Promise<string> {
  const directory = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
  const zip = await unzipper.Open.buffer(archive);
  for (const file of zip.files) {
    const target = path.join(directory, file.path);
    if (file.type === "Directory") {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, await file.buffer());
  }
  return directory;
}

function copyUploads(sourceRoot: string, targetDir: string, mode: RestoreMode) {
  const uploadsSource = path.join(sourceRoot, "uploads");
  if (!readdirSync(sourceRoot).includes("uploads")) return;
  if (mode === "wipe") {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });
  function copyDir(from: string, to: string) {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const fromPath = path.join(from, entry.name);
      const toPath = path.join(to, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(toPath, { recursive: true });
        copyDir(fromPath, toPath);
      } else {
        writeFileSync(toPath, require("node:fs").readFileSync(fromPath));
      }
    }
  }
  copyDir(uploadsSource, targetDir);
}

export async function restoreBackupArchive(options: RestoreOptions): Promise<RestoreResult> {
  const runShell = options.runShell ?? defaultRunShell;
  const directory = await extractArchive(options.archive);
  if (!readdirSync(directory).includes("dump.dump")) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Archive is missing dump.dump");
  }
  const dumpPath = path.join(directory, "dump.dump");
  const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: options.database.password };
  const warnings: string[] = [];

  if (options.mode === "wipe") {
    const wipe = await runShell("psql", [
      "-h", options.database.host,
      "-p", options.database.port,
      "-U", options.database.user,
      "-d", options.database.name,
      "-c", `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ${options.database.user};`,
    ], { env });
    if (wipe.code !== 0) {
      rmSync(directory, { recursive: true, force: true });
      throw new Error(`psql wipe failed: ${wipe.stderr.toString().trim()}`);
    }
    const restore = await runShell("pg_restore", [
      "-h", options.database.host,
      "-p", options.database.port,
      "-U", options.database.user,
      `--dbname=${options.database.name}`,
      "-j", "4",
      dumpPath,
    ], { env });
    if (restore.code !== 0) {
      rmSync(directory, { recursive: true, force: true });
      throw new Error(`pg_restore failed: ${restore.stderr.toString().trim()}`);
    }
  } else {
    const restore = await runShell("pg_restore", [
      "-h", options.database.host,
      "-p", options.database.port,
      "-U", options.database.user,
      `--dbname=${options.database.name}`,
      "--data-only",
      dumpPath,
    ], { env });
    if (restore.stderr.length > 0) warnings.push(restore.stderr.toString().trim());
    if (restore.code !== 0) {
      rmSync(directory, { recursive: true, force: true });
      throw new Error(`pg_restore --data-only failed: ${restore.stderr.toString().trim()}`);
    }
  }

  copyUploads(directory, options.uploadsDir, options.mode);
  rmSync(directory, { recursive: true, force: true });
  return { mode: options.mode, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/backup/restore-archive.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add lib/backup/restore-archive.ts lib/backup/restore-archive.test.ts
git commit -m "feat: restore Postgres dump and uploads from backup archive"
```

---

### Task 7: Add backup lock helper

**Files:**
- Create: `lib/backup/lock.ts`
- Test: `lib/backup/lock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/backup/lock.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock, releaseLock } from "./lock";

describe("backup lock", () => {
  const root = mkdtempSync(path.join(tmpdir(), "dccheck-lock-"));
  const file = path.join(root, "lock");

  it("acquires when free and rejects when held", async () => {
    expect(acquireLock(file)).toBe(true);
    expect(acquireLock(file)).toBe(false);
    releaseLock(file);
    expect(acquireLock(file)).toBe(true);
    releaseLock(file);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/backup/lock.test.ts`
Expected: FAIL, `Cannot find module './lock'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/backup/lock.ts
import { closeSync, existsSync, openSync, rmSync } from "node:fs";

export function acquireLock(path: string): boolean {
  if (existsSync(path)) return false;
  const fd = openSync(path, "wx");
  closeSync(fd);
  return true;
}

export function releaseLock(path: string): void {
  rmSync(path, { force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/backup/lock.test.ts`
Expected: PASS, 1/1.

- [ ] **Step 5: Commit**

```bash
git add lib/backup/lock.ts lib/backup/lock.test.ts
git commit -m "feat: add file-based backup lock helper"
```

---

### Task 8: Add backup environment helper

**Files:**
- Create: `lib/backup/env.ts`
- Test: `lib/backup/env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/backup/env.test.ts
import { describe, expect, it } from "vitest";
import { resolveBackupEnv } from "./env";

describe("resolveBackupEnv", () => {
  it("reads database connection and uploads path from env", () => {
    const env = resolveBackupEnv({
      DB_HOST: "db",
      DB_PORT: "5432",
      DB_USER: "administrator",
      DB_PASSWORD: "secret",
      DB_NAME: "dccheck",
    });
    expect(env.database).toEqual({
      host: "db",
      port: "5432",
      user: "administrator",
      password: "secret",
      name: "dccheck",
    });
    expect(env.uploadsDir).toBe("/app/public/uploads");
    expect(env.backupLockPath).toBe("/tmp/.dccheck-backup-lock");
    expect(env.restoreLockPath).toBe("/tmp/.dccheck-restore-lock");
  });

  it("throws when a required value is missing", () => {
    expect(() => resolveBackupEnv({ DB_HOST: "", DB_PORT: "5432", DB_USER: "u", DB_PASSWORD: "p", DB_NAME: "d" })).toThrow(/DB_HOST/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/backup/env.test.ts`
Expected: FAIL, `Cannot find module './env'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/backup/env.ts
import type { DatabaseTarget } from "./build-archive";

export type BackupEnv = {
  database: DatabaseTarget;
  uploadsDir: string;
  backupLockPath: string;
  restoreLockPath: string;
};

function require(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required for backup operations`);
  return value;
}

export function resolveBackupEnv(env: Record<string, string | undefined> = process.env): BackupEnv {
  return {
    database: {
      host: require(env, "DB_HOST"),
      port: require(env, "DB_PORT"),
      user: require(env, "DB_USER"),
      password: require(env, "DB_PASSWORD"),
      name: require(env, "DB_NAME"),
    },
    uploadsDir: env.UPLOADS_DIR ?? "/app/public/uploads",
    backupLockPath: env.BACKUP_LOCK_PATH ?? "/tmp/.dccheck-backup-lock",
    restoreLockPath: env.RESTORE_LOCK_PATH ?? "/tmp/.dccheck-restore-lock",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/backup/env.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add lib/backup/env.ts lib/backup/env.test.ts
git commit -m "feat: resolve backup environment configuration"
```

---

### Task 9: Add superadmin guard helper

**Files:**
- Create: `actions/backup-restore.ts`
- Test: `actions/backup-restore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// actions/backup-restore.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  verifySession: vi.fn(),
}));

import { verifySession } from "@/lib/session";
import { requireSuperadmin } from "./backup-restore";

describe("requireSuperadmin", () => {
  it("returns ok when role is superadmin", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ role: "superadmin", userId: 1, username: "root", isAuth: true, activeSiteId: null, activeSiteName: null });
    const result = await requireSuperadmin();
    expect(result.ok).toBe(true);
  });

  it("rejects admins", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ role: "admin", userId: 2, username: "a", isAuth: true, activeSiteId: 1, activeSiteName: "Site" });
    const result = await requireSuperadmin();
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run actions/backup-restore.test.ts`
Expected: FAIL, `Cannot find module './backup-restore'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// actions/backup-restore.ts
"use server";

import { verifySession } from "@/lib/session";

export type SuperadminGuard =
  | { ok: true; userId: number; username: string }
  | { ok: false; status: number; message: string };

export async function requireSuperadmin(): Promise<SuperadminGuard> {
  const session = await verifySession();
  if (!session) return { ok: false, status: 401, message: "Sesi tidak valid." };
  if (session.role !== "superadmin") return { ok: false, status: 403, message: "Hanya superadmin yang dapat menggunakan backup dan restore." };
  return { ok: true, userId: session.userId, username: session.username };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run actions/backup-restore.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add actions/backup-restore.ts actions/backup-restore.test.ts
git commit -m "feat: add superadmin guard for backup actions"
```

---

### Task 10: Implement backup download API route

**Files:**
- Create: `app/api/admin/backup/route.ts`

- [ ] **Step 1: Write the failing test**

There is no useful integration test for an API route streaming a real `pg_dump`; the underlying logic is already covered by Tasks 5, 7, 8, 9. Skip the test for this task and rely on the manual smoke run in Step 4. Document the decision in the commit message.

- [ ] **Step 2: Implement the route**

```ts
// app/api/admin/backup/route.ts
import { requireSuperadmin } from "@/actions/backup-restore";
import { logAudit } from "@/lib/audit";
import { buildBackupArchive } from "@/lib/backup/build-archive";
import { resolveBackupEnv } from "@/lib/backup/env";
import { acquireLock, releaseLock } from "@/lib/backup/lock";
import { PassThrough } from "node:stream";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET() {
  const guard = await requireSuperadmin();
  if (!guard.ok) {
    return new Response(JSON.stringify({ message: guard.message }), { status: guard.status, headers: { "content-type": "application/json" } });
  }

  const env = resolveBackupEnv();
  if (!acquireLock(env.backupLockPath)) {
    return new Response(JSON.stringify({ message: "Backup lain sedang berjalan. Coba lagi nanti." }), { status: 409, headers: { "content-type": "application/json" } });
  }

  const filename = `dccheck-backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.zip`;
  const passthrough = new PassThrough();

  let totalBytes = 0;
  passthrough.on("data", (chunk: Buffer) => { totalBytes += chunk.length; });

  buildBackupArchive({
    output: passthrough,
    uploadsDir: env.uploadsDir,
    database: env.database,
  }).then(async () => {
    await logAudit({
      action: "DOWNLOAD",
      entity: "settings",
      entityName: "Backup",
      detail: `bytes=${totalBytes}`,
    });
  }).catch((error) => {
    passthrough.destroy(error instanceof Error ? error : new Error(String(error)));
  }).finally(() => {
    releaseLock(env.backupLockPath);
  });

  return new Response(passthrough as unknown as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `No errors found`.

- [ ] **Step 4: Manual smoke run**

In a development environment with Postgres reachable, start the dev server (`npm run dev`), authenticate as superadmin, hit `/api/admin/backup`. Confirm a ZIP downloads and contains `dump.dump` plus the uploads tree. Discard the file afterward.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/backup/route.ts
git commit -m "feat: stream Postgres dump and uploads from /api/admin/backup"
```

---

### Task 11: Implement restore upload API route

**Files:**
- Create: `app/api/admin/restore/route.ts`

- [ ] **Step 1: Write the failing test**

The route logic mirrors the helper function tests already written in Task 6. Skip the integration test and rely on the manual smoke run in Step 4. Document the decision in the commit message.

- [ ] **Step 2: Implement the route**

```ts
// app/api/admin/restore/route.ts
import { requireSuperadmin } from "@/actions/backup-restore";
import { logAudit } from "@/lib/audit";
import { resolveBackupEnv } from "@/lib/backup/env";
import { acquireLock, releaseLock } from "@/lib/backup/lock";
import { restoreBackupArchive } from "@/lib/backup/restore-archive";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  const guard = await requireSuperadmin();
  if (!guard.ok) {
    return new Response(JSON.stringify({ message: guard.message }), { status: guard.status, headers: { "content-type": "application/json" } });
  }

  const env = resolveBackupEnv();
  if (!acquireLock(env.restoreLockPath)) {
    return new Response(JSON.stringify({ message: "Restore lain sedang berjalan. Coba lagi nanti." }), { status: 409, headers: { "content-type": "application/json" } });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("archive");
    const modeValue = formData.get("mode");
    if (!(file instanceof File) || file.size === 0) {
      return new Response(JSON.stringify({ message: "File backup wajib diunggah." }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const mode = modeValue === "append" ? "append" : "wipe";
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await restoreBackupArchive({
      archive: buffer,
      uploadsDir: env.uploadsDir,
      mode,
      database: env.database,
    });

    await logAudit({
      action: "RESTORE",
      entity: "settings",
      entityName: "Backup",
      detail: `mode=${result.mode}, bytes=${buffer.length}, warnings=${result.warnings.length}`,
    });

    return new Response(JSON.stringify({ ok: true, mode: result.mode, warnings: result.warnings }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  catch (error) {
    const message = error instanceof Error ? error.message : "Restore gagal.";
    await logAudit({
      action: "RESTORE",
      entity: "settings",
      entityName: "Backup",
      detail: `failed: ${message}`,
    });
    return new Response(JSON.stringify({ message }), { status: 500, headers: { "content-type": "application/json" } });
  }
  finally {
    releaseLock(env.restoreLockPath);
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `No errors found`.

- [ ] **Step 4: Manual smoke run**

With a copy of a small valid backup ZIP, start the dev server, authenticate as superadmin, POST the file to `/api/admin/restore` with `mode=wipe`. Confirm the response is `{ ok: true, mode: "wipe", warnings: [] }` and the database tables are rehydrated. Repeat with `mode=append` against an existing schema and confirm the response includes any pg_restore warnings.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/restore/route.ts
git commit -m "feat: accept ZIP upload at /api/admin/restore and rehydrate"
```

---

### Task 12: Build the Backup & Restore UI

**Files:**
- Create: `app/(dashboard)/admin/backup/page.tsx`
- Create: `components/admin/backup-form.tsx`

- [ ] **Step 1: Write the failing test**

UI is a thin client component over the two routes; vitest does not exercise client routing. Skip the unit test and verify behavior via the manual smoke run in Step 5.

- [ ] **Step 2: Implement the page**

```tsx
// app/(dashboard)/admin/backup/page.tsx
import BackupForm from "@/components/admin/backup-form";
import { verifySession } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata = {
    title: "Backup & Restore | DataGuard Admin",
    description: "Backup dan restore database serta uploads untuk migrasi server.",
};

export default async function BackupPage() {
    const session = await verifySession();
    if (!session || session.role !== "superadmin") {
        redirect("/admin");
    }

    return (
        <div className="py-8 px-6 max-w-4xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white tracking-tight">Backup &amp; Restore</h1>
                <p className="text-sm text-slate-400 mt-1">
                    Buat ZIP archive berisi pg_dump dan folder uploads, lalu restore ke server tujuan saat migrasi.
                </p>
            </div>
            <BackupForm />
        </div>
    );
}
```

- [ ] **Step 3: Implement the form component**

```tsx
// components/admin/backup-form.tsx
"use client";

import ActionButton from "@/components/ui/action-button";
import { useState } from "react";

export default function BackupForm() {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [mode, setMode] = useState<"wipe" | "append">("wipe");

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch("/api/admin/backup");
      if (!response.ok) throw new Error((await response.json()).message ?? "Backup gagal");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dccheck-backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
    catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Backup gagal");
    }
    finally {
      setDownloading(false);
    }
  }

  async function handleRestore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRestoring(true);
    setRestoreMessage(null);
    setRestoreError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("mode", mode);
    try {
      const response = await fetch("/api/admin/restore", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Restore gagal");
      setRestoreMessage(`Restore berhasil dalam mode ${body.mode}.${body.warnings.length ? ` Peringatan: ${body.warnings.join("; ")}` : ""}`);
      form.reset();
    }
    catch (error) {
      setRestoreError(error instanceof Error ? error.message : "Restore gagal");
    }
    finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
        <h2 className="text-sm font-semibold text-white">Backup</h2>
        <p className="mt-1 text-xs text-slate-400">Hasil download adalah ZIP berisi `dump.dump` dan folder `uploads/`.</p>
        <div className="mt-4 flex items-center gap-3">
          <ActionButton type="button" isPending={downloading} onClick={handleDownload}>
            Generate Backup
          </ActionButton>
          {downloadError && <span className="text-sm text-red-300">{downloadError}</span>}
        </div>
      </section>

      <form onSubmit={handleRestore} className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-white">Restore</h2>
        <p className="text-xs text-slate-400">Upload ZIP yang dihasilkan dari halaman backup. Mode wipe akan menghapus skema yang ada terlebih dahulu.</p>
        <label className="block text-sm font-medium text-slate-300">
          Archive
          <input type="file" name="archive" accept=".zip" required className="mt-1 block w-full text-sm text-slate-200" />
        </label>
        <label className="block text-sm font-medium text-slate-300">
          Mode
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value === "append" ? "append" : "wipe")}
            className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
          >
            <option value="wipe">Wipe &amp; restore</option>
            <option value="append">Append only</option>
          </select>
        </label>
        <ActionButton type="submit" isPending={restoring}>
          Restore
        </ActionButton>
        {restoreMessage && <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">{restoreMessage}</div>}
        {restoreError && <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{restoreError}</div>}
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `No errors found`.

- [ ] **Step 5: Manual smoke run**

Start `npm run dev`, sign in as superadmin, navigate to `/admin/backup`, generate a backup, then restore the resulting ZIP into the same database with mode `wipe`. Confirm the success banner shows and the page refreshes without error. Confirm a non-superadmin redirects to `/admin`.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/admin/backup/page.tsx" components/admin/backup-form.tsx
git commit -m "feat: superadmin Backup and Restore page"
```

---

### Task 13: Add Backup link to admin shortcuts

**Files:**
- Modify: `app/(dashboard)/admin/page.tsx:84-97`

- [ ] **Step 1: Add the entry to the governance shortcuts**

Edit `app/(dashboard)/admin/page.tsx`. Find the existing block where governance shortcuts are appended for superadmins. Insert a Backup shortcut visible only to superadmins:

```tsx
  if (session.role === "superadmin") {
    governanceShortcuts.push({ href: "/admin/sites", label: "Sites", meta: "Multi-site scope", icon: <Building2 className="size-5" /> });
    governanceShortcuts.push({ href: "/admin/backup", label: "Backup & Restore", meta: "Migrasi server", icon: <DatabaseBackup className="size-5" /> });
  }
```

Add `DatabaseBackup` to the `lucide-react` imports at the top of the file:

```tsx
import {
  Boxes,
  Building2,
  CircleAlert,
  DatabaseBackup,
  FileSearch,
  FolderTree,
  MapPin,
  Network,
  PanelTop,
  RadioTower,
  ScrollText,
  Server,
  Settings,
  ShieldAlert,
  Tag,
  Users,
} from "lucide-react";
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `No errors found`.

- [ ] **Step 3: Manual smoke run**

Start the dev server, sign in as superadmin, confirm Backup & Restore appears in the Governance group. Sign in as admin, confirm it does not appear.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/admin/page.tsx"
git commit -m "feat: link Backup and Restore from admin home"
```

---

### Task 14: Final verification and push

- [ ] **Step 1: Run the full vitest suite**

Run: `npx vitest run`
Expected: every test file passes.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `No errors found`.

- [ ] **Step 3: Push the branch to origin/main**

```bash
git push origin HEAD:main
```

- [ ] **Step 4: Trigger production update**

After the push completes, run `.\update.ps1` on production. Confirm `/admin/backup` is reachable as superadmin and the Postgres client tools (`pg_dump --version`, `pg_restore --version`, `unzip -v`) succeed inside the running app container.

---

## Self-Review

**Spec coverage:**

- Goal: Tasks 10, 11, 12, 13.
- Scope (one-shot manual backup / restore, wipe vs append, superadmin-only, audit logs): Tasks 9, 10, 11, 12.
- Architecture (API routes, archiver streaming, runShell adapter, locks, image tooling): Tasks 3, 4, 5, 6, 7, 8, 10, 11.
- File structure: Tasks 4-12 each create or modify a single listed file.
- Backup flow: Tasks 5, 7, 8, 10.
- Restore flow: Tasks 6, 7, 8, 11.
- Authentication: Task 9 plus the page check in Task 12.
- Audit logging: Task 1 (new actions) plus calls in Tasks 10 and 11.
- Image requirements: Task 3.
- Error handling: Tasks 5, 6, 7, 10, 11 all surface the documented failure modes.
- Testing: Tasks 1, 4, 5, 6, 7, 8, 9 produce automated tests; Tasks 10, 11, 12, 13 document the manual smoke run.
- Operator procedure: Task 14 covers the final production verification step.

**Placeholder scan:** No TBD, TODO, "implement later", or open-ended instructions remain. Tasks 10, 11, 12 explicitly document why they skip the failing test step instead of waving at "tests later".

**Type consistency:** `DatabaseTarget`, `RunShellResult`, `RestoreMode`, `BackupEnv`, and the `requireSuperadmin` return shape are defined in their owning task and consumed in later tasks with the same names and signatures.
