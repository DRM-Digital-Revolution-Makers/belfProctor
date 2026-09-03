[CmdletBinding()]
param(
    [string]$ServiceName = 'BelfProctor',
    [string]$InstallPath = (Join-Path $env:ProgramFiles 'BelfProctor'),
    [Parameter(Mandatory = $true)][string]$TrustedUpdateSignerThumbprint,
    [switch]$RemoveFiles
)

$ErrorActionPreference = 'Stop'
if ($ServiceName -ne 'BelfProctor') { throw 'The production service name is fixed to BelfProctor.' }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'This script must be run as Administrator.' }
$thumbprint = ($TrustedUpdateSignerThumbprint -replace '\s', '').ToUpperInvariant()
if ($thumbprint -notmatch '^[0-9A-F]{40}$') { throw 'Trusted signer thumbprint must contain exactly 40 hex characters.' }
$selfSignature = Get-AuthenticodeSignature -LiteralPath $PSCommandPath
$selfSigner = if ($selfSignature.SignerCertificate) {
    ($selfSignature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
} else { '' }
if ($selfSignature.Status -ne 'Valid' -or $selfSigner -ne $thumbprint) {
    throw "Uninstaller script is not validly signed by the trusted publisher ($thumbprint)."
}

$resolved = [IO.Path]::GetFullPath($InstallPath).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$programFiles = [IO.Path]::GetFullPath($env:ProgramFiles).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$expectedInstallPath = [IO.Path]::GetFullPath((Join-Path $programFiles 'BelfProctor')).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
if (-not $resolved.Equals($expectedInstallPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing unsafe install target: $resolved"
}
if ((Test-Path -LiteralPath $resolved) -and
    ((Get-Item -LiteralPath $resolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Refusing to uninstall through a reparse-point install root.'
}

function Test-ManagedExecutablePath([string]$ImagePath, [string]$RootPath) {
    try {
        $exe = if ($ImagePath.StartsWith('"')) {
            $closingQuote = $ImagePath.IndexOf('"', 1)
            if ($closingQuote -le 1) { return $false }
            $ImagePath.Substring(1, $closingQuote - 1)
        } else {
            ($ImagePath -split '\s+', 2)[0]
        }
        $fullExe = [IO.Path]::GetFullPath($exe)
        $prefix = [IO.Path]::GetFullPath($RootPath).TrimEnd(
            [IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) +
            [IO.Path]::DirectorySeparatorChar
        return $fullExe.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($fullExe) -eq 'BelfProctor.exe'
    } catch { return $false }
}

$escapedServiceName = $ServiceName.Replace("'", "''")
$serviceInfo = Get-CimInstance -ClassName Win32_Service -Filter "Name='$escapedServiceName'" -ErrorAction SilentlyContinue
if ($serviceInfo -and (-not (Test-ManagedExecutablePath -ImagePath ([string]$serviceInfo.PathName) -RootPath $resolved) -or
    [string]$serviceInfo.StartName -ne 'LocalSystem')) {
    throw "Refusing to delete a foreign service named $ServiceName."
}

Stop-ScheduledTask -TaskName 'BelfProctor-Desktop' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'BelfProctor-Desktop' -Confirm:$false -ErrorAction SilentlyContinue
foreach ($legacyTask in @('BelfProctor', 'BelfProctorUpdate')) {
    Stop-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $legacyTask -Confirm:$false -ErrorAction SilentlyContinue
}

$expectedExe = [IO.Path]::GetFullPath((Join-Path $resolved 'BelfProctor.exe'))
Get-CimInstance -ClassName Win32_Process -Filter "Name='BelfProctor.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
        try {
            return $_.SessionId -gt 0 -and
                [string]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), $expectedExe,
                    [StringComparison]::OrdinalIgnoreCase)
        } catch { return $false }
    } | ForEach-Object {
        Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
    }

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName -Force
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    sc.exe delete $ServiceName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to delete service $ServiceName." }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ((Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        throw "Service $ServiceName remained marked for deletion."
    }
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

if ($RemoveFiles -and (Test-Path -LiteralPath $resolved)) {
    for ($attempt = 0; $attempt -lt 5 -and (Test-Path -LiteralPath $resolved); $attempt++) {
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $resolved) { Start-Sleep -Seconds 1 }
    }
    if (Test-Path -LiteralPath $resolved) { throw "Could not remove install directory: $resolved" }
}

Write-Host "Service $ServiceName uninstalled successfully."
