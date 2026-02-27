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
# Memindahkan 30,000+ file (node_modules & standalone) antar stage menyebabkan Podman WSL crash.
# Solusinya: Bungkus seluruh hasil build menjadi file tarball UTUH.
RUN touch version.json # pastikan ada agar tar tidak fail
RUN cd .next/standalone && tar -cf /app/standalone.tar .
RUN tar -cf /app/assets.tar public .next/static version.json package.json drizzle.config.ts db scripts node_modules

# 2. Production image, hanya copy file hasil kompilasi (dalam bentuk tar)
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

# Ekstrak tarball hasil build
# Lakukan sebagai root agar ownership dapat di-chown dengan efisien
COPY --from=builder /app/standalone.tar ./
COPY --from=builder /app/assets.tar ./

RUN tar -xf standalone.tar && rm standalone.tar
RUN tar -xf assets.tar && rm assets.tar

# Persiapkan folder public uploads dan pastikan hak akses untuk user nextjs 
RUN mkdir -p public/uploads
RUN chown -R nextjs:nodejs /app

# Switch ke user non-root
USER nextjs

EXPOSE 3001

# Perintah menjalankan web server (berasal dari dalam standalone.tar)
CMD ["node", "server.js"]

