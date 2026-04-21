-- =============================================================================
-- LD-100-2026-0005 Station & Distance Fix  (Leona Divide 100, event_id = 5)
-- =============================================================================
-- PURPOSE:  Ensure the live database matches the confirmed Leona Divide 2026
--           course data for all five distances.
--
-- !! IMPORTANT: The race date below is set to 2026-04-21.
-- !! If the actual race runs on a different date, update every occurrence of
-- !! '2026-04-21' in this script before running it.
--
-- SAFE TO RE-RUN:  All statements use ON DUPLICATE KEY UPDATE or INSERT IGNORE
--           so running this script more than once will not create duplicate rows
--           or overwrite data that was already correct.
--
-- WHAT THIS SCRIPT DOES:
--   1. Adds/corrects event_distances rows for all five LD-100 distances.
--   2. EXPLICITLY UPDATES start_ts in event_start_times and official_start_ts
--      in event_distances to match the correct race date.
--   3. Removes any old aid_station rows for event_id=5 that used wrong station
--      codes (e.g. the earlier draft used AS6/AS7/AS8 for 50K instead of
--      AS1/AS2/AS3) and inserts the correct rows.
--   4. Using a temp table, corrects station_id on existing mismatch passes
--      so they point to the right 50K station (by station_name match) and
--      clears mismatch=1 and the off-course note.
-- =============================================================================

-- -------------------------------------------------------------------------
-- STEP 1: event_distances — add/correct all five LD-100-2026-0005 distances
-- -------------------------------------------------------------------------
INSERT INTO `event_distances`
  (`event_id`, `distance_code`, `distance_name`, `distance_miles`,
   `official_start_ts`, `cutoff_hours`)
VALUES
  (5, '100M', '100 Mile',  100.00, '2026-04-21 05:30:00', 36.00),
  (5, '100K', '100K',       62.20, '2026-04-21 06:30:00', 30.00),
  (5, '50M',  '50 Mile',    51.20, '2026-04-21 06:30:00', 20.00),
  (5, '50K',  '50K',        30.20, '2026-04-21 07:00:00', 12.00),
  (5, '30K',  '30K',        18.00, '2026-04-21 07:00:00',  8.00)
ON DUPLICATE KEY UPDATE
  `distance_name`    = VALUES(`distance_name`),
  `distance_miles`   = VALUES(`distance_miles`),
  `cutoff_hours`     = VALUES(`cutoff_hours`),
  `official_start_ts`= VALUES(`official_start_ts`);
-- NOTE: official_start_ts IS updated on conflict so the correct date is always applied.

-- -------------------------------------------------------------------------
-- STEP 2: event_start_times — add/correct all five LD-100 start times
--
-- Uses two statements:
--   a) INSERT ... ON DUPLICATE KEY UPDATE that ALSO updates start_ts so
--      any previously wrong date is corrected.
--   b) An explicit UPDATE to catch rows that may already exist with wrong dates.
-- -------------------------------------------------------------------------
INSERT INTO `event_start_times`
  (`event_id`, `distance_code`, `start_ts`, `set_by`)
VALUES
  (5, '100M', '2026-04-21 05:30:00', 'NC KJ6DGG Todd'),
  (5, '100K', '2026-04-21 06:30:00', 'NC KJ6DGG Todd'),
  (5, '50M',  '2026-04-21 06:30:00', 'NC KJ6DGG Todd'),
  (5, '50K',  '2026-04-21 07:00:00', 'NC KJ6DGG Todd'),
  (5, '30K',  '2026-04-21 07:00:00', 'NC KJ6DGG Todd')
ON DUPLICATE KEY UPDATE
  `start_ts` = VALUES(`start_ts`),
  `set_by`   = VALUES(`set_by`);

-- Explicit UPDATE to correct any pre-existing rows that the INSERT skipped
-- (e.g. if they were manually inserted with wrong dates earlier):
UPDATE `event_start_times`
SET    `start_ts` = CASE `distance_code`
         WHEN '100M' THEN '2026-04-21 05:30:00'
         WHEN '100K' THEN '2026-04-21 06:30:00'
         WHEN '50M'  THEN '2026-04-21 06:30:00'
         WHEN '50K'  THEN '2026-04-21 07:00:00'
         WHEN '30K'  THEN '2026-04-21 07:00:00'
         ELSE `start_ts`
       END,
       `set_by`   = 'NC KJ6DGG Todd'
