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
    echo Please install Node.js 18+
    pause
    exit /b 1
)

echo [2/4] Installing dependencies...
call npm install
if %errorLevel% neq 0 (
    echo Warning: npm install failed.
)

echo [3/4] Checking PM2...
call npm list -g pm2 >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing PM2 globally...
    call npm install -g pm2
)

echo [4/4] Starting Server...

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

echo Starting with PM2...
call pm2 start dist\index.js --name "belfproctor-server" --update-env

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
