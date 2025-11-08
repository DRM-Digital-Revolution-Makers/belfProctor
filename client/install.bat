@echo off
setlocal enabledelayedexpansion
REM Batch script to install BelfProctor Windows Service
REM This script must be run as Administrator

set "LOGFILE=%~dp0install.log"
echo ===== INSTALL START %date% %time% =====>> "%LOGFILE%"

call :log "Installing BelfProctor Service..."
call :log ""

REM Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    call :log "ERROR: This script must be run as Administrator."
    call :log "Please right-click and select 'Run as administrator'"
    echo ===== INSTALL END (admin required) %date% %time% =====>> "%LOGFILE%"
    pause
    exit /b 1
)

REM Execute PowerShell installation script with unified logging
powershell.exe -ExecutionPolicy Bypass -File "%~dp0Install-Service.ps1" -LogPath "%LOGFILE%" >> "%LOGFILE%" 2>&1

if %errorLevel% equ 0 (
    call :log ""
    call :log "Installation completed successfully!"
    call :log "The BelfProctor service is now running."
) else (
    call :log ""
    call :log "Installation failed. Please check the log: %LOGFILE%"
)

echo ===== INSTALL END %date% %time% =====>> "%LOGFILE%"
call :log ""
pause
exit /b

:log
set "msg=%~1"
echo %msg%
echo %msg%>> "%LOGFILE%"
goto :eof