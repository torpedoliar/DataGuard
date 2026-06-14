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

# ---- Helpers ----

# Append (or replace, when regenerate=always) a `KEY=value` line in $ENV_FILE.
# In "if-missing" mode we keep the existing value verbatim. In "always" mode
# we replace the first matching line in-place so repeated runs don't leave
# duplicate entries (compose and most tools take the first match anyway, but
# duplicates are confusing in the rendered .env file).
ensure_secret() {
    local key="$1"
    local default_bytes="$2"
    local regenerate="${3:-always}"  # "always" or "if-missing"

    if grep -qE "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null; then
        if [ "$regenerate" = "if-missing" ]; then
            echo "  - $key already set; keeping existing value"
            return 0
        fi
    fi

    local value
    value="$(openssl rand -base64 "$default_bytes" | tr -d '\n')"
    if [ "$regenerate" = "always" ] && grep -qE "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null; then
        # Replace the existing line in-place using sed (works on macOS + Linux
        # with the same syntax). The pattern only matches lines that begin
        # with KEY=, so a value containing "=" is safe.
        local tmp_file
        tmp_file="$(mktemp)"
        sed -E "s|^[[:space:]]*${key}=.*|${key}=${value}|" "$ENV_FILE" > "$tmp_file"
        mv "$tmp_file" "$ENV_FILE"
    else
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    echo "  - generated $key (${#value} chars)"
}

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

if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR - 'openssl' is not installed (needed to generate random secrets)."
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
# STEP 0: PROVISION SECRETS (idempotent)
# ==================================================================
# Compose reads .env.production for every service. If the file is missing
# or empty we generate a fresh set of random credentials so the operator
# never ships the development defaults by accident.
ENV_FILE=".env.production"

echo ""
echo "[0/6] Provisioning production secrets in $ENV_FILE..."
if [ ! -f "$ENV_FILE" ] || [ ! -s "$ENV_FILE" ]; then
    if [ -f "$ENV_FILE" ]; then
        echo "      $ENV_FILE exists but is empty — regenerating."
    else
        echo "      $ENV_FILE missing — generating fresh secrets."
    fi
    : > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
fi

# Non-secret defaults (kept in the file so compose interpolation works
# and operators have a complete reference even if they regenerate).
ensure_value() {
    local key="$1"
    local value="$2"
    if ! grep -qE "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null; then
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
        echo "  - set $key=$value"
    fi
}

ensure_value "DB_HOST" "db"
ensure_value "DB_PORT" "5432"
ensure_value "DB_NAME" "dccheck"
ensure_value "SECURE_COOKIES" "true"

# Secrets — DB_USER is set once and preserved on re-runs so the existing
# PostgreSQL volume (which baked the role in on first boot) still matches.
ensure_secret "DB_USER"     6   "if-missing"
ensure_secret "DB_PASSWORD" 24  "always"
ensure_secret "SESSION_SECRET" 32 "always"

# Sanity-check the file mode, but fall back to a portable ls -l parse when
# the host ships neither GNU `stat -c` nor BSD `stat -f` (e.g. minimal Alpine
# without coreutils, busybox-only systems).
ENV_FILE_MODE="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || true)"
if [ -z "$ENV_FILE_MODE" ]; then
    ENV_FILE_MODE="$(ls -l "$ENV_FILE" 2>/dev/null | awk 'NR==1 {print $1}')"
fi
echo "OK    - Secrets ready in $ENV_FILE (mode $ENV_FILE_MODE)"

# ==================================================================
# STEP 0b: DB_USER ↔ Postgres volume sanity check
# ==================================================================
# If the operator edited DB_USER in .env.production between runs but the
# dccheck_pgdata volume still has the old role, compose will pass the new
# env to the app container but Postgres will reject the connection. The
# volume is the source of truth here (it bakes POSTGRES_USER in on first
# boot and recreating it loses data), so we warn loudly and let the
# operator decide.
DB_USER_VAL="$(grep -E '^[[:space:]]*DB_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '\r\n')"
DB_CONTAINER_PRESENT=0
if docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
    DB_CONTAINER_PRESENT=1
fi
if [ "$DB_CONTAINER_PRESENT" -eq 1 ]; then
    VOLUME_USER="$(docker exec "$DB_CONTAINER" printenv POSTGRES_USER 2>/dev/null | tr -d '\r\n' || true)"
    if [ -z "$VOLUME_USER" ]; then
        VOLUME_USER="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER_VAL" -d dccheck -tAc "SELECT usename FROM pg_user WHERE usename = current_user" 2>/dev/null | tr -d '\r\n' || true)"
    fi
    if [ -n "$VOLUME_USER" ] && [ -n "$DB_USER_VAL" ] && [ "$VOLUME_USER" != "$DB_USER_VAL" ]; then
        echo ""
        echo "WARNING: DB_USER changed in $ENV_FILE but the existing PostgreSQL"
        echo "         volume has user '$VOLUME_USER'. The app container will"
        echo "         fail to authenticate against the database."
        echo "         To switch users: run 'docker compose down -v' to recreate"
        echo "         the volume (DATA LOSS — restore from backup first), or"
        echo "         revert DB_USER in $ENV_FILE to '$VOLUME_USER'."
        echo ""
    fi
