# BelfProctor Server

Full local stack runs in Docker: PostgreSQL, backend API, frontend SPA.

## First run

```bash
cd server
cp .env.example .env
# edit .env and set: JWT_SECRET, ENCRYPTION_KEY, DEFAULT_ADMIN_PASSWORD
docker compose up -d --build
```

After the stack is up:

- Frontend: <http://localhost:3000>
- Backend API (agents connect here): <http://localhost:4000>
- Postgres: `localhost:5432` (user `postgres`, db `proctor`)

Migrations run automatically on backend startup (`prisma migrate deploy`).

## Migrate existing storage data into Postgres

The legacy file-based store at `backend/storage/{users.json, apps.json, heartbeats.jsonl, events/, activity/, commands/, timesheet/, favorites.json}` is imported by a one-shot script. Binary files (screenshots, updates, reports, logs) stay on disk.

```bash
docker compose exec backend npm run migrate:storage
```

A marker file `backend/storage/.migrated_to_postgres` prevents re-runs. To force a re-import, delete the marker or run with `--force`:

```bash
docker compose exec backend node dist/scripts/migrate-to-postgres.js --force
```

## Common commands

```bash
# logs
docker compose logs -f backend
docker compose logs -f db

# rebuild after code changes
docker compose up -d --build backend

# psql shell
docker compose exec db psql -U postgres -d proctor

# stop
docker compose down

# stop + drop Postgres data
docker compose down -v
```

## Layout

- `backend/` — Express + Prisma API on port 4000
- `frontend/` — Vite SPA served via nginx on port 80 → host port 3000. Nginx proxies `/api/*` and `/ws/*` to the backend container.
- `backend/storage/` — bind-mounted into the backend container at `/app/storage`. Holds screenshots, agent update binaries, reports, and runtime logs.
- `backend/prisma/` — schema and SQL migrations.

## Production autostart (this server)

Docker runs inside a dedicated WSL2 Ubuntu distro named `BelfDocker` with a real
Docker Engine (not Docker Desktop). Previously the stack ran under Docker Desktop,
which never restarted itself after a reboot (its own autostart was disabled, and
there was no Windows auto-logon for it to launch into).

WSL2 distros are always owned by the user account that imported them — WSL2
explicitly refuses to run under `SYSTEM`/`LocalSystem`
(`WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED`), so a "no account at all" setup isn't
possible. `BelfDocker` is owned by the `Administrator` account. What makes it
start after a reboot with nobody logged in is the **scheduled task**, not the
distro's owner:

- `BelfProctor-Docker-Autostart` (boot trigger) must be set to run **as
  Administrator, "Run whether user is logged on or not"** (Task Scheduler batch
  logon — Windows stores the credential encrypted via LSA secrets/DPAPI). This is
  a one-time interactive step since it requires typing the account password:
  `schtasks /Change /TN "BelfProctor-Docker-Autostart" /RU Administrator /RP *`
  This is *not* the same as Windows auto-logon (`AutoAdminLogon`) — no desktop
  session is created, nothing is stored in plaintext in the registry, and it works
  identically whether or not anyone is physically logged in.
- Once that's set, `start-containers.ps1` runs at boot: it waits for
  `wsl -d BelfDocker -u root -- docker info` to succeed, then runs
  `wsl-compose-up.sh` inside that distro against this directory (reachable from
  WSL at `/mnt/c/...`).
- One-time provisioning (or after rebuilding the server): `wsl-docker-setup.ps1`
  (Windows side, run interactively as Administrator) + `wsl-docker-setup.sh`
  (installs Docker Engine + compose plugin and enables `docker.service` inside the
  distro).
- **Networking**: Docker Desktop used to forward published container ports onto
  *every* Windows network interface automatically. Plain WSL2 only forwards
  `127.0.0.1` (localhost) - traffic hitting the server's real LAN IP
  (`PUBLIC_BASE_URL`, what agent clients actually connect to) does NOT reach the
  distro by default. `start-containers.ps1` works around this at the end of every
  run by reading the distro's current NAT IP (`wsl -d BelfDocker -- hostname -I`,
  which changes on every WSL restart) and re-pointing `netsh interface portproxy`
  rules for ports 4000/8080/5432 at it. If clients can reach `localhost` on this
  server but not its LAN IP, check `netsh interface portproxy show v4tov4` against
  the distro's current IP first.
- Docker Desktop is left installed but inert (`com.docker.service` stays Manual/
  stopped) as a fallback; it's not part of the autostart path.

Inline `wsl.exe -d BelfDocker -- bash -lc "..."` calls with nested quoting break —
`wsl.exe` re-joins its trailing arguments and re-shells them inside the distro,
mangling embedded quotes. Any new automation should call a standalone `.sh` file
(like `wsl-compose-up.sh`) instead of an inline `bash -lc "..."` string.

## Environment

Required (no defaults):

- `JWT_SECRET`
- `ENCRYPTION_KEY` (must match agent's key)
- `DEFAULT_ADMIN_PASSWORD`

Optional (defaulted in `.env.example` and compose):

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`
- `BACKEND_PORT`, `FRONTEND_PORT`
- `RETENTION_*_DAYS`, `MAX_*_BYTES`, `FEATURE_*`, `LIVE_VIEW_MAX_STREAMS`
