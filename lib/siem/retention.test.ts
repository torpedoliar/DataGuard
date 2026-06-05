import { describe, expect, it } from "vitest";
import { buildSiemRetentionCutoffs, DEFAULT_SIEM_RETENTION_DAYS, normalizeRetentionDays, resolveSourceCutoffDays, mostLenientEventCutoff } from "./retention";

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

  it("resolves a source cutoff using its override, falling back to the global default", () => {
    expect(resolveSourceCutoffDays(30, 180)).toBe(30);
    expect(resolveSourceCutoffDays(null, 180)).toBe(180);
    expect(resolveSourceCutoffDays(0, 180)).toBe(180); // invalid override → global
    expect(resolveSourceCutoffDays(-5, 180)).toBe(180);
  });

  it("computes the most lenient event cutoff across sources and the global default", () => {
    const now = new Date("2026-06-08T00:00:00.000Z");
    // sources: 7d override, null (uses global 180), 30d override; global 180
    const cutoff = mostLenientEventCutoff(
      [{ eventRetentionDays: 7 }, { eventRetentionDays: null }, { eventRetentionDays: 30 }],
      180,
      now,
    );
    // most lenient = 180 days back
    expect(cutoff.toISOString()).toBe(new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString());
  });

  it("uses the largest override when it exceeds the global default", () => {
    const now = new Date("2026-06-08T00:00:00.000Z");
    const cutoff = mostLenientEventCutoff(
      [{ eventRetentionDays: 400 }, { eventRetentionDays: 30 }],
      180,
      now,
    );
    expect(cutoff.toISOString()).toBe(new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString());
  });
});
