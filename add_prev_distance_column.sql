-- add_prev_distance_column.sql
-- Run this once against your race timing database to enable the
-- "previous distance" feature.  After running this migration the
-- runner_distance_update.php endpoint will automatically use the new
-- column to preserve a runner's original distance whenever a Change
-- Distance is recorded during the event.
--
-- Safe to run multiple times (IF NOT EXISTS guard).

ALTER TABLE `runners`
  ADD COLUMN IF NOT EXISTS `prev_distance_code` varchar(16)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
    DEFAULT NULL
    AFTER `distance_code`;
