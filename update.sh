#!/bin/bash
# ============================================
# UPDATE.SH - Production-Safe Update Script
# DC-Check System
# ============================================
# KEAMANAN DATA:
# - Script ini TIDAK PERNAH memanggil 'down -v' (tidak menghapus volume)
# - Database container (db) TIDAK PERNAH di-rebuild atau di-stop
# - Hanya container aplikasi/stateless worker yang di-rebuild dan di-restart
# - Backup database WAJIB berhasil sebelum proses lanjut
# ============================================
#
# ENV_FILE: this script reads secrets from the same env file as deploy.sh
# (default: .env.production). Override by exporting ENV_FILE before running.
# Keep this in sync with deploy.sh's `ENV_FILE` constant — both must point
# to the same file or compose will fail to find the live DB credentials.
# ============================================

set -euo pipefail

# Path to the env file. Must match deploy.sh. Operators can override:
#   ENV_FILE=/path/to/.env.production ./update.sh
ENV_FILE="${ENV_FILE:-.env.production}"

echo ""
echo "============================================"
echo "  DC-Check System - Production Update"
echo "============================================"
echo ""

# ---- Ensure Docker Compose (V2 or V1) is available ----
COMPOSE_CMD=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
    if command -v docker-compose >/dev/null 2>&1; then
        COMPOSE_CMD=(docker-compose)
    else
        echo "ERROR: docker compose or docker-compose could not be found."
        echo "Please ensure Docker Engine is running."
        exit 1
    fi
fi
echo "Using: ${COMPOSE_CMD[*]}"

# Validasi folder project
if [ ! -f "docker-compose.yml" ]; then
    echo "ERROR: docker-compose.yml not found!"
    echo "Please run this script from the project root directory."
    exit 1
fi

