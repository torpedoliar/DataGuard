import { requireSuperadmin } from "@/actions/backup-restore";
import { logAudit } from "@/lib/audit";
import { buildBackupArchive } from "@/lib/backup/build-archive";
import { resolveBackupEnv } from "@/lib/backup/env";
import { acquireLock, releaseLock } from "@/lib/backup/lock";
import { PassThrough } from "node:stream";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET() {
  const guard = await requireSuperadmin();
  if (!guard.ok) {
    return new Response(JSON.stringify({ message: guard.message }), {
      status: guard.status,
      headers: { "content-type": "application/json" },
    });
  }

  const env = resolveBackupEnv();
  if (!acquireLock(env.backupLockPath)) {
    return new Response(JSON.stringify({ message: "Backup lain sedang berjalan. Coba lagi nanti." }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }

  const filename = `dccheck-backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.zip`;
  const passthrough = new PassThrough();

  let totalBytes = 0;
  passthrough.on("data", (chunk: Buffer) => {
    totalBytes += chunk.length;
  });

  buildBackupArchive({
    output: passthrough,
    uploadsDir: env.uploadsDir,
    database: env.database,
  })
    .then(async () => {
      await logAudit({
        action: "DOWNLOAD",
        entity: "settings",
        entityName: "Backup",
        detail: `bytes=${totalBytes}`,
      });
    })
    .catch((error) => {
      passthrough.destroy(error instanceof Error ? error : new Error(String(error)));
    })
    .finally(() => {
      releaseLock(env.backupLockPath);
    });

  return new Response(passthrough as unknown as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
