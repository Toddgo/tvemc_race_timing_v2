-- fix_hq_timestamps.sql
-- Run ONE TIME in phpMyAdmin after deploying hq_log_message.php with UTC_TIMESTAMP().
--
-- Background: Before the fix, hq_log_message.php used NOW() which stored the
-- MySQL server's local CDT time (UTC-5) in the created_at column.
-- The new fetch_hq_log.php appends 'Z' to every timestamp so JavaScript treats
-- it as UTC. Old CDT rows therefore display 5 hours too early.
--
-- This script adds 5 hours to all old rows (CDT → UTC) so they display correctly.
-- The cutoff '2026-04-17 02:00:00' is safely after the UTC_TIMESTAMP() fix
-- was deployed on 2026-04-17; adjust if you deployed earlier.
--
-- HOW TO RUN:
--   1. Open phpMyAdmin → your database → SQL tab
--   2. Paste and run the SELECT first to preview affected rows
--   3. Then run the UPDATE statements

-- STEP 1: Preview rows that will be changed (run this first, no changes yet)
SELECT id, event_id, station_target, created_at,
       DATE_ADD(created_at, INTERVAL 5 HOUR) AS corrected_utc
FROM hq_messages
WHERE created_at < '2026-04-17 02:00:00'
ORDER BY id DESC;

-- STEP 2: Fix created_at (CDT → UTC)
UPDATE hq_messages
SET created_at = DATE_ADD(created_at, INTERVAL 5 HOUR)
WHERE created_at < '2026-04-17 02:00:00';

-- STEP 3: Fix ack_time if any rows were acknowledged before the fix
UPDATE hq_messages
SET ack_time = DATE_ADD(ack_time, INTERVAL 5 HOUR)
WHERE ack_time IS NOT NULL
  AND ack_time < '2026-04-17 02:00:00';

-- STEP 4: Verify — all timestamps should now be in the 03:xx UTC range
-- (8:40 PM PDT = 03:40 UTC next day)
SELECT id, station_target, created_at, message_text
FROM hq_messages
ORDER BY id DESC
LIMIT 20;
