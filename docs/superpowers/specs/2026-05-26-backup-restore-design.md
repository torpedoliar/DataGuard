# DC-Check Backup & Restore Design

**Date:** 2026-05-26
**Author:** Claude (Opus 4.7) for torpedoliar
**Status:** Approved by user; spec self-review pending

## Goal

Provide an in-app Backup & Restore feature for the dccheck Next.js application so a superadmin can migrate the production deployment from Windows (Docker Desktop) to Linux without dropping into a shell. Each operation produces or consumes a single ZIP archive that contains both the PostgreSQL dump and the uploaded files volume.

## Scope

In-scope:

- One-shot manual backup that streams a ZIP download to the operator's browser.
- One-shot manual restore that accepts a ZIP upload and rehydrates Postgres plus the uploads directory.
- Toggle between **Wipe & restore** (DROP + recreate `public` schema, then `pg_restore` full dump) and **Append only** (`pg_restore --data-only`, schema unchanged).
- Superadmin-only access enforced in the UI page, the server actions, and the API routes.
- Audit log entries for every backup download and every restore execution.

Out of scope:

- Scheduled backups, retention policies, off-site replication.
- Per-site partial backups.
- Encryption at rest of the archive (operator transport responsibility).

## Architecture

The feature lives entirely inside the Next.js `app` container. Backup uses `pg_dump` with the custom format (`-Fc`) so restores can run with `pg_restore` and benefit from parallelism and ordering. The uploads volume (`/app/public/uploads`) is included so logos and incident photos travel with the database.

Both operations stream through the API route layer, not server actions, because Next.js server actions cap request bodies near 1 MB. API routes can accept the multi-hundred-MB archives we expect.

A simple file lock (`/tmp/.backup-running`, `/tmp/.restore-running`) prevents two operations of the same type from interleaving; if a previous run crashes the lock is removed on process startup via best-effort cleanup at module load.

## File Structure

```
app/(dashboard)/admin/backup/page.tsx       - Superadmin landing page
components/admin/backup-form.tsx            - Client UI: download button + upload form
actions/backup-restore.ts                   - Auth helpers and audit-only server actions
app/api/admin/backup/route.ts               - GET, returns streaming ZIP download
app/api/admin/restore/route.ts              - POST, accepts multipart upload
lib/backup/build-archive.ts                 - pg_dump + zip stream builder
lib/backup/restore-archive.ts               - unzip + pg_restore + uploads sync
lib/backup/build-archive.test.ts
lib/backup/restore-archive.test.ts
```

The libraries depend on a small `runShell` adapter so the unit tests can inject a fake instead of executing real `pg_dump`, `pg_restore`, or `psql` binaries.

## Backup Flow

1. Superadmin opens `/admin/backup` and clicks **Generate Backup**.
2. Browser issues `GET /api/admin/backup`.
3. Route handler verifies the session role; non-superadmins receive HTTP 403.
4. Handler obtains the backup lock; if already held, returns HTTP 409.
5. Handler invokes `buildBackupArchive`, which:
   - Spawns `pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -Fc`.
   - Pipes stdout into a streaming `archiver` ZIP (entry name `dump.dump`).
   - Walks `/app/public/uploads` and adds each file under `uploads/`.
   - Emits the ZIP to the response as `Content-Type: application/zip`, `Content-Disposition: attachment; filename="dccheck-backup-YYYYMMDD-HHmmss.zip"`.
6. On success, handler writes an audit log entry: `action=DOWNLOAD entity=settings entityName="Backup" detail="size=<bytes>"`.
7. Lock released in a `finally` block.

Concurrency rule: only one backup at a time. If the operator wants a second copy, wait for the first to finish.

## Restore Flow

