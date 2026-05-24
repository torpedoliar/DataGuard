import { describe, expect, it } from "vitest";
import { buildSiemRetentionCutoffs, DEFAULT_SIEM_RETENTION_DAYS, normalizeRetentionDays } from "./retention";

describe("SIEM retention", () => {
  it("normalizes invalid retention values to defaults", () => {
    expect(normalizeRetentionDays(null, 90)).toBe(90);
    expect(normalizeRetentionDays(0, 90)).toBe(90);
    expect(normalizeRetentionDays(-1, 90)).toBe(90);
    expect(normalizeRetentionDays(1.9, 90)).toBe(1);
  });

  it("builds cutoff dates from settings", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    const cutoffs = buildSiemRetentionCutoffs({ rawRetentionDays: 2, eventRetentionDays: 3, findingRetentionDays: 4, alertRetentionDays: 5 }, now);

    expect(cutoffs.raw.toISOString()).toBe("2026-05-22T12:00:00.000Z");
    expect(cutoffs.events.toISOString()).toBe("2026-05-21T12:00:00.000Z");
    expect(cutoffs.findings.toISOString()).toBe("2026-05-20T12:00:00.000Z");
    expect(cutoffs.alerts.toISOString()).toBe("2026-05-19T12:00:00.000Z");
  });

  it("uses default cutoffs when settings are absent", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    const cutoffs = buildSiemRetentionCutoffs(null, now);

    expect(cutoffs.raw.getTime()).toBe(now.getTime() - DEFAULT_SIEM_RETENTION_DAYS.raw * 24 * 60 * 60 * 1000);
    expect(cutoffs.events.getTime()).toBe(now.getTime() - DEFAULT_SIEM_RETENTION_DAYS.events * 24 * 60 * 60 * 1000);
    expect(cutoffs.findings.getTime()).toBe(now.getTime() - DEFAULT_SIEM_RETENTION_DAYS.findings * 24 * 60 * 60 * 1000);
    expect(cutoffs.alerts.getTime()).toBe(now.getTime() - DEFAULT_SIEM_RETENTION_DAYS.alerts * 24 * 60 * 60 * 1000);
  });
});
