# fix-watchdog-window.ps1
# Removes the flashing PowerShell window on already-installed clients WITHOUT reinstalling the exe.
# Rewrites the "BelfProctor" scheduled task so the watchdog runs via wscript.exe + watchdog.vbs
# (hidden window, style 0) instead of launching powershell.exe directly.
#
# Run on the client machine, in the session of the user the client runs under:
#   powershell -NoProfile -ExecutionPolicy Bypass -File fix-watchdog-window.ps1

$ErrorActionPreference = "Stop"
$taskName = "Microsoft One Drive"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "[skip] Task '$taskName' not found - client not installed or watchdog missing."
    exit 0
}

$action = $task.Actions | Select-Object -First 1
$argline = [string]$action.Arguments

# Already fixed?
if ($action.Execute -match 'wscript' -or $argline -match '\.vbs"?\s*$') {
    Write-Host "[ok] Task already uses the VBS launcher - nothing to change."
    exit 0
}

# Extract the watchdog.ps1 path from the current task; fall back to the default path.
if ($argline -match '-File\s+"([^"]+)"') {
    $ps1 = $matches[1]
} elseif ($argline -match '-File\s+(\S+)') {
    $ps1 = $matches[1]
} else {
    $ps1 = Join-Path $env:LOCALAPPDATA "BelfProctor\watchdog.ps1"
}

$dir = Split-Path -Parent $ps1
if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

# If watchdog.ps1 is missing (orphaned task), restore a minimal watchdog.
if (-not (Test-Path -LiteralPath $ps1)) {
    Write-Host "[warn] $ps1 not found - restoring a minimal watchdog.ps1"
    $exeGuess = Join-Path $dir "BelfProctor.exe"
    $lines = @(
        "if (-not (Get-Process -Name 'BelfProctor' -ErrorAction SilentlyContinue)) {",
        "    if (Test-Path -LiteralPath '$exeGuess') {",
        "        Start-Process -FilePath '$exeGuess' -ArgumentList '--auto-start' -WindowStyle Hidden",
        "    }",
        "}"
    )
    ($lines -join "`r`n") | Set-Content -LiteralPath $ps1 -Encoding UTF8
}

# Write the VBS launcher (ASCII). Run(..., 0, False) => window hidden from the start.
$vbs = Join-Path $dir "watchdog.vbs"
$vbsLine = 'CreateObject("Wscript.Shell").Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $ps1 + '""", 0, False'
Set-Content -LiteralPath $vbs -Value $vbsLine -Encoding Ascii
Write-Host "[+] watchdog.vbs created: $vbs"

# Repoint the task action to wscript.exe + vbs, keeping the existing triggers (logon + repeat 3 min).
$newAction = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('"' + $vbs + '"')
Set-ScheduledTask -TaskName $taskName -Action $newAction -Trigger $task.Triggers | Out-Null

$check = (Get-ScheduledTask -TaskName $taskName).Actions | Select-Object -First 1
Write-Host "[done] Task updated:"
Write-Host "       Execute: $($check.Execute)"
Write-Host "       Args   : $($check.Arguments)"
Write-Host "The PowerShell window will no longer flash."
