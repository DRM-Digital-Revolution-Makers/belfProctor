@echo off
setlocal
cd /d "%~dp0"

echo This script will set up BelfProctor Server to start automatically.
echo.

set "START_SCRIPT=%~dp0win8-start.bat"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_SCRIPT=%temp%\CreateShortcut.vbs"

echo Creating shortcut in Startup folder...
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%SHORTCUT_SCRIPT%"
echo sLinkFile = "%STARTUP_FOLDER%\BelfProctor Server.lnk" >> "%SHORTCUT_SCRIPT%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%SHORTCUT_SCRIPT%"
echo oLink.TargetPath = "%START_SCRIPT%" >> "%SHORTCUT_SCRIPT%"
echo oLink.WorkingDirectory = "%~dp0" >> "%SHORTCUT_SCRIPT%"
echo oLink.Description = "BelfProctor Server" >> "%SHORTCUT_SCRIPT%"
echo oLink.Save >> "%SHORTCUT_SCRIPT%"

cscript /nologo "%SHORTCUT_SCRIPT%"
del "%SHORTCUT_SCRIPT%"

echo.
echo Done! The server will now start automatically when you log in.
echo You can also run 'win8-start.bat' manually to start it now.
pause