1. Superadmin opens `/admin/backup`, picks an archive, optionally toggles **Wipe & restore** (default ON), and submits the upload form.
2. Browser issues `POST /api/admin/restore` as `multipart/form-data`.
3. Route handler verifies the session role; non-superadmins receive HTTP 403.
4. Handler obtains the restore lock; if already held, returns HTTP 409.
5. Handler streams the uploaded file to `/tmp/restore-<uuid>.zip`.
6. Handler invokes `restoreBackupArchive`, which:
   - Validates the ZIP can be opened and contains a `dump.dump` entry; otherwise rejects with HTTP 400.
   - Extracts the archive into `/tmp/restore-<uuid>/`.
   - Wipe mode:
     - `psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $DB_USER;"`.
     - `pg_restore -h $DB_HOST -U $DB_USER -d $DB_NAME -j 4 /tmp/restore-<uuid>/dump.dump`.
   - Append mode:
     - `pg_restore -h $DB_HOST -U $DB_USER -d $DB_NAME --data-only /tmp/restore-<uuid>/dump.dump`. Conflicts are reported but do not fail the run; warnings are returned to the caller.
   - If the archive contains an `uploads/` directory:
     - Wipe mode: empty `/app/public/uploads` then copy from archive.
     - Append mode: copy each file, overwriting existing names but never deleting unrelated files.
7. Handler removes the temp ZIP and extraction directory.
8. Handler writes audit log: `action=RESTORE entity=settings entityName="Backup" detail="mode=wipe|append, sizeKB=..., warnings=..."`.
9. Lock released in a `finally` block.
10. JSON response `{ ok: true, mode, restoredFromBytes, warnings }`. UI shows a success banner and refreshes the page.

The route is configured with `export const runtime = "nodejs"` and `export const maxDuration = 600` (10 minutes) so very large archives can complete.

## Authentication

All three entry points (page, GET route, POST route) call the existing session helper. The role check is `session?.role === "superadmin"`. Admin-per-site users do not see the navigation link and receive HTTP 403 if they probe the routes directly.

## Audit Logging

Every backup download and every restore attempt (success or failure) writes a row into `audit_logs` via the existing `logAudit()` helper. Restore audit detail includes `mode`, archive size, and a short warning summary if append mode produced conflicts.

## Image Requirements

The runner image must contain `pg_dump`, `pg_restore`, `psql`, and `unzip`. The current Dockerfile uses `node:20-alpine` and does not install these. The implementation plan adds:

```
RUN apk add --no-cache postgresql-client zip unzip
```

to both the builder and runner stages so worker scripts and the app share the same toolchain.

## Error Handling

- Lock contention: HTTP 409 with explanation message; UI surfaces "Another backup/restore is already running."
- pg_dump or pg_restore non-zero exit: HTTP 500, audit logs the failure, response includes the trimmed stderr.
- Restore of an archive missing `dump.dump`: HTTP 400 with explicit message, no DB modification, audit logs the rejection.
- Disk full while writing temp files: surfaced as HTTP 500; operator must clean `/tmp` and retry.
- Wipe mode failure between DROP SCHEMA and pg_restore: response makes the inconsistent state explicit so the operator can re-run with a known-good archive instead of guessing.

## Testing

- `lib/backup/build-archive.test.ts`: temp directory plus a fake `runShell` to assert the ZIP contains a `dump.dump` entry, includes uploaded files, and emits no entry for an empty uploads dir.
- `lib/backup/restore-archive.test.ts`: assert the dispatcher builds the correct shell commands for both modes, rejects archives that are not ZIPs, rejects archives without `dump.dump`, and copies uploads with the documented overwrite semantics.
- Manual integration test: backup on Windows, transfer to Linux, restore in wipe mode, verify row counts of major tables match between source and target.

## Operator Procedure (Migration Day)

1. Linux server set up with the latest dccheck stack, Postgres volume empty, app reachable.
2. Operator logs into Windows production, opens `/admin/backup`, clicks Generate Backup.
3. Operator copies the resulting ZIP to the Linux server (any transport: SCP, USB, shared drive).
4. Operator logs into the Linux deployment as superadmin, opens `/admin/backup`, uploads the ZIP, leaves Wipe & restore toggled ON, clicks Restore.
5. Operator verifies counts via Admin → Audit Log and the SIEM dashboard.
6. Operator points devices and switches to the new Linux server's IP for syslog and HTTP.
