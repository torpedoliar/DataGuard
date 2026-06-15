#!/usr/bin/env tsx
import dotenv from "dotenv";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { logAudit } from "@/lib/audit";
import { writeBackupToFile } from "@/lib/backup/build-archive";
import { resolveBackupEnv } from "@/lib/backup/env";
import { acquireLock, releaseLock } from "@/lib/backup/lock";
import { rotateBackups, type RetentionConfig } from "@/lib/backup/rotation";

dotenv.config();

const scheduleHours = Number(process.env.BACKUP_SCHEDULE_HOURS ?? "24");
const scheduleMs = Math.max(1, scheduleHours) * 60 * 60 * 1000;

const retention: RetentionConfig = {
  daily: Number(process.env.BACKUP_RETENTION_DAILY ?? "7"),
  weekly: Number(process.env.BACKUP_RETENTION_WEEKLY ?? "4"),
  monthly: Number(process.env.BACKUP_RETENTION_MONTHLY ?? "12"),
};

function timestampFilename(now: Date): string {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `dccheck-backup-${iso}.zip`;
}

async function runOnce(): Promise<void> {
  const env = resolveBackupEnv();
  const backupDir = process.env.BACKUP_DIR ?? "/backups";
  mkdirSync(backupDir, { recursive: true });

  if (!acquireLock(env.backupLockPath)) {
    console.warn("[scheduled-backup] another backup is already running, skipping this tick");
    return;
  }

  try {
    const filename = timestampFilename(new Date());
    const filePath = path.join(backupDir, filename);
    const result = await writeBackupToFile({
      filePath,
      uploadsDir: env.uploadsDir,
      database: env.database,
    });
    console.log(`[scheduled-backup] wrote ${result.bytes} bytes -> ${result.filePath}`);

    const rotation = await rotateBackups(backupDir, retention);
    console.log(`[scheduled-backup] rotation: kept=${rotation.kept.length}, deleted=${rotation.deleted.length}`);

    await logAudit({
      action: "BACKUP",
      entity: "settings",
      entityName: "Backup",
      detail: `scheduled, bytes=${result.bytes}, kept=${rotation.kept.length}, deleted=${rotation.deleted.length}`,
    });
  }
  finally {
    releaseLock(env.backupLockPath);
  }
}

async function loop(): Promise<void> {
  console.log(`[scheduled-backup] starting; interval=${scheduleHours}h, retention=${JSON.stringify(retention)}`);
  while (true) {
    try {
      await runOnce();
    }
    catch (error) {
      console.error("[scheduled-backup] tick failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, scheduleMs));
  }
}

void loop().catch((error) => {
  console.error("[scheduled-backup] loop crashed:", error);
  process.exit(1);
});
