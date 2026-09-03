-- Extend Client with denormalized "last known state" columns
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "hostname" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "os" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "version" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "lastSeen" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "lastHeartbeat" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "lastActivity" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "lastActivityActiveMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "lastActivityInactiveMs" INTEGER NOT NULL DEFAULT 0;

-- AppUsage: per-(client, process) counter, replaces apps.json
CREATE TABLE IF NOT EXISTS "AppUsage" (
  "id" SERIAL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "processName" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "lastSeen" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppUsage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AppUsage_clientId_processName_key" ON "AppUsage" ("clientId", "processName");
CREATE INDEX IF NOT EXISTS "AppUsage_clientId_lastSeen_idx" ON "AppUsage" ("clientId", "lastSeen");

-- CommandResult: replaces commands/{clientId}/{commandId}_{ts}.json files
CREATE TABLE IF NOT EXISTS "CommandResult" (
  "id" SERIAL PRIMARY KEY,
  "commandId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommandResult_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CommandResult_commandId_receivedAt_idx" ON "CommandResult" ("commandId", "receivedAt");
CREATE INDEX IF NOT EXISTS "CommandResult_clientId_receivedAt_idx" ON "CommandResult" ("clientId", "receivedAt");

-- TimesheetDay: replaces timesheet/{clientId}/{YYYY-MM}.json (one row per day)
CREATE TABLE IF NOT EXISTS "TimesheetDay" (
  "id" SERIAL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "startTime" TIMESTAMP(3),
  "endTime" TIMESTAMP(3),
  "activeMs" BIGINT NOT NULL DEFAULT 0,
  "presenceMs" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimesheetDay_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TimesheetDay_clientId_date_key" ON "TimesheetDay" ("clientId", "date");
