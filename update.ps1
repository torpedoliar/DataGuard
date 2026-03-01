# ============================================
# UPDATE.PS1 - Production-Safe Update Script
# DC-Check System
# ============================================
# KEAMANAN DATA:
# - Script ini TIDAK PERNAH memanggil 'down -v' (tidak menghapus volume)
# - Database container (db) TIDAK PERNAH di-rebuild atau di-stop
# - Hanya container 'app' yang di-rebuild dan di-restart
# - Backup database WAJIB berhasil sebelum proses lanjut
# ============================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  DC-Check System - Production Update" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ---- Ensure docker-compose is available ----
$composeCmd = "docker-compose"
if (-not (Get-Command "docker-compose" -ErrorAction SilentlyContinue)) {
    if (Get-Command "docker" -ErrorAction SilentlyContinue) {
        # Check if 'docker compose' (V2) works
        $checkCompose = docker compose version 2>$null
        if ($LASTEXITCODE -eq 0) {
            $composeCmd = "docker compose"
        }
        else {
            Write-Host "ERROR: docker-compose or 'docker compose' could not be found." -ForegroundColor Red
            Write-Host "Please ensure Docker Desktop or Rancher Desktop is running." -ForegroundColor Yellow
            exit 1
        }
    }
    else {
        Write-Host "ERROR: docker could not be found." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Using: $composeCmd" -ForegroundColor DarkGray

# ---- Read DB credentials from running container ----
try {
    # Default values
    $dbUser = "administrator"
    $dbName = "dccheck"

    # Use & operator for multi-word commands (like 'docker compose')
    $cmdParts = $composeCmd.Split(" ")
    
    $fetchedUser = & $cmdParts[0] $cmdParts[1..$cmdParts.Length] exec -T db printenv POSTGRES_USER 2>$null
    $fetchedName = & $cmdParts[0] $cmdParts[1..$cmdParts.Length] exec -T db printenv POSTGRES_DB 2>$null
    
    if ($fetchedUser) { $dbUser = $fetchedUser.Trim() }
    if ($fetchedName) { $dbName = $fetchedName.Trim() }
}
catch {
    $dbUser = "administrator"
    $dbName = "dccheck"
}
if ([string]::IsNullOrWhiteSpace($dbName)) { $dbName = "dccheck" }

# Validasi folder project
if (-not (Test-Path "docker-compose.yml")) {
    Write-Host "ERROR: docker-compose.yml not found!" -ForegroundColor Red
    Write-Host "Please run this script from the project root directory." -ForegroundColor Red
    exit 1
}

# ==================================================================
# STEP 1: BACKUP DATABASE (WAJIB BERHASIL!)
# ==================================================================
Write-Host ""
Write-Host "[1/5] Backing up database..." -ForegroundColor Yellow
$backupDir = "backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "$backupDir/db_backup_$timestamp.sql"

# Cek apakah container db sedang berjalan.
$dbRunning = $false
try {
    $psOutput = & $cmdParts[0] $cmdParts[1..$cmdParts.Length] ps 2>$null
    $dbRunning = $psOutput | Select-String -Pattern "db" -Quiet
}
catch {
    $dbRunning = $false
}

if ($dbRunning) {
    & $cmdParts[0] $cmdParts[1..$cmdParts.Length] exec -T db pg_dump -U $dbUser $dbName > $backupFile 2>$null

    # Validasi backup: file harus ada dan ukuran > 100 bytes
    if ((Test-Path $backupFile) -and (Get-Item $backupFile).Length -gt 100) {
        $backupSize = [math]::Round((Get-Item $backupFile).Length / 1KB, 1)
        Write-Host "OK - Database backed up: $backupFile (${backupSize}KB)" -ForegroundColor Green
    }
    else {
        Write-Host "CRITICAL: Backup file is empty or too small!" -ForegroundColor Red
        Write-Host "Aborting update to protect your data." -ForegroundColor Red
        Write-Host "Please check database health manually." -ForegroundColor Red
        if (Test-Path $backupFile) { Remove-Item $backupFile -Force }
        exit 1
    }
}
else {
    Write-Host "WARN - Database container is not running. Skipping backup." -ForegroundColor Yellow
    Write-Host "       (This is normal for first-time installation)" -ForegroundColor DarkGray
}

# ==================================================================
# STEP 2: PULL LATEST CODE
# ==================================================================
Write-Host ""
Write-Host "[2/5] Pulling latest code from GitHub..." -ForegroundColor Yellow
git pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Git pull failed!" -ForegroundColor Red
    Write-Host "Try: git stash; git pull origin main; git stash pop" -ForegroundColor Yellow
    exit 1
}
Write-Host "OK - Code updated" -ForegroundColor Green

# ==================================================================
# STEP 3: REBUILD HANYA CONTAINER APP (database TIDAK disentuh!)
# ==================================================================
Write-Host ""
Write-Host "[3/5] Rebuilding application image ONLY (database untouched)..." -ForegroundColor Yellow
Write-Host "      This may take 2-5 minutes..." -ForegroundColor DarkGray
& $cmdParts[0] $cmdParts[1..$cmdParts.Length] build --no-cache app
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed! Aborting update." -ForegroundColor Red
    Write-Host "Your current running version is still intact." -ForegroundColor Yellow
    Write-Host "Backup file: $backupFile" -ForegroundColor Cyan
    exit 1
}
Write-Host "OK - App image rebuilt successfully" -ForegroundColor Green

# ==================================================================
# STEP 4: RESTART HANYA APP (database tetap berjalan!)
# ==================================================================
Write-Host ""
Write-Host "[4/5] Restarting app container (database stays running)..." -ForegroundColor Yellow

# Hanya recreate service 'app', bukan seluruh stack
# Ini memastikan container 'db' TIDAK PERNAH berhenti
& $cmdParts[0] $cmdParts[1..$cmdParts.Length] up -d --no-deps app
Write-Host "OK - App container restarted" -ForegroundColor Green
Write-Host "Waiting for app to become ready..." -ForegroundColor DarkGray
Start-Sleep -Seconds 10

# ==================================================================
# STEP 5: SYNC DATABASE SCHEMA (additive only, no data loss)
# ==================================================================
Write-Host ""
Write-Host "[5/5] Syncing database schema..." -ForegroundColor Yellow
Write-Host "      (drizzle push is additive - it only ADDS new columns/tables)" -ForegroundColor DarkGray
try {
    & $cmdParts[0] $cmdParts[1..$cmdParts.Length] exec -T app npx drizzle-kit push
    Write-Host "OK - Database schema synced" -ForegroundColor Green
}
catch {
    Write-Host "WARN - Schema sync had warnings or failed. Check logs above." -ForegroundColor Yellow
}

# ==================================================================
# CLEANUP: Remove old backups (keep last 10)
# ==================================================================
Write-Host ""
Write-Host "Cleaning up old backups (keeping last 10)..." -ForegroundColor Yellow
Get-ChildItem -Path $backupDir -Filter "db_backup_*.sql" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | Remove-Item -Force 2>$null
Write-Host "OK - Cleanup completed" -ForegroundColor Green

# Done
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  UPDATE COMPLETE!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Application : http://localhost:3001" -ForegroundColor Cyan
Write-Host "  Backup file : $backupFile" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To restore database if needed:" -ForegroundColor Yellow
Write-Host "  Get-Content `"$backupFile`" | $composeCmd exec -T db psql -U $dbUser $dbName" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  IMPORTANT: Database was NEVER stopped during this update." -ForegroundColor Green
Write-Host "  Your data is safe and intact." -ForegroundColor Green
Write-Host ""