fi

# ==================================================================
# STEP 1: BUILD APP IMAGE
# ==================================================================
echo ""
echo "[1/6] Building app image (used by app + SIEM workers)..."
echo "      This may take 3-8 minutes on a fresh server."
if ! "${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" build --no-cache "$APP_SERVICE"; then
    echo "ERROR - App image build failed. Fix the build error above and re-run."
    exit 1
fi
echo "OK    - App image built"

# ==================================================================
# STEP 2: START DATABASE
# ==================================================================
echo ""
echo "[2/6] Starting database container..."
# shellcheck disable=SC1090
DB_USER_VAL="$(grep -E '^[[:space:]]*DB_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '\r\n')"
"${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" up -d "$DB_SERVICE"

echo "      Waiting for PostgreSQL to accept connections..."
# Prefer compose's healthcheck state — falls back to direct pg_isready if compose
# hasn't reported `healthy` yet (e.g. ps output delayed on first start).
for attempt in $(seq 1 60); do
    DB_STATE="$("${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" ps --format '{{.Service}}={{.Health}}' "$DB_SERVICE" 2>/dev/null | tail -n1 | cut -d= -f2-)"
    if [ "$DB_STATE" = "healthy" ]; then
        echo "OK    - Database is healthy (took ~${attempt}s, via compose healthcheck)"
        break
    fi
    if docker exec "$DB_CONTAINER" pg_isready -U "${DB_USER_VAL:-administrator}" -d "${DB_NAME:-dccheck}" >/dev/null 2>&1; then
        if [ "$attempt" -ge 5 ]; then
            echo "OK    - Database is ready (took ~${attempt}s, via pg_isready fallback)"
            break
        fi
    fi
    if [ "$attempt" -eq 60 ]; then
        echo "ERROR - Database never reported ready/healthy after 60s."
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
"${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" up -d --no-deps "$APP_SERVICE"

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
# STEP 4: SYNC DATABASE SCHEMA (versioned migrations)
# ==================================================================
echo ""
echo "[4/6] Syncing database schema..."
echo "      applying committed migrations from drizzle/ (deterministic, no prompts)."
SCHEMA_SYNC_OUTPUT=""
SCHEMA_SYNC_EXIT_CODE=0
set +e
SCHEMA_SYNC_OUTPUT="$("${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" exec -T "$APP_SERVICE" npm run db:migrate 2>&1)"
SCHEMA_SYNC_EXIT_CODE=$?
set -e
if [ -n "${SCHEMA_SYNC_OUTPUT//[[:space:]]/}" ]; then echo "$SCHEMA_SYNC_OUTPUT"; fi

if [ "$SCHEMA_SYNC_EXIT_CODE" -ne 0 ]; then
    echo "WARN  - Compose schema sync failed; retrying with direct docker exec..."
    set +e
    SCHEMA_SYNC_OUTPUT="$(docker exec "$APP_CONTAINER" npm run db:migrate 2>&1)"
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
"${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" exec -T "$APP_SERVICE" npm run seed:users
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
if ! "${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" up -d --no-deps "${SIEM_WORKER_SERVICES[@]}"; then
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
"${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" ps

cat <<'EOF'

============================================
  DEPLOYMENT COMPLETE!
============================================

  Application : http://<server-ip>:3001
  Postgres    : <server-ip>:3002
  SIEM UDP    : 0.0.0.0:514/udp  (point switches/firewalls here)

  Admin login: the random password was printed once during
               'Seeding initial users' above. SAVE IT NOW.
               To rotate: run with SEED_ADMIN_PASSWORD=<new>
               or delete the admin row and re-run the seed.

  Next steps:
    1. Login as 'admin' and change the password from /admin/users.
    2. Configure sites, devices, and SIEM sources from /admin.
    3. Set Telegram alerts and SIEM defaults from /admin/settings.
    4. For future updates, run ./update.sh (database stays running).

  IMPORTANT:
    - The database volume 'dccheck_pgdata' is the source of truth.
      Take regular backups via /admin/backup before maintenance.
    - .env.production holds the live secrets. NEVER commit it.
      Back it up out-of-band and rotate via a new deploy.
    - Open UDP/514 on the host firewall so syslog reaches the receiver.
EOF
