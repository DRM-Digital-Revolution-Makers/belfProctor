# BelfProctor Server

Full local stack runs in Docker: PostgreSQL, backend API, frontend SPA.

## First run

```bash
cd server
cp .env.example .env
# edit .env and set JWT_SECRET, DEFAULT_ADMIN_PASSWORD and TLS certificate paths
docker compose up -d --build
```

After the stack is up:

- Admin/API/WSS: <https://localhost> (certificate must be trusted by agents and browsers)
- PostgreSQL and backend remain private Compose-network services.

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
- `frontend/` — Vite SPA served by TLS nginx on port 443. Port 80 redirects to HTTPS; nginx proxies `/api/*` and `/ws/*` internally.
- `backend/storage/` — bind-mounted into the backend container at `/app/storage`. Holds screenshots, agent update binaries, reports, and runtime logs.
- `backend/prisma/` — schema and SQL migrations.

## Environment

Required (no defaults):

- `JWT_SECRET`
- `DEFAULT_ADMIN_PASSWORD`
- `TLS_CERT_FILE`, `TLS_KEY_FILE`

Optional (defaulted in `.env.example` and compose):

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `HTTPS_PORT`, `HTTP_REDIRECT_PORT`
- `RETENTION_*_DAYS`, `MAX_*_BYTES`, `FEATURE_*`, `LIVE_VIEW_MAX_STREAMS`
