-- =============================================================================
-- bishop_ultra_setup.sql  —  Bishop Ultra 2026
-- =============================================================================
--
-- PURPOSE:  Full database setup for Bishop Ultra 2026 (event code BU-ULTRA-2026-0006).
--           Sets up 4 distances (20M, 50K, 50M, 100K) with exact aid-station mile
--           markers transcribed from the official Bishop Ultra Table 1.
--
-- !! IMPORTANT: The race date and start times below are PLACEHOLDERS.
-- !! Before running this script, update EVERY occurrence of '2026-06-14' to the
-- !! actual race date, and adjust the start times to match the official wave starts.
--
-- SAFE TO RE-RUN:  All statements use INSERT IGNORE or ON DUPLICATE KEY UPDATE
--                 so running this script more than once will not create duplicate
--                 rows or overwrite important data.
--
-- NOTE ON phpMyAdmin COMPATIBILITY:
--   This script uses inline subqueries instead of a SET @variable pattern.
--   phpMyAdmin executes each statement in a separate connection context, which
--   means session variables set in one statement (SET @x = ...) are lost by
--   the time the next statement runs.  Every reference to the event_id therefore
--   uses: (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1)
--   directly inside each statement.  This is safe, correct, and works in all
--   MySQL clients including phpMyAdmin, MySQL Workbench, and the CLI.
--
-- WHAT THIS SCRIPT DOES:
--   0. Cleans up any bad rows (event_id = 0) left by a previous failed run.
--   1. Creates (or no-ops) the Bishop Ultra event row in `events`.
--   2. Inserts/updates all four distance records in `event_distances`.
--   3. Inserts/updates wave start times in `event_start_times`.
--   4. Deletes any previously-entered aid_station rows for this event and
--      re-inserts correct rows with exact mile values from Table 1.
--
-- Station-code convention (same as Leona Divide SQL):
--   station_order 1  → code 'START'
--   station_order 2  → code 'AS1' (first aid station)
--   station_order 3  → code 'AS2' (second aid station)
--   ...continuing sequentially...
--   station_order 99 → code 'FINISH'
--
-- AID STATION DATA SOURCE:
--   Transcribed from Bishop Ultra Table 1 image (cumulative mile column):
--     20M : 8 checkpoints  — Finish at 20.9 mi
--     50K : 12 checkpoints — Finish at 31.3 mi
--     50M : 18 checkpoints — Finish at 51.3 mi
--     100K: 21 checkpoints — Finish at 63.2 mi
-- =============================================================================


-- =========================================================================
-- STEP 0: Clean up bad rows from a previous run where event_id landed as 0
--         (caused by phpMyAdmin not carrying over the @bu_event_id variable).
--         Safe to run even if no bad rows exist.
-- =========================================================================
DELETE FROM `aid_stations`      WHERE `event_id` = 0;
DELETE FROM `event_start_times` WHERE `event_id` = 0;
DELETE FROM `event_distances`   WHERE `event_id` = 0;


-- -------------------------------------------------------------------------
-- STEP 1: Insert the event (no-op if event already exists)
-- -------------------------------------------------------------------------
INSERT IGNORE INTO `events`
  (`event_code`, `event_name`, `event_date`, `timezone`)
VALUES
  ('BU-ULTRA-2026-0006', 'Bishop Ultra 2026', '2026-06-14', 'America/Los_Angeles');


-- -------------------------------------------------------------------------
-- STEP 2: event_distances — total miles for all four Bishop Ultra distances
-- !! Update official_start_ts date from '2026-06-14' to actual race date.
-- !! Update the time portion to the correct wave-start time for each distance.
-- !! Typical ultra wave order: 100K earliest, 20M latest.
-- -------------------------------------------------------------------------
INSERT INTO `event_distances`
  (`event_id`, `distance_code`, `distance_name`, `distance_miles`,
   `official_start_ts`, `cutoff_hours`)
VALUES
  (
    (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1),
    '100K', '100K', 63.20, '2026-06-14 05:00:00', 36.00
  ),
  (
    (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1),
    '50M', '50 Mile', 51.30, '2026-06-14 06:00:00', 20.00
  ),
  (
    (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1),
    '50K', '50K', 31.30, '2026-06-14 07:00:00', 12.00
  ),
  (
    (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1),
    '20M', '20 Mile', 20.90, '2026-06-14 08:00:00', 6.00
  )
