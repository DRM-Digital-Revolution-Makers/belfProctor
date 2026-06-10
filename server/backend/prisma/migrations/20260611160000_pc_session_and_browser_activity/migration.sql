-- CreateTable
CREATE TABLE "PcSession" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bootAt" TIMESTAMP(3) NOT NULL,
    "shutdownAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "bootId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PcSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowserActivity" (
    "id" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "browser" TEXT NOT NULL,
    "profile" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowserActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PcSession_bootId_key" ON "PcSession"("bootId");

-- CreateIndex
CREATE INDEX "PcSession_clientId_bootAt_idx" ON "PcSession"("clientId", "bootAt");

-- CreateIndex
CREATE INDEX "BrowserActivity_clientId_visitedAt_idx" ON "BrowserActivity"("clientId", "visitedAt");

-- CreateIndex
CREATE INDEX "BrowserActivity_clientId_domain_idx" ON "BrowserActivity"("clientId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserActivity_clientId_browser_profile_url_visitedAt_key" ON "BrowserActivity"("clientId", "browser", "profile", "url", "visitedAt");

-- AddForeignKey
ALTER TABLE "PcSession" ADD CONSTRAINT "PcSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserActivity" ADD CONSTRAINT "BrowserActivity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
