/**
 * Dispatch payload builders (T07). Pure — no DB, no network. Payloads are built
 * server-side from typed action_type + frozen params + endpoint id; free-form
 * input never reaches the provider. The real transport is read-only, so these
 * builders feed the blocked write adapters (future dispatch path).
 */
import { WatchGuardError } from "@/lib/watchguard/errors";
import type { EpdrActionType } from "./action-types";

/** Format WatchGuard execution-window duration as `d.hh:mm:ss` (24h = 1.00:00:00). */
export function formatProviderDuration(hours: number): string {
  const totalSeconds = Math.max(0, Math.floor(hours * 3600));
  const days = Math.floor(totalSeconds / 86400);
  const rem = totalSeconds % 86400;
  const hh = String(Math.floor(rem / 3600)).padStart(2, "0");
  const mm = String(Math.floor((rem % 3600) / 60)).padStart(2, "0");
  const ss = String(rem % 60).padStart(2, "0");
  return `${days}.${hh}:${mm}:${ss}`;
}

export type ActionParams = Record<string, unknown>;

export function buildScanPayload(input: {
  deviceIds: string[];
  taskName: string;
  taskDescription?: string;
  scanScope?: number;
  windowHours?: number;
}): ActionParams {
  return {
    device_ids: input.deviceIds,
    task_name: input.taskName,
    task_description: input.taskDescription ?? "",
    scan_scope: input.scanScope ?? 0,
    detect_hacking_tools: true,
    detect_suspicious_files: true,
    scan_compressed_files: true,
    execution_window_expiration: formatProviderDuration(input.windowHours ?? 24),
  };
}

export function buildRebootPayload(deviceIds: string[], countDownType?: number): ActionParams {
  return { device_ids: deviceIds, action_type: 1, count_down_type: countDownType ?? 7 };
}

export function buildEndpointActionPayload(
  actionType: EpdrActionType,
  params: ActionParams,
  endpoint: { wgDeviceId: string; incidentId: number | null },
): ActionParams {
  const deviceIds = [endpoint.wgDeviceId];
  switch (actionType) {
    case "scan": {
      return buildScanPayload({
        deviceIds,
        taskName: `dc-check action:${endpoint.wgDeviceId} incident:${endpoint.incidentId ?? "none"}`,
        scanScope: (params.scanScope as number | undefined) ?? 0,
        windowHours: (params.windowHours as number | undefined) ?? 24,
      });
    }
    case "reboot": {
      return buildRebootPayload(deviceIds, (params.countDownType as number | undefined) ?? 7);
    }
    default: {
      // isolation / ThreatSync commands are approval-only and land in T10.
      throw new WatchGuardError("read_only_blocked", `WATCHGUARD_READ_ONLY_BLOCKED: action type ${actionType} not enabled`);
    }
  }
}