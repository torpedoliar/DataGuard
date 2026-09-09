import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { IncidentSeverity } from "./incidents";

// ==================== NCM ingest (ticket 06) ====================
// Pure domain logic for POST /api/ncm/ingest — unit-testable without
// Postgres. The route handles HMAC-site lookup, rate-limit, CSRF and
// Telegram fan-out; everything here is deterministic given `deps`.
//
// Wire source of truth: app_v4/service/events.py (envelope
// {type,payload,ts}, webhook names) + app_v4/service/notify.py
// (HMAC `sha256=<hex>` over the compact-JSON body).

export const NCM_EVENT_TYPES = [
  "backup_failed",
  "backup_ok",
  "drift",
  "review_opened",
  "review_decided",
  "device_offline",
] as const;

export type NcmEventType = (typeof NCM_EVENT_TYPES)[number];

// Payload shapes mirror the NCM publish() call sites in
// app_v4/service/backup_service.py and app_v4/service/api/reviews.py.
// All fields optional at the boundary — the route degrades to fallbacks,
// never 500s on a half-filled payload.
export const ncmIngestSchema = z.object({
  id: z.string().max(200).optional(),
  type: z.enum(NCM_EVENT_TYPES),
  payload: z.object({
    switch_id: z.union([z.number(), z.string()]).optional(),
    switch_name: z.string().max(300).optional(),
    backup_id: z.union([z.number(), z.string()]).optional(),
    review_id: z.union([z.number(), z.string()]).optional(),
    message: z.string().max(2000).optional(),
    status: z.string().max(100).optional(),
    comment: z.string().max(2000).optional(),
    switch_ip: z.string().max(100).optional(),
  }),
  ts: z.string(),
});

export type NcmIngestEvent = z.infer<typeof ncmIngestSchema>;
export type NcmPayload = NcmIngestEvent["payload"];

/**
 * Verify the X-NCM-Signature header (`sha256=<hex>`) over the raw body.
 * Fail-closed: any malformed input or empty secret returns false. Uses
 * timingSafeEqual so the comparison itself leaks nothing.
 */
export function verifyNcmSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!rawBody || !secret) return false;
  const header = signatureHeader?.trim() ?? "";
  const match = /^sha256=([0-9a-fA-F]+)$/.exec(header);
  if (!match) return false;
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"), "utf8");
    actual = Buffer.from(match[1]!.toLowerCase(), "utf8");
  } catch {
    return false;
  }
  if (expected.length !== actual.length || expected.length === 0) return false;
  return timingSafeEqual(expected, actual);
}

/** Severity map: backup_failed/device_offline → High, everything else → Medium. */
export function resolveSeverity(type: NcmEventType): IncidentSeverity {
  return type === "backup_failed" || type === "device_offline" ? "High" : "Medium";
}

/**
 * Dedupe key: the NCM event id when present, else a deterministic hash of
 * the identity-carrying fields (NOT ts — redeliveries change ts).
 * Stored as an `ncm_event_id:<key>` marker in the incident description.
 */
export function dedupeKeyOf(event: NcmIngestEvent): string {
  if (event.id) return event.id;
  const p = event.payload;
  const parts = [event.type, p.switch_id, p.backup_id, p.review_id, p.status]
    .map((v) => (v === undefined || v === null ? "" : String(v)))
    .join("|");
  return "sha256:" + createHash("sha256").update(parts, "utf8").digest("hex").slice(0, 32);
}

export function ncmEventMarker(event: NcmIngestEvent): string {
  return `ncm_event_id:${dedupeKeyOf(event)}`;
}

export type DeviceRef = { id: number; name: string };
export type OpenIncidentRef = { id: number; title: string };

/** Minimal DB surface processNcmEvent needs — trivially faked in tests. */
export type NcmIngestDeps = {
  findDevicesBySite(siteId: number): Promise<DeviceRef[]>;
  findOpenIncidentByMarker(siteId: number, marker: string): Promise<OpenIncidentRef | null>;
  findOpenBackupFailedIncident(siteId: number, switchName: string): Promise<OpenIncidentRef | null>;
  findOpenDriftIncident(siteId: number, switchName: string): Promise<OpenIncidentRef | null>;
  insertIncident(values: {
    siteId: number;
    deviceId: number;
    title: string;
    description: string | null;
    severity: IncidentSeverity;
  }): Promise<{ id: number; title: string }>;
  insertIncidentUpdate(values: { incidentId: number; note: string; newStatus: string }): Promise<void>;
  resolveIncident(incidentId: number, note: string): Promise<void>;
};

export type NcmIngestAction =
  | { kind: "created"; incidentId: number; severity: IncidentSeverity }
  | { kind: "resolved"; incidentId: number; severity: null };

