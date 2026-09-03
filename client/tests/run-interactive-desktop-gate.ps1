[CmdletBinding()]
param(
    [string]$ResultRoot = '',
    [string]$AgentExe = ''
)

$ErrorActionPreference = 'Stop'
$clientRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $clientRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($ResultRoot)) {
    $ResultRoot = Join-Path $repoRoot '.artifacts\interactive-desktop-gate'
}
$resultRootFull = [IO.Path]::GetFullPath($ResultRoot)
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot '.artifacts')) + [IO.Path]::DirectorySeparatorChar
if (-not $resultRootFull.StartsWith($artifactsRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'ResultRoot must be inside the repository .artifacts directory.'
}

$dotnet = Join-Path $repoRoot '.dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet)) { $dotnet = (Get-Command dotnet.exe).Source }
New-Item -ItemType Directory -Path $resultRootFull -Force | Out-Null

if ([string]::IsNullOrWhiteSpace($AgentExe)) {
    $publishRoot = Join-Path $resultRootFull 'agent'
    & $dotnet publish (Join-Path $clientRoot 'BelfProctor.csproj') -c Release -r win-x64 `
        --self-contained true -o $publishRoot
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $AgentExe = Join-Path $publishRoot 'BelfProctor.exe'
}
$agentExeFull = [IO.Path]::GetFullPath($AgentExe)
if (-not (Test-Path -LiteralPath $agentExeFull)) { throw "Agent executable not found: $agentExeFull" }

$evidencePath = Join-Path $resultRootFull 'virtual-desktop.jpg'
$probe = Start-Process -FilePath $agentExeFull `
    -ArgumentList @('--capture-desktop-evidence', $evidencePath) `
    -WindowStyle Hidden -Wait -PassThru
if ($probe.ExitCode -ne 0) { throw "Desktop capture probe failed with exit code $($probe.ExitCode)." }

$metadataPath = [IO.Path]::ChangeExtension($evidencePath, '.json')
if (-not (Test-Path -LiteralPath $evidencePath) -or -not (Test-Path -LiteralPath $metadataPath)) {
    throw 'Desktop capture probe did not produce JPEG and metadata evidence.'
}
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ($metadata.screens.Count -lt 2) { throw "Multi-monitor gate requires at least two screens; found $($metadata.screens.Count)." }
if ($metadata.image.width -ne $metadata.virtualScreen.width -or
    $metadata.image.height -ne $metadata.virtualScreen.height) {
    throw 'Evidence image dimensions do not match the process virtual-screen bounds.'
}
foreach ($screen in $metadata.screens) {
    if ($screen.x -lt $metadata.virtualScreen.x -or $screen.y -lt $metadata.virtualScreen.y -or
        ($screen.x + $screen.width) -gt ($metadata.virtualScreen.x + $metadata.virtualScreen.width) -or
        ($screen.y + $screen.height) -gt ($metadata.virtualScreen.y + $metadata.virtualScreen.height)) {
        throw "Screen $($screen.deviceName) lies outside the captured virtual desktop."
    }
}
Write-Host "Interactive multi-monitor desktop gate: PASS ($evidencePath)"
