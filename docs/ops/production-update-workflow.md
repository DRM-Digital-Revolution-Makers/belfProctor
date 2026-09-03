# Production update workflow

This workflow treats GitHub `main` as production source and the LAN server as the only machine that talks to GitHub. Worker clients stay inside the local network and download updates only from the BelfProctor server.

## Flow

1. A change is merged or pushed to `main`.
2. GitHub Actions runs `.github/workflows/production-release.yml`.
3. The workflow validates backend, frontend, and client builds.
4. The workflow reads `<Version>` from `client/Properties/BelfProctor.csproj` and creates GitHub Release `v<Version>`.
5. Release assets are published:
   - `BelfProctor-<Version>.exe` for client updates.
   - `belfProctor-server.zip` for server deployment staging.
6. The production LAN server checks the latest GitHub Release once per day.
7. If the release contains a new client version, the server downloads it into local update storage, verifies/stores SHA-256, and, when enabled, queues update commands for clients.
8. Online clients receive the update command immediately. Offline clients receive the pending command when they reconnect to the server over WebSocket.
9. Each client downloads the exe from `http://<LAN_SERVER_IP>:<PORT>/api/updates/<version>/file`, verifies SHA-256, waits for user idle time, switches the Windows service to the new version, and reports status back to the server.

## Required version rule

Every production update must bump:

```xml
<Version>x.y.z</Version>
<AssemblyVersion>x.y.z.0</AssemblyVersion>
<FileVersion>x.y.z.0</FileVersion>
```

The GitHub workflow fails if release `v<Version>` already exists. This keeps releases immutable and prevents the LAN server from repeatedly deploying the same version.

## GitHub repository settings

The workflow uses the built-in `GITHUB_TOKEN` and needs repository permission:

- Settings -> Actions -> General -> Workflow permissions -> Read and write permissions.

No client machine needs GitHub access.

## Production server settings

Set these variables on the LAN production server. For Docker Compose, put them into `server/.env`; for direct backend launch, put them into `server/backend/.env`.

```env
GITHUB_RELEASE_REPOSITORY=your-org/belfProctor
GITHUB_RELEASE_TOKEN=
GITHUB_RELEASE_AUTO_DEPLOY_CLIENT=true
GITHUB_RELEASE_POLL_ENABLED=true
GITHUB_RELEASE_POLL_INTERVAL_HOURS=24
GITHUB_RELEASE_POLL_START_DELAY_SECONDS=60

GITHUB_CLIENT_ASSET_REGEX=^BelfProctor(\.|-|_).*\.exe$|^BelfProctor\.exe$
GITHUB_SERVER_ASSET_REGEX=^belfProctor-server\.zip$|^BelfProctor(\.|-|_)Server.*\.zip$

CLIENT_UPDATE_DEPLOY_BATCH_SIZE=10
CLIENT_UPDATE_DEPLOY_BATCH_DELAY_MS=30000
```

Use `GITHUB_RELEASE_TOKEN` for private repositories or higher GitHub API limits. The token belongs only on the LAN server, not on clients.

## Manual checks

Admin status:

```http
GET /api/updates/github/status
```

Manual sync:

```http
POST /api/updates/github/sync
```

Manual deploy of an already staged version:

```http
POST /api/updates/<version>/deploy
Content-Type: application/json

{ "clientIds": "all" }
```

Deployment history:

```http
GET /api/updates/deployments
```

## Server update note

The current implementation stages `belfProctor-server.zip` on the LAN server under update storage. It does not hot-swap the running backend automatically. Apply server bundle updates during a maintenance window, because replacing the running backend may interrupt active WebSocket client sessions.
