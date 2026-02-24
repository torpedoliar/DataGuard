@echo off
title DC-Check Development Server

echo ==========================================
echo    DC-Check - Data Center Audit System
echo           Development Server
echo ==========================================
echo.

REM Cek apakah folder node_modules sudah ada (untuk memastikan dependensi sudah diinstall)
if not exist "node_modules\" (
    echo [INFO] Folder node_modules tidak ditemukan. Menginstal dependensi npm install...
    echo.
    call npm install
    echo.
)

echo [INFO] Memulai Next.js development server...
echo [INFO] Aplikasi akan berjalan di http://localhost:3000
echo.

REM Menjalankan skrip dev dari package.json
npm run dev

pause
