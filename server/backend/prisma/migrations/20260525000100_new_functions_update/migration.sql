DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('ADMIN', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SystemEventType" AS ENUM (
    'ProcessStarted',
    'ProcessStopped',
    'USBConnected',
    'USBDisconnected',
    'NetworkConnection',
    'NetworkDisconnection',
    'FileAccess',
    'RegistryAccess',
    'PolicyViolation',
    'SystemError',
    'AppUsage'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ConfidenceLevel" AS ENUM ('high', 'medium', 'low', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkSessionEndReason" AS ENUM ('active', 'switch', 'app_closed', 'timeout', 'shutdown', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "UpdateDeploymentStatus" AS ENUM ('queued', 'sent', 'downloading', 'verifying', 'installing', 'restarted', 'confirmed', 'rolled_back', 'failed', 'already_up_to_date');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "User" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'ADMIN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Client" (
  "id" TEXT PRIMARY KEY,
  "encryptionKey" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Event" (
  "id" SERIAL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "eventType" "SystemEventType" NOT NULL,
  "description" TEXT,
  "details" TEXT,
  "processName" TEXT,
  "deviceId" TEXT,
  "networkAddress" TEXT,
  "additionalData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Event_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Heartbeat" (
  "id" SERIAL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Heartbeat_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Screenshot" (
  "id" SERIAL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "filename" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "isFavorite" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Screenshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Report" (
  "id" SERIAL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "filename" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Report_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Policy" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "rules" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Activity" (
  "id" SERIAL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL,
  "activeMilliseconds" INTEGER NOT NULL,
  "inactiveMilliseconds" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Activity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Event_clientId_timestamp_idx" ON "Event"("clientId", "timestamp");
CREATE INDEX IF NOT EXISTS "Heartbeat_clientId_timestamp_idx" ON "Heartbeat"("clientId", "timestamp");
CREATE INDEX IF NOT EXISTS "Screenshot_clientId_timestamp_idx" ON "Screenshot"("clientId", "timestamp");
CREATE INDEX IF NOT EXISTS "Report_clientId_timestamp_idx" ON "Report"("clientId", "timestamp");
CREATE INDEX IF NOT EXISTS "Activity_clientId_timestamp_idx" ON "Activity"("clientId", "timestamp");

ALTER TABLE "Screenshot" ADD COLUMN IF NOT EXISTS "captureReason" TEXT;
ALTER TABLE "Screenshot" ADD COLUMN IF NOT EXISTS "linkedSessionId" TEXT;
ALTER TABLE "Screenshot" ADD COLUMN IF NOT EXISTS "processName" TEXT;
ALTER TABLE "Screenshot" ADD COLUMN IF NOT EXISTS "filePath" TEXT;
ALTER TABLE "Screenshot" ADD COLUMN IF NOT EXISTS "projectName" TEXT;

CREATE TABLE IF NOT EXISTS "WorkSession" (
  "id" TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "adapter" TEXT NOT NULL,
  "processName" TEXT NOT NULL,
  "windowTitle" TEXT,
  "filePath" TEXT,
  "folderPath" TEXT,
  "projectName" TEXT,
  "category" TEXT,
  "productivityLevel" TEXT,
  "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'unknown',
  "openedMs" BIGINT NOT NULL DEFAULT 0,
  "focusedMs" BIGINT NOT NULL DEFAULT 0,
  "activeFocusedMs" BIGINT NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "endReason" "WorkSessionEndReason" NOT NULL DEFAULT 'active',
  "lastEventAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "WorkSessionEvent" (
  "eventId" TEXT PRIMARY KEY,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "clientId" TEXT NOT NULL,
  "sessionId" TEXT,
  "eventType" TEXT NOT NULL,
  "timestampUtc" TIMESTAMP(3) NOT NULL,
  "adapter" TEXT,
  "processName" TEXT,
  "windowTitle" TEXT,
  "filePath" TEXT,
  "folderPath" TEXT,
  "projectName" TEXT,
  "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'unknown',
  "payload" JSONB,
  "sourceVersion" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkSessionEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkSession"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectRoot" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL UNIQUE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ProjectAlias" (
  "id" TEXT PRIMARY KEY,
  "alias" TEXT NOT NULL UNIQUE,
  "projectName" TEXT NOT NULL,
  "rootId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "UnknownProjectPath" (
  "id" TEXT PRIMARY KEY,
  "path" TEXT NOT NULL UNIQUE,
  "clientId" TEXT,
  "processName" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seenCount" INTEGER NOT NULL DEFAULT 1,
  "resolvedProjectName" TEXT,
  "ignored" BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS "AgentVersion" (
  "version" TEXT PRIMARY KEY,
  "filename" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "notes" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "UpdateDeployment" (
  "id" TEXT PRIMARY KEY,
  "version" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "status" "UpdateDeploymentStatus" NOT NULL DEFAULT 'queued',
  "detail" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UpdateDeployment_version_fkey" FOREIGN KEY ("version") REFERENCES "AgentVersion"("version") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UpdateDeployment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WorkSession_clientId_startedAt_idx" ON "WorkSession"("clientId", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkSession_projectName_startedAt_idx" ON "WorkSession"("projectName", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkSession_processName_startedAt_idx" ON "WorkSession"("processName", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkSession_filePath_idx" ON "WorkSession"("filePath");
CREATE INDEX IF NOT EXISTS "WorkSessionEvent_clientId_timestampUtc_idx" ON "WorkSessionEvent"("clientId", "timestampUtc");
CREATE INDEX IF NOT EXISTS "WorkSessionEvent_sessionId_idx" ON "WorkSessionEvent"("sessionId");
CREATE INDEX IF NOT EXISTS "UpdateDeployment_clientId_sentAt_idx" ON "UpdateDeployment"("clientId", "sentAt");
CREATE INDEX IF NOT EXISTS "UpdateDeployment_version_idx" ON "UpdateDeployment"("version");
CREATE INDEX IF NOT EXISTS "UpdateDeployment_status_idx" ON "UpdateDeployment"("status");
