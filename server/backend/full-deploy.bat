@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo [1/5] Checking dependencies...
echo ==================================================
node -v
if %errorLevel% neq 0 (
    echo ERROR: Node.js is not installed!
    pause
    exit /b 1
)

echo ==================================================
echo [2/5] Building Frontend...
echo ==================================================
cd ..\frontend
call npm install
if %errorLevel% neq 0 (
    echo ERROR: Frontend install failed.
    pause
    exit /b 1
)
call npm run build
if %errorLevel% neq 0 (
    echo ERROR: Frontend build failed.
    pause
    exit /b 1
)

echo ==================================================
echo [3/5] Moving Frontend to Backend...
echo ==================================================
cd ..\backend
if exist public (
    echo Cleaning old public folder...
    rmdir /s /q public
)
mkdir public
echo Copying dist to public...
xcopy /E /I /Y "..\frontend\dist" "public"
if %errorLevel% neq 0 (
    echo ERROR: Copy failed.
    pause
    exit /b 1
)

echo ==================================================
echo [4/5] Building Backend...
echo ==================================================
call npm install
call npm run build
if %errorLevel% neq 0 (
    echo ERROR: Backend build failed. Trying fallback...
    call npx tsc
)

echo ==================================================
echo [5/5] Ready to deploy!
echo ==================================================
echo.
echo Please run 'start-pm2.bat' to start the server.
echo.
pause
