@echo off
echo Restarting belfproctor-server...
call pm2 restart belfproctor-server
if %errorLevel% neq 0 (
    echo Global PM2 not found, trying local npx...
    call npx pm2 restart belfproctor-server
)
echo Done.
pause
