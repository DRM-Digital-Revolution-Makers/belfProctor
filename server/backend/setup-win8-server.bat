@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   BelfProctor Server Installer for Windows 8
echo ===================================================

echo [1/6] Checking Node.js...
node -v
if %errorLevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js 18+
    pause
    exit /b 1
)

echo [2/6] Skipping Frontend build on Windows 8...
echo (Frontend must be prebuilt and included in backend\public)

echo [3/6] Installing backend dependencies...
call npm install
if %errorLevel% neq 0 (
    echo Warning: npm install failed.
)

echo [4/6] Checking PM2...
call npm list -g pm2 >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing PM2 globally...
    call npm install -g pm2
)

echo [5/6] Configuring Auto-Startup...
call npm list -g pm2-windows-startup >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing pm2-windows-startup...
    call npm install -g pm2-windows-startup
)
echo Registering PM2 startup...
call pm2-startup install

echo [6/6] Starting Server...

echo Stopping any existing instance...
call pm2 delete belfproctor-server >nul 2>&1

echo Building project...
if exist "dist\index.js" (
    echo Found existing build in dist/, skipping compilation...
) else (
    call npm run build
    if %errorLevel% neq 0 (
        echo Build failed! Exiting.
        pause
        exit /b 1
    )
)

echo Creating storage directory...
if not exist "storage" mkdir storage
if not exist "storage\screenshots" mkdir storage\screenshots
if not exist "storage\reports" mkdir storage\reports
if not exist "storage\activity" mkdir storage\activity
if not exist "storage\events" mkdir storage\events
if not exist "storage\clients" mkdir storage\clients

echo Starting with PM2 (ecosystem.config.cjs)...
REM Env: NO_DB=1, PORT=8080, STORE_TAIL_BYTES=16384 - see ecosystem.config.cjs
call pm2 start ecosystem.config.cjs
call pm2 save

echo Adding watchdog scheduled task (checks health every minute)...
schtasks /Create /SC MINUTE /MO 1 /TN "BelfProctorServerWatchdog" /TR "powershell -NoProfile -WindowStyle Hidden -Command \"try{Invoke-WebRequest -Uri http://localhost:8080/api/health -UseBasicParsing -TimeoutSec 15 | Out-Null}catch{pm2 restart belfproctor-server}\"" /F >nul 2>&1

echo.
echo ===================================================
echo   Server Started Successfully!
echo ===================================================
echo   Frontend: http://localhost:8080/
echo   Backend:  http://localhost:8080/api/
echo.
echo   To stop server: pm2 stop belfproctor-server
echo   To see logs:    pm2 logs belfproctor-server
echo.
call pm2 save
echo.
pause
