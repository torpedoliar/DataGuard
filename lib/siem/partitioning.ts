const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export type WeekRange = {
  start: Date;
  end: Date; // half-open: [start, end)
  suffix: string;
};

/**
 * Snap a date down to 00:00:00 UTC of the Monday that begins its week.
 * Uses a fixed Monday epoch so buckets never overlap and are timezone-stable.
 */
export function weekStart(date: Date): Date {
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dow = new Date(utcMidnight).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0, Sun=6
  return new Date(utcMidnight - daysSinceMonday * MS_PER_DAY);
}

/** Compact YYYYMMDD suffix of the week start, used in partition table names. */
export function partitionSuffix(date: Date): string {
  const start = weekStart(date);
  const y = start.getUTCFullYear().toString().padStart(4, "0");
  const m = (start.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = start.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Full partition table name for a base table and a date. */
export function partitionName(baseTable: string, date: Date): string {
  return `${baseTable}_p${partitionSuffix(date)}`;
}

/** Half-open [start, end) range for the week containing `date`. */
export function weekRange(date: Date): WeekRange {
  const start = weekStart(date);
  const end = new Date(start.getTime() + MS_PER_WEEK);
  return { start, end, suffix: partitionSuffix(start) };
}

/**
 * Weeks covering [now - weeksBack ... now + weeksAhead], inclusive, ascending.
 * Used to pre-create upcoming partitions (and re-assert recent ones idempotently).
 */
export function partitionsForWindow(now: Date, weeksBack: number, weeksAhead: number): WeekRange[] {
  const current = weekStart(now);
  const weeks: WeekRange[] = [];
  for (let i = -weeksBack; i <= weeksAhead; i++) {
    weeks.push(weekRange(new Date(current.getTime() + i * MS_PER_WEEK)));
  }
  return weeks;
}

/** A partition is fully expired when its whole range is at/older than the cutoff. */
export function isPartitionFullyExpired(range: WeekRange, cutoff: Date): boolean {
  return range.end.getTime() <= cutoff.getTime();
}
