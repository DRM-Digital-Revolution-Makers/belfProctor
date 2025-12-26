@echo off
cd /d "%~dp0"
set NO_DB=1
set PORT=8080
pm2 start dist/index.js --name "belfproctor-server" --env NO_DB=1 --env PORT=8080
echo Server started with PM2.
pause
