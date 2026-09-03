[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PfxPath,
    [Parameter(Mandatory = $true)][SecureString]$PfxPassword,
    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\.artifacts\release'),
    [string]$TimestampServer = 'http://timestamp.digicert.com',
    [switch]$AllowUntrustedEphemeralTestCertificate,
    [switch]$AllowDirtyWorkingTree
)

$ErrorActionPreference = 'Stop'
$PfxPath = (Resolve-Path -LiteralPath $PfxPath).Path
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$output = [IO.Path]::GetFullPath($OutputRoot)
$workspaceBoundary = $workspace.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if ($output.Equals($workspace, [StringComparison]::OrdinalIgnoreCase) -or
    -not ($output + [IO.Path]::DirectorySeparatorChar).StartsWith($workspaceBoundary, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must be inside the repository workspace."
}

$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PfxPassword))
try {
    $flags = [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($PfxPath, $plainPassword, $flags)
} finally {
    $plainPassword = $null
}
if (-not $certificate.HasPrivateKey) { throw 'The code-signing PFX has no private key.' }
$isEphemeralTestCertificate = $AllowUntrustedEphemeralTestCertificate -and
    $certificate.Subject -eq 'CN=BelfProctor Ephemeral Pipeline Test Only'
if ($AllowUntrustedEphemeralTestCertificate -and -not $isEphemeralTestCertificate) {
    throw 'The untrusted-certificate override is restricted to the ephemeral pipeline test certificate.'
}
if ($AllowDirtyWorkingTree -and -not $isEphemeralTestCertificate) {
    throw 'Dirty working-tree releases are restricted to the ephemeral pipeline test certificate.'
}
$sourceCommit = (& git -C $workspace rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw 'Could not resolve the source Git commit.'
}
$dirtyEntries = @(& git -C $workspace status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the source working tree.' }
$sourceState = if ($dirtyEntries.Count -eq 0) { 'clean' } else { 'dirty-test-only' }
if ($sourceState -ne 'clean' -and -not $AllowDirtyWorkingTree) {
    throw 'Production releases require a clean Git working tree. Commit or stash all changes first.'
}
$thumbprint = ($certificate.Thumbprint -replace '\s', '').ToUpperInvariant()
if ($thumbprint -notmatch '^[0-9A-F]{40}$') { throw 'The signing certificate has an invalid thumbprint.' }

$publish = Join-Path $output 'agent-win-x64'
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $publish -Force | Out-Null

& dotnet publish (Join-Path $PSScriptRoot 'BelfProctor.csproj') -c Release -r win-x64 `
    --self-contained true -o $publish "/p:TrustedUpdateSignerThumbprint=$thumbprint"
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed.' }

# Symbols are useful in CI artifacts but expose implementation details and are
# not required by the installed single-file agent.
Get-ChildItem -LiteralPath $publish -Filter '*.pdb' -File |
    Remove-Item -Force
# Provisioning is owned by the signed installer. Shipping a mutable config next
# to the signed payload would create an ambiguous, unsupported launch path.
Get-ChildItem -LiteralPath $publish -Filter 'appsettings*.json' -File |
    Remove-Item -Force

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-windows-service.ps1') -Destination $publish
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall-windows-service.ps1') -Destination $publish

$exe = Join-Path $publish 'BelfProctor.exe'
$signedPaths = @(
    $exe,
    (Join-Path $publish 'install-windows-service.ps1'),
    (Join-Path $publish 'uninstall-windows-service.ps1')
)
foreach ($path in $signedPaths) {
    $signingArgs = @{
        LiteralPath = $path
        Certificate = $certificate
        HashAlgorithm = 'SHA256'
    }
    if (-not [string]::IsNullOrWhiteSpace($TimestampServer)) {
        $signingArgs.TimestampServer = $TimestampServer
    }
    $signed = Set-AuthenticodeSignature @signingArgs
    $acceptableStatuses = if ($isEphemeralTestCertificate) { @('Valid', 'UnknownError') } else { @('Valid') }
    if ([string]$signed.Status -notin $acceptableStatuses) {
        throw "Authenticode signing failed for $path`: $($signed.StatusMessage)"
    }
    $verified = Get-AuthenticodeSignature -LiteralPath $path
    if ([string]$verified.Status -notin $acceptableStatuses -or $verified.SignerCertificate.Thumbprint -ne $thumbprint) {
        throw "Post-sign verification failed for $path or signer thumbprint changed."
    }
}

$probe = Start-Process -FilePath $exe -ArgumentList @('--verify-embedded-signer', $thumbprint) `
    -WindowStyle Hidden -Wait -PassThru
if ($probe.ExitCode -ne 0) {
    throw "Published EXE does not contain the expected embedded signer thumbprint (probe exit $($probe.ExitCode))."
}

$files = Get-ChildItem -LiteralPath $publish -File | Sort-Object Name | ForEach-Object {
    [ordered]@{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$manifest = [ordered]@{
    product = 'BelfProctor Agent'
    version = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion
    sourceCommit = $sourceCommit.ToLowerInvariant()
    sourceState = $sourceState
    signerThumbprint = $thumbprint
    files = @($files)
    builtAtUtc = [DateTime]::UtcNow.ToString('O')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $publish 'release-manifest.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $publish '*') -DestinationPath (Join-Path $output 'BelfProctor-agent-win-x64.zip')
Write-Host "Signed release created: $output"
