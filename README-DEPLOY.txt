BelfProctor — production deployment
===================================

Server
------
The supported production topology is server/docker-compose.yml:
PostgreSQL and backend stay on the private Compose network; nginx exposes only
HTTPS 443 and redirects HTTP 80 to HTTPS.

1. Copy server/.env.example to server/.env.
2. Replace every change_me value, set PUBLIC_BASE_URL to the public https:// URL,
   and provide TLS_CERT_FILE/TLS_KEY_FILE for a certificate trusted by agents.
3. From server run: docker compose up -d --build --wait
4. Verify: docker compose exec backend npx prisma migrate status

Agent
-----
1. Obtain an Authenticode code-signing PFX owned by the publisher.
2. Run client/build-release.ps1 with -PfxPath and -PfxPassword.
3. Verify the generated release-manifest.json and Authenticode signature.
4. From an elevated PowerShell session, install with the signed
   install-windows-service.ps1 using ExecutionPolicy AllSigned and pass unique
   -ClientId/-EncryptionKey,
   the https:// ServerUrl and the exact publisher certificate thumbprint.

The old Windows 8 + PM2 + plaintext HTTP deployment is unsupported and unsafe.
Do not expose backend port 4000/8080 or use HTTP/WS for agents.