export type NcmIngestOutcome = {
  actions: NcmIngestAction[];
  deviceId: number | null;
  incidentId: number | null;
};

function switchLabel(p: NcmPayload, fallback: string): string {
  const name = p.switch_name?.trim();
  if (name) return name;
  const id = p.switch_id !== undefined && p.switch_id !== null ? String(p.switch_id) : "";
  return id ? `switch #${id}` : fallback;
}

/**
 * Map switch name → DG device id, falling back to the site's first device
 * (incidents.deviceId is NOT NULL). Returns null only when the site has no
 * devices at all — the route answers 503 in that case.
 */
export async function resolveDeviceId(
  deps: Pick<NcmIngestDeps, "findDevicesBySite">,
  siteId: number,
  switchName: string | undefined,
): Promise<number | null> {
  const devices = await deps.findDevicesBySite(siteId);
  if (devices.length === 0) return null;
  const wanted = switchName?.trim().toLowerCase();
  if (wanted) {
    const exact = devices.find((d) => d.name.trim().toLowerCase() === wanted);
    if (exact) return exact.id;
  }
  return devices[0]!.id;
}

export async function processNcmEvent(
  deps: NcmIngestDeps,
  input: { siteId: number; siteName: string; event: NcmIngestEvent },
): Promise<NcmIngestOutcome> {
  const { siteId, event } = input;
  const p = event.payload;
  const marker = ncmEventMarker(event);

  // Global dedupe first: an already-processed id (or identical content
  // hash) is a no-op however many times NCM redelivers it.
  if (await deps.findOpenIncidentByMarker(siteId, marker)) {
    return { actions: [], deviceId: null, incidentId: null };
  }

  const label = switchLabel(p, "unknown switch");

  if (event.type === "backup_ok") {
    // No new incident — close the open backup_failed incident, if any.
    const open = await deps.findOpenBackupFailedIncident(siteId, label);
    if (!open) return { actions: [], deviceId: null, incidentId: null };
    const note = `Auto-resolved by NCM backup_ok (backup #${p.backup_id ?? "?"}). ${marker}`;
    await deps.resolveIncident(open.id, note);
    return { actions: [{ kind: "resolved", incidentId: open.id, severity: null }], deviceId: null, incidentId: open.id };
  }

  if (event.type === "review_decided") {
    // Only an approve closes drift; flagged/dismissed leave incidents as-is
    // (per ticket: reviews follow the existing incident policy).
    if (p.status !== "approved") return { actions: [], deviceId: null, incidentId: null };
    const open = await deps.findOpenDriftIncident(siteId, label);
    if (!open) return { actions: [], deviceId: null, incidentId: null };
    const note = `Auto-resolved by NCM review #${p.review_id ?? "?"} approved${p.comment ? `: ${p.comment}` : ""}. ${marker}`;
    await deps.resolveIncident(open.id, note);
    return { actions: [{ kind: "resolved", incidentId: open.id, severity: null }], deviceId: null, incidentId: open.id };
  }

  if (event.type === "review_opened") {
    // review_opened rides along with drift (config_drift fans out to both
    // webhook names) — annotate, don't double-file.
    const open = await deps.findOpenDriftIncident(siteId, label);
    if (open) {
      await deps.insertIncidentUpdate({
        incidentId: open.id,
        note: `NCM review #${p.review_id ?? "?"} opened for ${label}. ${marker}`,
        newStatus: "Open",
      });
      return { actions: [], deviceId: null, incidentId: open.id };
    }
    // No drift incident yet: fall through and file one below.
  }

  const deviceId = await resolveDeviceId(deps, siteId, p.switch_name);
  if (deviceId === null) return { actions: [], deviceId: null, incidentId: null };

  const severity = resolveSeverity(event.type);
  const detail = [p.message, p.status ? `status=${p.status}` : null]
    .filter(Boolean)
    .join(" — ");
  const description = [`[NCM ${event.type}] ${label}${detail ? ` — ${detail}` : ""}`, marker].join("\n");
  const title =
    event.type === "drift" || (event.type === "review_opened")
      ? `Config drift: ${label}`
      : event.type === "device_offline"
        ? `Device offline: ${label}`
        : `Backup failed: ${label}`;

  const created = await deps.insertIncident({ siteId, deviceId, title, description, severity });
  await deps.insertIncidentUpdate({
    incidentId: created.id,
    note: `Created from NCM ${event.type} event. ${marker}`,
    newStatus: "Open",
  });
  return { actions: [{ kind: "created", incidentId: created.id, severity }], deviceId, incidentId: created.id };
}
