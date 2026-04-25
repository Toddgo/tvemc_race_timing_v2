-- =============================================================================
-- bishop_ultra_stations_rename.sql  —  Bishop Ultra 2026 (event 6)
-- =============================================================================
--
-- PURPOSE:  Remove the "#1", "#2", "#3" suffix from aid-station names for the
--           Bishop Ultra 2026 event.  At a shared physical location, all
--           distances now show the same base name (e.g. "Tungsten City") and
--           the Pass # column in the results view shows 1, 2, … to distinguish
--           repeated visits to the same checkpoint.
--
-- SAFE TO RE-RUN:  All UPDATE statements use CASE expressions that map the
--                  old name to the new name, so running this script a second
--                  time is a no-op.
--
-- !! IMPORTANT: Run this script ONLY when the event has live pass data and you
-- !! CANNOT delete and re-insert aid_station rows (which would cascade-delete
-- !! all passes).  If no real pass data exists yet, simply re-run the full
-- !! bishop_ultra_setup.sql instead.
--
-- WHAT THIS SCRIPT DOES:
--   1. Updates station_name for every Bishop Ultra 2026 station that has a
--      "#1", "#2", or "#3" suffix, stripping the suffix.
--   2. Clears the false "RUNNER OFF COURSE" mismatch flag for bib #425 whose
--      passes were recorded at 100K station codes while they ran the 20M
--      course.  The off-course warnings were a data-entry artefact (the aid-
--      station device was left on a 100K station code when 20M runners came
--      through).
-- =============================================================================


-- -------------------------------------------------------------------------
-- STEP 1: Rename stations — strip "#1", "#2", "#3" suffixes
-- -------------------------------------------------------------------------
UPDATE `aid_stations`
SET `station_name` = CASE `station_name`
  -- 100K first-pass stations (rename from "X #1" → "X")
  WHEN 'CDF #1'           THEN 'CDF'
  WHEN 'Tungsten City #1' THEN 'Tungsten City'

  -- 100K return-leg stations (rename from "X #2" → "X")
  WHEN 'CDF #2'           THEN 'CDF'
  WHEN 'Tungsten City #2' THEN 'Tungsten City'

  -- Shared across 20M / 50K / 50M / 100K
  WHEN 'Junction #1'      THEN 'Junction'
  WHEN 'Junction #2'      THEN 'Junction'

  -- Shared across 50K / 50M / 100K
  WHEN 'Buttermilk #1'    THEN 'Buttermilk'
  WHEN 'Buttermilk #2'    THEN 'Buttermilk'
  WHEN 'McGee #1'         THEN 'McGee'
  WHEN 'McGee #2'         THEN 'McGee'

  -- 50M / 100K multi-pass stations
  WHEN 'Edison Loop #1'   THEN 'Edison Loop'
  WHEN 'Edison Loop #2'   THEN 'Edison Loop'
  WHEN 'Edison Loop #3'   THEN 'Edison Loop'
  WHEN 'Intake Two #1'    THEN 'Intake Two'
  WHEN 'Intake Two #2'    THEN 'Intake Two'

  ELSE `station_name`   -- leave all other names unchanged
END
WHERE `event_id` = (
  SELECT `event_id` FROM `events`
  WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1
);


-- -------------------------------------------------------------------------
-- STEP 2: Clear false "RUNNER OFF COURSE" flags for bib #425
--
-- Bib 425 (20M) was correctly on-course.  Their passes at Junction #2 (100K
-- AS14), Hwy 168 (100K AS15), and Tungsten City #1 (100K AS16) were flagged
-- as mismatches because the aid-station devices were still set to the 100K
-- station codes when 20M runners came through.  Clear the flag and remove the
-- auto-generated off-course prefix from the note field.
-- -------------------------------------------------------------------------

-- 2a) Save a mapping: mismatch pass_id → station_name as it now appears
--     (after the rename above, so the names can be matched back to the
--     correct 20M station_id in step 2b).
CREATE TEMPORARY TABLE IF NOT EXISTS `_bu_bib425_stfix` (
  `pass_id`      INT         NOT NULL,
  `station_name` VARCHAR(128) NOT NULL,
  PRIMARY KEY (`pass_id`)
);