ON DUPLICATE KEY UPDATE
  `distance_name`     = VALUES(`distance_name`),
  `distance_miles`    = VALUES(`distance_miles`),
  `official_start_ts` = VALUES(`official_start_ts`),
  `cutoff_hours`      = VALUES(`cutoff_hours`);


-- -------------------------------------------------------------------------
-- STEP 3: event_start_times — wave start times used by the JS timing module
-- !! Update all four dates from '2026-06-14' to actual race date.
-- !! Update times to match official wave-start schedule.
-- -------------------------------------------------------------------------
INSERT INTO `event_start_times`
  (`event_id`, `distance_code`, `start_ts`, `set_by`)
VALUES
  (
    (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1),
    '100K', '2026-06-14 05:00:00', 'Bishop Ultra Race Director'
  ),
  (
    (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1),
    '50M', '2026-06-14 06:00:00', 'Bishop Ultra Race Director'
  ),
  (
    (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1),
    '50K', '2026-06-14 07:00:00', 'Bishop Ultra Race Director'
  ),
  (
    (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1),
    '20M', '2026-06-14 08:00:00', 'Bishop Ultra Race Director'
  )
ON DUPLICATE KEY UPDATE
  `start_ts` = VALUES(`start_ts`),
  `set_by`   = VALUES(`set_by`);

-- Explicit UPDATE in case rows already existed with a wrong date
UPDATE `event_start_times`
SET    `start_ts` = CASE `distance_code`
         WHEN '100K' THEN '2026-06-14 05:00:00'
         WHEN '50M'  THEN '2026-06-14 06:00:00'
         WHEN '50K'  THEN '2026-06-14 07:00:00'
         WHEN '20M'  THEN '2026-06-14 08:00:00'
         ELSE `start_ts`
       END,
       `set_by` = 'Bishop Ultra Race Director'
WHERE  `event_id` = (
         SELECT `event_id` FROM `events`
         WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1
       );


-- -------------------------------------------------------------------------
-- STEP 4: aid_stations — remove any old/draft rows for this event and
--         re-insert correct station data for all four distances.
--
-- NOTE: This DELETE is safe.  The foreign key on `passes.station_id` has
--       ON DELETE CASCADE, so any test passes recorded against the old
--       station rows will also be removed.  If real pass data already exists,
--       COMMENT OUT the DELETE and UPDATE the mile column only (see note at
--       the very bottom of this file).
-- -------------------------------------------------------------------------

DELETE FROM `aid_stations`
WHERE `event_id` = (
  SELECT `event_id` FROM `events`
  WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1
);

