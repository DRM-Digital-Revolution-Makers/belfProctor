@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   BelfProctor Server - Stop / Disable
echo ===================================================

echo [1/2] Stopping server...
call pm2 stop belfproctor-server >nul 2>&1
call pm2 delete belfproctor-server >nul 2>&1
call pm2 save >nul 2>&1
echo Server stopped.

echo [2/2] Removing watchdog task...
schtasks /Delete /TN "BelfProctorServerWatchdog" /F >nul 2>&1
if %errorLevel% equ 0 (
    echo Watchdog task removed.
) else (
    echo Watchdog task not found or already removed.
)

echo.
echo ===================================================
echo   Server is disabled.
echo ===================================================
echo   To start again: setup-win8-server.bat
echo.
pause
