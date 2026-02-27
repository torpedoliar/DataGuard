# ================================================================
# SETUP-PORTPROXY.PS1 - Script Fix Akses Podman Windows ke Jaringan Luar
# ================================================================
# Jalankan script ini sebagai **Administrator** setiap kali server/WSL direstart
# atau jika aplikasi Next.js (port 3001) tiba-tiba tidak bisa diakses dari IP LAN.

$ErrorActionPreference = "Stop"

# Pastikan dijalankan sebagai Administrator
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Harap jalankan PowerShell script ini sebagai ADMINISTRATOR!"
    exit
}

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
Write-Host "Catatan: Script ini perlu dijalankan lagi jika Windows atau WSL direstart (karena IP WSL berubah)." -ForegroundColor DarkGray
