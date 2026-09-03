@echo off
cd /d "%~dp0"
echo Publishing BelfProctor as a single EXE...
dotnet publish ..\Properties\BelfProctor.csproj -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o ..\publish
if %errorLevel% neq 0 (
    echo Build failed. Please ensure .NET SDK is installed.
    pause
    exit /b 1
)

echo Copying appsettings.json...
copy /Y ..\Properties\appsettings.json ..\publish\appsettings.json

echo.
echo Build successful!
echo The files are located at: client\publish\
echo  - BelfProctor.exe
echo  - appsettings.json
echo.
echo IMPORTANT: Copy BOTH files to the target machine!
pause
