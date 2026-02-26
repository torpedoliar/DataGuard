@echo off
title DC-Check Development Server

echo ==========================================
echo    DC-Check - Data Center Audit System
echo           Development Server
echo ==========================================
echo.

REM Cek apakah Docker atau Podman tersedia
where docker-compose >nul 2>nul
if %errorlevel%==0 (
    set COMPOSE_CMD=docker-compose
) else (
    where podman-compose >nul 2>nul
    if %errorlevel%==0 (
        set COMPOSE_CMD=podman-compose
    ) else (
        echo [WARNING] docker-compose atau podman-compose tidak ditemukan.
        echo Pastikan database PostgreSQL sudah berjalan secara manual.
        echo.
        goto skip_docker
    )
)

echo [INFO] Menyalakan database PostgreSQL via %COMPOSE_CMD%...
call %COMPOSE_CMD% up -d
echo.

:skip_docker

REM Cek apakah folder node_modules sudah ada
if not exist "node_modules\" (
    echo [INFO] Folder node_modules tidak ditemukan. Menginstal dependensi npm install...
    echo.
    call npm install
    echo.
)

REM (Opsional) Langsung sinkronisasi schema database terbaru sebelum run dev
echo [INFO] Mengecek dan menerapkan skema database Drizzle ke PostgreSQL...
call npm run db:push
echo.

echo [INFO] Memulai Next.js development server...
echo [INFO] Aplikasi akan berjalan di http://localhost:3000
echo.

REM Menjalankan skrip dev dari package.json
npm run dev

pause
