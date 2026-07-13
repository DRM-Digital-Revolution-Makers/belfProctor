@echo off
REM Убирает мелькающее окно PowerShell у установленного клиента (без переустановки).
REM Запускать в сессии того пользователя, под которым работает клиент.
setlocal
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-watchdog-window.ps1"
echo.
pause
