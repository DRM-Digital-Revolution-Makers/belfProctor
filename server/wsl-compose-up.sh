#!/bin/bash
# Invoked from Windows via: wsl -d BelfDocker -u root -- bash /mnt/c/.../server/wsl-compose-up.sh
# Kept as a standalone script (rather than an inline `bash -lc "..."` string) because
# wsl.exe re-joins and re-shells its trailing arguments, which mangles nested quoting.
set -euo pipefail
cd "$(dirname "$0")"
docker compose --env-file .env up -d
