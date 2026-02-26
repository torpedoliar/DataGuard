@echo off
title DC-Check Development Server (Podman Edition)

echo ==========================================
echo    DC-Check - Data Center Audit System
echo           Development Server
echo           [ Powered by Podman ]
echo ==========================================
echo.

REM Memastikan menggunakan podman-compose
set COMPOSE_CMD=podman-compose

where podman-compose >nul 2>nul
if %errorlevel%==0 (
    echo [INFO] Menyalakan database PostgreSQL via %COMPOSE_CMD%...
    call %COMPOSE_CMD% up -d
    echo.
) else (
    echo [ERROR] podman-compose tidak ditemukan di sistem Anda!
    echo Silakan install podman-compose atau jalankan database secara manual.
    echo.
    pause
    exit /b 1
)

REM Cek apakah folder node_modules sudah ada
if not exist "node_modules\" (
    echo [INFO] Folder node_modules tidak ditemukan. Menginstal dependensi npm install...
    echo.
    call npm install
    echo.
)

REM Langsung sinkronisasi schema database terbaru sebelum run dev
echo [INFO] Mengecek dan menerapkan skema database Drizzle ke PostgreSQL...
call npm run db:push
echo.

echo [INFO] Memulai Next.js development server...
echo [INFO] Aplikasi akan berjalan di http://localhost:3001
echo.

REM Menjalankan skrip dev dari package.json
npm run dev

pause
