@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
REM Batch script to install BelfProctor Windows Service
REM This script must be run as Administrator

set DOTNET_CLI_UI_LANGUAGE=en-US
set "LOGFILE=%~dp0install.log"
REM Ensure we run from the script directory
pushd "%~dp0" >nul
echo ===== INSTALL START %date% %time% =====>> "%LOGFILE%"

call :log "Installing BelfProctor Service..."
call :log "Checking Administrator privileges..."
call :log

REM Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    call :log "ERROR: This script must be run as Administrator."
    call :log "Please right-click and select 'Run as administrator'"
    echo ===== INSTALL END (admin required) %date% %time% =====>> "%LOGFILE%"
    pause
    timeout /t 20 /nobreak >nul
    goto :end
)
call :log "Admin check passed."
call :log

REM Validate installer script exists
call :log "Validating installer script and binaries..."
if not exist "%~dp0install-windows-service.ps1" (
    call :log "ERROR: install-windows-service.ps1 not found in the current directory."
    call :log "Please ensure you run this from the publish folder containing BelfProctor binaries."
    goto :end
)

REM Validate required binaries exist (publish folder)
if not exist "BelfProctor.exe" (
    call :log "ERROR: BelfProctor.exe not found."
    call :log "Please build and publish the project, then run install-client.bat from the publish folder."
    goto :end
)
call :log "Found installer and binaries."
call :log "Invoking PowerShell installer..."
call :log

REM Resolve PowerShell path and execute installer with unified logging
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0install-windows-service.ps1' -LogPath '%LOGFILE%'" >> "%LOGFILE%" 2>&1
call :log "PowerShell finished with exit code: %errorLevel%"

if %errorLevel% equ 0 (
    call :log
    call :log "Installation completed successfully!"
    call :log "The BelfProctor service is now running."
) else (
    call :log
    call :log "Installation failed. Please check the log: %LOGFILE%"
)

echo ===== INSTALL END %date% %time% =====>> "%LOGFILE%"
call :log "Press any key to close..."
call :log
pause
timeout /t 20 /nobreak >nul
goto :end

:log
set "msg=%~1"
if defined msg (
    echo %msg%
    echo %msg%>> "%LOGFILE%"
) else (
    echo.
    echo.>> "%LOGFILE%"
)
goto :eof

:end
popd >nul
exit /b