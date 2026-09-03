-- Chromium URLs frequently exceed Postgres' btree 2704-byte index row limit.
-- Replace the unique constraint on the raw url with a functional index on md5(url).
--
-- NOTE: this migration is timestamped earlier than the one that creates the
-- BrowserActivity table (20260611160000), so on a fresh database the table does
-- not exist yet when this runs. Guard the index creation so a fresh
-- `migrate deploy` does not fail; the table-creation migration now creates the
-- md5 index directly, and this remains a safe no-op / idempotent fixup for any
-- database where the table already carries the old raw-url index.

DROP INDEX IF EXISTS "BrowserActivity_clientId_browser_profile_url_visitedAt_key";

DO $$
BEGIN
  IF to_regclass('"BrowserActivity"') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "BrowserActivity_dedup_md5_url_idx"
      ON "BrowserActivity" ("clientId", "browser", "profile", md5("url"), "visitedAt");
  END IF;
END $$;
