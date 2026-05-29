@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

set "ISCC=C:\Users\Aleksandr\AppData\Local\Programs\Inno Setup 6\ISCC.exe"
set "SCRIPT=%~dp0BelfProctor.iss"
set "OUTPUT=%~dp0output\BelfProctor-Setup-1.0.4.exe"
set "CLIENT_DIR=%~dp0..\client"

echo ============================================================
echo  BelfProctor Installer Builder
echo ============================================================
echo.

:: ── Step 1: dotnet publish ───────────────────────────────────
echo [1/3] Publishing .NET application...
dotnet publish "%CLIENT_DIR%\BelfProctor.csproj" ^
    -c Release ^
    -r win-x64 ^
    --self-contained ^
    -p:PublishSingleFile=true ^
    -p:IncludeNativeLibrariesForSelfExtract=true ^
    -o "%CLIENT_DIR%\publish" ^
    --nologo
if %errorLevel% neq 0 (
    echo ERROR: dotnet publish failed.
    pause & exit /b 1
)
echo   Done: client\publish\Microsoft OneDrive.exe
echo.

:: ── Step 2: Inno Setup compile ──────────────────────────────
echo [2/3] Compiling installer...
if not exist "%ISCC%" (
    echo ERROR: ISCC.exe not found at: %ISCC%
    pause & exit /b 1
)
"%ISCC%" "%SCRIPT%"
if %errorLevel% neq 0 (
    echo ERROR: Inno Setup compilation failed.
    pause & exit /b 1
)
echo   Done: installer\output\BelfProctor-Setup-1.0.4.exe
echo.

:: ── Step 3: Sign installer ──────────────────────────────────
echo [3/3] Signing installer...
if not exist "%OUTPUT%" (
    echo ERROR: Installer output not found: %OUTPUT%
    pause & exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sign-installer.ps1" -InstallerPath "%OUTPUT%"
if %errorLevel% neq 0 (
    echo WARNING: Signing failed or skipped. Installer is unsigned.
) else (
    echo   Done: installer signed.
)
echo.

echo ============================================================
echo  BUILD COMPLETE
echo  Installer: %OUTPUT%
echo ============================================================
pause
