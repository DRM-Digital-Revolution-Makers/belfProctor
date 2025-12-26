@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   BelfProctor Server Installer for Windows 8
echo ===================================================

echo [1/4] Checking Node.js...
node -v
if %errorLevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js 14.x or 16.x.
    pause
    exit /b 1
)

echo [2/4] Installing dependencies...
if not exist node_modules (
    call npm install --production --no-optional
)

echo [3/4] Installing PM2 process manager...
call npm install -g pm2
if %errorLevel% neq 0 (
    echo Warning: Failed to install PM2 globally. Trying local install...
    call npm install pm2
)

echo [4/4] Starting Server...
echo Setting environment variables...
set NO_DB=1
set PORT=8080

echo [Firewall] Opening Port 8080...
netsh advfirewall firewall delete rule name="BelfProctor Server" >nul 2>&1
netsh advfirewall firewall add rule name="BelfProctor Server" dir=in action=allow protocol=TCP localport=8080
if %errorLevel% neq 0 (
    echo Warning: Failed to configure firewall. You may need to run as Administrator.
)

echo Stopping any existing instance...
call pm2 delete belfproctor-server >nul 2>&1

echo Starting with PM2...
if exist dist\index.js (
    call pm2 start dist\index.js --name "belfproctor-server" --env NO_DB=1 --env PORT=8080
) else (
    echo ERROR: dist\index.js not found! Building now...
    call npm run build
    call pm2 start dist\index.js --name "belfproctor-server" --env NO_DB=1 --env PORT=8080
)

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
echo Saving PM2 list for autostart...
call pm2 save
echo.
pause
