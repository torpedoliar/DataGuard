import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export type RetentionConfig = {
  daily: number;
  weekly: number;
  monthly: number;
};

export type RotateResult = {
  kept: string[];
  deleted: string[];
};

const BACKUP_NAME_PATTERN = /^dccheck-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/;

type BackupEntry = {
  filePath: string;
  name: string;
  date: Date;
  isoWeekKey: string;
  yearMonthKey: string;
  yearDayKey: string;
};

/**
 * Parse "dccheck-backup-YYYYMMDD-HHMMSS.zip" into a structured entry.
 * Returns null if the name doesn't match the convention.
 */
function parseBackupName(name: string, filePath: string): BackupEntry | null {
  const match = BACKUP_NAME_PATTERN.exec(name);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;

  // ISO week: compute year-week using the algorithm from ISO 8601.
  const { isoYear, isoWeek } = isoWeekFromDate(date);
  const isoWeekKey = `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
  const yearMonthKey = `${year}-${month}`;
  const yearDayKey = `${year}-${month}-${day}`;
  return { filePath, name, date, isoWeekKey, yearMonthKey, yearDayKey };
}

function isoWeekFromDate(date: Date): { isoYear: number; isoWeek: number } {
  // Copy date to avoid mutation and set to nearest Thursday (current date + 4 - current day number)
  // Make Sunday = 7 (per ISO 8601)
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { isoYear: d.getUTCFullYear(), isoWeek: weekNo };
}

/**
 * Pick N group representatives — for each group key, the most-recent entry.
 * Returns the set of file paths that survived. If a group is empty, nothing is picked.
 */
function pickTopGroups(entries: BackupEntry[], keyFn: (entry: BackupEntry) => string, keepN: number): Set<string> {
  if (keepN <= 0) return new Set();
  const groups = new Map<string, BackupEntry>();
  for (const entry of entries) {
    const key = keyFn(entry);
    const existing = groups.get(key);
    if (!existing || entry.date.getTime() > existing.date.getTime()) {
      groups.set(key, entry);
    }
  }
  // Order groups by their most-recent entry's date (descending).
  const representatives = Array.from(groups.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  const chosen = new Set<string>();
  for (let i = 0; i < Math.min(keepN, representatives.length); i++) {
    chosen.add(representatives[i]!.filePath);
  }
  return chosen;
}

/**
 * Apply a 7/4/12 retention policy to the backup directory.
 *
 * Strategy:
 *   1. Parse filenames matching `dccheck-backup-YYYYMMDD-HHMMSS.zip`.
 *   2. For each day / ISO week / calendar month, pick the most-recent backup.
 *   3. Take the top-N daily, top-N weekly, top-N monthly representatives.
 *   4. Keep the union of those representatives; delete the rest of the parsed set.
 *   5. Files not matching the pattern are left untouched.
 */
export async function rotateBackups(backupDir: string, retention: RetentionConfig): Promise<RotateResult> {
  const fileNames = readdirSync(backupDir);
  const entries: BackupEntry[] = [];
  for (const name of fileNames) {
    const filePath = path.join(backupDir, name);
    let stats;
    try {
      stats = statSync(filePath);
    }
    catch {
      continue;
    }
    if (!stats.isFile()) continue;
    const entry = parseBackupName(name, filePath);
    if (entry) entries.push(entry);
  }

  const dailyKept = pickTopGroups(entries, (e) => e.yearDayKey, retention.daily);
  const weeklyKept = pickTopGroups(entries, (e) => e.isoWeekKey, retention.weekly);
  const monthlyKept = pickTopGroups(entries, (e) => e.yearMonthKey, retention.monthly);

  const keep = new Set<string>([...dailyKept, ...weeklyKept, ...monthlyKept]);

  const kept: string[] = [];
  const deleted: string[] = [];
  for (const entry of entries) {
    if (keep.has(entry.filePath)) kept.push(entry.filePath);
    else deleted.push(entry.filePath);
  }

  for (const f of deleted) {
    try {
      rmSync(f, { force: true });
    }
    catch (error) {
      // Surface deletion errors via stderr but don't fail the rotation.
      console.error(`[rotateBackups] failed to delete ${f}:`, error);
    }
  }

  kept.sort();
  deleted.sort();
  return { kept, deleted };
}
