# ================================================================
# SETUP-PORTPROXY.PS1 - Script Fix Akses Podman Windows ke Jaringan Luar
# ================================================================
# Jalankan script ini sebagai **Administrator** setiap kali server/WSL direstart
# atau jika aplikasi Next.js (port 3001) tiba-tiba tidak bisa diakses dari IP LAN.
#
# Untuk menginstall script ini agar jalan otomatis tiap restart:
# .\setup-portproxy.ps1 -InstallTask

param (
    [switch]$InstallTask
)

$ErrorActionPreference = "Stop"

# Pastikan dijalankan sebagai Administrator
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Harap jalankan PowerShell script ini sebagai ADMINISTRATOR!"
    exit
}

# --- BAGIAN INSTALL AUTO-START TASK ---
if ($InstallTask) {
    $taskName = "DC-Check-Podman-Proxy"
    $scriptPath = $MyInvocation.MyCommand.Path
    
    Write-Host "Mendaftarkan script ini ke Windows Task Scheduler agar berjalan otomatis saat komputer menyala..." -ForegroundColor Cyan
    
    # Hapus task lama jika ada
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
    
    # Trigger 1: Saat komputer / sistem menyala
    $trigger1 = New-ScheduledTaskTrigger -AtStartup
    
    # Kita butuh privilege tertinggi (Run with highest privileges) agar bisa execute 'netsh'
    $principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger1 -Principal $principal -Settings $settings | Out-Null
    
    Write-Host "✅ Selesai! Script telah didaftarkan sebagai '$taskName' di Task Scheduler." -ForegroundColor Green
    Write-Host "Mulai sekarang, proxy IP Podman akan disesuaikan otomatis setiap kali server di-restart." -ForegroundColor Yellow
    exit
}

# --- BAGIAN UTAMA (EKSEKUSI PROXY) ---

Write-Host "Mencari IP dari Podman Machine WSL2..." -ForegroundColor Cyan

# Ambil IP spesifik dari instance WSL Podman (biasanya `podman-machine-default`)
$wslIp = (wsl -d podman-machine-default -- ip -4 addr show eth0 | Select-String -Pattern "inet ([\d\.]+)/").Matches.Groups[1].Value

if (-not $wslIp) {
    # Fallback ke IP default WSL jika spesifik tidak ditemukan
    $wslIp = (wsl -- ip -4 addr show eth0 | Select-String -Pattern "inet ([\d\.]+)/").Matches.Groups[1].Value
}

if (-not $wslIp) {
    Write-Host "❌ Gagal menemukan IP WSL2. Pastikan Podman Machine sudah berjalan (podman machine start)." -ForegroundColor Red
    exit
}

Write-Host "✅ IP Podman/WSL2 ditemukan: $wslIp" -ForegroundColor Green

# Membersihkan proxy lama untuk port 3001 dan 3002
netsh interface portproxy delete v4tov4 listenport=3001 listenaddress=0.0.0.0 2>$null
netsh interface portproxy delete v4tov4 listenport=3002 listenaddress=0.0.0.0 2>$null

# Membuat proxy baru yang mengarah ke IP dinamis WSL2 saat ini
Write-Host "Menyambungkan Port 3001 (App) & 3002 (DB) Host ke IP WSL ($wslIp)..." -ForegroundColor Cyan

netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=$wslIp
netsh interface portproxy add v4tov4 listenport=3002 listenaddress=0.0.0.0 connectport=3002 connectaddress=$wslIp

Write-Host "✅ Selesai! Aplikasi sekarang seharusnya bisa diakses via IP Windows Server." -ForegroundColor Green
Write-Host "Contoh: http://192.168.2.3:3001" -ForegroundColor Yellow
Write-Host "Catatan: Jalankan dengan parameter -InstallTask jika ingin ini berjalan otomatis setelah restart." -ForegroundColor DarkGray
