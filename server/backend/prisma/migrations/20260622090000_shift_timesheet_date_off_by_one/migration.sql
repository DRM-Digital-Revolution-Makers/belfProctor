-- Fix the off-by-one date bug in TimesheetDay.date.
--
-- The application was passing `startOfTashkentDay(sample)` (a UTC instant at
-- 19:00 of the previous UTC calendar day) to a `@db.Date` column. Prisma binds
-- @db.Date using the JS Date's UTC year/month/day, so every row was stored
-- under (Tashkent day - 1). The application code is fixed to use UTC midnight
-- whose UTC date already matches the Tashkent date — this migration shifts the
-- already-accumulated rows forward by one day so the data lines up [B-D1].
--
-- The auto-backfill that runs on server startup (scheduleBackgroundJobs in
-- index.ts) will re-derive the current and previous month from `Activity`,
-- which is the source of truth and unaffected. Older months only have the
-- shifted TimesheetDay rows to rely on, so the +1 day correction is what makes
-- them readable again.

UPDATE "TimesheetDay" SET "date" = "date" + INTERVAL '1 day';
