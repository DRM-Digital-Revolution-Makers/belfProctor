# BelfProctor — AI handoff / progress

Last updated: 2026-08-31

Working branch: `test-update`

Base accepted through: `23dc6646173c9e09bb80a211db740a670f5c95d5`

## Purpose of this file

Read this file before changing the project in a new AI session. It records what
was actually changed and verified, what is still unverified, and the safest next
steps. The detailed audit is in `FULL_AUDIT_REPORT_2026-08-31.md`.

## Product layout

- `client/`: Windows monitoring agent, C#, `net10.0-windows`.
- `server/backend/`: Express 4 + TypeScript + Prisma + PostgreSQL.
- `server/frontend/`: React/Vite/Ant Design admin panel behind nginx.
- `server/docker-compose.yml`: PostgreSQL, backend and frontend production stack.
- `server/backend/storage/`: binary/runtime files; structured metadata is in PostgreSQL.

## Work already completed

### Accepted upstream work

- Branch history was fast-forwarded through `8111e80` and `23dc664`.
- This includes Live View recording/fullscreen updates, the timesheet backfill
  script, agent version 2.0.2 and the mass deployment PowerShell script.

### Backend correctness and security

- Added JWT protection to administrative reads of events, activity and heartbeat.
- Added regression tests proving six monitoring endpoints reject anonymous reads.
- Added short-lived HMAC-SHA256 authentication to `/ws` and `/ws/stream` agent
  connections. Signature is bound to `clientId` and Unix timestamp; accepted
  clock skew is ±120 seconds; comparison is constant-time.
- Unknown WebSocket paths and unsigned connections are rejected with code 1008.
- Added matching C# signing implementation and a shared fixed protocol test vector.
- Added centralized Express 4 rejected-Promise handling and safe JSON 500 responses.
- Added explicit Multer error mapping: oversized files return JSON HTTP 413.
- Upgraded Multer 1.x → 2.3.0, Morgan and Sharp; moved backend `xlsx` to dev-only.
- Added `npm run smoke` (`server/backend/scripts/smoke-test.js`).
- Added Compose backend healthcheck and frontend `service_healthy` dependency.

### Windows client

- Agent WebSocket command and Live View URLs now include the HMAC auth query.
- WebSocket URLs containing signatures are no longer written to logs.
- Updated `Microsoft.Data.Sqlite` 8.0.10 → 8.0.30.
- Fixed production config keys to use `ScreenshotIntervalMs`,
  `HeartbeatIntervalMs`, `PolicyUpdateIntervalMs` and
  `DirectoryListingIntervalMs`; the old names were silently ignored.
- Replaced `Assembly.Location` fallback with `Environment.ProcessPath` for
  single-file deployments.
- Fixed nullable warnings in configuration and work-tracking code.

### Frontend

- Fixed all existing ESLint errors/warnings.
- Fixed screenshot Blob URL effect dependencies.
- Removed unused direct `xlsx` and `flyonui` dependencies.
- Replaced non-compiled FlyonUI `@apply` rules with valid CSS.
- Updated vulnerable transitive packages, including React Router's
  `path-to-regexp` chain.

### Timesheet work already present in the worktree

- Contains the Tashkent date/off-by-one correction in `store.ts`, `tz.ts`, tests
  and migration `20260622090000_shift_timesheet_date_off_by_one`.
- Do not discard or recreate this migration without first checking the existing
  database migration history.

## Verification evidence

The following passed after merging upstream commit `23dc664`:

- Backend: `npm test -- --runInBand` — 16 suites, 87/87 tests.
- Backend: `npm run build`.
- Backend: `npm audit --omit=dev` — 0 known runtime vulnerabilities.
- Frontend: `npm run lint`.
- Frontend: `npm run build`.
- Frontend: `npm audit --omit=dev` — 0 known runtime vulnerabilities.
- Client: .NET 10 `dotnet build BelfProctor.csproj -p:EnableWindowsTargeting=true`
  — 0 warnings, 0 errors on macOS cross-targeting Windows.
- Client NuGet audit — 0 known vulnerable packages.
- All three C# test projects compile successfully.
- Clean isolated Docker Compose stack was built and started with a separate
  PostgreSQL volume and temporary storage.
