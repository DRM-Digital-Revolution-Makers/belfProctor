@echo off
setlocal
cd /d "%~dp0"

set LOG_FILE=server-win8.log
echo Starting server at %date% %time% >> %LOG_FILE%

REM Check for Node.js
node -v >> %LOG_FILE% 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH. >> %LOG_FILE%
    echo Please install Node.js 14.x or 16.x for Windows 8.
    pause
    exit /b 1
)

REM Install dependencies if needed
if not exist node_modules (
    echo Installing dependencies... >> %LOG_FILE%
    call npm install --no-optional >> %LOG_FILE% 2>&1
)

REM Build TypeScript
echo Building project... >> %LOG_FILE%
call npm run build >> %LOG_FILE% 2>&1
if %errorLevel% neq 0 (
    echo Build failed. Trying direct tsc... >> %LOG_FILE%
    call npx tsc >> %LOG_FILE% 2>&1
)

REM Start Server
echo Starting Node.js server... >> %LOG_FILE%
set NO_DB=1
set PORT=8080
node --max-old-space-size=64 --expose-gc dist/index.js >> %LOG_FILE% 2>&1

if %errorLevel% neq 0 (
    echo Server crashed with code %errorLevel% >> %LOG_FILE%
    pause
)
