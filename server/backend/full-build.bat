@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Building Frontend...
cd ..\frontend
call npm install
call npm run build
if %errorLevel% neq 0 (
    echo Frontend build failed!
    pause
    exit /b 1
)

echo [2/3] Preparing Backend...
cd ..\backend
if exist public rmdir /s /q public
mkdir public
xcopy /s /e /y ..\frontend\dist\* public\

echo [3/3] Building Backend...
call npm install
call npm run build
if %errorLevel% neq 0 (
    echo Backend build failed!
    pause
    exit /b 1
)

echo.
echo ===========================================
echo   FULL BUILD COMPLETE
echo ===========================================
echo.
echo Now you can take the 'backend' folder to your Windows 8 server.
echo On the server, run: setup-win8-server.bat
echo.
pause
