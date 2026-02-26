@echo off
cd /d "%~dp0"
set NO_DB=1
set PORT=8080
REM Start with robust PM2 options to ensure autorestart
pm2 start dist/index.js --name "belfproctor-server" --node-args="--max-old-space-size=64 --expose-gc" --env NO_DB=1 --env PORT=8080 --time --restart-delay 5000 --exp-backoff-restart-delay 10000 --max-restarts 9999
REM Persist the process list for resurrect on login/startup
pm2 save
echo Server started with PM2 (autorestart enabled).
pause
