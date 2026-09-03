@echo off
setlocal
REM Build script for BelfProctor

REM Ensure we run from the script directory
pushd "%~dp0"

set "CLIENT_ROOT=%~dp0.."
set "PROJECT=..\Properties\BelfProctor.csproj"
set DOTNET_CLI_UI_LANGUAGE=en-US

REM Use local cache for obj/bin to avoid network share timestamp issues (ensure trailing slashes)
set "LOCAL_CACHE=%LOCALAPPDATA%\BelfProctorBuild\client\"
set "OBJ_DIR=%LOCAL_CACHE%obj\"
set "BIN_DIR=%LOCAL_CACHE%bin\"
set "PUBLISH_DIR=%LOCAL_CACHE%publish\"
if not exist "%OBJ_DIR%" mkdir "%OBJ_DIR%"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
if not exist "%PUBLISH_DIR%" mkdir "%PUBLISH_DIR%"
set "UNIT_OBJ_DIR=%LOCAL_CACHE%tests\Unit\obj\"
set "UNIT_BIN_DIR=%LOCAL_CACHE%tests\Unit\bin\"
set "INT_OBJ_DIR=%LOCAL_CACHE%tests\Integration\obj\"
set "INT_BIN_DIR=%LOCAL_CACHE%tests\Integration\bin\"
set "SYS_OBJ_DIR=%LOCAL_CACHE%tests\System\obj\"
set "SYS_BIN_DIR=%LOCAL_CACHE%tests\System\bin\"
if not exist "%UNIT_OBJ_DIR%" mkdir "%UNIT_OBJ_DIR%"
if not exist "%UNIT_BIN_DIR%" mkdir "%UNIT_BIN_DIR%"
if not exist "%INT_OBJ_DIR%" mkdir "%INT_OBJ_DIR%"
if not exist "%INT_BIN_DIR%" mkdir "%INT_BIN_DIR%"
if not exist "%SYS_OBJ_DIR%" mkdir "%SYS_OBJ_DIR%"
if not exist "%SYS_BIN_DIR%" mkdir "%SYS_BIN_DIR%"

REM Verify project file exists
if not exist "%PROJECT%" (
    echo ERROR: Project file not found: %PROJECT%
    echo Make sure the client project exists at 'client\Properties\BelfProctor.csproj'.
    pause
    exit /b 1
)

echo Building BelfProctor...
echo.

REM Check if dotnet is installed
dotnet --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: .NET SDK is not installed or not in PATH.
    echo Please install .NET 8.0 SDK from https://dotnet.microsoft.com/download
    pause
    exit /b 1
)

REM Show dotnet environment info for diagnostics
echo .NET SDK information:
dotnet --info
for /f "delims=" %%P in ('where dotnet 2^>nul') do echo dotnet path: %%P
echo.

REM Clean previous builds
echo Cleaning previous builds...
if exist "%CLIENT_ROOT%\bin" rmdir /s /q "%CLIENT_ROOT%\bin"
if exist "%CLIENT_ROOT%\obj" rmdir /s /q "%CLIENT_ROOT%\obj"
REM Note: do not aggressively delete repo publish to avoid locking issues on network drives

REM Restore packages
echo Restoring NuGet packages...
dotnet restore "%PROJECT%" -p:BaseIntermediateOutputPath=%OBJ_DIR% -p:BaseOutputPath=%BIN_DIR%
if %errorLevel% neq 0 (
    echo ERROR: Failed to restore packages.
    echo Attempting to clear NuGet caches and retry restore...
    dotnet nuget locals all --clear
    dotnet restore "%PROJECT%" -p:BaseIntermediateOutputPath=%OBJ_DIR% -p:BaseOutputPath=%BIN_DIR%
    if %errorLevel% neq 0 (
        echo ERROR: Restore failed again.
        if not exist "build_logs" mkdir "build_logs"
        echo Capturing detailed restore logs to build_logs\restore_diag.log
        dotnet restore "%PROJECT%" -v diag -p:BaseIntermediateOutputPath=%OBJ_DIR% -p:BaseOutputPath=%BIN_DIR% > "build_logs\restore_diag.log" 2>&1
        echo Please check build_logs\restore_diag.log for detailed information.
        pause
        exit /b 1
    )
)

