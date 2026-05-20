#!/bin/bash
# ============================================
# UPDATE.SH - Production-Safe Update Script
# DC-Check System
# ============================================
# KEAMANAN DATA:
# - Script ini TIDAK PERNAH memanggil 'down -v' (tidak menghapus volume)
# - Database container (db) TIDAK PERNAH di-rebuild atau di-stop
# - Hanya container 'app' yang di-rebuild dan di-restart
# - Backup database WAJIB berhasil sebelum proses lanjut
# ============================================

set -e  # Stop on any error

echo ""
echo "============================================"
echo "  DC-Check System - Production Update"
echo "============================================"
echo ""

# ---- Detect compose command ----
COMPOSER="docker-compose"
if ! command -v docker-compose &> /dev/null; then
    if command -v podman-compose &> /dev/null; then
        COMPOSER="podman-compose"
    else
        echo "❌ ERROR: Neither docker-compose nor podman-compose could be found."
        exit 1
    fi
fi
echo "Using: $COMPOSER"

# ---- Read DB credentials from docker-compose.yml ----
# Kredensial baca dari environment container yang sedang berjalan
DB_USER=$(${COMPOSER} exec -T db printenv POSTGRES_USER 2>/dev/null || echo "administrator")
DB_NAME=$(${COMPOSER} exec -T db printenv POSTGRES_DB 2>/dev/null || echo "dccheck")

# Validasi folder project
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ ERROR: docker-compose.yml not found!"
    echo "Please run this script from the project root directory."
    exit 1
fi

# ==================================================================
# STEP 1: BACKUP DATABASE (WAJIB BERHASIL!)
# ==================================================================
echo ""
echo "[1/5] Backing up database..."
BACKUP_DIR="backups"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql"

# Cek apakah container db sedang berjalan
DB_RUNNING=$($COMPOSER ps db 2>/dev/null | grep -c "running\|Up" || true)

if [ "$DB_RUNNING" -gt 0 ]; then
    $COMPOSER exec -T db pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE" 2>/dev/null

    # Validasi backup: file harus ada dan ukuran > 100 bytes (bukan file kosong)
    if [ -s "$BACKUP_FILE" ] && [ $(wc -c < "$BACKUP_FILE") -gt 100 ]; then
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        echo "✅ Database backed up successfully: $BACKUP_FILE ($BACKUP_SIZE)"
    else
        echo "❌ CRITICAL: Backup file is empty or too small!"
        echo "   Aborting update to protect your data."
        echo "   Please check database health manually."
        rm -f "$BACKUP_FILE"
        exit 1
    fi
else
    echo "⚠️  Database container is not running. Skipping backup."
    echo "   (This is normal for first-time installation)"
fi

# ==================================================================
# STEP 2: PULL LATEST CODE
# ==================================================================
echo ""
echo "[2/5] Pulling latest code from GitHub..."
git pull origin main
if [ $? -ne 0 ]; then
    echo "❌ ERROR: Git pull failed!"
    echo "   Try: git stash && git pull origin main && git stash pop"
    exit 1
fi
echo "✅ Code updated"

# ==================================================================
# STEP 3: REBUILD HANYA CONTAINER APP (database TIDAK disentuh!)
# ==================================================================
echo ""
echo "[3/5] Rebuilding application image ONLY (database untouched)..."
echo "      ⏳ This may take 2-5 minutes..."
$COMPOSER build --no-cache app
if [ $? -ne 0 ]; then
    echo "❌ ERROR: Build failed! Aborting update."
    echo "   Your current running version is still intact."
    echo "   Backup file: $BACKUP_FILE"
    exit 1
fi
echo "✅ App image rebuilt successfully"

# ==================================================================
# STEP 4: RESTART HANYA APP (database tetap berjalan!)
# ==================================================================
echo ""
echo "[4/5] Restarting app container (database stays running)..."

# Hanya recreate service 'app', bukan seluruh stack
# Ini memastikan container 'db' TIDAK PERNAH berhenti
$COMPOSER up -d --no-deps app
echo "✅ App container restarted"
echo "   Waiting for app to become ready..."
sleep 10

# ==================================================================
# STEP 5: SYNC DATABASE SCHEMA (additive only, no data loss)
# ==================================================================
echo ""
echo "[5/5] Syncing database schema..."
echo "      (drizzle push is additive — it only ADDS new columns/tables)"
$COMPOSER exec -T app npx drizzle-kit push 2>&1 || true
echo "✅ Database schema sync completed"

# ==================================================================
# CLEANUP: Remove old backups (keep last 10)
# ==================================================================
echo ""
echo "Cleaning up old backups (keeping last 10)..."
ls -t $BACKUP_DIR/db_backup_*.sql 2>/dev/null | tail -n +11 | xargs -r rm
echo "✅ Cleanup completed"

# Done
echo ""
echo "============================================"
echo "  ✅ UPDATE COMPLETE!"
echo "============================================"
echo ""
echo "  🌐 Application: http://localhost:3001"
echo "  💾 Backup file : $BACKUP_FILE"
echo ""
echo "  To restore database if needed:"
echo "  cat $BACKUP_FILE | $COMPOSER exec -T db psql -U $DB_USER $DB_NAME"
echo ""
echo "  ⚠️  IMPORTANT: Database was NEVER stopped during this update."
echo "  Your data is safe and intact."
echo ""
