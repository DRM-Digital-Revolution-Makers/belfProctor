@echo off
cd /d "%~dp0"
echo ===================================================
echo   BelfProctor Server Logs
echo ===================================================
echo Press Ctrl+C to exit log view.
echo.
call pm2 logs belfproctor-server --lines 100
pause
