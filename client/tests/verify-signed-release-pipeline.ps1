[CmdletBinding()]
param(
    [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repo '.artifacts\signed-release-pipeline-test'
}
$certDir = Join-Path $repo '.artifacts\ephemeral-signing-test'
$pfx = Join-Path $certDir 'test-only.pfx'
$cer = Join-Path $certDir 'test-only.cer'
$password = ConvertTo-SecureString 'BelfProctor-Ephemeral-Test-Only!' -AsPlainText -Force
$certificate = $null

try {
    & (Join-Path $PSScriptRoot 'verify-generated-updater-script.ps1')
    & (Join-Path $PSScriptRoot 'verify-installer-safety-contract.ps1')
    New-Item -ItemType Directory -Path $certDir -Force | Out-Null
    $certificate = New-SelfSignedCertificate -Type CodeSigningCert `
        -Subject 'CN=BelfProctor Ephemeral Pipeline Test Only' `
        -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 `
        -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(1) -KeyExportPolicy Exportable
    Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password $password | Out-Null
    Export-Certificate -Cert $certificate -FilePath $cer | Out-Null
    $dotnetDir = Join-Path $repo '.dotnet'
    if (Test-Path (Join-Path $dotnetDir 'dotnet.exe')) { $env:Path = "$dotnetDir;$env:Path" }
    $workingTreeIsDirty = @(& git -C $repo status --porcelain --untracked-files=all).Count -gt 0
    if ($workingTreeIsDirty) {
        $dirtyBuildWasRejected = $false
        try {
            & (Join-Path $repo 'client\build-release.ps1') -PfxPath $pfx `
                -PfxPassword $password -OutputRoot $OutputRoot -TimestampServer '' `
                -AllowUntrustedEphemeralTestCertificate
        } catch {
            $dirtyBuildWasRejected = $_.Exception.Message -like '*clean Git working tree*'
        }
        if (-not $dirtyBuildWasRejected) { throw 'Production-mode release did not reject a dirty Git working tree.' }
    }
    & (Join-Path $repo 'client\build-release.ps1') -PfxPath $pfx `
        -PfxPassword $password -OutputRoot $OutputRoot -TimestampServer '' `
        -AllowUntrustedEphemeralTestCertificate -AllowDirtyWorkingTree

    $publish = Join-Path $OutputRoot 'agent-win-x64'
    $manifestPath = Join-Path $publish 'release-manifest.json'
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.signerThumbprint -ne $certificate.Thumbprint) { throw 'Manifest signer mismatch.' }
    if ($manifest.sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Manifest source commit is missing or invalid.' }
    if ($manifest.sourceState -notin @('clean', 'dirty-test-only')) { throw 'Manifest source state is invalid.' }
    if ($manifest.files.name -contains 'BelfProctor.pdb') { throw 'PDB leaked into production release.' }
    if ($manifest.files.name -contains 'install-client.bat') { throw 'Unsigned batch wrapper leaked into production release.' }
    if ($manifest.files.name -match '^appsettings.*\.json$') { throw 'Mutable configuration leaked into production release.' }
    if (@($manifest.files).Count -ne 3) { throw 'Production release must contain exactly three signed payloads.' }

    foreach ($entry in $manifest.files) {
        $file = Join-Path $publish $entry.name
        if (-not (Test-Path $file)) { throw "Manifest file is missing: $($entry.name)" }
        $actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $entry.sha256) { throw "Manifest hash mismatch: $($entry.name)" }
    }

    foreach ($name in @('BelfProctor.exe', 'install-windows-service.ps1', 'uninstall-windows-service.ps1')) {
        $signature = Get-AuthenticodeSignature (Join-Path $publish $name)
        if ([string]$signature.Status -notin @('Valid', 'UnknownError') -or
            $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
            throw "Authenticode verification failed: $name"
        }
    }

    if (-not (Test-Path (Join-Path $OutputRoot 'BelfProctor-agent-win-x64.zip'))) {
        throw 'Release ZIP was not created.'
    }
    Write-Host 'Ephemeral signed-release pipeline: PASS'
} finally {
    if ($certificate) {
        $myStore = [Security.Cryptography.X509Certificates.X509Store]::new('My', 'CurrentUser')
        $myStore.Open('ReadWrite')
        foreach ($cert in @($myStore.Certificates.Find('FindByThumbprint', $certificate.Thumbprint, $false))) {
            $myStore.Remove($cert)
        }
        $myStore.Close()
    }
    if (Test-Path $certDir) { Remove-Item -LiteralPath $certDir -Recurse -Force }
}
