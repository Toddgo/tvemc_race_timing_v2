-- =============================================================
-- Leona Divide 2026 — Event seed
-- Run this on your MySQL server to add the event, distances,
-- start times, and placeholder aid stations.
--
-- Race date : Saturday April 18, 2026
-- Location  : Lake Hughes, CA  (America/Los_Angeles)
-- Distances : 100M, 100K, 50M, 50K, 30K
-- 100M start: 4:30 AM PDT  = 11:30 UTC
-- Cutoff    : Sunday April 19 @ 2:30 PM PDT (34 hrs from 100M start)
-- Source    : https://www.khraces.com/series/leona-divide-50-50
-- =============================================================

-- ---------------------------------------------------------------
-- 1. EVENT ROW
--    Use INSERT IGNORE so re-running the script is safe.
-- ---------------------------------------------------------------
INSERT IGNORE INTO `events`
  (`event_code`, `event_name`, `event_date`, `timezone`)
VALUES
  ('KH_LD_2026', 'Leona Divide 2026 — KH Races', '2026-04-18', 'America/Los_Angeles');

-- Store the new event_id in a variable for subsequent inserts
SET @ld_id = (SELECT event_id FROM events WHERE event_code = 'KH_LD_2026' LIMIT 1);

-- ---------------------------------------------------------------
-- 2. DISTANCES
--    Approximate distances in miles; start times are PDT (UTC-7).
--    100M 4:30 AM → 11:30 UTC
--    100K 5:00 AM → 12:00 UTC  (typical KH start)
--    50M  6:00 AM → 13:00 UTC
--    50K  7:00 AM → 14:00 UTC
--    30K  7:30 AM → 14:30 UTC
-- ---------------------------------------------------------------
INSERT IGNORE INTO `event_distances`
  (`event_id`, `distance_code`, `distance_name`, `distance_miles`, `official_start_ts`, `cutoff_hours`)
VALUES
  (@ld_id, '100M', '100 Mile',  100.00, '2026-04-18 11:30:00', 34.00),
  (@ld_id, '100K', '100K',       62.14, '2026-04-18 12:00:00', 30.50),
  (@ld_id, '50M',  '50 Mile',    50.00, '2026-04-18 13:00:00', 27.50),
  (@ld_id, '50K',  '50K',        31.07, '2026-04-18 14:00:00', 14.50),
  (@ld_id, '30K',  '30K',        18.64, '2026-04-18 14:30:00',  9.00);

-- ---------------------------------------------------------------
-- 3. START TIMES (event_start_times table used by timing app)
-- ---------------------------------------------------------------
INSERT IGNORE INTO `event_start_times`
  (`event_id`, `distance_code`, `start_ts`, `set_by`)
VALUES
  (@ld_id, '100M', '2026-04-18 11:30:00', 'seed-script'),
  (@ld_id, '100K', '2026-04-18 12:00:00', 'seed-script'),
  (@ld_id, '50M',  '2026-04-18 13:00:00', 'seed-script'),
  (@ld_id, '50K',  '2026-04-18 14:00:00', 'seed-script'),
  (@ld_id, '30K',  '2026-04-18 14:30:00', 'seed-script');

-- ---------------------------------------------------------------
-- 4. AID STATIONS — placeholders (station_code + order are the
--    important fields; update station_name / mile once confirmed)
--
--    Leona Divide 100M course is an out-and-back/loop with
--    aid stations shared across distances at different checkpoints.
--    Update mile marks once you have GPS/race-book data.
--    All distances share START and FINISH; intermediate ASes will
--    need to be validated against the official course guide.
-- ---------------------------------------------------------------

-- 100M stations (21 stops including START & FINISH)
INSERT IGNORE INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`, `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (@ld_id, '100M',  0, 'START',   'START / Lake Hughes',       0.00,   0, 0),
  (@ld_id, '100M',  1, 'AS1',     'Spunky Canyon',             6.50,   1, 0),
  (@ld_id, '100M',  2, 'AS2',     'Atmore Ranch',             12.50,   1, 0),
  (@ld_id, '100M',  3, 'AS3',     'Lake Hughes (Return)',      18.50,   1, 0),
  (@ld_id, '100M',  4, 'AS4',     'Spunky Canyon (Return)',   24.50,   1, 0),
  (@ld_id, '100M',  5, 'AS5',     'Atmore Ranch #2',          30.50,   1, 0),
  (@ld_id, '100M',  6, 'AS6',     'Lake Hughes #2',           36.50,   1, 0),
  (@ld_id, '100M',  7, 'AS7',     'Spunky Canyon #2',         42.50,   1, 0),
  (@ld_id, '100M',  8, 'AS8',     'Atmore Ranch #3',          48.50,   1, 0),
  (@ld_id, '100M',  9, 'AS9',     'Lake Hughes #3',           54.50,   1, 0),
  (@ld_id, '100M', 10, 'AS10',    'Spunky Canyon #3',         60.50,   1, 0),
  (@ld_id, '100M', 11, 'AS11',    'Atmore Ranch #4',          66.50,   1, 0),
  (@ld_id, '100M', 12, 'AS12',    'Lake Hughes #4',           72.50,   1, 0),
  (@ld_id, '100M', 13, 'AS13',    'Spunky Canyon #4',         78.50,   1, 0),
  (@ld_id, '100M', 14, 'AS14',    'Atmore Ranch #5',          84.50,   1, 0),
  (@ld_id, '100M', 15, 'AS15',    'Lake Hughes #5',           90.50,   1, 0),
  (@ld_id, '100M', 16, 'AS16',    'Spunky Canyon #5',         96.50,   1, 0),
  (@ld_id, '100M', 20, 'FINISH',  'FINISH / Lake Hughes',    100.00,   0, 1);

