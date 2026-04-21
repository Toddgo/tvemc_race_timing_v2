-- =============================================================================
-- LDV 50K Station Fix — Leona Divide 100 2026 (event_id = 5)
-- =============================================================================
-- PROBLEM:  The 50K distance has no rows in aid_stations or event_distances
--           for event_id=5.  Every 50K pass at AS6/AS7/AS8 is flagged as
--           "RUNNER OFF COURSE" (mismatch=1) and Card C / ETA / finish-time
--           calculations all fail.
--
-- SOLUTION: Insert the missing 50K rows.  Run this script ONCE on the live DB.
--
-- IMPORTANT: Before running, verify and update:
--   1. official_start_ts in event_distances — use the actual 50K wave start.
--   2. start_ts in event_start_times       — same actual start time.
--   3. mile values in aid_stations          — update to actual course miles.
--   4. station_name values                  — already match the live DB names.
--
-- =============================================================================

-- 1) Add 50K event distance for LD-100-2026-0005
--    Update official_start_ts to the real 50K start time before running.
INSERT INTO `event_distances`
  (`event_id`, `distance_code`, `distance_name`, `distance_miles`,
   `official_start_ts`, `cutoff_hours`)
VALUES
  (5, '50K', '50K', 31.07, '2026-04-19 09:00:00', 12.00)
ON DUPLICATE KEY UPDATE
  `distance_name`    = VALUES(`distance_name`),
  `distance_miles`   = VALUES(`distance_miles`),
  `cutoff_hours`     = VALUES(`cutoff_hours`);
-- NOTE: official_start_ts is NOT updated on conflict so a prior correct value
--       is preserved.  Change the ON DUPLICATE KEY clause if you need to force it.

-- 2) Add 50K aid stations for LD-100-2026-0005
--    Update mile values to the actual course distances from the 50K start.
INSERT INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`,
   `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (5, '50K', 0,   'START',  'Start',           0.00,  0, 0),
  (5, '50K', 1,   'AS6',    'Lake Hughes #1',  11.00, 1, 0),
  (5, '50K', 2,   'AS7',    'Sawmill Road',    19.50, 1, 0),
  (5, '50K', 3,   'AS8',    'Lake Hughes #2',  26.20, 1, 0),
  (5, '50K', 999, 'FINISH', 'Finish Line',     31.07, 1, 1)
ON DUPLICATE KEY UPDATE
  `station_name`  = VALUES(`station_name`),
  `mile`          = VALUES(`mile`),
  `is_aid`        = VALUES(`is_aid`),
  `is_finish`     = VALUES(`is_finish`);

-- 3) Add 50K start time
--    Update start_ts to the actual 50K wave start time before running.
INSERT INTO `event_start_times`
  (`event_id`, `distance_code`, `start_ts`, `set_by`)
VALUES
  (5, '50K', '2026-04-19 09:00:00', 'migration')
ON DUPLICATE KEY UPDATE
  `set_by` = VALUES(`set_by`);
-- NOTE: start_ts is NOT updated on conflict so a manually-set correct value
--       is preserved.

-- =============================================================================
-- After running this script:
--   • Reload the page in the browser (hard refresh: Ctrl+Shift+R / Cmd+Shift+R)
--   • The "RUNNER OFF COURSE" flags on existing 50K passes will NOT be cleared
--     automatically — those passes were stored with mismatch=1.  To clear them
--     run the optional UPDATE below.
--
-- OPTIONAL: clear mismatch flag on existing 50K passes at AS6/AS7/AS8
-- UPDATE passes p
--   JOIN aid_stations a ON a.station_id = p.station_id
-- SET p.mismatch = 0, p.note = ''
-- WHERE p.event_id = 5
--   AND p.distance_code = '50K'
--   AND a.station_code IN ('AS6','AS7','AS8')
--   AND p.mismatch = 1;
-- =============================================================================
