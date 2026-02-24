@echo off
title DC-Check Production Server

echo ==========================================
echo    DC-Check - Data Center Audit System
echo             Production Server
echo ==========================================
echo.

if not exist "node_modules\" (
    echo [INFO] Folder node_modules tidak ditemukan. Menginstal dependensi npm install...
    echo.
    call npm install
    echo.
)

if not exist ".next\" (
    echo [INFO] Build folder .next tidak ditemukan. Menjalankan proses build...
    echo.
    call npm run build
    echo.
)

echo [INFO] Memulai Next.js production server...
echo [INFO] Aplikasi akan berjalan di http://localhost:3000
echo.

npm run start

pause
