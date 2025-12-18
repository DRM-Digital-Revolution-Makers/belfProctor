@echo off
echo Publishing BelfProctor as a single EXE...
dotnet publish BelfProctor.csproj -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o ./publish
if %errorLevel% neq 0 (
    echo Build failed. Please ensure .NET SDK is installed.
    pause
    exit /b 1
)
echo.
echo Build successful!
echo The file is located at: client\publish\BelfProctor.exe
pause