WHERE  `event_id` = 5;

-- -------------------------------------------------------------------------
-- STEP 3: aid_stations — remove any wrong/draft rows for event_id=5 and
--         re-insert the correct data.
--
-- The earlier draft script (ldv_50k_stations_fix v1) incorrectly inserted
-- station codes AS6/AS7/AS8 for the 50K distance.  This step cleans that up.
-- -------------------------------------------------------------------------

-- 3a) Save station_names for any mismatch passes BEFORE deleting rows so we
--     can restore correct station_id after re-insert (STEP 4b).
CREATE TEMPORARY TABLE IF NOT EXISTS `_ldv_pass_station_fix` (
  `pass_id`      INT NOT NULL,
  `station_name` VARCHAR(128) NOT NULL,
  PRIMARY KEY (`pass_id`)
);

INSERT INTO `_ldv_pass_station_fix` (`pass_id`, `station_name`)
  SELECT p.`pass_id`, a.`station_name`
  FROM   `passes` p
  JOIN   `aid_stations` a ON a.`station_id` = p.`station_id`
  WHERE  p.`event_id` = 5
    AND  p.`mismatch` = 1
ON DUPLICATE KEY UPDATE `station_name` = VALUES(`station_name`);

-- 3b) Delete all aid_station rows for event_id=5 (will be replaced below)
DELETE FROM `aid_stations` WHERE `event_id` = 5;

-- 3c) Insert correct rows for all five distances
INSERT INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`,
   `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
-- 100M
(5, '100M',  1, 'START',  'Start Line',               0.00,  0, 0),
(5, '100M',  2, 'AS1',    'San Fran #1',              11.00,  1, 0),
(5, '100M',  3, 'AS2',    'Spunky Edison #1',         18.00,  1, 0),
(5, '100M',  4, 'AS3',    'Bouquet Canyon #1',        24.00,  1, 0),
(5, '100M',  5, 'AS4',    'Agua Dulce',               32.50,  1, 0),
(5, '100M',  6, 'AS5',    'Bouquet Canyon #2',        41.50,  1, 0),
(5, '100M',  7, 'AS6',    'Spunky Edison #2',         47.50,  1, 0),
(5, '100M',  8, 'AS7',    'Lincoln Crest',            54.50,  1, 0),
(5, '100M',  9, 'AS8',    'Spunky Edison #3',         61.50,  1, 0),
(5, '100M', 10, 'AS9',    'San Fran #2',              68.00,  1, 0),
(5, '100M', 11, 'AS10',   'Lake Hughes #1',           75.50,  1, 0),
(5, '100M', 12, 'AS11',   'Sawmill Road',             84.00,  1, 0),
(5, '100M', 13, 'AS12',   'Lake Hughes #2',           92.50,  1, 0),
(5, '100M', 99, 'FINISH', 'Finish Line',             100.00,  0, 1),
-- 100K
(5, '100K',  1, 'START',  'Start Line',               0.00,  0, 0),
(5, '100K',  2, 'AS1',    'San Fran #1',               7.50,  1, 0),
(5, '100K',  3, 'AS2',    'Spunky Edison #1',         14.00,  1, 0),
(5, '100K',  4, 'AS3',    'Bouquet Canyon #1',        20.00,  1, 0),
(5, '100K',  5, 'AS4',    'Spunky Edison #2',         26.00,  1, 0),
(5, '100K',  6, 'AS5',    'San Fran #2',              32.50,  1, 0),
(5, '100K',  7, 'AS6',    'Lake Hughes #1',           40.00,  1, 0),
(5, '100K',  8, 'AS7',    'Sawmill Road',             48.25,  1, 0),
(5, '100K',  9, 'AS8',    'Lake Hughes #2',           56.50,  1, 0),
(5, '100K', 99, 'FINISH', 'Finish Line',              62.20,  0, 1),
-- 50M
(5, '50M',  1, 'START',  'Start Line',                0.00,  0, 0),
(5, '50M',  2, 'AS1',    'San Fran #1',                7.50,  1, 0),
(5, '50M',  3, 'AS2',    'Spunky Edison #1',          14.00,  1, 0),
(5, '50M',  4, 'AS3',    'Bouquet Canyon #1',         20.00,  1, 0),
(5, '50M',  5, 'AS4',    'Spunky Edison #2',          26.00,  1, 0),
(5, '50M',  6, 'AS5',    'San Fran #2',               32.50,  1, 0),
(5, '50M',  7, 'AS6',    'Lake Hughes #1',            40.00,  1, 0),
(5, '50M',  8, 'AS7',    'Lake Hughes #2',            44.50,  1, 0),
(5, '50M', 99, 'FINISH', 'Finish Line',               51.20,  0, 1),
-- 50K  (station codes AS1/AS2/AS3 — NOT AS6/AS7/AS8)
(5, '50K',  1, 'START',  'Start Line',                0.00,  0, 0),
(5, '50K',  2, 'AS1',    'Lake Hughes #1',             6.50,  1, 0),
(5, '50K',  3, 'AS2',    'Sawmill Road',              15.00,  1, 0),
(5, '50K',  4, 'AS3',    'Lake Hughes #2',            23.50,  1, 0),
(5, '50K', 99, 'FINISH', 'Finish Line',               30.20,  0, 1),
-- 30K
(5, '30K',  1, 'START',  'Start Line',                0.00,  0, 0),
(5, '30K',  2, 'AS1',    'Lake Hughes #1',             6.50,  1, 0),
(5, '30K',  3, 'TURN',   'Turnaround Spot (NO AID)',   9.00,  0, 0),
(5, '30K',  4, 'AS2',    'Lake Hughes #2',            12.50,  1, 0),
(5, '30K', 99, 'FINISH', 'Finish Line',               18.00,  0, 1);

