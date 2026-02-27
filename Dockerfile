# Base image
FROM node:20-alpine AS base

# Install dependensi untuk build (termasuk libc opsional untuk Alpine)
RUN apk add --no-cache libc6-compat python3 make g++

# 1. Install dependencies & Build (Digabung jadi satu tahap untuk menghindari bug Podman)
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

# Environment flag untuk mencegah error lint/typescript saat build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Workaround Bug Podman Windows (Unexpected EOF): 
# Memindahkan 30,000+ file node_modules antar stage menyebabkan Podman WSL crash.
# Solusinya: Bungkus menjadi SATU file tarball.
RUN tar -cf runner_deps.tar node_modules

# 3. Production image, hanya copy file hasil kompilasi
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# Buat group/user non-root untuk keamanan
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Database connection — decomposed agar tidak ada masalah URL encoding
ENV DB_HOST="db"
ENV DB_PORT="5432"
ENV DB_USER="administrator"
ENV DB_PASSWORD="Arabika1927"
ENV DB_NAME="dccheck"
ENV UPLOAD_DIR="./public/uploads"

# Buat folder uploads dan set hak akses sebelum switch user
RUN mkdir -p ./public/uploads
RUN chown -R nextjs:nodejs ./public

COPY --from=builder /app/public ./public

# Folder standalone meminimalisir node_modules yang dibutuhkan
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy version.json agar bisa dibaca oleh server action checkSystemUpdate()
COPY --from=builder --chown=nextjs:nodejs /app/version.json ./version.json

# ============================================================
# MIGRATION & SEED TOOLKIT
# ============================================================
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/db ./db
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# KARENA `drizzle-kit` dan `tsx` merupakan devDependencies, kita perlu mengcopy node_modules
# bypass bug COPY Podman Windows dengan memindahkan format TAR lalu mengekstraknya di dalam image
COPY --from=builder --chown=nextjs:nodejs /app/runner_deps.tar ./
RUN tar -xf runner_deps.tar && rm runner_deps.tar && chown -R nextjs:nodejs ./node_modules

# Switch ke user non-root
USER nextjs

EXPOSE 3001

# Perintah menjalankan web server
CMD ["node", "server.js"]
