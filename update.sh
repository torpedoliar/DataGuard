#!/bin/bash
# ============================================
# UPDATE.SH - Production-Safe Update Script
# DC-Check System
# ============================================
# DATA SAFETY:
# - Never runs 'down -v' and never deletes volumes.
# - Never rebuilds or stops the db service.
# - Rebuilds/recreates only the app service.
# - Requires database backup and schema sync to succeed before app restart.
# ============================================

set -euo pipefail

echo ""
echo "============================================"
echo "  DC-Check System - Production Update"
echo "============================================"
echo ""

if [ ! -f "docker-compose.yml" ]; then
    echo "ERROR: docker-compose.yml not found."
    echo "Run this script from the project root directory."
    exit 1
fi

# ---- Detect compose command ----
COMPOSE_LABEL=""
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
    COMPOSE_LABEL="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
    COMPOSE_LABEL="docker-compose"
elif command -v podman-compose >/dev/null 2>&1; then
    COMPOSE=(podman-compose)
    COMPOSE_LABEL="podman-compose"
else
    echo "ERROR: docker compose, docker-compose, or podman-compose could not be found."
    exit 1
fi
echo "Using: $COMPOSE_LABEL"

# ---- Read DB credentials from running container ----
DB_USER="$("${COMPOSE[@]}" exec -T db printenv POSTGRES_USER 2>/dev/null || echo "administrator")"
DB_NAME="$("${COMPOSE[@]}" exec -T db printenv POSTGRES_DB 2>/dev/null || echo "dccheck")"
DB_USER="${DB_USER:-administrator}"
DB_NAME="${DB_NAME:-dccheck}"

# ==================================================================
# STEP 1: BACKUP DATABASE (MUST SUCCEED WHEN DB IS RUNNING)
# ==================================================================
echo ""
echo "[1/5] Backing up database..."
BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql"

DB_RUNNING=0
if "${COMPOSE[@]}" ps db 2>/dev/null | grep -Eq "(running|Up)"; then
    DB_RUNNING=1
fi

if [ "$DB_RUNNING" -eq 1 ]; then
    "${COMPOSE[@]}" exec -T db pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE"

    if [ -s "$BACKUP_FILE" ] && [ "$(wc -c < "$BACKUP_FILE")" -gt 100 ]; then
        BACKUP_SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
        echo "OK - Database backed up: $BACKUP_FILE ($BACKUP_SIZE)"
    else
        echo "CRITICAL: Backup file is empty or too small."
        echo "Aborting update to protect data."
        rm -f "$BACKUP_FILE"
        exit 1
    fi
else
    echo "WARN - Database container is not running. Skipping backup."
    echo "       Update will continue only if migrations can reach the database."
fi

# ==================================================================
# STEP 2: PULL LATEST CODE
# ==================================================================
echo ""
echo "[2/5] Pulling latest code from GitHub..."
git pull origin main
echo "OK - Code updated"

# ==================================================================
# STEP 3: REBUILD ONLY APP IMAGE
# ==================================================================
echo ""
echo "[3/5] Rebuilding application image ONLY (database untouched)..."
echo "      This may take 2-5 minutes..."
"${COMPOSE[@]}" build --no-cache app
echo "OK - App image rebuilt successfully"

# ==================================================================
# STEP 4: SYNC DATABASE SCHEMA BEFORE APP RESTART
# ==================================================================
echo ""
echo "[4/5] Syncing database schema..."
echo "      Running drizzle-kit push from the newly built app image before restart."
"${COMPOSE[@]}" run --rm --no-deps app npx drizzle-kit push
echo "OK - Database schema synced"

# ==================================================================
# STEP 5: RESTART ONLY APP
# ==================================================================
echo ""
echo "[5/5] Restarting app container (database stays running)..."
"${COMPOSE[@]}" up -d --no-deps --force-recreate --remove-orphans app
echo "OK - App container restarted"
echo "Waiting for app to become ready..."
sleep 10

# ==================================================================
# CLEANUP: Remove old backups (keep last 10)
# ==================================================================
echo ""
echo "Cleaning up old backups (keeping last 10)..."
ls -t "$BACKUP_DIR"/db_backup_*.sql 2>/dev/null | tail -n +11 | xargs -r rm -f
echo "OK - Cleanup completed"

echo ""
echo "============================================"
echo "  UPDATE COMPLETE"
echo "============================================"
echo ""
echo "  Application : http://localhost:3001"
echo "  Backup file : $BACKUP_FILE"
echo ""
echo "  To restore database if needed:"
echo "  cat \"$BACKUP_FILE\" | $COMPOSE_LABEL exec -T db psql -U \"$DB_USER\" \"$DB_NAME\""
echo ""
echo "  IMPORTANT: Database was never stopped during this update."
echo ""
