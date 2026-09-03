-- Chromium URLs frequently exceed Postgres' btree 2704-byte index row limit.
-- Replace the unique constraint on the raw url with a functional index on md5(url).

DROP INDEX IF EXISTS "BrowserActivity_clientId_browser_profile_url_visitedAt_key";

CREATE UNIQUE INDEX "BrowserActivity_dedup_md5_url_idx"
ON "BrowserActivity" ("clientId", "browser", "profile", md5("url"), "visitedAt");
