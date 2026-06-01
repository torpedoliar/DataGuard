#!/bin/bash
# ============================================
# DEPLOY.SH - First-Time Production Deployment
# DC-Check System (Docker on Linux)
# ============================================
# Use this script on a fresh Linux server to bring the full stack up:
#   db -> app (build + schema sync + seed) -> SIEM workers + syslog receiver
# Re-running is safe: existing volumes, schema, and admin user are kept.
#
# For subsequent updates, use ./update.sh instead.
# ============================================

set -euo pipefail

echo ""
echo "============================================"
echo "  DC-Check System - First-Time Deployment"
echo "============================================"
echo ""

# ---- Prerequisites ----
if [ "$(id -u)" -ne 0 ] && ! groups | grep -qE '\bdocker\b'; then
    echo "WARN  - Current user is not root and not in the 'docker' group."
    echo "        If docker commands fail, re-run with sudo or add user to docker group."
fi

if [ ! -f "docker-compose.yml" ]; then
    echo "ERROR - docker-compose.yml not found in current directory."
    echo "        Run this script from the project root (the folder cloned from git)."
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR - 'docker' is not installed."
    echo "        Install Docker Engine first: https://docs.docker.com/engine/install/"
    exit 1
fi

COMPOSE_CMD=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
    if command -v docker-compose >/dev/null 2>&1; then
        COMPOSE_CMD=(docker-compose)
    else
        echo "ERROR - Neither 'docker compose' (v2) nor 'docker-compose' (v1) is available."
        exit 1
    fi
fi
echo "Using: ${COMPOSE_CMD[*]}"

# ---- Service definitions ----
APP_SERVICE="app"
DB_SERVICE="db"
SIEM_WORKER_SERVICES=(syslog-receiver siem-parser siem-rules siem-alerts siem-retention)
DB_CONTAINER="dccheck_postgres"
APP_CONTAINER="dccheck_app"

# ==================================================================
# STEP 1: BUILD APP IMAGE
# ==================================================================
echo ""
echo "[1/6] Building app image (used by app + SIEM workers)..."
echo "      This may take 3-8 minutes on a fresh server."
if ! "${COMPOSE_CMD[@]}" build --no-cache "$APP_SERVICE"; then
    echo "ERROR - App image build failed. Fix the build error above and re-run."
    exit 1
fi
echo "OK    - App image built"

# ==================================================================
# STEP 2: START DATABASE
# ==================================================================
echo ""
echo "[2/6] Starting database container..."
"${COMPOSE_CMD[@]}" up -d "$DB_SERVICE"

echo "      Waiting for PostgreSQL to accept connections..."
for attempt in $(seq 1 60); do
    if docker exec "$DB_CONTAINER" pg_isready -U administrator -d dccheck >/dev/null 2>&1; then
        echo "OK    - Database is ready (took ~${attempt}s)"
        break
    fi
    if [ "$attempt" -eq 60 ]; then
        echo "ERROR - Database never reported ready after 60s."
        echo "        Check: ${COMPOSE_CMD[*]} logs $DB_SERVICE"
        exit 1
    fi
    sleep 1
done

# ==================================================================
# STEP 3: START APP CONTAINER
# ==================================================================
echo ""
echo "[3/6] Starting app container..."
"${COMPOSE_CMD[@]}" up -d --no-deps "$APP_SERVICE"

echo "      Waiting for app process to come up..."
for attempt in $(seq 1 30); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null || true)" = "true" ]; then
        echo "OK    - App container is running (took ~${attempt}s)"
        break
    fi
    if [ "$attempt" -eq 30 ]; then
        echo "ERROR - App container failed to start within 30s."
        echo "        Check: ${COMPOSE_CMD[*]} logs $APP_SERVICE"
        exit 1
    fi
    sleep 1
done

