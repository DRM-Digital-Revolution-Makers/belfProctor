# Docker now runs inside the WSL2 distro "BelfDocker" (see wsl-docker-setup.ps1)
# instead of Docker Desktop. The BelfProctor-Docker-Autostart scheduled task
# that runs this script must be set to run as Administrator via Task
# Scheduler's "Run whether user is logged on or not" batch logon (see
# server/README.md) - that's what lets it start with Windows itself, with no
# interactive session, without touching Windows auto-logon.

$distro = "BelfDocker"
$serverPathWin = $PSScriptRoot
$composeUpScript = Join-Path $serverPathWin "wsl-compose-up.sh"
$composeUpScriptWsl = "/mnt/" + $composeUpScript.Substring(0, 1).ToLower() + $composeUpScript.Substring(2).Replace('\', '/')

# Wait for the WSL Docker engine to be ready (max 120 seconds)
$timeout = 120
$elapsed = 0
Write-EventLog -LogName Application -Source "BelfProctor" -EventId 1001 -Message "Waiting for Docker (WSL: $distro) to be ready..." -ErrorAction SilentlyContinue
while ($elapsed -lt $timeout) {
    try {
        & wsl.exe -d $distro -u root -- docker info *> $null
        if ($LASTEXITCODE -eq 0) { break }
    } catch {}
    Start-Sleep -Seconds 5
    $elapsed += 5
}

if ($elapsed -ge $timeout) {
    Write-EventLog -LogName Application -Source "BelfProctor" -EventId 1002 -Message "Docker (WSL: $distro) did not become ready in time." -ErrorAction SilentlyContinue
    exit 1
}

& wsl.exe -d $distro -u root -- bash $composeUpScriptWsl 2>&1 |
    Out-File -FilePath (Join-Path $serverPathWin "startup.log") -Append
Write-EventLog -LogName Application -Source "BelfProctor" -EventId 1003 -Message "BelfProctor containers started." -ErrorAction SilentlyContinue

# WSL2 NAT gives the distro a fresh internal IP on every boot, and (unlike Docker
# Desktop) plain WSL2 does not forward the real network interfaces into it - only
# 127.0.0.1. Re-point the portproxy rules at the current IP so clients hitting
# this server's real IP (PUBLIC_BASE_URL) keep working after a reboot.
$wslIp = (& wsl.exe -d $distro -u root -- hostname -I) -split ' ' | Select-Object -First 1
if ($wslIp) {
    foreach ($port in 4000, 8080, 5432) {
        netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 *> $null
        netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 connectport=$port connectaddress=$wslIp *> $null
    }
    Write-EventLog -LogName Application -Source "BelfProctor" -EventId 1004 -Message "Portproxy re-pointed at WSL IP $wslIp for ports 4000/8080/5432." -ErrorAction SilentlyContinue
}
