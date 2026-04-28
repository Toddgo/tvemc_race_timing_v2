-- =============================================================================
-- bishop_ultra_hwy168_tungsten_fix.sql  —  Bishop Ultra 2026 (event 6)
-- =============================================================================
--
-- PURPOSE: Clear the remaining false "RUNNER OFF COURSE" flags at
--          Hwy 168 and Tungsten City that were NOT resolved by the
--          earlier bishop_ultra_stations_rename.sql (which only targeted bib 425).
--
-- ROOT CAUSE:
--   Hwy 168 and Tungsten City appear in all four distances, but under
--   DIFFERENT station codes per distance:
--
--     Distance | Hwy 168 code | Tungsten City code(s)
--     ---------|--------------|----------------------
--     20M      | AS5          | AS6
--     50K      | AS9          | AS10
--     50M      | AS15         | AS16
--     100K     | AS15         | AS16 (1st pass), AS19 (2nd pass)
--
--   When an aid-station device was left on a 50M/100K station code (AS15 or
--   AS16) while 20M or 50K runners passed through, those runners were
--   correctly on course but were flagged mismatch=1 because AS15/AS16 do not
--   exist in the 20M or 50K station list.
--
-- WHAT THIS SCRIPT DOES:
--   1. Collects every mismatch=1 pass for event 6 whose resolved station_name
--      is 'Hwy 168' or 'Tungsten City'.
--   2. Finds the correct station_id for each such pass — matching the runner's
--      registered distance_code to the same station_name.
--      When Tungsten City appears twice in 100K, the first occurrence
--      (station_order 17, mile 38.4) is used as the default.
--   3. Updates each pass: reassigns station_id, clears mismatch=1, and strips
--      the "RUNNER OFF COURSE" prefix from the note field.
--
-- SAFE TO RE-RUN: The INSERT uses ON DUPLICATE KEY UPDATE, and the UPDATE
--   only acts on rows where mismatch=1 (already-cleared rows are skipped).
--
-- PREREQUISITE: bishop_ultra_stations_rename.sql must have been run first
--   (station names must already be clean, e.g. 'Tungsten City' not
--   'Tungsten City #1').
-- =============================================================================


-- -------------------------------------------------------------------------
-- STEP 1: Build mapping of affected pass_ids → correct station_id
-- -------------------------------------------------------------------------
CREATE TEMPORARY TABLE IF NOT EXISTS `_bu_hwy_tungsten_fix` (
  `pass_id`         INT NOT NULL,
  `correct_station` INT NOT NULL,
  PRIMARY KEY (`pass_id`)
);

INSERT INTO `_bu_hwy_tungsten_fix` (`pass_id`, `correct_station`)
  SELECT
    p.`pass_id`,
    correct.`station_id`
  FROM `passes` p

  -- The station that was actually recorded (wrong-distance code)
  JOIN `aid_stations` wrong_as
    ON  wrong_as.`station_id` = p.`station_id`

  -- The correct station: same event, same station_name, matching runner's distance_code.
  -- When Tungsten City appears more than once in a distance (100K has AS16 + AS19),
  -- MIN(station_id) picks the first physical occurrence (mile 38.4 = station_order 17).
  JOIN (
    SELECT
      `distance_code`,
      `station_name`,
      MIN(`station_id`) AS `station_id`
    FROM `aid_stations`
    WHERE `event_id` = (
      SELECT `event_id` FROM `events`
      WHERE  `event_code` = 'BU-ULTRA-2026-0006'
      LIMIT  1
    )
      AND `station_name` IN ('Hwy 168', 'Tungsten City')
    GROUP BY `distance_code`, `station_name`
  ) correct
    ON  correct.`distance_code` = p.`distance_code`
    AND correct.`station_name`  = wrong_as.`station_name`

  WHERE p.`event_id` = (
          SELECT `event_id` FROM `events`
          WHERE  `event_code` = 'BU-ULTRA-2026-0006'
          LIMIT  1
        )
    AND p.`mismatch`             = 1
    AND wrong_as.`station_name` IN ('Hwy 168', 'Tungsten City')

ON DUPLICATE KEY UPDATE `correct_station` = VALUES(`correct_station`);


-- -------------------------------------------------------------------------
-- STEP 2: Apply the corrections
-- -------------------------------------------------------------------------
UPDATE `passes` p
  JOIN `_bu_hwy_tungsten_fix` fx ON fx.`pass_id` = p.`pass_id`
SET
  p.`station_id` = fx.`correct_station`,
  p.`mismatch`   = 0,
  p.`note`       = CASE
                     WHEN p.`note` LIKE '⚠️ RUNNER OFF COURSE%' THEN ''
                     ELSE TRIM(p.`note`)
                   END
WHERE p.`event_id` = (
  SELECT `event_id` FROM `events`
  WHERE  `event_code` = 'BU-ULTRA-2026-0006'
  LIMIT  1
);

DROP TEMPORARY TABLE IF EXISTS `_bu_hwy_tungsten_fix`;


-- =============================================================================
-- Done.  After running this script:
--
--   1. Hard-refresh all browser windows (Ctrl+Shift+R / Cmd+Shift+R).
--
--   2. The bib log viewer should no longer show any "RUNNER OFF COURSE"
--      warning for passes at Hwy 168 or Tungsten City.
--
--   3. Each corrected pass is now assigned to the station matching the
--      runner's registered distance:
--        20M runners → AS5 (Hwy 168) or AS6 (Tungsten City)
--        50K runners → AS9 (Hwy 168) or AS10 (Tungsten City)
--        50M runners → AS15 (Hwy 168) or AS16 (Tungsten City)
--        100K runners → AS15 (Hwy 168) or AS16 (Tungsten City, first pass)
--
-- OPERATIONAL NOTE — preventing recurrence:
--   At a shared physical checkpoint, the aid-station device must be set to
--   the station code that matches the RUNNER's registered distance before
--   scanning.  Verify with the per-distance station-code sheet:
--     20M  runner at Hwy 168       → enter AS5
--     50K  runner at Hwy 168       → enter AS9
--     50M  runner at Hwy 168       → enter AS15
--     100K runner at Hwy 168       → enter AS15
--     20M  runner at Tungsten City → enter AS6
--     50K  runner at Tungsten City → enter AS10
--     50M  runner at Tungsten City → enter AS16
--     100K runner at Tungsten City (1st pass) → enter AS16
--     100K runner at Tungsten City (2nd pass) → enter AS19
-- =============================================================================
