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

echo [2/5] Skipping Frontend build on Windows 8...
echo (Frontend must be prebuilt and included in backend\public)

echo [3/5] Installing backend dependencies...
call npm install
if %errorLevel% neq 0 (
    echo Warning: npm install failed.
)

echo [4/5] Checking PM2...
call npm list -g pm2 >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing PM2 globally...
    call npm install -g pm2
)

echo [5/5] Configuring Auto-Startup...
call npm list -g pm2-windows-startup >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing pm2-windows-startup...
    call npm install -g pm2-windows-startup
)
echo Registering PM2 startup...
call pm2-startup install

echo Starting Server...

echo Setting environment variables...
set NO_DB=1
set PORT=8080

echo Stopping any existing instance...
call pm2 delete belfproctor-server >nul 2>&1

echo Building project...
call npm run build
if %errorLevel% neq 0 (
    echo Build failed! Exiting.
    pause
    exit /b 1
)

echo Using existing static frontend in backend\public...

echo Starting with PM2...
call pm2 start dist\index.js --name "belfproctor-server" --update-env --time --restart-delay 5000 --exp-backoff-restart-delay 10000 --max-restarts 9999
call pm2 save

echo Adding watchdog scheduled task (checks health every minute)...
REM Uses PowerShell to probe /api/health and restarts via PM2 if down
REM The task will run for the current user at logon and every minute
schtasks /Create /SC MINUTE /MO 1 /TN "BelfProctorServerWatchdog" /TR "powershell -NoProfile -WindowStyle Hidden -Command \"try{Invoke-WebRequest -Uri http://localhost:8080/api/health -UseBasicParsing | Out-Null}catch{pm2 restart belfproctor-server}\"" /F >nul 2>&1

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
