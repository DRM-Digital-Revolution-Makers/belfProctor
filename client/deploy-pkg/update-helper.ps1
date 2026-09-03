[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServiceName,

    [Parameter(Mandatory = $true)]
    [string]$CurrentExe,

    [Parameter(Mandatory = $true)]
    [string]$StagedExe,

    [Parameter(Mandatory = $true)]
    [string]$VersionDir,

    [Parameter(Mandatory = $true)]
    [string]$TargetExe,

    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [Parameter(Mandatory = $true)]
    [string]$LockFile,

    [Parameter(Mandatory = $true)]
    [string]$LogPath,

    [int]$MaxVersionsToKeep = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-UpdateLog {
    param([string]$Message)

    try {
        $logDir = Split-Path -Parent $LogPath
        if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }

        Add-Content -LiteralPath $LogPath -Value ("{0:o} {1}" -f (Get-Date).ToUniversalTime(), $Message) -Encoding UTF8
    } catch {
    }
}

function Resolve-RequiredPath {
    param(
        [string]$Name,
        [string]$PathValue
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        throw "$Name is empty"
    }

    return [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($PathValue)).TrimEnd('\')
}

function Test-ChildPath {
    param(
        [string]$Parent,
        [string]$Child
    )

    $parentFull = Resolve-RequiredPath "Parent" $Parent
    $childFull = Resolve-RequiredPath "Child" $Child
    $prefix = $parentFull.TrimEnd('\') + '\'
    return $childFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Start-ServiceAndWait {
    param([string]$Name)

    try {
        Start-Service -Name $Name -ErrorAction SilentlyContinue
    } catch {
        Write-UpdateLog ("WARN Start-Service {0}: {1}" -f $Name, $_.Exception.Message)
    }

    for ($i = 0; $i -lt 120; $i++) {
        try {
            $status = (Get-Service -Name $Name -ErrorAction SilentlyContinue).Status
            if ($status -eq "Running") {
                return $true
            }
        } catch {
        }

        Start-Sleep -Seconds 1
    }

    return $false
}

function Stop-ProductProcesses {
    $names = @(
        [System.IO.Path]::GetFileNameWithoutExtension($CurrentExe),
        "BelfProctor",
        "Microsoft One Drive"
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

    foreach ($name in $names) {
        try {
            taskkill.exe /F /IM "$name.exe" /T 2>$null | Out-Null
        } catch {
            Write-UpdateLog ("WARN taskkill {0}: {1}" -f $name, $_.Exception.Message)
        }
    }
}

function Set-ServiceImagePath {
    param(
        [string]$Name,
        [string]$ExePath
    )

    if ([string]::IsNullOrWhiteSpace($Name)) {
        throw "ServiceName is empty"
    }

    if ($Name -notin @("BelfProctor", "Microsoft One Drive")) {
        throw "Unsupported service name: $Name"
    }

    $imagePath = '"' + $ExePath + '" --auto-start'
    Set-ItemProperty `
        -Path ("HKLM:\SYSTEM\CurrentControlSet\Services\" + $Name) `
        -Name "ImagePath" `
        -Value $imagePath `
        -Type ExpandString `
        -ErrorAction Stop
    Write-UpdateLog ("binPath set to {0}" -f $imagePath)
}

Write-UpdateLog "begin versioned update"

try {
    $currentExeFull = Resolve-RequiredPath "CurrentExe" $CurrentExe
    $stagedExeFull = Resolve-RequiredPath "StagedExe" $StagedExe
    $versionDirFull = Resolve-RequiredPath "VersionDir" $VersionDir
    $targetExeFull = Resolve-RequiredPath "TargetExe" $TargetExe
    $installRootFull = Resolve-RequiredPath "InstallRoot" $InstallRoot
    $versionsRoot = Join-Path $installRootFull "versions"

    if (-not (Test-Path -LiteralPath $stagedExeFull)) {
        throw "staged exe not found: $stagedExeFull"
    }

    if (-not (Test-ChildPath -Parent $versionsRoot -Child $targetExeFull)) {
        throw "target exe must be inside install versions directory"
    }

    New-Item -ItemType Directory -Force -Path $versionDirFull | Out-Null
    Copy-Item -LiteralPath $stagedExeFull -Destination $targetExeFull -Force -ErrorAction Stop

    try {
        Unblock-File -LiteralPath $targetExeFull -ErrorAction SilentlyContinue
    } catch {
    }

    foreach ($configName in @("appsettings.json", "appsettings.Production.json", "uninstall.ps1", "update-helper.ps1")) {
        $source = Join-Path $installRootFull $configName
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $versionDirFull $configName) -Force -ErrorAction SilentlyContinue
        }
    }

    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Stop-ProductProcesses

    Set-ServiceImagePath -Name $ServiceName -ExePath $targetExeFull

    if (-not (Start-ServiceAndWait $ServiceName)) {
        throw "new service version did not start"
    }

    Write-UpdateLog "new version started"

    try {
        Get-ChildItem -LiteralPath $versionsRoot -Directory |
            Sort-Object LastWriteTime -Descending |
            Select-Object -Skip $MaxVersionsToKeep |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-UpdateLog ("WARN cleanup versions: {0}" -f $_.Exception.Message)
    }
} catch {
    Write-UpdateLog ("update failed: {0}" -f $_.Exception.Message)

    try {
        Set-ServiceImagePath -Name $ServiceName -ExePath $currentExeFull
    } catch {
        Write-UpdateLog ("rollback image failed: {0}" -f $_.Exception.Message)
    }

    try {
        Start-ServiceAndWait $ServiceName | Out-Null
    } catch {
        Write-UpdateLog ("rollback start failed: {0}" -f $_.Exception.Message)
    }
} finally {
    try {
        Remove-Item -LiteralPath $StagedExe -Force -ErrorAction SilentlyContinue
    } catch {
    }

    try {
        Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
    } catch {
    }

    try {
        Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
    } catch {
    }
}
