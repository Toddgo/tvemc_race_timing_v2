-- =============================================================
-- Leona Divide 2026 — COMPLETE SETUP (event_id = 5)
-- Run this in phpMyAdmin → SQL tab
-- Safe to run more than once (uses INSERT IGNORE / UPDATE)
--
-- Start times are in UTC (PDT = UTC − 7):
--   100M: 4:30 AM PDT  = 11:30 UTC  (Sat Apr 18)
--   100K: 6:00 AM PDT  = 13:00 UTC  (Sat Apr 18) *verify with RD*
--   50M:  6:30 AM PDT  = 13:30 UTC  (Sat Apr 18) *verify with RD*
--   50K:  7:00 AM PDT  = 14:00 UTC  (Sat Apr 18) *verify with RD*
--   30K:  7:00 AM PDT  = 14:00 UTC  (Sat Apr 18) *verify with RD*
-- =============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------
-- 1. DISTANCES  (INSERT IGNORE so existing rows are kept)
-- ---------------------------------------------------------------
INSERT IGNORE INTO `event_distances`
  (`event_id`, `distance_code`, `distance_name`)
VALUES
  (5, '100M', '100 Mile'),
  (5, '100K', '100K'),
  (5, '50M',  '50 Mile'),
  (5, '50K',  '50K'),
  (5, '30K',  '30K');

-- ---------------------------------------------------------------
-- 2. START TIMES  (INSERT IGNORE; update manually if wrong)
-- ---------------------------------------------------------------
INSERT IGNORE INTO `event_start_times`
  (`event_id`, `distance_code`, `start_ts`)
VALUES
  (5, '100M', '2026-04-18 11:30:00'),
  (5, '100K', '2026-04-18 13:00:00'),
  (5, '50M',  '2026-04-18 13:30:00'),
  (5, '50K',  '2026-04-18 14:00:00'),
  (5, '30K',  '2026-04-18 14:00:00');

-- ---------------------------------------------------------------
-- 3. FIX 100M station names to match official race website
--    (your DB already has the rows — just correcting the names)
-- ---------------------------------------------------------------
UPDATE `aid_stations`
  SET station_name = 'San Fran #1'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS1';

UPDATE `aid_stations`
  SET station_name = 'Spunky Edison #1'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS2';

UPDATE `aid_stations`
  SET station_name = 'Bouquet Canyon #1'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS3';

UPDATE `aid_stations`
  SET station_name = 'Agua Dulce'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS4';

UPDATE `aid_stations`
  SET station_name = 'Bouquet Canyon #2'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS5';

UPDATE `aid_stations`
  SET station_name = 'Spunky Edison #2'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS6';

UPDATE `aid_stations`
  SET station_name = 'Lincoln Crest'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS7';

UPDATE `aid_stations`
  SET station_name = 'Spunky Edison #3'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS8';

UPDATE `aid_stations`
  SET station_name = 'San Fran #2'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS9';

UPDATE `aid_stations`
  SET station_name = 'Lake Hughes #1'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS10';

UPDATE `aid_stations`
  SET station_name = 'Sawmill Road'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS11';

UPDATE `aid_stations`
  SET station_name = 'Lake Hughes #2'
  WHERE event_id = 5 AND distance_code = '100M' AND station_code = 'AS12';

-- ---------------------------------------------------------------
-- 4. 100K AID STATIONS  (~62 miles — uses shared course to turnaround)
--    NOTE: Verify these against the official 100K course guide.
--    Based on the 100M course structure (out-and-back to Lincoln Crest).
-- ---------------------------------------------------------------
INSERT IGNORE INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`, `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (5, '100K',  1, 'START',  'Start Line',         0.0,   0, 0),
  (5, '100K',  2, 'AS1',    'San Fran #1',        11.0,  1, 0),
  (5, '100K',  3, 'AS2',    'Spunky Edison #1',   18.0,  1, 0),
  (5, '100K',  4, 'AS3',    'Bouquet Canyon #1',  24.0,  1, 0),
  (5, '100K',  5, 'AS4',    'Agua Dulce',         32.5,  1, 0),
  (5, '100K',  6, 'AS5',    'Bouquet Canyon #2',  41.5,  1, 0),
  (5, '100K',  7, 'AS6',    'Spunky Edison #2',   47.5,  1, 0),
  (5, '100K',  8, 'AS7',    'Lincoln Crest',      54.5,  1, 0),
  (5, '100K',  9, 'AS8',    'Spunky Edison #3',   61.5,  1, 0),
  (5, '100K', 99, 'FINISH', 'Finish Line',        62.0,  0, 1);

-- ---------------------------------------------------------------
-- 5. 50 MILE AID STATIONS  (~50 miles)
--    NOTE: Verify against official 50 Mile course guide.
--    Based on shared course, turnaround near Spunky Edison #2.
-- ---------------------------------------------------------------
INSERT IGNORE INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`, `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (5, '50M',  1, 'START',  'Start Line',         0.0,   0, 0),
  (5, '50M',  2, 'AS1',    'San Fran #1',        11.0,  1, 0),
  (5, '50M',  3, 'AS2',    'Spunky Edison #1',   18.0,  1, 0),
  (5, '50M',  4, 'AS3',    'Bouquet Canyon #1',  24.0,  1, 0),
  (5, '50M',  5, 'AS4',    'Agua Dulce',         32.5,  1, 0),
  (5, '50M',  6, 'AS5',    'Bouquet Canyon #2',  41.5,  1, 0),
  (5, '50M',  7, 'AS6',    'Spunky Edison #2',   47.5,  1, 0),
  (5, '50M', 99, 'FINISH', 'Finish Line',        50.0,  0, 1);

-- ---------------------------------------------------------------
-- 6. 50K AID STATIONS  (~31 miles)
--    NOTE: Verify against official 50K course guide.
--    Based on shared course, turnaround near Agua Dulce area.
-- ---------------------------------------------------------------
INSERT IGNORE INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`, `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (5, '50K',  1, 'START',  'Start Line',         0.0,   0, 0),
  (5, '50K',  2, 'AS1',    'San Fran #1',        11.0,  1, 0),
  (5, '50K',  3, 'AS2',    'Spunky Edison #1',   18.0,  1, 0),
  (5, '50K',  4, 'AS3',    'Bouquet Canyon #1',  24.0,  1, 0),
  (5, '50K', 99, 'FINISH', 'Finish Line',        31.0,  0, 1);

-- ---------------------------------------------------------------
-- 7. 30K AID STATIONS  (~18.6 miles)
--    NOTE: Verify against official 30K course guide.
--    Based on shared course, likely just through San Fran #1.
-- ---------------------------------------------------------------
INSERT IGNORE INTO `aid_stations`
  (`event_id`, `distance_code`, `station_order`, `station_code`, `station_name`, `mile`, `is_aid`, `is_finish`)
VALUES
  (5, '30K',  1, 'START',  'Start Line',         0.0,   0, 0),
  (5, '30K',  2, 'AS1',    'San Fran #1',        11.0,  1, 0),
  (5, '30K', 99, 'FINISH', 'Finish Line',        18.6,  0, 1);

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------
-- VERIFY — these 3 queries run automatically so you can confirm
-- ---------------------------------------------------------------
SELECT event_id, event_code, event_name, event_date
  FROM events
  WHERE event_id = 5;

SELECT distance_code, distance_name
  FROM event_distances
  WHERE event_id = 5
  ORDER BY distance_code;

SELECT distance_code, station_order, station_code, station_name, mile
  FROM aid_stations
  WHERE event_id = 5
  ORDER BY distance_code, station_order;
