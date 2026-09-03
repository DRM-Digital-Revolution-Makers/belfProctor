[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$clientRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installer = Get-Content -LiteralPath (Join-Path $clientRoot 'install-windows-service.ps1') -Raw
$uninstaller = Get-Content -LiteralPath (Join-Path $clientRoot 'uninstall-windows-service.ps1') -Raw
$updater = Get-Content -LiteralPath (Join-Path $clientRoot 'Services\UpdateHelper.cs') -Raw

$required = [ordered]@{
    'installer fixed service identity' = @($installer, "ServiceName -ne 'BelfProctor'")
    'installer exact Program Files product root' = @($installer, 'installFullPath.Equals($expectedInstallPath')
    'installer rejects reparse install root' = @($installer, 'Existing install root must not be a reparse point')
    'installer verifies staged executable' = @($installer, "Assert-TrustedPayload -Path (Join-Path `$staging 'BelfProctor.exe')")
    'installer verifies staged uninstaller' = @($installer, "Assert-TrustedPayload -Path (Join-Path `$staging 'uninstall-windows-service.ps1')")
    'installer preserves an existing service object' = @($installer, 'Set-ItemProperty -LiteralPath $serviceRegistryPath -Name ''ImagePath''')
    'uninstaller fixed service identity' = @($uninstaller, "ServiceName -ne 'BelfProctor'")
    'uninstaller exact Program Files product root' = @($uninstaller, 'resolved.Equals($expectedInstallPath')
    'uninstaller rejects reparse install root' = @($uninstaller, 'Refusing to uninstall through a reparse-point install root')
    'uninstaller rejects a foreign same-name service' = @($uninstaller, 'Refusing to delete a foreign service')
    'updater rejects unsafe version names' = @($updater, '!char.IsAsciiLetterOrDigit(raw[0])')
    'updater rejects reparse versions root' = @($updater, 'versions root is a reparse point')
    'updater rejects reparse version directory' = @($updater, 'version directory is a reparse point')
}

foreach ($entry in $required.GetEnumerator()) {
    if ($entry.Value[0].IndexOf($entry.Value[1], [StringComparison]::Ordinal) -lt 0) {
        throw "Installer safety contract missing: $($entry.Key)"
    }
}

foreach ($script in @($installer, $uninstaller)) {
    if ($script -match 'ExecutionPolicy\s+Bypass' -or $script -match 'Copy-Item[^\r\n]+appsettings') {
        throw 'Installer safety contract forbids bypass execution or copying mutable config.'
    }
}

Write-Host 'Installer/update safety contract: PASS'