# ---- Read DB credentials from running container ----
DB_USER="administrator"
DB_NAME="dccheck"
FETCHED_USER="$("${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" exec -T db printenv POSTGRES_USER 2>/dev/null || docker exec dccheck_postgres printenv POSTGRES_USER 2>/dev/null || true)"
FETCHED_NAME="$("${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" exec -T db printenv POSTGRES_DB 2>/dev/null || docker exec dccheck_postgres printenv POSTGRES_DB 2>/dev/null || true)"
if [ -n "${FETCHED_USER//[[:space:]]/}" ]; then DB_USER="$(echo "$FETCHED_USER" | tr -d '\r' | xargs)"; fi
if [ -n "${FETCHED_NAME//[[:space:]]/}" ]; then DB_NAME="$(echo "$FETCHED_NAME" | tr -d '\r' | xargs)"; fi
if [ -z "${DB_NAME//[[:space:]]/}" ]; then DB_NAME="dccheck"; fi

# ==================================================================
# STEP 1: BACKUP DATABASE (WAJIB BERHASIL!)
# ==================================================================
echo ""
echo "[1/6] Backing up database..."
BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql"

DB_RUNNING=0
USE_NAMED_DB_CONTAINER=0
DB_ID="$("${COMPOSE_CMD[@]}" ps -q db 2>/dev/null || true)"
if [ -n "$DB_ID" ] && [ "$(docker inspect -f '{{.State.Running}}' "$DB_ID" 2>/dev/null || true)" = "true" ]; then
    DB_RUNNING=1
fi
if [ "$DB_RUNNING" -eq 0 ] && "${COMPOSE_CMD[@]}" ps db 2>/dev/null | grep -Eq "Up|running"; then
    DB_RUNNING=1
fi
if [ "$DB_RUNNING" -eq 0 ] && [ "$(docker inspect -f '{{.State.Running}}' dccheck_postgres 2>/dev/null || true)" = "true" ]; then
    DB_RUNNING=1
    USE_NAMED_DB_CONTAINER=1
fi

if [ "$DB_RUNNING" -eq 1 ]; then
    if [ "$USE_NAMED_DB_CONTAINER" -eq 1 ]; then
        if ! docker exec -i dccheck_postgres pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE" 2>/dev/null; then
            echo "CRITICAL: Database backup command failed!"
            echo "Aborting update to protect your data."
            rm -f "$BACKUP_FILE"
            exit 1
        fi
    else
        if ! "${COMPOSE_CMD[@]}" exec -T db pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE" 2>/dev/null; then
            echo "CRITICAL: Database backup command failed!"
            echo "Aborting update to protect your data."
            rm -f "$BACKUP_FILE"
            exit 1
        fi
    fi

    if [ -s "$BACKUP_FILE" ] && [ "$(wc -c < "$BACKUP_FILE")" -gt 100 ]; then
        BACKUP_SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
        echo "OK - Database backed up: $BACKUP_FILE ($BACKUP_SIZE)"
    else
        echo "CRITICAL: Backup file is empty or too small!"
        echo "Aborting update to protect your data."
        echo "Please check database health manually."
        rm -f "$BACKUP_FILE"
        exit 1
    fi
else
    echo "WARN - Database container is not running. Skipping backup."
    echo "       (This is normal for first-time installation)"
fi

# ==================================================================
# STEP 2: PULL LATEST CODE
# ==================================================================
echo ""
echo "[2/6] Pulling latest code from GitHub..."
if ! git pull origin main; then
    echo "ERROR: Git pull failed!"
    echo "Try: git stash; git pull origin main; git stash pop"
    exit 1
fi
echo "OK - Code updated"

# ==================================================================
# STEP 3: REBUILD APP IMAGE (database TIDAK disentuh!)
# ==================================================================
APP_SERVICE="app"
SIEM_WORKER_SERVICES=(syslog-receiver siem-parser siem-rules siem-alerts siem-retention)
echo ""
echo "[3/6] Rebuilding app image (database untouched)..."
echo "      Workers reuse image: ${SIEM_WORKER_SERVICES[*]}"
echo "      This may take 2-5 minutes..."
if ! "${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" build --no-cache "$APP_SERVICE"; then
    echo "ERROR: Build failed! Aborting update."
    echo "Your current running version is still intact."
    echo "Backup file: $BACKUP_FILE"
    exit 1
fi
echo "OK - App image rebuilt successfully"

# ==================================================================
# STEP 4: RESTART APP ONLY (database tetap berjalan!)
# ==================================================================
echo ""
echo "[4/6] Restarting app (database stays running)..."
if ! "${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" up -d --no-deps --force-recreate --remove-orphans "$APP_SERVICE"; then
    echo "ERROR: App restart failed! Check docker compose logs."
    echo "Backup file: $BACKUP_FILE"
    exit 1
fi
echo "OK - App restarted"
echo "Waiting for app to become ready..."
sleep 10

# ==================================================================
# STEP 5: SYNC DATABASE SCHEMA (versioned migrations, non-interactive)
# ==================================================================
echo ""
echo "[5/6] Syncing database schema..."
echo "      (applying committed migrations from drizzle/ - deterministic, no prompts)"
SCHEMA_SYNC_OUTPUT=""
SCHEMA_SYNC_EXIT_CODE=0
set +e
SCHEMA_SYNC_OUTPUT="$("${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" exec -T app npm run db:migrate 2>&1)"
SCHEMA_SYNC_EXIT_CODE=$?
set -e
if [ -n "${SCHEMA_SYNC_OUTPUT//[[:space:]]/}" ]; then echo "$SCHEMA_SYNC_OUTPUT"; fi

if [ "$SCHEMA_SYNC_EXIT_CODE" -ne 0 ]; then
    echo "WARN - Compose schema sync failed; retrying with direct docker exec..."
    set +e
    SCHEMA_SYNC_OUTPUT="$(docker exec dccheck_app npm run db:migrate 2>&1)"
    SCHEMA_SYNC_EXIT_CODE=$?
    set -e
    if [ -n "${SCHEMA_SYNC_OUTPUT//[[:space:]]/}" ]; then echo "$SCHEMA_SYNC_OUTPUT"; fi
fi

if [ "$SCHEMA_SYNC_EXIT_CODE" -ne 0 ]; then
    echo "ERROR - Schema sync failed. SIEM workers will not be restarted."
    echo "Backup file: $BACKUP_FILE"
    exit 1
fi
echo "OK - Database schema synced"

# ==================================================================
# STEP 6: RESTART STATELESS SIEM SERVICES (database tetap berjalan!)
# ==================================================================
echo ""
echo "[6/6] Restarting SIEM workers (database stays running)..."
echo "      Services: ${SIEM_WORKER_SERVICES[*]}"
if ! "${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" up -d --no-deps --force-recreate --remove-orphans "${SIEM_WORKER_SERVICES[@]}"; then
    echo "ERROR: SIEM worker restart failed! Check docker compose logs."
    echo "Backup file: $BACKUP_FILE"
    exit 1
fi
echo "OK - SIEM workers restarted"

# ==================================================================
# CLEANUP: Remove old backups (keep last 10)
# ==================================================================
echo ""
echo "Cleaning up old backups (keeping last 10)..."
find "$BACKUP_DIR" -maxdepth 1 -type f -name "db_backup_*.sql" -printf "%T@ %p\n" 2>/dev/null | sort -rn | tail -n +11 | cut -d " " -f2- | xargs -r rm -f
echo "OK - Cleanup completed"

# Done
echo ""
echo "============================================"
echo "  UPDATE COMPLETE!"
echo "============================================"
echo ""
echo "  Application : http://localhost:3001"
echo "  SIEM UDP    : 0.0.0.0:514/udp"
echo "  Backup file : $BACKUP_FILE"
echo ""
echo "  To restore database if needed:"
echo "  cat \"$BACKUP_FILE\" | ${COMPOSE_CMD[*]} exec -T db psql -U $DB_USER $DB_NAME"
echo ""
echo "  IMPORTANT: Database was NEVER stopped during this update."
echo "  Your data is safe and intact."
echo ""
