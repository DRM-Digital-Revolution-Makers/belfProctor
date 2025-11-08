@echo off
REM Build script for BelfProctor

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

REM Clean previous builds
echo Cleaning previous builds...
if exist "bin" rmdir /s /q "bin"
if exist "obj" rmdir /s /q "obj"
if exist "publish" rmdir /s /q "publish"

REM Restore packages
echo Restoring NuGet packages...
dotnet restore
if %errorLevel% neq 0 (
    echo ERROR: Failed to restore packages.
    pause
    exit /b 1
)

REM Build Release configuration
echo Building Release configuration...
dotnet build -c Release
if %errorLevel% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

REM Run tests
echo Running unit, integration, and system tests...
dotnet test "tests\BelfProctor.UnitTests\BelfProctor.UnitTests.csproj" -c Release --logger "trx;LogFileName=TestResults_Unit.trx" --collect:"XPlat Code Coverage"
if %errorLevel% neq 0 (
    echo ERROR: Unit tests failed.
    pause
    exit /b 1
)

dotnet test "tests\BelfProctor.IntegrationTests\BelfProctor.IntegrationTests.csproj" -c Release --logger "trx;LogFileName=TestResults_Integration.trx"
if %errorLevel% neq 0 (
    echo ERROR: Integration tests failed.
    pause
    exit /b 1
)

dotnet test "tests\BelfProctor.SystemTests\BelfProctor.SystemTests.csproj" -c Release --logger "trx;LogFileName=TestResults_System.trx"
if %errorLevel% neq 0 (
    echo ERROR: System tests failed.
    pause
    exit /b 1
)

REM Publish self-contained executable
echo Publishing self-contained executable...
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o publish
if %errorLevel% neq 0 (
    echo ERROR: Publish failed.
    pause
    exit /b 1
)

REM Copy configuration files to publish directory
echo Copying configuration files...
copy "appsettings.json" "publish\" >nul
copy "appsettings.Production.json" "publish\" >nul
copy "Install-Service.ps1" "publish\" >nul
copy "install.bat" "publish\" >nul
copy "README.md" "publish\" >nul

echo.
echo ✓ Build completed successfully!
echo.
echo Published files are in the 'publish' directory.
echo To install the service, navigate to the publish directory and run install.bat as Administrator.
echo.
pause