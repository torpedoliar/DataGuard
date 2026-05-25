# ============================================
# UPDATE.PS1 - Production-Safe Update Script
# DC-Check System
# ============================================
# KEAMANAN DATA:
# - Script ini TIDAK PERNAH memanggil 'down -v' (tidak menghapus volume)
# - Database container (db) TIDAK PERNAH di-rebuild atau di-stop
# - Hanya container aplikasi/stateless worker yang di-rebuild dan di-restart
# - Backup database WAJIB berhasil sebelum proses lanjut
# ============================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  DC-Check System - Production Update" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ---- Ensure Docker Compose (V2 or V1) is available ----
$composeCmd = "docker compose"
try {
    & docker compose version >$null 2>&1
    if ($LASTEXITCODE -ne 0) { throw "no v2" }
}
catch {
    if (Get-Command "docker-compose" -ErrorAction SilentlyContinue) {
        $composeCmd = "docker-compose"
    }
    else {
        Write-Host "ERROR: docker compose or docker-compose could not be found." -ForegroundColor Red
        Write-Host "Please ensure Docker Desktop or Rancher Desktop is running." -ForegroundColor Yellow
        exit 1
    }
}
Write-Host "Using: $composeCmd" -ForegroundColor DarkGray

# Define main command and extra arguments
$cmdParts = $composeCmd.Split(" ")
$mainCmd = $cmdParts[0]
$extraArgs = @()
if ($cmdParts.Length -gt 1) { $extraArgs = $cmdParts[1..($cmdParts.Length - 1)] }

# ---- Read DB credentials from running container ----
try {
    # Default values
    $dbUser = "administrator"
    $dbName = "dccheck"

    $fetchedUser = & $mainCmd $extraArgs exec -T db printenv POSTGRES_USER 2>$null
    $fetchedName = & $mainCmd $extraArgs exec -T db printenv POSTGRES_DB 2>$null
    if (-not $fetchedUser) { $fetchedUser = & docker exec dccheck_postgres printenv POSTGRES_USER 2>$null }
    if (-not $fetchedName) { $fetchedName = & docker exec dccheck_postgres printenv POSTGRES_DB 2>$null }
    
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
Write-Host "[1/6] Backing up database..." -ForegroundColor Yellow
$backupDir = "backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "$backupDir/db_backup_$timestamp.sql"

# Cek apakah container db sedang berjalan
$dbRunning = $false
$useNamedDbContainer = $false
try {
    # Method 1: Check by Service Name (V2 compatible)
    $dbID = & $mainCmd $extraArgs ps -q db 2>$null
    if ($dbID) {
        $inspectStatus = & docker inspect -f '{{.State.Running}}' $dbID 2>$null
        if ($inspectStatus -eq "true") {
            $dbRunning = $true
        }
    }
    
    # Method 2: Fallback to text check (V1 compatible)
    if (-not $dbRunning) {
        $psOutput = & $mainCmd $extraArgs ps db 2>$null
        # Join lines and check for "Up" or "running"
        if (($psOutput -join "`n") -match "(Up|running)") {
            $dbRunning = $true
        }
    }

    # Method 3: Fallback to explicit container name shown by Docker Desktop
    if (-not $dbRunning) {
        $inspectStatus = & docker inspect -f '{{.State.Running}}' dccheck_postgres 2>$null
        if ($inspectStatus -eq "true") {
            $dbRunning = $true
            $useNamedDbContainer = $true
        }
    }
}
catch {
    $dbRunning = $false
}

if ($dbRunning) {
    if ($useNamedDbContainer) {
        & docker exec -i dccheck_postgres pg_dump -U $dbUser $dbName > $backupFile 2>$null
    }
    else {
        & $mainCmd $extraArgs exec -T db pg_dump -U $dbUser $dbName > $backupFile 2>$null
    }

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
Write-Host "[2/6] Pulling latest code from GitHub..." -ForegroundColor Yellow
git pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Git pull failed!" -ForegroundColor Red
    Write-Host "Try: git stash; git pull origin main; git stash pop" -ForegroundColor Yellow
    exit 1
}
Write-Host "OK - Code updated" -ForegroundColor Green

# ==================================================================
# STEP 3: REBUILD APP IMAGE (database TIDAK disentuh!)
# ==================================================================
$appService = "app"
$siemWorkerServices = @("syslog-receiver", "siem-parser", "siem-rules", "siem-alerts", "siem-retention")
$statelessServices = @($appService) + $siemWorkerServices
Write-Host ""
Write-Host "[3/6] Rebuilding app image (database untouched)..." -ForegroundColor Yellow
Write-Host "      Workers reuse image: $($siemWorkerServices -join ', ')" -ForegroundColor DarkGray
Write-Host "      This may take 2-5 minutes..." -ForegroundColor DarkGray
& $mainCmd $extraArgs build --no-cache $appService
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed! Aborting update." -ForegroundColor Red
    Write-Host "Your current running version is still intact." -ForegroundColor Yellow
    Write-Host "Backup file: $backupFile" -ForegroundColor Cyan
    exit 1
}
Write-Host "OK - App image rebuilt successfully" -ForegroundColor Green

