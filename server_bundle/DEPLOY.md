## BelfProctor Server (Backend) Deploy

### 1) Prepare

- Copy `.env.example` to `.env` and fill:
  - `ENCRYPTION_KEY` (must match clients)
  - `JWT_SECRET`
  - `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`

### 2) Install deps

```bash
npm ci
```

### 3) Run

```bash
npm start
```

### 4) Data folders

All runtime data is stored under `UPLOAD_DIR` (default `./storage`).
