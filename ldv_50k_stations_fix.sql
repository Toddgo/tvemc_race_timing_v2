-- =============================================================================
-- LD-100-2026-0005 Station & Distance Fix  (Leona Divide 100, event_id = 5)
-- =============================================================================
-- PURPOSE:  Ensure the live database matches the confirmed Leona Divide 2026
--           course data for all five distances.
--
-- SAFE TO RE-RUN:  All statements use ON DUPLICATE KEY UPDATE or INSERT IGNORE
--           so running this script more than once will not create duplicate rows
--           or overwrite data that was already correct.
--
-- WHAT THIS SCRIPT DOES:
--   1. Adds/corrects event_distances rows for all five LD-100 distances.
--   2. Removes any old aid_station rows for event_id=5 that used wrong station
--      codes (e.g. the earlier draft used AS6/AS7/AS8 for 50K instead of
--      AS1/AS2/AS3) and inserts the correct rows.
--   3. Adds/corrects event_start_times rows for all five distances.
--   4. Clears mismatch=1 on passes whose station codes were corrected.
-- =============================================================================

-- -------------------------------------------------------------------------
-- STEP 1: event_distances — add/correct all five LD-100-2026-0005 distances
-- -------------------------------------------------------------------------
INSERT INTO `event_distances`
  (`event_id`, `distance_code`, `distance_name`, `distance_miles`,
   `official_start_ts`, `cutoff_hours`)
VALUES
  (5, '100M', '100 Mile',  100.00, '2026-04-18 05:30:00', 36.00),
  (5, '100K', '100K',       62.20, '2026-04-18 06:30:00', 30.00),
  (5, '50M',  '50 Mile',    51.20, '2026-04-18 06:30:00', 20.00),
  (5, '50K',  '50K',        30.20, '2026-04-18 07:00:00', 12.00),
  (5, '30K',  '30K',        18.00, '2026-04-18 07:00:00',  8.00)
ON DUPLICATE KEY UPDATE
  `distance_name`  = VALUES(`distance_name`),
  `distance_miles` = VALUES(`distance_miles`),
  `cutoff_hours`   = VALUES(`cutoff_hours`);
-- NOTE: official_start_ts is intentionally NOT updated on conflict so that a
--       manually-set correct live value is preserved.

-- -------------------------------------------------------------------------
-- STEP 2: aid_stations — remove any wrong/draft rows for event_id=5 and
--         re-insert the correct data.
--
-- The earlier draft script (ldv_50k_stations_fix v1) incorrectly inserted
-- station codes AS6/AS7/AS8 for the 50K distance.  This step cleans that up.
-- -------------------------------------------------------------------------

-- 2a) Delete all aid_station rows for event_id=5 (will be replaced below)
DELETE FROM `aid_stations` WHERE `event_id` = 5;

-- 2b) Insert correct rows for all five distances
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
(5, '50K',  3, 'AS2',    'Sawmill',                   15.00,  1, 0),
(5, '50K',  4, 'AS3',    'Lake Hughes #2',            23.50,  1, 0),
(5, '50K', 99, 'FINISH', 'Finish Line',               30.20,  0, 1),
-- 30K
(5, '30K',  1, 'START',  'Start Line',                0.00,  0, 0),
(5, '30K',  2, 'AS1',    'Lake Hughes #1',             6.50,  1, 0),
(5, '30K',  3, 'TURN',   'Turnaround Spot (NO AID)',   9.00,  0, 0),
(5, '30K',  4, 'AS2',    'Lake Hughes #2',            12.50,  1, 0),
(5, '30K', 99, 'FINISH', 'Finish Line',               18.00,  0, 1);

-- -------------------------------------------------------------------------
-- STEP 3: event_start_times — add/correct all five LD-100 start times
-- -------------------------------------------------------------------------
INSERT INTO `event_start_times`
  (`event_id`, `distance_code`, `start_ts`, `set_by`)
VALUES
  (5, '100M', '2026-04-18 05:30:00', 'NC KJ6DGG Todd'),
  (5, '100K', '2026-04-18 06:30:00', 'NC KJ6DGG Todd'),
  (5, '50M',  '2026-04-18 06:30:00', 'NC KJ6DGG Todd'),
  (5, '50K',  '2026-04-18 07:00:00', 'NC KJ6DGG Todd'),
  (5, '30K',  '2026-04-18 07:00:00', 'NC KJ6DGG Todd')
ON DUPLICATE KEY UPDATE
  `set_by` = VALUES(`set_by`);
-- NOTE: start_ts is intentionally NOT updated on conflict so that a manually-
--       adjusted correct live value is preserved.

-- -------------------------------------------------------------------------
-- STEP 4: clear mismatch flags on existing passes for event_id=5
--
-- Any passes recorded with mismatch=1 because the station codes didn't
-- exist in aid_stations at the time should now be cleared.
-- -------------------------------------------------------------------------
UPDATE `passes` p
  JOIN `aid_stations` a ON a.station_id = p.station_id
SET p.mismatch = 0, p.note = ''
WHERE p.event_id = 5
  AND p.mismatch = 1
  AND (p.note = '' OR p.note IS NULL OR p.note LIKE '%mismatch%' OR p.note LIKE '%off course%');

-- =============================================================================
-- Done.  After running:
--   • Hard-refresh the browser (Ctrl+Shift+R / Cmd+Shift+R).
--   • All five distances should appear correctly in the event selector.
--   • ETA / expected-next-station calculations will now use the DB-driven
--     station paths for LDV instead of any hardcoded fallback values.
-- =============================================================================
