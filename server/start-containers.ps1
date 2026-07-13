# Wait for Docker engine to be ready (max 120 seconds)
$timeout = 120
$elapsed = 0
Write-EventLog -LogName Application -Source "BelfProctor" -EventId 1001 -Message "Waiting for Docker to be ready..." -ErrorAction SilentlyContinue
while ($elapsed -lt $timeout) {
    try {
        $result = & docker info 2>&1
        if ($LASTEXITCODE -eq 0) { break }
    } catch {}
    Start-Sleep -Seconds 5
    $elapsed += 5
}

if ($elapsed -ge $timeout) {
    Write-EventLog -LogName Application -Source "BelfProctor" -EventId 1002 -Message "Docker did not become ready in time." -ErrorAction SilentlyContinue
    exit 1
}

Set-Location "C:\Users\Администратор\Desktop\belfProctor\server"
& docker compose up -d 2>&1 | Out-File -FilePath "C:\Users\Администратор\Desktop\belfProctor\server\startup.log" -Append
Write-EventLog -LogName Application -Source "BelfProctor" -EventId 1003 -Message "BelfProctor containers started." -ErrorAction SilentlyContinue
