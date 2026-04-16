-- =============================================================
-- FIX: Insert Leona Divide into the events table with event_id=5
-- (aid_stations already has event_id=5 rows — this adds the parent row)
--
-- Run this in phpMyAdmin → SQL tab, or MySQL client.
-- Safe to run multiple times (INSERT IGNORE).
-- =============================================================

-- Step 1: Allow explicit event_id insert (needed if auto_increment is past 5)
SET FOREIGN_KEY_CHECKS = 0;

-- Step 2: Insert the events row with explicit event_id = 5
INSERT IGNORE INTO `events`
  (`event_id`, `event_code`, `event_name`, `event_date`, `timezone`)
VALUES
  (5, 'KH_LD_2026', 'Leona Divide 100 — KH Races', '2026-04-18', 'America/Los_Angeles');

-- Step 3: Insert the distances (distance_miles and cutoff_hours may be NULL if columns don't exist yet)
--         Uses INSERT IGNORE so re-running is safe.
INSERT IGNORE INTO `event_distances`
  (`event_id`, `distance_code`, `distance_name`)
VALUES
  (5, '100M', '100 Mile'),
  (5, '100K', '100K'),
  (5, '50M',  '50 Mile'),
  (5, '50K',  '50K'),
  (5, '30K',  '30K');

-- Step 4: Insert start times (UTC — PDT = UTC-7)
--   100M 4:30 AM PDT = 11:30 UTC
--   100K 6:30 AM PDT = 13:30 UTC
--   50M  6:30 AM PDT = 13:30 UTC
--   50K  7:00 AM PDT = 14:00 UTC
--   30K  7:00 AM PDT = 14:00 UTC
INSERT IGNORE INTO `event_start_times`
  (`event_id`, `distance_code`, `start_ts`)
VALUES
  (5, '100M', '2026-04-18 11:30:00'),
  (5, '100K', '2026-04-18 13:30:00'),
  (5, '50M',  '2026-04-18 13:30:00'),
  (5, '50K',  '2026-04-18 14:00:00'),
  (5, '30K',  '2026-04-18 14:00:00');

SET FOREIGN_KEY_CHECKS = 1;

-- Verify:
SELECT event_id, event_code, event_name, event_date FROM events ORDER BY event_id;
SELECT event_id, distance_code, distance_name FROM event_distances WHERE event_id = 5;
SELECT event_id, distance_code, start_ts FROM event_start_times WHERE event_id = 5;