INSERT INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`,
   `station_name`, `mile`, `is_aid`, `is_finish`, `lat`, `lon`)
VALUES

-- =========================================================================
-- 20M  (8 checkpoints, finish at 20.9 mi)
-- =========================================================================
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '20M',  1, 'START',  'Start',          0.00,  0, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '20M',  2, 'AS1',    'CDF',             2.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '20M',  3, 'AS2',    'Junction #1',     4.70,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '20M',  4, 'AS3',    'Buttermilk',      7.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '20M',  5, 'AS4',    'Junction #2',    10.00,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '20M',  6, 'AS5',    'Hwy 168',        12.80,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '20M',  7, 'AS6',    'Tungsten City',  15.80,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '20M', 99, 'FINISH', 'Finish Line',    20.90,  0, 1, NULL, NULL),

-- =========================================================================
-- 50K  (12 checkpoints, finish at 31.3 mi)
-- =========================================================================
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K',  1, 'START',  'Start',           0.00,  0, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K',  2, 'AS1',    'CDF',             2.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K',  3, 'AS2',    'Junction #1',     4.70,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K',  4, 'AS3',    'Buttermilk #1',   7.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K',  5, 'AS4',    'McGee #1',       10.00,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K',  6, 'AS5',    'Edison Loop',    12.70,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K',  7, 'AS6',    'McGee #2',       15.30,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K',  8, 'AS7',    'Buttermilk #2',  17.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K',  9, 'AS8',    'Junction #2',    20.00,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K', 10, 'AS9',    'Hwy 168',        22.80,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K', 11, 'AS10',   'Tungsten City',  25.80,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50K', 99, 'FINISH', 'Finish Line',    31.30,  0, 1, NULL, NULL),

-- =========================================================================
-- 50M  (18 checkpoints, finish at 51.3 mi)
-- =========================================================================
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M',  1, 'START',  'Start',           0.00,  0, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M',  2, 'AS1',    'CDF',             2.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M',  3, 'AS2',    'Junction #1',     4.70,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M',  4, 'AS3',    'Buttermilk #1',   7.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M',  5, 'AS4',    'McGee #1',       10.00,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M',  6, 'AS5',    'Edison Loop #1', 12.70,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M',  7, 'AS6',    'Overlook',       15.20,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M',  8, 'AS7',    'Edison Loop #2', 17.50,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M',  9, 'AS8',    'Intake Two #1',  19.30,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M', 10, 'AS9',    'Bishop Creek',   21.30,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M', 11, 'AS10',   'Intake Two #2',  23.20,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M', 12, 'AS11',   'Edison Loop #3', 25.30,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M', 13, 'AS12',   'McGee #2',       27.90,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M', 14, 'AS13',   'Buttermilk #2',  30.20,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M', 15, 'AS14',   'Junction #2',    32.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M', 16, 'AS15',   'Hwy 168',        35.40,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M', 17, 'AS16',   'Tungsten City',  38.40,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '50M', 99, 'FINISH', 'Finish Line',    51.30,  0, 1, NULL, NULL),

-- =========================================================================
-- 100K  (21 checkpoints, finish at 63.2 mi)
-- Same route as 50M through Tungsten City (mile 38.4), then continues:
-- CDF #2 → Aid Station → Tungsten City #2 → Finish
-- =========================================================================
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K',  1, 'START',  'Start',              0.00,  0, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K',  2, 'AS1',    'CDF #1',             2.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K',  3, 'AS2',    'Junction #1',        4.70,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K',  4, 'AS3',    'Buttermilk #1',      7.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K',  5, 'AS4',    'McGee #1',          10.00,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K',  6, 'AS5',    'Edison Loop #1',    12.70,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K',  7, 'AS6',    'Overlook',          15.20,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K',  8, 'AS7',    'Edison Loop #2',    17.50,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K',  9, 'AS8',    'Intake Two #1',     19.30,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 10, 'AS9',    'Bishop Creek',      21.30,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 11, 'AS10',   'Intake Two #2',     23.20,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 12, 'AS11',   'Edison Loop #3',    25.30,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 13, 'AS12',   'McGee #2',          27.90,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 14, 'AS13',   'Buttermilk #2',     30.20,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 15, 'AS14',   'Junction #2',       32.60,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 16, 'AS15',   'Hwy 168',           35.40,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 17, 'AS16',   'Tungsten City #1',  38.40,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 18, 'AS17',   'CDF #2',            40.70,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 19, 'AS18',   'Aid Station',       42.70,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 20, 'AS19',   'Tungsten City #2',  44.40,  1, 0, NULL, NULL),
((SELECT `event_id` FROM `events` WHERE `event_code`='BU-ULTRA-2026-0006' LIMIT 1), '100K', 99, 'FINISH', 'Finish Line',       63.20,  0, 1, NULL, NULL);


-- =============================================================================
-- Done.  After running this script:
--
--   1. Add the Bishop Ultra event to your event selector by setting:
--        window.TVEMC_EVENT_CODE = 'BU-ULTRA-2026-0006';
--      (or via the events dropdown if your UI supports it).
--
--   2. Hard-refresh all browser windows (Ctrl+Shift+R / Cmd+Shift+R).
--
--   3. All five tracking metrics will now function:
--        • Finish Time  — populated when runner passes FINISH station
--        • Elapsed      — from wave start to most recent scan
--        • Avg Pace     — elapsed / miles reached so far
--        • AG Place     — computed after at least two finishers in same
--                         distance + gender + age group are recorded
--        • ETA Next     — projected arrival at next aid station based on
--                         current pace (requires at least one IN/OUT scan
--                         past the START station)
--
--   4. If you have the lat/lon coordinates for any Bishop Ultra stations,
--      run an UPDATE on aid_stations setting lat and lon for those rows.
--      The JS Haversine fallback is disabled automatically once real mile
--      values are present (it only activates when ALL non-START stations
--      have mile = 0).
--
-- ALTERNATE UPDATE-ONLY APPROACH (if real pass data already exists and you
-- MUST NOT delete/re-insert aid_stations rows):
-- ---------------------------------------------------------------------------
--   UPDATE aid_stations
--   SET mile = CASE
--     WHEN distance_code = '20M' AND station_order = 2  THEN 2.60
--     WHEN distance_code = '20M' AND station_order = 3  THEN 4.70
--     WHEN distance_code = '20M' AND station_order = 4  THEN 7.60
--     WHEN distance_code = '20M' AND station_order = 5  THEN 10.00
--     WHEN distance_code = '20M' AND station_order = 6  THEN 12.80
--     WHEN distance_code = '20M' AND station_order = 7  THEN 15.80
--     WHEN distance_code = '20M' AND station_order = 99 THEN 20.90
--     WHEN distance_code = '50K' AND station_order = 2  THEN 2.60
--     WHEN distance_code = '50K' AND station_order = 3  THEN 4.70
--     WHEN distance_code = '50K' AND station_order = 4  THEN 7.60
--     WHEN distance_code = '50K' AND station_order = 5  THEN 10.00
--     WHEN distance_code = '50K' AND station_order = 6  THEN 12.70
--     WHEN distance_code = '50K' AND station_order = 7  THEN 15.30
--     WHEN distance_code = '50K' AND station_order = 8  THEN 17.60
--     WHEN distance_code = '50K' AND station_order = 9  THEN 20.00
--     WHEN distance_code = '50K' AND station_order = 10 THEN 22.80
--     WHEN distance_code = '50K' AND station_order = 11 THEN 25.80
--     WHEN distance_code = '50K' AND station_order = 99 THEN 31.30
--     WHEN distance_code = '50M' AND station_order = 2  THEN 2.60
--     WHEN distance_code = '50M' AND station_order = 3  THEN 4.70
--     WHEN distance_code = '50M' AND station_order = 4  THEN 7.60
--     WHEN distance_code = '50M' AND station_order = 5  THEN 10.00
--     WHEN distance_code = '50M' AND station_order = 6  THEN 12.70
--     WHEN distance_code = '50M' AND station_order = 7  THEN 15.20
--     WHEN distance_code = '50M' AND station_order = 8  THEN 17.50
--     WHEN distance_code = '50M' AND station_order = 9  THEN 19.30
--     WHEN distance_code = '50M' AND station_order = 10 THEN 21.30
--     WHEN distance_code = '50M' AND station_order = 11 THEN 23.20
--     WHEN distance_code = '50M' AND station_order = 12 THEN 25.30
--     WHEN distance_code = '50M' AND station_order = 13 THEN 27.90
--     WHEN distance_code = '50M' AND station_order = 14 THEN 30.20
--     WHEN distance_code = '50M' AND station_order = 15 THEN 32.60
--     WHEN distance_code = '50M' AND station_order = 16 THEN 35.40
--     WHEN distance_code = '50M' AND station_order = 17 THEN 38.40
--     WHEN distance_code = '50M' AND station_order = 99 THEN 51.30
--     WHEN distance_code = '100K' AND station_order = 2  THEN 2.60
--     WHEN distance_code = '100K' AND station_order = 3  THEN 4.70
--     WHEN distance_code = '100K' AND station_order = 4  THEN 7.60
--     WHEN distance_code = '100K' AND station_order = 5  THEN 10.00
--     WHEN distance_code = '100K' AND station_order = 6  THEN 12.70
--     WHEN distance_code = '100K' AND station_order = 7  THEN 15.20
--     WHEN distance_code = '100K' AND station_order = 8  THEN 17.50
--     WHEN distance_code = '100K' AND station_order = 9  THEN 19.30
--     WHEN distance_code = '100K' AND station_order = 10 THEN 21.30
--     WHEN distance_code = '100K' AND station_order = 11 THEN 23.20
--     WHEN distance_code = '100K' AND station_order = 12 THEN 25.30
--     WHEN distance_code = '100K' AND station_order = 13 THEN 27.90
--     WHEN distance_code = '100K' AND station_order = 14 THEN 30.20
--     WHEN distance_code = '100K' AND station_order = 15 THEN 32.60
--     WHEN distance_code = '100K' AND station_order = 16 THEN 35.40
--     WHEN distance_code = '100K' AND station_order = 17 THEN 38.40
--     WHEN distance_code = '100K' AND station_order = 18 THEN 40.70
--     WHEN distance_code = '100K' AND station_order = 19 THEN 42.70
--     WHEN distance_code = '100K' AND station_order = 20 THEN 44.40
--     WHEN distance_code = '100K' AND station_order = 99 THEN 63.20
--     ELSE mile
--   END
--   WHERE event_id = (SELECT `event_id` FROM `events` WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1);
-- =============================================================================
