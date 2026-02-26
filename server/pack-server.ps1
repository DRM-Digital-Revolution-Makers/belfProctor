# BelfProctor Server - Pack for deployment
# Creates belfProctor-server.zip with everything needed to run the server

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverRoot = $scriptDir
$backendDir = Join-Path $serverRoot "backend"
$frontendDir = Join-Path $serverRoot "frontend"
$zipPath = Join-Path (Split-Path -Parent $scriptDir) "belfProctor-server.zip"

Write-Host "=== BelfProctor Server Pack ===" -ForegroundColor Cyan
Write-Host ""

# 1. Build Frontend
Write-Host "[1/4] Building Frontend..." -ForegroundColor Yellow
Push-Location $frontendDir
npm install --silent 2>$null
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
Pop-Location
Write-Host "  OK" -ForegroundColor Green

# 2. Prepare Backend public folder
Write-Host "[2/4] Copying frontend to backend/public..." -ForegroundColor Yellow
$publicDir = Join-Path $backendDir "public"
if (Test-Path $publicDir) { Remove-Item $publicDir -Recurse -Force }
New-Item -ItemType Directory -Path $publicDir | Out-Null
Copy-Item -Path (Join-Path $frontendDir "dist\*") -Destination $publicDir -Recurse
Write-Host "  OK" -ForegroundColor Green

# 3. Build Backend
Write-Host "[3/4] Building Backend..." -ForegroundColor Yellow
Push-Location $backendDir
npm install --silent 2>$null
npm run build
if ($LASTEXITCODE -ne 0) { throw "Backend build failed" }
Pop-Location
Write-Host "  OK" -ForegroundColor Green

# 4. Create ZIP
Write-Host "[4/4] Creating ZIP archive..." -ForegroundColor Yellow
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$tempPackDir = Join-Path $env:TEMP "belfProctor-pack"
if (Test-Path $tempPackDir) { Remove-Item $tempPackDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempPackDir | Out-Null

# Copy backend contents (exclude node_modules, .git, storage - we create fresh storage; .env включаем!)
$excludeNames = @("node_modules", ".git", "storage")
Get-ChildItem $backendDir | Where-Object { $_.Name -notin $excludeNames } | ForEach-Object {
    $dest = Join-Path $tempPackDir $_.Name
    if ($_.PSIsContainer) {
        Copy-Item $_.FullName $dest -Recurse -Force -Exclude @("node_modules", ".env", ".git")
    } else {
        Copy-Item $_.FullName $dest -Force
    }
}
# Ensure node_modules is not in pack (Copy-Item -Exclude on dir doesn't skip the dir itself)
$nodeModPath = Join-Path $tempPackDir "node_modules"
if (Test-Path $nodeModPath) { Remove-Item $nodeModPath -Recurse -Force }

# Create empty storage structure for fresh deploy
$storageDir = Join-Path $tempPackDir "storage"
New-Item -ItemType Directory -Path $storageDir -Force | Out-Null
@("screenshots", "reports", "activity", "events", "clients") | ForEach-Object {
    New-Item -ItemType Directory -Path (Join-Path $storageDir $_) -Force | Out-Null
}

# Add README for deployment
$readme = @"
BelfProctor Server - Deployment

1. Unzip this archive to your server
2. Install Node.js 18+ if not present
3. Run setup-win8-server.bat (for Windows with PM2)
   OR run win8-start.bat (simple Node.js start, no PM2)

Environment (optional .env file):
- PORT=8080
- NO_DB=1 (use file storage, no PostgreSQL)
- DEFAULT_ADMIN_EMAIL=admin@local
- DEFAULT_ADMIN_PASSWORD=your-password
"@
$readme | Out-File (Join-Path $tempPackDir "DEPLOY-README.txt") -Encoding utf8

# Create ZIP
Compress-Archive -Path "$tempPackDir\*" -DestinationPath $zipPath -Force
Remove-Item $tempPackDir -Recurse -Force

Write-Host "  OK" -ForegroundColor Green
Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Cyan
Write-Host "ZIP: $zipPath"
Write-Host "Size: $([math]::Round((Get-Item $zipPath).Length / 1MB, 2)) MB"
Write-Host ""
Write-Host "On the server: unzip, run setup-win8-server.bat"
