import { describe, expect, it } from "vitest";
import {
  weekStart,
  partitionSuffix,
  partitionName,
  weekRange,
  partitionsForWindow,
  isPartitionFullyExpired,
} from "./partitioning";

describe("siem partitioning", () => {
  it("snaps a date down to the Monday 00:00 UTC of its week", () => {
    // 2026-06-05 is a Friday; its week starts Monday 2026-06-01
    const start = weekStart(new Date("2026-06-05T13:45:00.000Z"));
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("returns the same Monday when the date already is that Monday", () => {
    const start = weekStart(new Date("2026-06-01T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("builds a stable suffix from the week start", () => {
    expect(partitionSuffix(new Date("2026-06-05T13:45:00.000Z"))).toBe("20260601");
  });

  it("builds partition table names per base table", () => {
    const date = new Date("2026-06-05T13:45:00.000Z");
    expect(partitionName("syslog_events", date)).toBe("syslog_events_p20260601");
    expect(partitionName("syslog_events_raw", date)).toBe("syslog_events_raw_p20260601");
  });

  it("returns a half-open [start, end) week range of exactly 7 days", () => {
    const range = weekRange(new Date("2026-06-05T13:45:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });

  it("lists partitions covering a window from weeksBack to weeksAhead inclusive", () => {
    const now = new Date("2026-06-05T13:45:00.000Z");
    const weeks = partitionsForWindow(now, 1, 1);
    expect(weeks.map((w) => w.suffix)).toEqual(["20260525", "20260601", "20260608"]);
  });

  it("treats a partition as fully expired only when its end is at or before the cutoff", () => {
    const range = weekRange(new Date("2026-06-01T00:00:00.000Z")); // ends 2026-06-08
    expect(isPartitionFullyExpired(range, new Date("2026-06-08T00:00:00.000Z"))).toBe(true);
    expect(isPartitionFullyExpired(range, new Date("2026-06-09T00:00:00.000Z"))).toBe(true);
    expect(isPartitionFullyExpired(range, new Date("2026-06-07T23:59:59.000Z"))).toBe(false);
  });
});
