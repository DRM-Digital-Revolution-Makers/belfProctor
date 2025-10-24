@echo off
REM Batch script to install BelfProctor Windows Service
REM This script must be run as Administrator

echo Installing BelfProctor Service...
echo.

REM Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator.
    echo Please right-click and select "Run as administrator"
    pause
    exit /b 1
)

REM Execute PowerShell installation script
powershell.exe -ExecutionPolicy Bypass -File "%~dp0Install-Service.ps1"

if %errorLevel% equ 0 (
    echo.
    echo Installation completed successfully!
    echo The BelfProctor service is now running.
) else (
    echo.
    echo Installation failed. Please check the error messages above.
)

echo.
pause