# One-time provisioning: create a dedicated WSL2 Ubuntu distro ("BelfDocker")
# that runs Docker Engine, replacing Docker Desktop.
#
# NOTE: WSL2 refuses to run under the SYSTEM account at all
# (WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED is a hard Microsoft restriction, confirmed
# empirically) - so this distro is owned by the Administrator account like any
# normal WSL distro. What makes it start after a reboot with nobody logged in
# is NOT the distro's owner, it's the *scheduled task* that launches it:
# "BelfProctor-Docker-Autostart" is set (separately, see server/README.md) to
# run as Administrator via Task Scheduler's "Run whether user is logged on or
# not" batch logon, which needs no interactive session - unlike full Windows
# auto-logon, it doesn't require or create a desktop session at boot.
#
# Run once, interactively, as an Administrator:
#   powershell -NoProfile -File wsl-docker-setup.ps1

$ErrorActionPreference = "Stop"
$DistroName = "BelfDocker"
$WslRoot = "C:\WSL\$DistroName"
$ExportTar = "C:\WSL\ubuntu-export.tar"
$SourceDistro = "Ubuntu-22.04"

# 1/2. Export the base distro to a portable tarball and re-import it as
#    BelfDocker - gives us a clean, predictably-named distro with nothing
#    else installed in it. Idempotent: reuses an already-exported tarball or
#    an already-imported distro from a prior partial run.
$existing = (wsl --list --quiet) -replace "`0", ""
New-Item -ItemType Directory -Force -Path "C:\WSL" | Out-Null

if ($existing -notcontains $DistroName) {
    if (-not (Test-Path $ExportTar)) {
        if ($existing -notcontains $SourceDistro) {
            throw "Neither $SourceDistro nor $ExportTar nor $DistroName exist. Run: wsl --install -d $SourceDistro --no-launch"
        }
        Write-Host "[1/4] Exporting $SourceDistro..."
        wsl --export $SourceDistro $ExportTar
        wsl --unregister $SourceDistro
    } else {
        Write-Host "[1/4] Reusing existing $ExportTar."
        if ($existing -contains $SourceDistro) { wsl --unregister $SourceDistro }
    }

    Write-Host "[2/4] Importing as $DistroName..."
    wsl --import $DistroName $WslRoot $ExportTar --version 2
} else {
    Write-Host "[1-2/4] $DistroName already imported, skipping."
}

wsl --list --verbose
$check = (wsl --list --quiet) -replace "`0", ""
if ($check -notcontains $DistroName) { throw "$DistroName did not register." }

# 4. Configure the distro: enable systemd, install Docker Engine, enable docker.service.
Write-Host "[3/4] Installing Docker Engine inside $DistroName..."
$scriptPathWsl = "/mnt/c/Users/" + $env:USERNAME + "/Desktop/belfProctor/server/wsl-docker-setup.sh"
wsl -d $DistroName -u root -- bash $scriptPathWsl

Write-Host "[4/4] Restarting $DistroName so systemd takes effect..."
wsl --terminate $DistroName
Start-Sleep -Seconds 5
wsl -d $DistroName -u root -- systemctl is-active docker

Write-Host ""
Write-Host "Done. $DistroName is provisioned with Docker Engine and docker.service is enabled."
Write-Host "Next: bring the stack up inside it and restore the Postgres backup, then set"
Write-Host "BelfProctor-Docker-Autostart's principal to Administrator / batch logon (see README)."
