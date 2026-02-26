# Base image
FROM node:20-alpine AS base

# Install dependensi untuk build (termasuk libc opsional untuk Alpine)
RUN apk add --no-cache libc6-compat python3 make g++

# 1. Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# 2. Build aplikasi
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Environment flag untuk mencegah error lint/typescript saat build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

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

# Set environment DB & Upload dir standard
# Kredensial URL untuk internal antar container. Simbol "!" pada password harus encode (%21)
ENV DATABASE_URL="postgresql://administrator:Arabika1927%21@db:5432/dccheck"
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
# bawaan builder ager command `npm run db:push` dan `npm run seed:users` bisa dieksekusi 
# oleh admin di server production.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Switch ke user non-root
USER nextjs

EXPOSE 3000

# Perintah menjalankan web server
CMD ["node", "server.js"]
