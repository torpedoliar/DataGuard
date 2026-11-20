/**
 * Provider write-outcome classification.
 *
 * Pure. The single rule this module enforces: an ambiguous response is never
 * treated as a rejection and never retried. A request that may have reached
 * the provider becomes `outcome_unknown` and is resolved by observation, not
 * by a second POST.
 */
import type { JsonValue } from "./execution-request";
import type { WriteOperation } from "./execution-capability";

export type DispatchClassification =
  | {
      kind: "accepted";
      providerRef: string | null;
      providerJobId: string | null;
      affectedItems: number | null;
      response: JsonValue;
    }
  | { kind: "definite_reject"; reason: string }
  | { kind: "outcome_unknown"; reason: string };

export type DispatchResponseInput = {
  operation: WriteOperation;
  /** HTTP status, or null when no response was received. */
  status: number | null;
  /** Parsed JSON body, when the provider returned one. */
  body: unknown;
  /** The exact device this request was approved for, when applicable. */
  expectedDeviceId?: string | null;
  /** The request was aborted by our own timeout. */
  timedOut?: boolean;
  /** The connection failed before a response could be read. */
  networkError?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asIdentifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim().slice(0, 200);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Keys a documented receipt can contain. Anything else is dropped before the
 * response is persisted: this is an allowlist, not a shape filter, so an echoed
 * token or password can never ride along in `epdr_actions.result`.
 */
const SAFE_RESPONSE_KEYS = new Set([
  "task_id", "taskId", "processed_device_ids", "processedDeviceIds",
  "id", "action_id", "actionId", "status", "message", "detail",
  "count", "total", "task_name", "type", "code",
]);

export function sanitizeResponseBody(value: unknown, depth = 0): JsonValue {
  if (depth > 3) return null;
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 300);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeResponseBody(item, depth + 1));
  const record = asRecord(value);
  if (!record) return null;
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(record).slice(0, 20)) {
    if (!SAFE_RESPONSE_KEYS.has(key)) continue;
    out[key] = sanitizeResponseBody(record[key], depth + 1);
  }
  return out;
}

function extractReceipt(
  operation: WriteOperation,
  body: unknown,
  expectedDeviceId?: string | null,
): { ok: true; providerRef: string | null; providerJobId: string | null; affectedItems: number | null }
  | { ok: false; reason: string } {
  const record = asRecord(body);

  if (operation.receipt === "task_id") {
    const taskId = asIdentifier(record?.task_id ?? record?.taskId ?? record?.id);
    if (!taskId) return { ok: false, reason: "missing_task_id" };
    return { ok: true, providerRef: taskId, providerJobId: taskId, affectedItems: null };
  }

  if (operation.receipt === "processed_device_ids") {
    const ids = record?.processed_device_ids ?? record?.processedDeviceIds;
    if (!Array.isArray(ids)) return { ok: false, reason: "missing_processed_device_ids" };
    const processed = ids.map((id) => asIdentifier(id)).filter((id): id is string => id !== null);
    // An empty acceptance list is not a success signal.
    if (processed.length === 0) return { ok: false, reason: "empty_processed_device_ids" };
    // The approved request targets exactly one device. A receipt that does not
    // mention it is ambiguous acceptance, not success for our target.
    if (expectedDeviceId && !processed.includes(expectedDeviceId)) {
      return { ok: false, reason: "unexpected_processed_device_ids" };
    }
    return { ok: true, providerRef: null, providerJobId: null, affectedItems: processed.length };
  }

  if (operation.receipt === "action_ref") {
    const actionId = asIdentifier(record?.id ?? record?.action_id ?? record?.actionId);
    if (!actionId) return { ok: false, reason: "missing_action_id" };
    return { ok: true, providerRef: actionId, providerJobId: null, affectedItems: null };
  }

  // `status` receipts: the mutation itself returns the new state.
  return { ok: true, providerRef: null, providerJobId: null, affectedItems: null };
}

/** Client-side rejections that prove the provider did not perform the action. */
const DEFINITE_REJECT_STATUSES = new Set([400, 401, 403, 404, 405, 409, 412, 415, 422, 429]);

export function classifyDispatchResponse(input: DispatchResponseInput): DispatchClassification {
  if (input.timedOut) return { kind: "outcome_unknown", reason: "client_timeout" };
  if (input.networkError) return { kind: "outcome_unknown", reason: "network_error" };
  if (input.status === null) return { kind: "outcome_unknown", reason: "no_response" };

  if (input.status >= 300 && input.status < 400) {
    return { kind: "outcome_unknown", reason: "redirect_refused" };
  }

  if (input.status >= 200 && input.status < 300) {
    const receipt = extractReceipt(input.operation, input.body, input.expectedDeviceId);
    if (!receipt.ok) {
      // A 2xx without the documented receipt field is ambiguous acceptance.
      return { kind: "outcome_unknown", reason: receipt.reason };
    }
    return {
      kind: "accepted",
      providerRef: receipt.providerRef,
      providerJobId: receipt.providerJobId,
      affectedItems: receipt.affectedItems,
      response: sanitizeResponseBody(input.body),
    };
  }

  if (DEFINITE_REJECT_STATUSES.has(input.status)) {
    return { kind: "definite_reject", reason: `http_${input.status}` };
  }

  if (input.status === 408) return { kind: "outcome_unknown", reason: "http_408" };

  if (input.status >= 500) {
    // The provider may have performed the action before failing to respond.
    return { kind: "outcome_unknown", reason: `http_${input.status}` };
  }

  return { kind: "outcome_unknown", reason: `http_${input.status}` };
}

/**
 * Marker embedded in a scan task name so a later read can correlate this exact
 * request. Bounded and charset-safe for the documented `task_name` field.
 */
export function scanTaskMarker(requestId: number): string {
  return `dcheck-${requestId}`;
}

export function buildScanTaskName(requestId: number, hostName: string | null): string {
  const host = (hostName ?? "endpoint").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60);
  return `${scanTaskMarker(requestId)} ${host}`;
}

/**
 * Exact marker match. A substring test would let request 1 adopt request 10's
 * task (`dcheck-1` is a prefix of `dcheck-10`).
 */
export function matchesScanTaskMarker(taskName: string, requestId: number): boolean {
  const marker = scanTaskMarker(requestId);
  const name = taskName.trim();
  return name === marker || name.startsWith(`${marker} `);
}

export type ScanJobAggregate = "completed" | "failed" | "pending" | "unreadable";

/**
 * Reduce every job in a scan task. A single failed job means the task failed;
 * success requires every reported job to be a success. Unrecognized statuses are
 * unreadable rather than "probably fine".
 *
 * Documented numeric mapping: 0,1,6 pending; 2 succeeded; 3,4,5,7 failed.
 * Result pages are never fetched here, so completion is not cleanliness.
 */
export function aggregateScanJobStatuses(raw: unknown): ScanJobAggregate {
  const array = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { data?: unknown }).data)
      ? ((raw as { data: unknown[] }).data)
      : null;
  if (!array || array.length === 0) return "unreadable";
  let sawPending = false;
  for (const item of array) {
    if (typeof item !== "object" || item === null) return "unreadable";
    const status = (item as { status?: unknown }).status;
    if (typeof status !== "number" || !Number.isInteger(status)) return "unreadable";
    if (status === 2) continue;
    if (status === 3 || status === 4 || status === 5 || status === 7) return "failed";
    if (status === 0 || status === 1 || status === 6) { sawPending = true; continue; }
    // An undocumented status is not progress we can trust.
    return "unreadable";
  }
  // Completed only when every reported device job completed.
  return sawPending ? "pending" : "completed";
}
