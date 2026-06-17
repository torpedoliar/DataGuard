# Base image
FROM node:20-alpine AS base

# Install dependensi untuk build, unzip, PostgreSQL 17 fallback restore,
# dan runtime libraries yang dibutuhkan pg_dump/pg_restore dari postgres:15-alpine.
RUN apk add --no-cache libc6-compat python3 make g++ unzip postgresql17-client \
    icu-libs lz4-libs zstd-libs xz-libs libxml2 libedit krb5-libs openldap && \
    cp /usr/bin/pg_restore /usr/local/bin/pg_restore17

# Copy pg_dump, pg_restore, psql dari image postgres:15-alpine resmi
# supaya backup baru tidak menghasilkan SET transaction_timeout untuk server PostgreSQL 15.
COPY --from=postgres:15-alpine /usr/local/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=postgres:15-alpine /usr/local/bin/pg_restore /usr/local/bin/pg_restore
COPY --from=postgres:15-alpine /usr/local/bin/psql /usr/local/bin/psql
COPY --from=postgres:15-alpine /usr/local/lib/libpq.so.5 /usr/local/lib/libpq.so.5
COPY --from=postgres:15-alpine /usr/local/lib/libpq.so.5.15 /usr/local/lib/libpq.so.5.15

# 1. Install dependencies & Build (Digabung jadi satu tahap untuk menghindari bug Podman)
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

# Environment flag untuk mencegah error lint/typescript saat build
ENV NEXT_TELEMETRY_DISABLED=1

# SESSION_SECRET is required at build time: Next.js collects page data and
# validates env vars (zod) for every route. Without this, the build aborts
# with "SESSION_SECRET is required in production". Pass via:
#   docker build --build-arg SESSION_SECRET=...
# or via docker-compose `build.args` (already wired in docker-compose.yml).
ARG SESSION_SECRET
ENV SESSION_SECRET=${SESSION_SECRET}

# AI_KEY_ENCRYPTION_SECRET — same story: N49 env validation refuses to boot
# production without it. Build-time page data collection triggers the same
# zod schema, so the secret has to be present during the build step too.
ARG AI_KEY_ENCRYPTION_SECRET
ENV AI_KEY_ENCRYPTION_SECRET=${AI_KEY_ENCRYPTION_SECRET}

RUN npm run build

# Workaround Bug Podman Windows (Unexpected EOF):
# Memindahkan 30,000+ file (node_modules & standalone) antar stage menyebabkan Podman WSL crash.
# Solusinya: Bungkus seluruh hasil build menjadi file tarball UTUH.
RUN touch version.json # pastikan ada agar tar tidak fail
RUN cd .next/standalone && tar -cf /app/standalone.tar .
RUN tar -cf /app/assets.tar public .next/static version.json package.json drizzle.config.ts drizzle db scripts lib node_modules

# 2. Production image, hanya copy file hasil kompilasi (dalam bentuk tar)
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# Database connection values (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME)
# MUST be supplied at runtime via the .env.production file mounted by docker-compose.
# Hardcoding defaults here would leak credentials into image layers.

# Buat group/user non-root untuk keamanan
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Beri ownership hanya ke workdir kosong dan tarball, bukan recursive seluruh hasil build.
RUN chown nextjs:nodejs /app
COPY --from=builder --chown=nextjs:nodejs /app/standalone.tar ./
COPY --from=builder --chown=nextjs:nodejs /app/assets.tar ./

# Ekstrak sebagai user non-root agar file hasil ekstraksi langsung dimiliki nextjs.
# Ini menghindari layer chown -R /app yang besar dan sering gagal saat export image.
USER nextjs
RUN tar -xf standalone.tar && rm standalone.tar && \
    tar -xf assets.tar && rm assets.tar && \
    mkdir -p public/uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Perintah menjalankan web server (berasal dari dalam standalone.tar)
CMD ["node", "server.js"]

