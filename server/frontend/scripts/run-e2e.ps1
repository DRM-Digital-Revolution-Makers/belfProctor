$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$vite = Join-Path $root "node_modules\vite\bin\vite.js"
$node = (Get-Command node.exe).Source
$server = $null

try {
    $server = Start-Process -FilePath $node `
        -ArgumentList @($vite, "--host", "127.0.0.1", "--port", "4173", "--strictPort") `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4173" -TimeoutSec 1
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw "Vite did not become ready on port 4173" }

    $env:E2E_BASE_URL = "http://127.0.0.1:4173"
    $env:E2E_MOCK_API = "1"
    & (Join-Path $root "node_modules\.bin\playwright.cmd") test
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Remove-Item Env:E2E_BASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:E2E_MOCK_API -ErrorAction SilentlyContinue
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
}