-- 100K stations
INSERT IGNORE INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`, `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (@ld_id, '100K',  0, 'START',  'START / Lake Hughes',   0.00,  0, 0),
  (@ld_id, '100K',  1, 'AS1',    'Spunky Canyon',         6.50,  1, 0),
  (@ld_id, '100K',  2, 'AS2',    'Atmore Ranch',         12.50,  1, 0),
  (@ld_id, '100K',  3, 'AS3',    'Lake Hughes (Return)', 18.50,  1, 0),
  (@ld_id, '100K',  4, 'AS4',    'Spunky Canyon #2',     24.50,  1, 0),
  (@ld_id, '100K',  5, 'AS5',    'Atmore Ranch #2',      30.50,  1, 0),
  (@ld_id, '100K',  6, 'AS6',    'Lake Hughes #2',       36.50,  1, 0),
  (@ld_id, '100K',  7, 'AS7',    'Spunky Canyon #3',     42.50,  1, 0),
  (@ld_id, '100K',  8, 'AS8',    'Atmore Ranch #3',      48.50,  1, 0),
  (@ld_id, '100K',  9, 'AS9',    'Turnaround',           54.50,  1, 0),
  (@ld_id, '100K', 10, 'AS10',   'Atmore Ranch #4',      60.50,  1, 0),
  (@ld_id, '100K', 20, 'FINISH', 'FINISH / Lake Hughes', 62.14,  0, 1);

-- 50M stations
INSERT IGNORE INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`, `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (@ld_id, '50M',  0, 'START',  'START / Lake Hughes',  0.00,  0, 0),
  (@ld_id, '50M',  1, 'AS1',    'Spunky Canyon',        6.50,  1, 0),
  (@ld_id, '50M',  2, 'AS2',    'Atmore Ranch',        12.50,  1, 0),
  (@ld_id, '50M',  3, 'AS3',    'Lake Hughes (Loop)',   18.50,  1, 0),
  (@ld_id, '50M',  4, 'AS4',    'Spunky Canyon #2',    24.50,  1, 0),
  (@ld_id, '50M',  5, 'AS5',    'Atmore Ranch #2',     30.50,  1, 0),
  (@ld_id, '50M',  6, 'AS6',    'Lake Hughes #2',      36.50,  1, 0),
  (@ld_id, '50M',  7, 'AS7',    'Spunky Canyon #3',    42.50,  1, 0),
  (@ld_id, '50M',  8, 'AS8',    'Atmore Ranch #3',     48.50,  1, 0),
  (@ld_id, '50M', 20, 'FINISH', 'FINISH / Lake Hughes', 50.00,  0, 1);

-- 50K stations
INSERT IGNORE INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`, `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (@ld_id, '50K',  0, 'START',  'START / Lake Hughes',  0.00,  0, 0),
  (@ld_id, '50K',  1, 'AS1',    'Spunky Canyon',        6.50,  1, 0),
  (@ld_id, '50K',  2, 'AS2',    'Atmore Ranch',        12.50,  1, 0),
  (@ld_id, '50K',  3, 'AS3',    'Lake Hughes (Loop)',   18.50,  1, 0),
  (@ld_id, '50K',  4, 'AS4',    'Spunky Canyon #2',    24.50,  1, 0),
  (@ld_id, '50K',  5, 'AS5',    'Atmore Ranch #2',     30.50,  1, 0),
  (@ld_id, '50K', 20, 'FINISH', 'FINISH / Lake Hughes', 31.07,  0, 1);

-- 30K stations
INSERT IGNORE INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`, `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (@ld_id, '30K',  0, 'START',  'START / Lake Hughes',  0.00,  0, 0),
  (@ld_id, '30K',  1, 'AS1',    'Spunky Canyon',        6.50,  1, 0),
  (@ld_id, '30K',  2, 'AS2',    'Atmore Ranch',        12.50,  1, 0),
  (@ld_id, '30K', 20, 'FINISH', 'FINISH / Lake Hughes', 18.64,  0, 1);

-- ---------------------------------------------------------------
-- DONE — verify with:
--   SELECT * FROM events WHERE event_code = 'KH_LD_2026';
--   SELECT * FROM event_distances WHERE event_id = @ld_id;
--   SELECT * FROM aid_stations WHERE event_id = @ld_id ORDER BY distance_code, station_order;
-- ---------------------------------------------------------------