REM Build Release configuration
echo Building Release configuration...
dotnet build "%PROJECT%" -c Release -p:BaseIntermediateOutputPath=%OBJ_DIR% -p:BaseOutputPath=%BIN_DIR%
if %errorLevel% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

REM Run tests
echo Running unit, integration, and system tests...
set "TEST_FAILED=0"
set "UNIT_DIR=..\tests\BelfProctor.UnitTests"
set "INT_DIR=..\tests\BelfProctor.IntegrationTests"
set "SYS_DIR=..\tests\BelfProctor.SystemTests"
REM Use directory references to avoid any csproj path metadata issues
dotnet test %UNIT_DIR% -c Release --no-restore -p:BaseIntermediateOutputPath=%UNIT_OBJ_DIR% -p:BaseOutputPath=%UNIT_BIN_DIR% --logger "trx;LogFileName=TestResults_Unit.trx" --collect:"XPlat Code Coverage"
if %errorLevel% neq 0 (
    echo WARNING: Unit tests failed. Continuing to publish...
    set "TEST_FAILED=1"
)

dotnet test %INT_DIR% -c Release --no-restore -p:BaseIntermediateOutputPath=%INT_OBJ_DIR% -p:BaseOutputPath=%INT_BIN_DIR% --logger "trx;LogFileName=TestResults_Integration.trx"
if %errorLevel% neq 0 (
    echo WARNING: Integration tests failed. Continuing to publish...
    set "TEST_FAILED=1"
)

dotnet test %SYS_DIR% -c Release --no-restore -p:BaseIntermediateOutputPath=%SYS_OBJ_DIR% -p:BaseOutputPath=%SYS_BIN_DIR% --logger "trx;LogFileName=TestResults_System.trx"
if %errorLevel% neq 0 (
    echo WARNING: System tests failed. Continuing to publish...
    set "TEST_FAILED=1"
)

REM Publish self-contained executable
echo Publishing self-contained executable...
dotnet publish "%PROJECT%" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:BaseIntermediateOutputPath=%OBJ_DIR% -p:BaseOutputPath=%BIN_DIR% -o "%PUBLISH_DIR%"
if %errorLevel% neq 0 (
    echo ERROR: Publish failed.
    pause
    exit /b 1
)

REM Copy configuration files to publish directory
echo Copying configuration files...
copy "..\Properties\appsettings.json" "%PUBLISH_DIR%" >nul
copy "..\Properties\appsettings.Production.json" "%PUBLISH_DIR%" >nul
copy "uninstall.ps1" "%PUBLISH_DIR%" >nul
copy "update-helper.ps1" "%PUBLISH_DIR%" >nul
copy "install-windows-service.ps1" "%PUBLISH_DIR%" >nul
copy "install-client.bat" "%PUBLISH_DIR%" >nul
copy "..\README.md" "%PUBLISH_DIR%" >nul

REM Attempt to mirror to repo publish directory for convenience (non-fatal on failure)
if not exist "..\publish" mkdir "..\publish"
echo Mirroring artifacts to repo 'publish' directory...
xcopy /E /I /Y "%PUBLISH_DIR%*" "..\publish\" >nul
if %errorLevel% neq 0 (
    echo WARNING: Could not mirror to repo publish (file may be locked). Use local path: %PUBLISH_DIR%
)

echo.
echo ✓ Build completed successfully!
echo.
echo Published files are in: %PUBLISH_DIR%
echo To install the service, navigate to that directory and run install-client.bat as Administrator.
echo If needed, repo 'publish' may also contain mirrored artifacts.
if %TEST_FAILED% equ 1 (
    echo.
    echo WARNING: Some tests failed. Artifacts were published; please review test results.
)
echo.
pause

popd
endlocal
