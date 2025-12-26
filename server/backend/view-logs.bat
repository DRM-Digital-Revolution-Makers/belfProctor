@echo off
echo Viewing logs for belfproctor-server...
echo Press Ctrl+C to exit log view.
call pm2 logs belfproctor-server
if %errorLevel% neq 0 (
    echo Global PM2 not found, trying local npx...
    call npx pm2 logs belfproctor-server
)
pause
