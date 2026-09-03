[CmdletBinding()]
param(
    [string]$ServiceName = "BelfProctor",
    [string]$InstallRoot = "",
    [string]$BaseDir = "",
    [string]$LogPath = (Join-Path $env:TEMP "BelfProctor\uninstall.log"),
    [switch]$RemoveLegacyArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-UninstallLog {
    param([string]$Message)

    try {
        $logDir = Split-Path -Parent $LogPath
        if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }

        $line = "{0:u} {1}" -f (Get-Date), $Message
        Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    } catch {
    }
}

function Invoke-UninstallStep {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    try {
        Write-UninstallLog "START $Name"
        & $Action
        Write-UninstallLog "OK $Name"
    } catch {
        Write-UninstallLog ("WARN {0}: {1}" -f $Name, $_.Exception.Message)
    }
}

function Resolve-CandidatePath {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    try {
        $expanded = [Environment]::ExpandEnvironmentVariables($PathValue)
        return [System.IO.Path]::GetFullPath($expanded).TrimEnd('\')
    } catch {
        Write-UninstallLog ("WARN invalid path skipped: {0}" -f $PathValue)
        return $null
    }
}

function Test-ProductPath {
    param([string]$PathValue)

    $resolved = Resolve-CandidatePath $PathValue
    if (-not $resolved) {
        return $false
    }

    if (-not (Test-Path -LiteralPath $resolved)) {
        return $false
    }

    $root = [System.IO.Path]::GetPathRoot($resolved).TrimEnd('\')
    if ($resolved.TrimEnd('\') -ieq $root) {
        Write-UninstallLog ("WARN root path refused: {0}" -f $resolved)
        return $false
    }

    $leaf = Split-Path -Leaf $resolved
    if ($leaf -ieq "BelfProctor") {
        return $true
    }

    $productExe = Join-Path $resolved "BelfProctor.exe"
    if (Test-Path -LiteralPath $productExe) {
        return $true
    }

    Write-UninstallLog ("WARN non-product path refused: {0}" -f $resolved)
    return $false
}

function Remove-ProductDirectory {
    param([string]$PathValue)

    $resolved = Resolve-CandidatePath $PathValue
    if (-not $resolved -or -not (Test-ProductPath $resolved)) {
        return
    }

    for ($i = 0; $i -lt 5; $i++) {
        try {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
        } catch {
            Write-UninstallLog ("WARN remove retry {0} for {1}: {2}" -f ($i + 1), $resolved, $_.Exception.Message)
        }

        if (-not (Test-Path -LiteralPath $resolved)) {
            Write-UninstallLog ("Removed directory: {0}" -f $resolved)
            break
        }

        Start-Sleep -Seconds 2
    }
}

Write-UninstallLog "Uninstall started"

$serviceNames = @($ServiceName, "BelfProctor", "Microsoft One Drive") |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Unique

$taskNames = @("BelfProctor", "BelfProctorUpdate")
$runValues = @("BelfProctor")
$startupLinks = @("BelfProctor.lnk")
$processNames = @("BelfProctor", "Microsoft One Drive")

if ($RemoveLegacyArtifacts) {
    $serviceNames += "SystemWorker"
    $taskNames += "WindowsSystemWorkerUpdate"
    $runValues += "WindowsSystemWorker"
    $startupLinks += "SystemWorker.lnk"
    $processNames += "SystemWorker"
}

$serviceNames = $serviceNames | Select-Object -Unique
$taskNames = $taskNames | Select-Object -Unique
$runValues = $runValues | Select-Object -Unique
$startupLinks = $startupLinks | Select-Object -Unique
$processNames = $processNames | Select-Object -Unique

foreach ($taskName in $taskNames) {
    Invoke-UninstallStep "Stop scheduled task $taskName" {
        schtasks.exe /End /TN $taskName | Out-Null
    }

    Invoke-UninstallStep "Delete scheduled task $taskName" {
        schtasks.exe /Delete /TN $taskName /F | Out-Null
    }
}

Invoke-UninstallStep "Remove startup shortcuts" {
    $startup = [Environment]::GetFolderPath("Startup")
    if ($startup) {
        foreach ($linkName in $startupLinks) {
            $linkPath = Join-Path $startup $linkName
            if (Test-Path -LiteralPath $linkPath) {
                Remove-Item -LiteralPath $linkPath -Force -ErrorAction Stop
            }
        }
    }
}

foreach ($runKeyPath in @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
)) {
    Invoke-UninstallStep "Clean Run key $runKeyPath" {
        if (Test-Path -LiteralPath $runKeyPath) {
            foreach ($valueName in $runValues) {
                Remove-ItemProperty -Path $runKeyPath -Name $valueName -ErrorAction SilentlyContinue
            }
        }
    }
}

foreach ($svc in $serviceNames) {
    Invoke-UninstallStep "Stop service $svc" {
        Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
        sc.exe stop $svc | Out-Null
    }
}

Start-Sleep -Seconds 4

foreach ($processName in $processNames) {
    Invoke-UninstallStep "Stop process $processName" {
        taskkill.exe /F /IM "$processName.exe" /T | Out-Null
    }
}

Start-Sleep -Seconds 2

foreach ($svc in $serviceNames) {
    Invoke-UninstallStep "Delete service $svc" {
        sc.exe delete $svc | Out-Null
    }
}

$paths = @(
    $InstallRoot,
    $BaseDir,
    (Join-Path $env:ProgramFiles "BelfProctor"),
    (Join-Path $env:ProgramData "BelfProctor"),
    (Join-Path $env:LOCALAPPDATA "BelfProctor")
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

foreach ($path in $paths) {
    Invoke-UninstallStep "Remove directory $path" {
        Remove-ProductDirectory $path
    }
}

Write-UninstallLog "Uninstall finished"
