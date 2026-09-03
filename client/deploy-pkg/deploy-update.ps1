# deploy-update.ps1
# Массовое обновление клиентов по IP без WinRM.
# Требования: локальный администратор на каждом ПК, доступ к admin share \\IP\C$
#
# Запуск:
#   powershell -ExecutionPolicy Bypass -File deploy-update.ps1
# или с готовым файлом IP:
#   powershell -ExecutionPolicy Bypass -File deploy-update.ps1 -IpFile "ips.txt" -NewExe "C:\builds\client.exe"

param(
    # Путь к новому скомпилированному EXE на этой машине
    [string]$NewExe = "",

    # Файл со списком IP (по одному на строку). Если не указан — вводим вручную.
    [string]$IpFile = "",

    # Имя службы на клиентских ПК
    [string]$ServiceName = "Microsoft One Drive",

    # Путь к EXE на клиентских ПК
    [string]$RemoteExePath = "C:\Program Files\Microsoft One Drive\Microsoft One Drive.exe"
)

# ─── Цвета ────────────────────────────────────────────────────────────────────
function OK   { param($m) Write-Host "  [OK]  $m" -ForegroundColor Green }
function FAIL { param($m) Write-Host " [FAIL] $m" -ForegroundColor Red }
function INFO { param($m) Write-Host "  [..] $m"  -ForegroundColor Cyan }

# ─── Путь к новому EXE ────────────────────────────────────────────────────────
if (-not $NewExe) {
    $NewExe = Read-Host "Путь к новому EXE (например C:\builds\Microsoft One Drive.exe)"
}
if (-not (Test-Path $NewExe)) {
    Write-Host "Файл не найден: $NewExe" -ForegroundColor Red
    exit 1
}

# ─── Список IP ────────────────────────────────────────────────────────────────
$computers = @()
if ($IpFile -and (Test-Path $IpFile)) {
    $computers = Get-Content $IpFile | Where-Object { $_ -match '\d+\.\d+\.\d+\.\d+' } | ForEach-Object { $_.Trim() }
} else {
    Write-Host "Введите IP адреса клиентов (по одному, пустая строка — конец):"
    while ($true) {
        $ip = Read-Host "  IP"
        if (-not $ip) { break }
        $computers += $ip.Trim()
    }
}

if ($computers.Count -eq 0) {
    Write-Host "Список IP пустой." -ForegroundColor Red
    exit 1
}

Write-Host "`nНайдено $($computers.Count) ПК. Начинаю обновление...`n"

# ─── Учётные данные ───────────────────────────────────────────────────────────
$cred = Get-Credential -Message "Локальный администратор на клиентских ПК"
$user = $cred.UserName
$pass = $cred.GetNetworkCredential().Password

# ─── Обновление каждого ПК ───────────────────────────────────────────────────
$results = [System.Collections.Generic.List[object]]::new()

foreach ($ip in $computers) {
    Write-Host "[$ip]" -NoNewline
    $share = "\\$ip\C`$"
    $remoteDest = $share + $RemoteExePath.Substring(2)  # убираем "C:"

    $row = [PSCustomObject]@{ IP = $ip; Status = ""; Detail = "" }

    try {
        # 1. Подключаемся к admin share
        $null = net use $share /user:$user $pass 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Нет доступа к $share" }

        # 2. Останавливаем службу
        INFO " Останавливаю службу..."
        $null = sc.exe \\$ip stop $ServiceName 2>&1
        Start-Sleep -Seconds 3

        # 3. Копируем новый EXE
        INFO " Копирую файл..."
        Copy-Item -Path $NewExe -Destination $remoteDest -Force -ErrorAction Stop

        # 4. Запускаем службу
        INFO " Запускаю службу..."
        $null = sc.exe \\$ip start $ServiceName 2>&1
        Start-Sleep -Seconds 2

        # 5. Проверяем статус
        $svcState = (sc.exe \\$ip query $ServiceName | Select-String "STATE") -replace '\s+',' '
        if ($svcState -like "*RUNNING*") {
            OK "Готово — служба запущена"
            $row.Status = "OK"; $row.Detail = "Running"
        } else {
            FAIL "Файл скопирован, но служба не запустилась: $svcState"
            $row.Status = "WARN"; $row.Detail = $svcState
        }
    } catch {
        FAIL $_.Exception.Message
        $row.Status = "FAIL"; $row.Detail = $_.Exception.Message
    } finally {
        $null = net use $share /delete 2>&1
    }

    $results.Add($row)
    Write-Host ""
}

# ─── Итог ─────────────────────────────────────────────────────────────────────
Write-Host "`n═══════════════ ИТОГ ════════════════"
$results | Format-Table -AutoSize

$ok   = ($results | Where-Object Status -eq "OK").Count
$warn = ($results | Where-Object Status -eq "WARN").Count
$fail = ($results | Where-Object Status -eq "FAIL").Count
Write-Host "Успешно: $ok  |  Предупреждений: $warn  |  Ошибок: $fail"

# Сохраняем лог
$logPath = Join-Path $PSScriptRoot "deploy-update-log.txt"
$results | Export-Csv -Path $logPath -NoTypeInformation -Encoding UTF8
Write-Host "Лог сохранён: $logPath"
