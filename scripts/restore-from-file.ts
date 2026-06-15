#!/usr/bin/env tsx
import dotenv from "dotenv";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { logAudit } from "@/lib/audit";
import { resolveBackupEnv } from "@/lib/backup/env";
import { acquireLock, releaseLock } from "@/lib/backup/lock";
import { restoreBackupArchive } from "@/lib/backup/restore-archive";

dotenv.config();

function prompt(question: string): string {
  process.stdout.write(question);
  let answer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    answer += chunk;
    if (answer.includes("\n")) {
      process.stdin.pause();
    }
  });
  return new Promise((resolve) => {
    process.stdin.on("close", () => resolve(answer.trim()));
    process.stdin.on("data", () => {
      // Allow above closure to handle the line break.
    });
  }) as unknown as string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const yesFlag = args.includes("--yes") || args.includes("-y");
  const positional = args.filter((a) => !a.startsWith("-"));
  const archivePath = positional[0];

  if (!archivePath) {
    console.error("Usage: tsx scripts/restore-from-file.ts [--yes] /path/to/backup.zip");
    process.exit(2);
  }

  const absolute = path.resolve(archivePath);
  const stats = statSync(absolute);
  console.log(`[restore] archive: ${absolute} (${stats.size} bytes)`);

  if (!yesFlag) {
    const answer = await Promise.race([
      prompt("[restore] type 'yes' to proceed with WIPE restore: "),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 30_000)),
    ]);
    if (answer !== "yes") {
      console.error("[restore] aborted");
      process.exit(1);
    }
  }

  const env = resolveBackupEnv();
  if (!acquireLock(env.restoreLockPath)) {
    console.error("[restore] another restore is already in progress");
    process.exit(3);
  }

  try {
    const buffer = readFileSync(absolute);
    const result = await restoreBackupArchive({
      archive: buffer,
      uploadsDir: env.uploadsDir,
      mode: "wipe",
      database: env.database,
    });
    await logAudit({
      action: "RESTORE",
      entity: "settings",
      entityName: "Backup",
      detail: `mode=${result.mode}, source=${absolute}, bytes=${buffer.length}, warnings=${result.warnings.length}`,
    });
    console.log(`[restore] OK (warnings=${result.warnings.length})`);
  }
  finally {
    releaseLock(env.restoreLockPath);
  }
}

void main().catch((error) => {
  console.error("[restore] failed:", error);
  process.exit(1);
});
