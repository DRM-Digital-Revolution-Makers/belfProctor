[CmdletBinding()]
param(
    [string]$ServiceName = 'BelfProctor',
    [string]$DisplayName = 'BelfProctor Agent',
    [string]$Description = 'BelfProctor endpoint monitoring agent',
    [string]$InstallPath = (Join-Path $env:ProgramFiles 'BelfProctor'),
    [Parameter(Mandatory = $true)][string]$ServerUrl,
    [Parameter(Mandatory = $true)][string]$ClientId,
    [Parameter(Mandatory = $true)][string]$EncryptionKey,
    [Parameter(Mandatory = $true)][string]$TrustedUpdateSignerThumbprint,
    [string]$LogPath = "$env:ProgramData\BelfProctor\Install\install.log"
)

$ErrorActionPreference = 'Stop'
if ($ServiceName -ne 'BelfProctor') { throw 'The production service name is fixed to BelfProctor.' }
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]$currentIdentity).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'This installer must be run as Administrator.' }
if ($currentIdentity.IsSystem) { throw 'Run this installer elevated from the interactive user account, not as LocalSystem.' }
$desktopTaskName = 'BelfProctor-Desktop'
$installUser = $currentIdentity.Name
$installUserSid = $currentIdentity.User.Value

$serverUri = $null
if (-not [Uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$serverUri) -or $serverUri.Scheme -ne 'https') {
    throw 'ServerUrl must be an absolute https:// URL.'
}
$thumbprint = ($TrustedUpdateSignerThumbprint -replace '\s', '').ToUpperInvariant()
if ($thumbprint -notmatch '^[0-9A-F]{40}$') { throw 'Trusted signer thumbprint must contain exactly 40 hex characters.' }
$installerSignature = Get-AuthenticodeSignature -LiteralPath $PSCommandPath
$installerSigner = if ($installerSignature.SignerCertificate) {
    ($installerSignature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
} else { '' }
if ($installerSignature.Status -ne 'Valid' -or $installerSigner -ne $thumbprint) {
    throw "Installer script is not validly signed by the trusted publisher ($thumbprint)."
}
if ([string]::IsNullOrWhiteSpace($ClientId) -or $ClientId -match 'PROVISION_') { throw 'A unique provisioned ClientId is required.' }
if ($EncryptionKey.Length -lt 32 -or $EncryptionKey -match 'PROVISION_' -or $EncryptionKey -eq 'ABCDEFGHIJKLMNOP') {
    throw 'A unique provisioned EncryptionKey of at least 32 characters is required.'
}

$sourceRoot = $PSScriptRoot
$sourceExe = Join-Path $sourceRoot 'BelfProctor.exe'
$sourceUninstaller = Join-Path $sourceRoot 'uninstall-windows-service.ps1'
if (-not (Test-Path -LiteralPath $sourceExe) -or -not (Test-Path -LiteralPath $sourceUninstaller)) {
    throw 'Run this installer from a complete BelfProctor release directory.'
}
function Assert-TrustedPayload([string]$Path, [string]$Label) {
    $payloadSignature = Get-AuthenticodeSignature -LiteralPath $Path
    $payloadSigner = if ($payloadSignature.SignerCertificate) {
        ($payloadSignature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
    } else { '' }
    if ($payloadSignature.Status -ne 'Valid' -or $payloadSigner -ne $thumbprint) {
        throw "$Label is not validly signed by the trusted publisher ($thumbprint)."
    }
}
Assert-TrustedPayload -Path $sourceExe -Label 'BelfProctor.exe'
Assert-TrustedPayload -Path $sourceUninstaller -Label 'Uninstaller'

$installFullPath = [IO.Path]::GetFullPath($InstallPath).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$programFiles = [IO.Path]::GetFullPath($env:ProgramFiles).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$expectedInstallPath = [IO.Path]::GetFullPath((Join-Path $programFiles 'BelfProctor')).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
if (-not $installFullPath.Equals($expectedInstallPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "InstallPath must be exactly $expectedInstallPath"
}
if ((Test-Path -LiteralPath $installFullPath) -and
    ((Get-Item -LiteralPath $installFullPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Existing install root must not be a reparse point.'
}
$parent = Split-Path $installFullPath -Parent
$staging = Join-Path $parent ('.BelfProctor-staging-' + [Guid]::NewGuid().ToString('N'))
$backup = Join-Path $parent ('.BelfProctor-backup-' + [Guid]::NewGuid().ToString('N'))
$expectedLogPath = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'BelfProctor\Install\install.log'))
$logFullPath = [IO.Path]::GetFullPath($LogPath)
if (-not $logFullPath.Equals($expectedLogPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "LogPath must be exactly $expectedLogPath"
}
$LogPath = $logFullPath
$logDirectory = Split-Path $LogPath -Parent
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Start-Transcript -Path $LogPath -Append | Out-Null
$previousTaskXml = $null
$previousTask = Get-ScheduledTask -TaskName $desktopTaskName -ErrorAction SilentlyContinue
if ($previousTask) {
    $previousTaskXml = Export-ScheduledTask -TaskName $desktopTaskName
}
$previousTaskWasRunning = $previousTask -and $previousTask.State -eq 'Running'
$escapedServiceName = $ServiceName.Replace("'", "''")
$previousService = Get-CimInstance -ClassName Win32_Service -Filter "Name='$escapedServiceName'" -ErrorAction SilentlyContinue
$previousServiceImagePath = if ($previousService) { [string]$previousService.PathName } else { $null }
$previousServiceStartType = if ($previousService) {
    switch ([string]$previousService.StartMode) {
        'Auto' { 'Automatic' }
        'Manual' { 'Manual' }
        'Disabled' { 'Disabled' }
        default { 'Manual' }
    }
} else { $null }
$previousServiceWasRunning = $previousService -and $previousService.State -eq 'Running'
$serviceRegistryPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
$previousFailureActionsPresent = $false
$previousFailureActions = $null
if ($previousService) {
    if ([string]$previousService.StartName -ne 'LocalSystem') {
        throw "Existing $ServiceName service is not owned by LocalSystem; refusing to replace a foreign service."
    }
    try {
        $previousFailureActions = Get-ItemPropertyValue -LiteralPath $serviceRegistryPath -Name 'FailureActions' -ErrorAction Stop
        $previousFailureActionsPresent = $true
    } catch {}
}
$serviceMutationStarted = $false
$taskMutationStarted = $false
$oldInstallBackedUp = $false
$newInstallPlaced = $false

function Wait-ServiceRemoval([string]$Name, [int]$TimeoutSeconds = 30) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Service $Name remained marked for deletion for more than $TimeoutSeconds seconds."
}

function Test-PathInsideInstallRoot([string]$CandidatePath, [string]$RootPath) {
    try {
        $candidate = [IO.Path]::GetFullPath($CandidatePath)
        $root = [IO.Path]::GetFullPath($RootPath).TrimEnd(
            [IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
        $prefix = $root + [IO.Path]::DirectorySeparatorChar
        return $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

if ($previousServiceImagePath) {
    $serviceExe = if ($previousServiceImagePath.StartsWith('"')) {
        $closingQuote = $previousServiceImagePath.IndexOf('"', 1)
        if ($closingQuote -gt 1) { $previousServiceImagePath.Substring(1, $closingQuote - 1) } else { '' }
    } else {
        ($previousServiceImagePath -split '\s+', 2)[0]
    }
    if (-not (Test-PathInsideInstallRoot -CandidatePath $serviceExe -RootPath $installFullPath) -or
        [IO.Path]::GetFileName($serviceExe) -ne 'BelfProctor.exe') {
        throw "Existing $ServiceName ImagePath is outside the BelfProctor install root; refusing to replace a foreign service."
    }
}

function Stop-InstalledDesktopAgents([string]$InstallRoot) {
    $targets = @(Get-Process -Name 'BelfProctor' -ErrorAction SilentlyContinue | Where-Object {
        if ($_.SessionId -le 0) { return $false }
        try {
            return Test-PathInsideInstallRoot -CandidatePath $_.Path -RootPath $InstallRoot
        } catch { return $false }
    })
    $targets | Stop-Process -Force -ErrorAction SilentlyContinue
    foreach ($target in $targets) {
        if (-not $target.HasExited -and -not $target.WaitForExit(15000)) {
            throw "Desktop agent process $($target.Id) did not stop."
        }
    }
}

try {
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    if ((Get-Item -LiteralPath $staging -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Protected staging directory must not be a reparse point.'
    }
    Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $staging 'BelfProctor.exe') -Force
    Copy-Item -LiteralPath $sourceUninstaller -Destination (Join-Path $staging 'uninstall-windows-service.ps1') -Force
    # The release directory may be user-writable. Verify the protected copies,
    # not only the sources, so a swap between validation and copy cannot cross
    # the elevated trust boundary.
    Assert-TrustedPayload -Path (Join-Path $staging 'BelfProctor.exe') -Label 'Staged BelfProctor.exe'
    Assert-TrustedPayload -Path (Join-Path $staging 'uninstall-windows-service.ps1') -Label 'Staged uninstaller'

    $configPath = Join-Path $staging 'appsettings.json'
    # Do not trust a mutable appsettings.json next to the signed installer.
    # This production template is covered by the installer's Authenticode signature.
    $config = [ordered]@{
        Logging = [ordered]@{
            LogLevel = [ordered]@{
                Default = 'Information'
                Microsoft = 'Warning'
                'Microsoft.Hosting.Lifetime' = 'Information'
                BelfProctor = 'Information'
            }
            EventLog = [ordered]@{ LogLevel = [ordered]@{ Default = 'Warning' } }
        }
        ProctorSettings = [ordered]@{
            ServerUrl = $serverUri.AbsoluteUri.TrimEnd('/')
            ClientId = $ClientId
            EncryptionKey = $EncryptionKey
            AllowInsecureDevelopmentTransport = $false
            TrustedUpdateSignerThumbprint = $thumbprint
            ScreenshotIntervalMs = 300000
            ScreenshotQuality = 75
            ScreenshotPath = "$installFullPath\Screenshots"
            LogPath = "$installFullPath\Logs"
            ReportsPath = "$installFullPath\Reports"
            MonitorUSB = $true
            MonitorProcesses = $true
            MonitorNetwork = $false
            RunOnStartup = $true
            AllowedProcesses = @()
            BlockedProcesses = @()
            MaxLogFileSize = 10485760
            MaxScreenshotAge = 7
            ScreenshotRetentionMinutes = 60
            HeartbeatIntervalMs = 60000
            PolicyUpdateIntervalMs = 300000
            DirectoryListingIntervalMs = 600000
            MaxStartupJitterMs = 30000
            InactivityThresholdMinutes = 3
            DirectoryRoots = @(
                "$installFullPath\Screenshots",
                "$installFullPath\Logs",
                "$installFullPath\Reports"
            )
            Features = [ordered]@{
                UpdateV2 = $true
                WorkTracking = $true
                ProjectMapping = $true
                LiveView = $true
                RulesClassifier = $true
                BrowserActivity = $false
            }
        }
    }
    $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding UTF8

    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    $serviceMutationStarted = $true
    if ($existing) {
        if ($existing.Status -ne 'Stopped') {
            Stop-Service -Name $ServiceName -Force
            $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        }
    }
    $taskMutationStarted = $true
    if ($previousTask) {
        Stop-ScheduledTask -TaskName $desktopTaskName -ErrorAction SilentlyContinue
    }
    Stop-InstalledDesktopAgents -InstallRoot $installFullPath
    if (Test-Path -LiteralPath $installFullPath) {
        Move-Item -LiteralPath $installFullPath -Destination $backup
        $oldInstallBackedUp = $true
    }
    Move-Item -LiteralPath $staging -Destination $installFullPath
    $newInstallPlaced = $true

    $newServiceImagePath = '"' + (Join-Path $installFullPath 'BelfProctor.exe') + '" --service-host'
    if ($previousService) {
        Set-ItemProperty -LiteralPath $serviceRegistryPath -Name 'ImagePath' -Value $newServiceImagePath -Type ExpandString
        Set-Service -Name $ServiceName -StartupType Automatic
    } else {
        New-Service -Name $ServiceName -BinaryPathName $newServiceImagePath `
            -DisplayName $DisplayName -Description $Description -StartupType Automatic | Out-Null
    }
    sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not configure recovery actions for $ServiceName." }
    icacls $installFullPath /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' "*$installUserSid`:(OI)(CI)RX" | Out-Null
    foreach ($dataDir in @('Screenshots', 'Logs', 'Reports')) {
        $fullDataDir = Join-Path $installFullPath $dataDir
        New-Item -ItemType Directory -Path $fullDataDir -Force | Out-Null
        icacls $fullDataDir /grant:r "*$installUserSid`:(OI)(CI)M" | Out-Null
    }

    $desktopExe = Join-Path $installFullPath 'BelfProctor.exe'
    $taskAction = New-ScheduledTaskAction -Execute $desktopExe -Argument '--auto-start' -WorkingDirectory $installFullPath
    $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $installUser
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $installUser -LogonType Interactive -RunLevel Highest
    $taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1))
    Register-ScheduledTask -TaskName $desktopTaskName -Action $taskAction -Trigger $taskTrigger `
        -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null

    Start-Service -Name $ServiceName
    (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    Start-ScheduledTask -TaskName $desktopTaskName
    $desktopRunning = $null
    for ($attempt = 0; $attempt -lt 30 -and -not $desktopRunning; $attempt++) {
        $desktopRunning = Get-CimInstance -ClassName Win32_Process -Filter "Name='BelfProctor.exe'" -ErrorAction SilentlyContinue |
            Where-Object {
                try {
                    return $_.SessionId -gt 0 -and
                        [string]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), [IO.Path]::GetFullPath($desktopExe),
                            [StringComparison]::OrdinalIgnoreCase) -and
                        ([string]$_.CommandLine).IndexOf('--auto-start', [StringComparison]::OrdinalIgnoreCase) -ge 0
                } catch { return $false }
            } | Select-Object -First 1
        if (-not $desktopRunning) { Start-Sleep -Seconds 1 }
    }
    if (-not $desktopRunning) { throw 'Interactive desktop agent did not start.' }

    # Remove persistence created by pre-hardened releases only after the new
    # service/task have passed their startup checks.
    foreach ($legacyTask in @('BelfProctor', 'BelfProctorUpdate')) {
        Stop-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $legacyTask -Confirm:$false -ErrorAction SilentlyContinue
    }
    foreach ($runKey in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
    )) {
        if (Test-Path -LiteralPath $runKey) {
            Remove-ItemProperty -LiteralPath $runKey -Name 'BelfProctor' -ErrorAction SilentlyContinue
        }
    }
    $startupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'BelfProctor.lnk'
    Remove-Item -LiteralPath $startupShortcut -Force -ErrorAction SilentlyContinue
    $legacyWatchdog = Join-Path $env:LOCALAPPDATA 'BelfProctor\watchdog.ps1'
    Remove-Item -LiteralPath $legacyWatchdog -Force -ErrorAction SilentlyContinue

    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    Write-Host "BelfProctor supervisor service and interactive desktop agent are running."
} catch {
    $installFailure = $_
    $rollbackFailure = $null
    try {
        if ($taskMutationStarted) {
            Stop-ScheduledTask -TaskName $desktopTaskName -ErrorAction SilentlyContinue
            if ($newInstallPlaced) {
                Stop-InstalledDesktopAgents -InstallRoot $installFullPath
            }
            Unregister-ScheduledTask -TaskName $desktopTaskName -Confirm:$false -ErrorAction SilentlyContinue
        }
        if ($serviceMutationStarted) {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            if ($previousServiceImagePath) {
                Set-ItemProperty -LiteralPath $serviceRegistryPath -Name 'ImagePath' `
                    -Value $previousServiceImagePath -Type ExpandString
                Set-Service -Name $ServiceName -StartupType $previousServiceStartType
                if ($previousFailureActionsPresent) {
                    Set-ItemProperty -LiteralPath $serviceRegistryPath -Name 'FailureActions' `
                        -Value $previousFailureActions -Type Binary
                } else {
                    Remove-ItemProperty -LiteralPath $serviceRegistryPath -Name 'FailureActions' `
                        -ErrorAction SilentlyContinue
                }
            } elseif (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
                sc.exe delete $ServiceName 2>$null | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "Could not remove failed replacement service $ServiceName during rollback." }
                Wait-ServiceRemoval -Name $ServiceName
            }
        }
        if ($newInstallPlaced -and (Test-Path -LiteralPath $installFullPath)) {
            Remove-Item -LiteralPath $installFullPath -Recurse -Force
        }
        if ($oldInstallBackedUp -and (Test-Path -LiteralPath $backup)) {
            Move-Item -LiteralPath $backup -Destination $installFullPath
        }

        if ($serviceMutationStarted -and $previousServiceImagePath) {
            if ($previousServiceWasRunning) {
                Start-Service -Name $ServiceName
                (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
            }
        }
        if ($taskMutationStarted -and $previousTaskXml) {
            Register-ScheduledTask -TaskName $desktopTaskName -Xml $previousTaskXml -Force | Out-Null
            if ($previousTaskWasRunning) { Start-ScheduledTask -TaskName $desktopTaskName }
        }
    } catch {
        $rollbackFailure = $_
    }
    if ($rollbackFailure) {
        throw "Installation failed: $($installFailure.Exception.Message) Rollback also failed: $($rollbackFailure.Exception.Message)"
    }
    throw $installFailure
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    try { Stop-Transcript | Out-Null } catch {}
}
