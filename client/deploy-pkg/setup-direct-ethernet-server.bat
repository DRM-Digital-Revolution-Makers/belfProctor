@echo off
REM Запустить PowerShell ОТ ИМЕНИ АДМИНИСТРАТОРА на ОБОИХ компах
REM Сервер (твой ПК): 192.168.100.1
REM Клиент (ПК друга): 192.168.100.2

echo === BelfProctor: настройка прямого Ethernet ===
echo.
echo Адаптер для кабеля на этом ПК: "Ethernet 3" (ASIX USB)
echo Если у друга другое имя — замени InterfaceAlias вручную.
echo.

powershell -NoProfile -Command ^
  "Get-NetIPAddress -InterfaceAlias 'Ethernet 3' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue; New-NetIPAddress -InterfaceAlias 'Ethernet 3' -IPAddress 192.168.100.1 -PrefixLength 24; New-NetFirewallRule -DisplayName 'BelfProctor Backend 8080' -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -ErrorAction SilentlyContinue; Write-Host 'OK: IP 192.168.100.1, firewall 8080' -ForegroundColor Green"

echo.
echo На ПК друга выполни (админ PowerShell):
echo   New-NetIPAddress -InterfaceAlias 'Ethernet' -IPAddress 192.168.100.2 -PrefixLength 24
echo.
echo Потом в appsettings.json друга:
echo   "ServerUrl": "http://192.168.100.1:8080/api"
echo.
pause
