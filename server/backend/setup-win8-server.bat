@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   BelfProctor Server Installer for Windows 8
echo ===================================================

echo [1/6] Checking Node.js...
node -v
if %errorLevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js 18+
    pause
    exit /b 1
)

echo [2/6] Building Frontend...
pushd ..\frontend
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
popd

echo [3/6] Installing backend dependencies...
call npm install
if %errorLevel% neq 0 (
    echo Warning: npm install failed.
)

echo [4/6] Checking PM2...
call npm list -g pm2 >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing PM2 globally...
    call npm install -g pm2
)

echo [5/6] Configuring Auto-Startup...
call npm list -g pm2-windows-startup >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing pm2-windows-startup...
    call npm install -g pm2-windows-startup
)
echo Registering PM2 startup...
call pm2-startup install

echo [6/6] Starting Server...

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

echo Preparing static frontend...
if exist public (
    rmdir /s /q public
)
mkdir public
xcopy /E /I /Y "..\frontend\dist" "public"
if %errorLevel% neq 0 (
    echo ERROR: Copying frontend dist to public failed.
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