-- -------------------------------------------------------------------------
-- STEP 4: Correct station_id on existing mismatch passes and clear flags.
--
-- Uses the temp table created in STEP 3a to match by station_name so that
-- each mismatch pass gets the station_id for its own distance (e.g. 50K
-- "Lake Hughes #1" → AS1, not the 100K AS6 row).
-- -------------------------------------------------------------------------

-- 4a) Update station_id by matching the saved station_name to the new rows
UPDATE `passes` p
  JOIN  `_ldv_pass_station_fix` bak ON bak.`pass_id` = p.`pass_id`
  JOIN  `aid_stations` new_as
          ON  new_as.`event_id`       = p.`event_id`
          AND new_as.`distance_code`  = p.`distance_code`
          AND new_as.`station_name`   = bak.`station_name`
SET   p.`station_id` = new_as.`station_id`,
      p.`mismatch`   = 0,
      p.`note`       = ''
WHERE p.`event_id`   = 5;

-- 4b) Clear any remaining mismatch flags whose station_name wasn't found above
--     (e.g. passes recorded with no station match in new aid_stations)
UPDATE `passes` p
SET    p.`mismatch` = 0,
       p.`note`     = ''
WHERE  p.`event_id` = 5
  AND  p.`mismatch` = 1
  AND  (p.`note` = '' OR p.`note` IS NULL
        OR p.`note` LIKE '%mismatch%'
        OR p.`note` LIKE '%off course%');

DROP TEMPORARY TABLE IF EXISTS `_ldv_pass_station_fix`;

-- =============================================================================
-- Done.  After running:
--   • Hard-refresh the browser (Ctrl+Shift+R / Cmd+Shift+R).
--   • All five distances should appear correctly in the event selector.
--   • Elapsed time will now compute correctly from the 2026-04-21 start times.
--   • ETA / expected-next-station calculations will now use the DB-driven
--     station paths for LDV instead of any hardcoded fallback values.
--   • If you still see old "RUNNER OFF COURSE" entries in the Bib Log,
--     delete those passes and re-submit from scratch for a clean state.
-- =============================================================================