INSERT INTO `_bu_bib425_stfix` (`pass_id`, `station_name`)
  SELECT p.`pass_id`, a.`station_name`
  FROM   `passes`       p
  JOIN   `aid_stations` a ON a.`station_id` = p.`station_id`
  WHERE  p.`event_id` = (
           SELECT `event_id` FROM `events`
           WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1
         )
    AND  p.`bib`      = 425
    AND  p.`mismatch` = 1
ON DUPLICATE KEY UPDATE `station_name` = VALUES(`station_name`);

-- 2b) Reassign station_id to the correct 20M station where the station_name
--     matches exactly one 20M row.  This corrects passes that landed on a 100K
--     station_id (e.g. AS16 Tungsten City) when they should be on the
--     equivalent 20M station (AS6 Tungsten City).
--
--     Note: for station names that appear more than once in a distance (e.g.
--     "Junction" appears at AS2 and AS4 for 20M), only passes whose scanned
--     station_name uniquely resolves are updated here; ambiguous cases are
--     handled in step 2c.
UPDATE `passes` p
  JOIN `_bu_bib425_stfix` bak ON bak.`pass_id` = p.`pass_id`
  JOIN (
    -- Find 20M stations whose name appears exactly once in the 20M distance
    SELECT `station_id`, `station_name`
    FROM   `aid_stations`
    WHERE  `event_id`      = (
             SELECT `event_id` FROM `events`
             WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1
           )
      AND  `distance_code` = '20M'
    GROUP  BY `station_name`
    HAVING COUNT(*) = 1
  ) correct_as ON correct_as.`station_name` = bak.`station_name`
SET  p.`station_id` = correct_as.`station_id`,
     p.`mismatch`   = 0,
     p.`note`       = CASE
                        WHEN p.`note` LIKE '⚠️ RUNNER OFF COURSE%' THEN ''
                        ELSE TRIM(p.`note`)
                      END
WHERE p.`event_id` = (
        SELECT `event_id` FROM `events`
        WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1
      )
  AND p.`bib`      = 425;

-- 2c) Clear any remaining mismatch flags for bib 425 (e.g. "Junction" which
--     appears twice in 20M and could not be unambiguously reassigned above).
--     The mismatch flag is cleared; the station_id remains as-is.
UPDATE `passes` p
SET    p.`mismatch` = 0,
       p.`note`     = CASE
                        WHEN p.`note` LIKE '⚠️ RUNNER OFF COURSE%' THEN ''
                        ELSE TRIM(p.`note`)
                      END
WHERE  p.`event_id` = (
         SELECT `event_id` FROM `events`
         WHERE `event_code` = 'BU-ULTRA-2026-0006' LIMIT 1
       )
  AND  p.`bib`      = 425
  AND  p.`mismatch` = 1;

DROP TEMPORARY TABLE IF EXISTS `_bu_bib425_stfix`;


-- =============================================================================
-- Done.  After running this script:
--
--   1. Hard-refresh all browser windows (Ctrl+Shift+R / Cmd+Shift+R).
--
--   2. The bib log for runner #425 should no longer show any
--      "RUNNER OFF COURSE" warnings.
--
--   3. All stations previously shown as "CDF #1 / #2", "Junction #1 / #2",
--      etc. will now display simply as "CDF", "Junction", etc.  The Pass #
--      column in the results view will show 1, 2, … when a runner passes the
--      same physical checkpoint more than once.
--
--   4. For future events, update bishop_ultra_setup.sql to use the new
--      station names (no suffixes) so a fresh run of that script produces the
--      correct names from the start.
--
-- OPERATIONAL NOTE — preventing future false off-course warnings:
--   The off-course detection matches the submitted station_code (AS1, AS2, …)
--   against the distance_code in aid_stations.  If aid-station operators leave
--   their device set to a 100K station code when runners of a shorter distance
--   come through, those runners will still be flagged.  To avoid this, each
--   aid-station operator should confirm their device's distance_code matches
--   the runner's registered distance before scanning, or use the event's
--   station-code list to verify they are on the correct sequential code
--   (e.g. AS6 for 20M Tungsten City, AS16 for 100K first-pass Tungsten City).
-- =============================================================================
