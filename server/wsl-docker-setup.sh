#!/bin/bash
# Linux-side provisioning for the SYSTEM-owned "BelfDocker" WSL2 distro.
# Run as root inside the distro (invoked by wsl-docker-setup.ps1):
#   wsl -d BelfDocker -u root -- bash /mnt/c/.../server/wsl-docker-setup.sh
set -euo pipefail

cat >/etc/wsl.conf <<'EOF'
[boot]
systemd=true
EOF

apt-get update
apt-get install -y ca-certificates curl

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

systemctl enable docker >/tmp/systemctl-enable-docker.log 2>&1 || true

echo "[wsl-docker-setup] Docker Engine installed, docker.service enabled."
echo "[wsl-docker-setup] NOTE: systemd only takes effect after this WSL VM is restarted"
echo "[wsl-docker-setup] (run 'wsl --terminate BelfDocker' from Windows, then retry docker commands)."
