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

## Environment

Required (no defaults):

- `JWT_SECRET`
- `ENCRYPTION_KEY` (must match agent's key)
- `DEFAULT_ADMIN_PASSWORD`

Optional (defaulted in `.env.example` and compose):

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`
- `BACKEND_PORT`, `FRONTEND_PORT`
- `RETENTION_*_DAYS`, `MAX_*_BYTES`, `FEATURE_*`, `LIVE_VIEW_MAX_STREAMS`
