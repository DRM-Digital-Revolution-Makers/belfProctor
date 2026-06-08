@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
REM ========================================================
REM  BelfProctor bootstrap-updater
REM  Cleanly stops service, replaces exe, starts service.
REM  Run as Administrator.
REM ========================================================

set "INSTALL_DIR=C:\Program Files\BelfProctor"
set "EXE_NAME=Microsoft One Drive.exe"
set "SERVICE=Microsoft One Drive"
set "NEW_EXE=%~dp0BelfProctor.exe"

echo Bootstrap updater
echo Installing to: %INSTALL_DIR%
echo Source exe   : %NEW_EXE%
echo.

REM Check admin
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Run this script as Administrator.
    echo Right-click ^> "Run as administrator"
    pause
    exit /b 1
)
echo [OK] Running as Administrator
echo.

REM Check new exe exists next to this bat
if not exist "%NEW_EXE%" (
    echo ERROR: %NEW_EXE% not found.
    echo Place this .bat next to BelfProctor.exe and try again.
    pause
    exit /b 1
)
echo [OK] New exe found
echo.

REM Stop the service
echo Stopping service %SERVICE%...
sc.exe stop "%SERVICE%" >nul 2>&1
REM Wait up to 30 sec for service to actually stop
for /l %%i in (1,1,60) do (
    sc.exe query "%SERVICE%" 2>nul | findstr /C:"STOPPED" >nul
    if not errorlevel 1 goto svc_stopped
    timeout /t 1 /nobreak >nul
)
:svc_stopped
echo [OK] Service stopped
echo.

REM Kill any lingering processes by exe path (more reliable than name)
echo Killing any remaining processes...
for /f "tokens=*" %%P in ('wmic process where "ExecutablePath='%INSTALL_DIR:\=\\%\\%EXE_NAME%'" get ProcessId /value 2^>nul ^| find "ProcessId="') do (
    set "LINE=%%P"
    setlocal enabledelayedexpansion
    set "PID=!LINE:ProcessId=!"
    set "PID=!PID:=!"
    if not "!PID!"=="" (
        taskkill /F /PID !PID! >nul 2>&1
    )
    endlocal
)
REM Belt-and-suspenders: kill by name aliases
taskkill /F /IM "Microsoft One Drive.exe" /T >nul 2>&1
taskkill /F /IM "SystemWorker.exe" /T >nul 2>&1
timeout /t 3 /nobreak >nul
echo [OK] Processes killed
echo.

REM Backup old exe and install new one
if exist "%INSTALL_DIR%\%EXE_NAME%.bak" del /F /Q "%INSTALL_DIR%\%EXE_NAME%.bak" 2>nul
echo Renaming old exe to .bak ...
move /Y "%INSTALL_DIR%\%EXE_NAME%" "%INSTALL_DIR%\%EXE_NAME%.bak" >nul 2>&1
if errorlevel 1 (
    echo WARNING: Could not move old exe. Trying direct overwrite...
    copy /Y "%NEW_EXE%" "%INSTALL_DIR%\%EXE_NAME%" >nul
    if errorlevel 1 (
        echo ERROR: Could not write new exe. File may still be locked.
        pause
        exit /b 1
    )
) else (
    echo [OK] Old exe backed up
    copy /Y "%NEW_EXE%" "%INSTALL_DIR%\%EXE_NAME%" >nul
    if errorlevel 1 (
        echo ERROR: Could not copy new exe.
        echo Rolling back...
        move /Y "%INSTALL_DIR%\%EXE_NAME%.bak" "%INSTALL_DIR%\%EXE_NAME%" >nul
        pause
        exit /b 1
    )
)
echo [OK] New exe installed
echo.

REM Remove Mark-of-the-Web from new exe (downloaded files cause Defender re-scan)
powershell -NoProfile -Command "try { Unblock-File -LiteralPath '%INSTALL_DIR%\%EXE_NAME%' -ErrorAction SilentlyContinue } catch {}" >nul 2>&1

REM Start service
echo Starting service %SERVICE%...
echo (Self-contained .NET first-run extraction may take up to 90 sec)
sc.exe start "%SERVICE%" >nul 2>&1

REM Wait up to 120 sec, polling every 1 sec
set "RUNNING=0"
for /l %%i in (1,1,120) do (
    sc.exe query "%SERVICE%" 2>nul | findstr /C:"RUNNING" >nul
    if not errorlevel 1 (
        set "RUNNING=1"
        goto svc_started
    )
    timeout /t 1 /nobreak >nul
)
:svc_started

if "%RUNNING%"=="0" (
    echo WARNING: Service did not reach RUNNING state within 120 sec.
    echo Check Event Viewer or appsettings.json for issues.
    echo.
    echo Rolling back to previous version...
    sc.exe stop "%SERVICE%" >nul 2>&1
    timeout /t 5 /nobreak >nul
    if exist "%INSTALL_DIR%\%EXE_NAME%.bak" (
        del /F /Q "%INSTALL_DIR%\%EXE_NAME%"
        move /Y "%INSTALL_DIR%\%EXE_NAME%.bak" "%INSTALL_DIR%\%EXE_NAME%" >nul
        sc.exe start "%SERVICE%" >nul 2>&1
        echo Rolled back to previous version.
    )
    pause
    exit /b 1
)
echo [OK] Service is running on new version
echo.

REM Cleanup .bak if everything worked
if exist "%INSTALL_DIR%\%EXE_NAME%.bak" del /F /Q "%INSTALL_DIR%\%EXE_NAME%.bak" 2>nul

echo ============================================
echo Bootstrap update complete!
echo Future updates will install automatically.
echo ============================================
timeout /t 5 /nobreak >nul
exit /b 0