# ==================================================================
# STEP 4: SYNC DATABASE SCHEMA (drizzle push)
# ==================================================================
echo ""
echo "[4/6] Syncing database schema..."
echo "      drizzle-kit push is additive: safe to run on existing data."
SCHEMA_SYNC_OUTPUT=""
SCHEMA_SYNC_EXIT_CODE=0
set +e
SCHEMA_SYNC_OUTPUT="$("${COMPOSE_CMD[@]}" exec -T "$APP_SERVICE" npx drizzle-kit push 2>&1)"
SCHEMA_SYNC_EXIT_CODE=$?
set -e
if [ -n "${SCHEMA_SYNC_OUTPUT//[[:space:]]/}" ]; then echo "$SCHEMA_SYNC_OUTPUT"; fi

if [ "$SCHEMA_SYNC_EXIT_CODE" -ne 0 ] && echo "$SCHEMA_SYNC_OUTPUT" | grep -Eq "No changes detected|Pulling schema from database"; then
    echo "WARN  - Compose reported an exec error after schema check completed. Continuing."
    SCHEMA_SYNC_EXIT_CODE=0
fi

if [ "$SCHEMA_SYNC_EXIT_CODE" -ne 0 ]; then
    echo "WARN  - Compose schema sync failed; retrying with direct docker exec..."
    set +e
    SCHEMA_SYNC_OUTPUT="$(docker exec "$APP_CONTAINER" npx drizzle-kit push 2>&1)"
    SCHEMA_SYNC_EXIT_CODE=$?
    set -e
    if [ -n "${SCHEMA_SYNC_OUTPUT//[[:space:]]/}" ]; then echo "$SCHEMA_SYNC_OUTPUT"; fi
fi

if [ "$SCHEMA_SYNC_EXIT_CODE" -ne 0 ]; then
    echo "ERROR - Schema sync failed. Aborting before workers start."
    echo "        Inspect the output above and fix migration/schema errors first."
    exit 1
fi
echo "OK    - Database schema synced"

# ==================================================================
# STEP 5: SEED INITIAL USERS (idempotent)
# ==================================================================
echo ""
echo "[5/6] Seeding initial users and demo site (skips if they already exist)..."
SEED_EXIT_CODE=0
set +e
"${COMPOSE_CMD[@]}" exec -T "$APP_SERVICE" npm run seed:users
SEED_EXIT_CODE=$?
set -e
if [ "$SEED_EXIT_CODE" -ne 0 ]; then
    echo "WARN  - Seed step exited with code $SEED_EXIT_CODE."
    echo "        If users already exist this is harmless. Otherwise check: ${COMPOSE_CMD[*]} logs $APP_SERVICE"
fi
echo "OK    - Seed step finished"

# ==================================================================
# STEP 6: START SIEM WORKERS + SYSLOG RECEIVER
# ==================================================================
echo ""
echo "[6/6] Starting SIEM workers and syslog receiver..."
echo "      Services: ${SIEM_WORKER_SERVICES[*]}"
if ! "${COMPOSE_CMD[@]}" up -d --no-deps "${SIEM_WORKER_SERVICES[@]}"; then
    echo "ERROR - Failed to start SIEM workers. Check logs:"
    echo "        ${COMPOSE_CMD[*]} logs ${SIEM_WORKER_SERVICES[*]}"
    exit 1
fi
echo "OK    - SIEM workers running"

# ==================================================================
# Status summary
# ==================================================================
echo ""
echo "Current container state:"
"${COMPOSE_CMD[@]}" ps

cat <<'EOF'

============================================
  DEPLOYMENT COMPLETE!
============================================

  Application : http://<server-ip>:3001
  Postgres    : <server-ip>:3002 (administrator / Arabika1927)
  SIEM UDP    : 0.0.0.0:514/udp  (point switches/firewalls here)

  Default login (change immediately!):
    Superadmin : admin / password
    Staff      : staff / password

  Next steps:
    1. Login as 'admin' and change the password from /admin/users.
    2. Configure sites, devices, and SIEM sources from /admin.
    3. Set Telegram alerts and SIEM defaults from /admin/settings.
    4. For future updates, run ./update.sh (database stays running).

  IMPORTANT:
    - The database volume 'dccheck_pgdata' is the source of truth.
      Take regular backups via /admin/backup before maintenance.
    - Open UDP/514 on the host firewall so syslog reaches the receiver.
EOF
