import { describe, expect, it } from "vitest";
import {
  accountSchema,
  dataEnvelopeSchema,
  deviceSchema,
  managedConfigurationSchema,
  protectionStatusSchema,
  securityEventSchema,
  taskJobStatusSchema,
  taskSchema,
  threatSyncActionSchema,
  threatSyncIncidentSchema,
  threatSyncListEnvelopeSchema,
  tokenResponseSchema,
  unmanagedDeviceSchema,
} from "./schemas";

import tokenFixture from "./fixtures/token.json";
import accountFixture from "./fixtures/account.json";
import devicesFixture from "./fixtures/devices.json";
import protectionFixture from "./fixtures/devices-protection-status.json";
import licensesFixture from "./fixtures/licenses.json";
import securityEventsFixture from "./fixtures/security-events.json";
import countersFixture from "./fixtures/security-event-counters.json";
import tasksFixture from "./fixtures/tasks.json";
import taskJobStatusFixture from "./fixtures/task-job-status.json";
import unmanagedFixture from "./fixtures/unmanaged-devices.json";
import managedConfigFixture from "./fixtures/managed-configurations.json";
import threatSyncIncidentsFixture from "./fixtures/threatsync-incidents.json";
import threatSyncIncidentFixture from "./fixtures/threatsync-incident.json";
import threatSyncActionFixture from "./fixtures/threatsync-incident-action.json";

describe("WatchGuard response schemas", () => {
  it("parse every checked-in fixture", () => {
    expect(tokenResponseSchema.safeParse(tokenFixture).success).toBe(true);
    expect(accountSchema.safeParse(accountFixture).success).toBe(true);
    expect(dataEnvelopeSchema.safeParse(devicesFixture).success).toBe(true);
    expect(deviceSchema.safeParse(devicesFixture.data[0]).success).toBe(true);
    expect(protectionStatusSchema.safeParse(protectionFixture.data[0]).success).toBe(true);
    expect(dataEnvelopeSchema.safeParse(licensesFixture).success).toBe(true);
    expect(securityEventSchema.safeParse(securityEventsFixture.data[0]).success).toBe(true);
    expect(dataEnvelopeSchema.safeParse(countersFixture).success).toBe(true);
    expect(taskSchema.safeParse(tasksFixture.data[0]).success).toBe(true);
    expect(taskJobStatusSchema.safeParse(taskJobStatusFixture.data[0]).success).toBe(true);
    expect(unmanagedDeviceSchema.safeParse(unmanagedFixture.data[0]).success).toBe(true);
    expect(managedConfigurationSchema.safeParse(managedConfigFixture.data[0]).success).toBe(true);
    expect(threatSyncListEnvelopeSchema.safeParse(threatSyncIncidentsFixture).success).toBe(true);
    expect(threatSyncIncidentSchema.safeParse(threatSyncIncidentFixture).success).toBe(true);
    expect(threatSyncActionSchema.safeParse(threatSyncActionFixture).success).toBe(true);
  });

  it("keeps unknown numeric enums as numbers instead of throwing", () => {
    const device = deviceSchema.safeParse({
      device_id: "x",
      device_type: 999,
      platform_id: 888,
      last_connection: "2026-11-09T00:00:00Z",
    });
    expect(device.success).toBe(true);
    if (device.success) {
      expect(device.data.device_type).toBe(999);
      expect(device.data.platform_id).toBe(888);
    }

    const status = protectionStatusSchema.safeParse({ device_id: "x", accumulated_protection_status: 99 });
    expect(status.success).toBe(true);
    if (status.success) expect(status.data.accumulated_protection_status).toBe(99);
  });

  it("preserves undocumented fields via passthrough", () => {
    const parsed = deviceSchema.safeParse({ device_id: "x", future_field: { nested: true } });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect((parsed.data as Record<string, unknown>).future_field).toEqual({ nested: true });
  });
});