- All five Prisma migrations applied successfully to a clean PostgreSQL 16 DB.
- `/api/health` reported database and disk checks healthy.
- Runtime smoke passed directly through backend and through nginx. Its 13 checks
  cover login, anonymous JWT denial, registration, valid/invalid encrypted
  heartbeat, PostgreSQL persistence, encrypted screenshot upload/index/download
  and byte equality, unsigned/signed WebSocket, and admin command delivery.
- Audit containers, network and PostgreSQL volume were removed after verification.

## Current readiness assessment

Estimated readiness: **70/100**.

Suitable for a controlled pilot in a trusted LAN after configuration review.
Not yet suitable for an Internet-facing production deployment.

## Remaining release blockers

1. Run all C# unit/integration/system tests on real Windows with .NET 10 and
   `Microsoft.WindowsDesktop.App`. macOS can compile them but cannot execute the
   Windows testhost.
2. Test real Windows service installation/removal/recovery, reboot/session events,
   multi-monitor screenshots, USB/WMI, offline queues and update/rollback.
3. Run Playwright and visual UI QA when a browser runtime is available. Check all
   primary pages, responsive layouts, console errors, auth expiry and error states.
4. Deploy HTTPS/WSS. Current production agent examples still use plain HTTP.
5. Replace the shared weak `ABCDEFGHIJKLMNOP` key with unique provisioned device
   credentials and key rotation.
6. Replace AES-CBC payload envelopes with a versioned authenticated encryption
   format such as AES-256-GCM or ChaCha20-Poly1305.
7. Add signed updates: Authenticode with pinned publisher/certificate or a detached
   signature verified by a public key embedded in the agent. A SHA-256 value sent
   through the same channel does not prove publisher authenticity.
8. Strengthen WebSocket replay resistance with server challenge/one-time nonce.
   Current ±120-second HMAC is a major improvement but can be replayed briefly.
9. Add a strict login-specific rate limiter. The general default is 10,000/minute
   and can be partitioned by caller-controlled `X-Client-Id`.
10. Increase backend coverage from about 23% lines / 16% branches, especially
    uploads, updates, commands, retention and failure/rollback paths.
11. Add frontend component tests; current automated browser suite only covers login.
12. Split the roughly 3 MB frontend bundle and large page components.
13. Resolve deployment/documentation port inconsistency (`4000` in Compose/README,
    `8080` in several agent/frontend fallbacks) based on the intended topology.
14. Replace misleading Microsoft OneDrive assembly/service identity with the real
    product/publisher name before a public release, and sign binaries.

## Recommended next-session order

1. Read this file and `FULL_AUDIT_REPORT_2026-08-31.md`.
2. Check `git status` and preserve unrelated user changes.
3. On Windows, run the three test projects and record exact results here.
4. Run the full Docker stack and `cd server/backend && npm run smoke`.
5. Run frontend Playwright tests and visually inspect all routes.
6. Prioritize HTTPS/WSS, unique device credentials and signed updates before
   feature work.
7. Re-run every build/test/audit gate and update this document with evidence.

## Useful commands

```bash
# Backend
cd server/backend
npm ci
npm test -- --runInBand
npm run build
npm audit --omit=dev

# Frontend
cd server/frontend
npm ci
npm run lint
npm run build
npm audit --omit=dev

# Windows client (run tests on Windows)
dotnet build client/BelfProctor.csproj
dotnet test client/tests/BelfProctor.UnitTests/BelfProctor.UnitTests.csproj
dotnet test client/tests/BelfProctor.IntegrationTests/BelfProctor.IntegrationTests.csproj
dotnet test client/tests/BelfProctor.SystemTests/BelfProctor.SystemTests.csproj

# Full stack
cd server
docker compose up -d --build --wait
docker compose ps

# Runtime smoke (supply secrets through environment; never commit them)
cd server/backend
SMOKE_BASE_URL=http://127.0.0.1:4000 \
SMOKE_ADMIN_EMAIL=... \
SMOKE_ADMIN_PASSWORD=... \
SMOKE_ENCRYPTION_KEY=... \
npm run smoke
```

## Repository hygiene

- `timesheet_2026-06 (2).xlsx` is a local user artifact and is intentionally not
  part of the `test-update` source commit.
- Never commit `.env`, production credentials, generated storage files, test
  databases, Docker volumes, `bin/`, `obj/`, `dist/` or `node_modules/`.
- Existing user modifications were preserved during the audit.
