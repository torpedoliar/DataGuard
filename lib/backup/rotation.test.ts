import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rotateBackups } from "./rotation";

/**
 * Create a backup file with the conventional name and mtime in the past.
 * `ageMs` controls how old the file is; the parsed date is in the filename.
 */
function makeBackup(dir: string, name: string, ageMs: number): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, "");
  const mtime = new Date(Date.now() - ageMs);
  utimesSync(filePath, mtime, mtime);
  return filePath;
}

function names(paths: string[]): string[] {
  return paths.map((p) => path.basename(p)).sort();
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/**
 * Build an ISO-style filename `daysAgo` days ago at `hour` UTC.
 */
function dailyName(daysAgo: number, hour = 2): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(hour);
  return `dccheck-backup-${y}${m}${day}-${h}0000.zip`;
}

describe("rotateBackups", () => {
  it("returns empty arrays when the backup dir is empty", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dccheck-rotate-"));
    try {
      const result = await rotateBackups(dir, { daily: 7, weekly: 4, monthly: 12 });
      expect(result.kept).toEqual([]);
      expect(result.deleted).toEqual([]);
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps all 5 daily backups when daily retention is 7", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dccheck-rotate-"));
    try {
      const files = [
        makeBackup(dir, dailyName(5), 5 * 24 * 60 * 60 * 1000),
        makeBackup(dir, dailyName(4), 4 * 24 * 60 * 60 * 1000),
        makeBackup(dir, dailyName(3), 3 * 24 * 60 * 60 * 1000),
        makeBackup(dir, dailyName(2), 2 * 24 * 60 * 60 * 1000),
        makeBackup(dir, dailyName(1), 1 * 24 * 60 * 60 * 1000),
      ];
      const result = await rotateBackups(dir, { daily: 7, weekly: 4, monthly: 12 });
      expect(result.deleted).toEqual([]);
      expect(names(result.kept).sort()).toEqual(names(files).sort());
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps daily/weekly/monthly candidates and deletes the rest (30 days, 1/day)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dccheck-rotate-"));
    try {
      const allFiles: string[] = [];
      for (let i = 1; i <= 30; i++) {
        allFiles.push(makeBackup(dir, dailyName(i), i * 24 * 60 * 60 * 1000));
      }
      const result = await rotateBackups(dir, { daily: 7, weekly: 4, monthly: 12 });

      // 30 entries; daily=7 keeps 7; weekly=4 keeps 4 (one per week); monthly=12 keeps ~2 (one per month).
      // Their union is at most 7+4+2=13, possibly less due to overlap. So:
      //   - kept <= 13
      //   - deleted >= 17
      //   - kept + deleted === 30
      const totalKept = result.kept.length;
      const totalDeleted = result.deleted.length;
      expect(totalKept + totalDeleted).toBe(30);
      expect(totalKept).toBeGreaterThanOrEqual(7);
      expect(totalKept).toBeLessThanOrEqual(13);
      expect(totalDeleted).toBeGreaterThanOrEqual(17);

      // The 7 most recent (youngest) files must be among the kept set (one per day).
      const keptNames = new Set(names(result.kept));
      for (let i = 1; i <= 7; i++) {
        expect(keptNames.has(path.basename(dailyName(i)))).toBe(true);
      }

      // The oldest 7 files (i=24..30) should not be kept (older than 1 month, not in any slot).
      for (let i = 24; i <= 30; i++) {
        expect(keptNames.has(path.basename(dailyName(i)))).toBe(false);
      }
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves weekly and monthly candidates when there are multiple backups per day", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dccheck-rotate-"));
    try {
      // 3 backups per day for 60 days = 180 backups, all within last 60 days.
      for (let day = 1; day <= 60; day++) {
        for (let hour = 0; hour < 3; hour++) {
          makeBackup(dir, dailyName(day, hour), day * 24 * 60 * 60 * 1000 - hour * 60 * 60 * 1000);
        }
      }

      const result = await rotateBackups(dir, { daily: 7, weekly: 4, monthly: 12 });

      // 180 entries. daily=7 keeps 7 (one per day = 7 files). weekly=4 keeps 4 (~7 days each)
      // but each week spans multiple days, so weekly representatives may fall outside the daily window
      // (i.e. older weeks). monthly=12 keeps 2-3 months.
      //   - kept >= 7
      //   - kept <= 7 + 4 + 3 = 14
      expect(result.kept.length).toBeGreaterThanOrEqual(7);
      expect(result.kept.length).toBeLessThanOrEqual(14);
      expect(result.kept.length + result.deleted.length).toBe(180);

      // The most recent backup must always be kept (it is the most-recent
      // representative of "today" in UTC).  We check the most-recent filename
      // (any of the 3 hours of day 0 or day 1) since the test may run across
      // the UTC midnight boundary.
      const dayZeroHourZero = dailyName(0, 0);
      const dayZeroHourOne = dailyName(0, 1);
      const dayZeroHourTwo = dailyName(0, 2);
      const dayOneHourZero = dailyName(1, 0);
      const dayOneHourOne = dailyName(1, 1);
      const dayOneHourTwo = dailyName(1, 2);
      const keptNames = new Set(names(result.kept));
      const someRecent = [
        dayZeroHourZero, dayZeroHourOne, dayZeroHourTwo,
        dayOneHourZero, dayOneHourOne, dayOneHourTwo,
      ].some((n) => keptNames.has(n));
      expect(someRecent).toBe(true);

      // Files from day 50-60 should be deleted (too old for any retention slot).
      for (let day = 55; day <= 60; day++) {
        for (let hour = 0; hour < 3; hour++) {
          expect(keptNames.has(dailyName(day, hour))).toBe(false);
        }
      }
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores files that do not match the backup naming pattern", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dccheck-rotate-"));
    try {
      const real = makeBackup(dir, dailyName(0), 0);
      const stale = makeBackup(dir, "random-file.txt", 60 * 24 * 60 * 60 * 1000);
      const result = await rotateBackups(dir, { daily: 7, weekly: 4, monthly: 12 });
      expect(result.kept).toContain(real);
      // Non-matching files are ignored (not in kept, not in deleted) — they survive.
      expect(result.kept).not.toContain(stale);
      expect(result.deleted).not.toContain(stale);
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