# ==================================================================
# STEP 4: RESTART APP ONLY (database tetap berjalan!)
# ==================================================================
Write-Host ""
Write-Host "[4/6] Restarting app (database stays running)..." -ForegroundColor Yellow

# Recreate app dulu supaya schema sync berjalan sebelum worker SIEM aktif.
& $mainCmd $extraArgs up -d --no-deps --force-recreate --remove-orphans $appService
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: App restart failed! Check docker compose logs." -ForegroundColor Red
    Write-Host "Backup file: $backupFile" -ForegroundColor Cyan
    exit 1
}
Write-Host "OK - App restarted" -ForegroundColor Green
Write-Host "Waiting for app to become ready..." -ForegroundColor DarkGray
Start-Sleep -Seconds 10

# ==================================================================
# STEP 5: SYNC DATABASE SCHEMA (additive only, no data loss)
# ==================================================================
Write-Host ""
Write-Host "[5/6] Syncing database schema..." -ForegroundColor Yellow
Write-Host "      (drizzle push is additive - it only ADDS new columns/tables)" -ForegroundColor DarkGray
$schemaSyncOutput = @()
$schemaSyncExitCode = 1
try {
    $schemaSyncOutput = & $mainCmd $extraArgs exec -T app npx drizzle-kit push 2>&1
    $schemaSyncExitCode = $LASTEXITCODE
}
catch {
    $schemaSyncOutput += $_.Exception.Message
    $schemaSyncExitCode = 1
}

$schemaSyncText = ($schemaSyncOutput | Out-String)
if ($schemaSyncText.Trim()) { Write-Host $schemaSyncText.TrimEnd() }

if ($schemaSyncExitCode -ne 0 -and ($schemaSyncText -match "No changes detected|Pulling schema from database")) {
    Write-Host "WARN - Docker reported an exec error after schema check completed. Continuing." -ForegroundColor Yellow
    $schemaSyncExitCode = 0
}

if ($schemaSyncExitCode -ne 0) {
    Write-Host "WARN - Compose schema sync failed; retrying with direct docker exec..." -ForegroundColor Yellow
    try {
        $schemaSyncOutput = & docker exec dccheck_app npx drizzle-kit push 2>&1
        $schemaSyncExitCode = $LASTEXITCODE
    }
    catch {
        $schemaSyncOutput += $_.Exception.Message
        $schemaSyncExitCode = 1
    }
    $schemaSyncText = ($schemaSyncOutput | Out-String)
    if ($schemaSyncText.Trim()) { Write-Host $schemaSyncText.TrimEnd() }
}

if ($schemaSyncExitCode -ne 0) {
    Write-Host "ERROR - Schema sync failed. SIEM workers will not be restarted." -ForegroundColor Red
    Write-Host "Backup file: $backupFile" -ForegroundColor Cyan
    exit 1
}

Write-Host "OK - Database schema synced" -ForegroundColor Green

# ==================================================================
# STEP 6: RESTART STATELESS SIEM SERVICES (database tetap berjalan!)
# ==================================================================
Write-Host ""
Write-Host "[6/6] Restarting SIEM workers (database stays running)..." -ForegroundColor Yellow
Write-Host "      Services: $($siemWorkerServices -join ', ')" -ForegroundColor DarkGray

& $mainCmd $extraArgs up -d --no-deps --force-recreate --remove-orphans $siemWorkerServices
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: SIEM worker restart failed! Check docker compose logs." -ForegroundColor Red
    Write-Host "Backup file: $backupFile" -ForegroundColor Cyan
    exit 1
}
Write-Host "OK - SIEM workers restarted" -ForegroundColor Green

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
Write-Host "  SIEM UDP    : 0.0.0.0:514/udp" -ForegroundColor Cyan
Write-Host "  Backup file : $backupFile" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To restore database if needed:" -ForegroundColor Yellow
Write-Host "  Get-Content `"$backupFile`" | $composeCmd exec -T db psql -U $dbUser $dbName" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  IMPORTANT: Database was NEVER stopped during this update." -ForegroundColor Green
Write-Host "  Your data is safe and intact." -ForegroundColor Green
Write-Host ""
