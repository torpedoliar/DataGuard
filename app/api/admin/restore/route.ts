import { requireSuperadmin } from "@/actions/backup-restore";
import { logAudit } from "@/lib/audit";
import { resolveBackupEnv } from "@/lib/backup/env";
import { acquireLock, releaseLock } from "@/lib/backup/lock";
import { restoreBackupArchive } from "@/lib/backup/restore-archive";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  const guard = await requireSuperadmin();
  if (!guard.ok) {
    return new Response(JSON.stringify({ message: guard.message }), {
      status: guard.status,
      headers: { "content-type": "application/json" },
    });
  }

  const env = resolveBackupEnv();
  if (!acquireLock(env.restoreLockPath)) {
    return new Response(JSON.stringify({ message: "Restore lain sedang berjalan. Coba lagi nanti." }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("archive");
    const modeValue = formData.get("mode");
    if (!(file instanceof File) || file.size === 0) {
      return new Response(JSON.stringify({ message: "File backup wajib diunggah." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const mode = modeValue === "append" ? "append" : "wipe";
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await restoreBackupArchive({
      archive: buffer,
      uploadsDir: env.uploadsDir,
      mode,
      database: env.database,
    });

    await logAudit({
      action: "RESTORE",
      entity: "settings",
      entityName: "Backup",
      detail: `mode=${result.mode}, bytes=${buffer.length}, warnings=${result.warnings.length}`,
    });

    return new Response(JSON.stringify({ ok: true, mode: result.mode, warnings: result.warnings }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  catch (error) {
    const message = error instanceof Error ? error.message : "Restore gagal.";
    await logAudit({
      action: "RESTORE",
      entity: "settings",
      entityName: "Backup",
      detail: `failed: ${message}`,
    });
    return new Response(JSON.stringify({ message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  finally {
    releaseLock(env.restoreLockPath);
  }
}
