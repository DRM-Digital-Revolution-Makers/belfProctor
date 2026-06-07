param(
    [Parameter(Mandatory=$true)]
    [string]$InstallerPath,

    # Supply a thumbprint to reuse an existing cert in the store;
    # leave empty to create a new self-signed cert.
    [string]$CertThumbprint = "",

    # Replace with your real timestamp server if you have a commercial cert.
    [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

function Get-OrCreateSelfSignedCert {
    $subject = "CN=BelfProctor, O=System Maintenance Provider"
    $existing = Get-ChildItem Cert:\CurrentUser\My |
                Where-Object { $_.Subject -eq $subject -and $_.EnhancedKeyUsageList.ObjectId -contains "1.3.6.1.5.5.7.3.3" } |
                Sort-Object NotAfter -Descending |
                Select-Object -First 1

    if ($existing) {
        Write-Host "  Reusing existing self-signed cert: $($existing.Thumbprint)" -ForegroundColor Gray
        return $existing
    }

    Write-Host "  Creating new self-signed code-signing certificate..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $subject `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(3)
    Write-Host "  Created cert: $($cert.Thumbprint)" -ForegroundColor Gray
    return $cert
}

# ── Select certificate ────────────────────────────────────────────────────────
if ($CertThumbprint) {
    $cert = Get-Item "Cert:\CurrentUser\My\$CertThumbprint" -ErrorAction Stop
    Write-Host "Using provided cert: $($cert.Subject)" -ForegroundColor Cyan
} else {
    Write-Host "No thumbprint supplied — using self-signed certificate." -ForegroundColor Yellow
    Write-Host "NOTE: Self-signed certs trigger Windows SmartScreen on other machines." -ForegroundColor Yellow
    Write-Host "      For production, obtain an OV/EV cert from DigiCert, Sectigo, etc." -ForegroundColor Yellow
    Write-Host ""
    $cert = Get-OrCreateSelfSignedCert
}

# ── Sign ─────────────────────────────────────────────────────────────────────
Write-Host "Signing: $InstallerPath" -ForegroundColor Cyan

$result = Set-AuthenticodeSignature `
    -FilePath $InstallerPath `
    -Certificate $cert `
    -TimestampServer $TimestampServer `
    -HashAlgorithm SHA256 `
    -ErrorAction SilentlyContinue

if ($result.Status -eq "Valid") {
    Write-Host "  Signature status: Valid" -ForegroundColor Green
} elseif ($result.Status -eq "UnknownError") {
    # Timestamp server may be unreachable — sign without timestamp
    Write-Host "  Timestamp server unreachable, signing without timestamp..." -ForegroundColor Yellow
    $result = Set-AuthenticodeSignature `
        -FilePath $InstallerPath `
        -Certificate $cert `
        -HashAlgorithm SHA256
    if ($result.Status -eq "Valid") {
        Write-Host "  Signature status: Valid (no timestamp)" -ForegroundColor Green
    } else {
        Write-Host "  Signature status: $($result.Status)" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Signature status: $($result.Status)" -ForegroundColor Red
    exit 1
}

# ── Also sign the EXE itself ──────────────────────────────────────────────────
$exePath = Join-Path (Split-Path $InstallerPath) "..\client\publish\Microsoft OneDrive.exe"
$exePath = [System.IO.Path]::GetFullPath($exePath)
if (Test-Path $exePath) {
    Write-Host "Signing EXE: $exePath" -ForegroundColor Cyan
    $exeResult = Set-AuthenticodeSignature `
        -FilePath $exePath `
        -Certificate $cert `
        -TimestampServer $TimestampServer `
        -HashAlgorithm SHA256 `
        -ErrorAction SilentlyContinue
    if ($exeResult.Status -ne "Valid") {
        # Try without timestamp
        $exeResult = Set-AuthenticodeSignature -FilePath $exePath -Certificate $cert -HashAlgorithm SHA256
    }
    Write-Host "  EXE signature: $($exeResult.Status)" -ForegroundColor $(if ($exeResult.Status -eq "Valid") { "Green" } else { "Yellow" })
}

Write-Host ""
Write-Host "Signing complete." -ForegroundColor Green
