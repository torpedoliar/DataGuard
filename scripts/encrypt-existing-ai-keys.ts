#!/usr/bin/env tsx
/**
 * One-time migration: encrypt any plaintext `siem_settings.ai_api_key` rows.
 *
 * Safe to re-run: rows already in the v1 envelope format are skipped.
 *
 * Usage:
 *   npx tsx scripts/encrypt-existing-ai-keys.ts
 *
 * Requires `AI_KEY_ENCRYPTION_SECRET` in the environment. The migration
 * reads every row, encrypts plaintext values, and writes them back. An
 * audit log entry is created when finished so operators have a record
 * of the run.
 */
import "dotenv/config";
import { db } from "@/db";
import { siemSettings } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { encryptString, isEncryptedString } from "@/lib/crypto";
import { eq, isNotNull } from "drizzle-orm";

async function main(): Promise<void> {
  if (!process.env.AI_KEY_ENCRYPTION_SECRET) {
    console.error(
      "AI_KEY_ENCRYPTION_SECRET is not set. Refusing to start; set it in the environment and re-run.",
    );
    process.exit(1);
  }

  const rows = await db
    .select({ id: siemSettings.id, aiApiKey: siemSettings.aiApiKey })
    .from(siemSettings)
    .where(isNotNull(siemSettings.aiApiKey));

  let encrypted = 0;
  let skipped = 0;
  for (const row of rows) {
    const raw = row.aiApiKey;
    if (!raw) {
      skipped += 1;
      continue;
    }
    if (isEncryptedString(raw)) {
      skipped += 1;
      continue;
    }
    const cipher = encryptString(raw);
    await db
      .update(siemSettings)
      .set({ aiApiKey: cipher, updatedAt: new Date() })
      .where(eq(siemSettings.id, row.id));
    encrypted += 1;
  }

  const detail = `Encrypted ${encrypted} existing AI API key(s); skipped ${skipped} (already encrypted or empty).`;
  console.log(`[encrypt-existing-ai-keys] ${detail}`);
  await logAudit({ action: "UPDATE", entity: "settings", entityName: "SIEM AI", detail });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[encrypt-existing-ai-keys] failed:", error);
    process.exit(1);
  });
