# ================================================================
# SETUP-AUTOSTART.PS1 - Script Menjalankan Podman Otomatis di Background
# ================================================================
# Script ini akan membuat Scheduled Task di Windows yang memaksa
# 'podman machine start' dan 'podman-compose up -d' berjalan pada 
# saat server Windows baru menyala, bahkan tanpa Administrator login!

$ErrorActionPreference = "Stop"

# Pastikan dijalankan sebagai Administrator
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Harap jalankan PowerShell script ini sebagai ADMINISTRATOR!"
    exit
}

$taskName = "DC-Check-Podman-Autostart"
$projectDir = (Get-Item .).FullName
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " SETUP AUTO-START PODMAN (WINDOWS SERVER)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "User pendeteksi: $currentUser"
Write-Host "Direktori Kerja: $projectDir"
Write-Host ""

Write-Host "Mendaftarkan Podman Autostart ke Task Scheduler..." -ForegroundColor Yellow

# Hapus task lama jika ada
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Karena Podman & WSL terikat pada User (bukan SYSTEM), kita buat file batch perantara
$batFile = "$projectDir\scripts\runner.bat"
$batContent = @"
@echo off
echo Starting Podman Machine...
podman machine start
echo Waiting for machine to initialize...
timeout /t 15 /nobreak
echo Starting DC-Check application...
cd /d "$projectDir"
podman-compose up -d
"@
Set-Content -Path $batFile -Value $batContent
Write-Host "File perantara terbuat: $batFile" -ForegroundColor DarkGray

# Action untuk menjalankan batch tadi secara Hidden
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batFile`""

# Trigger: Saat komputer menyala (Startup)
$trigger = New-ScheduledTaskTrigger -AtStartup

# Supaya jalan tanpa User Login, ubah nilai logonType
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd

Write-Host ""
Write-Host "⚠️ PENTING: Windows memerlukan PASSWORD Administrator Anda" -ForegroundColor Red
Write-Host "untuk mengizinkan aplikasi berjalan di background saat Server Restart." -ForegroundColor Red

try {
    # Minta sistem register dengan pop-up credential atau dialog CLI prompt Windows
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
    Write-Host "✅ Selesai! Podman Machine dan App sekarang akan AUTO-START saat server nyala." -ForegroundColor Green
    Write-Host "Bapak tidak perlu login ke Desktop lagi." -ForegroundColor Green
}
catch {
    Write-Host "❌ Gagal mendata task. Pastikan Anda memiliki password admin yang benar." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Gray
}

Write-Host ""
