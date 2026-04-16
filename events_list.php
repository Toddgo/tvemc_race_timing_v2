<?php
// events_list.php — returns all events ordered by event_date desc
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode([]);
  exit;
}
$conn->set_charset('utf8mb4');

// Select only columns guaranteed to exist in all server versions.
// timezone is optional — fall back to America/Los_Angeles if not present.
$res = $conn->query(
  "SELECT event_id, event_code, event_name, event_date FROM events ORDER BY event_date DESC, event_id DESC"
);

if ($res === false) {
  // Query failed (e.g. unknown column) — log and return empty list
  error_log("events_list.php query failed: " . $conn->error);
  $conn->close();
  echo json_encode([]);
  exit;
}

// Try to also read timezone if the column exists
$hasTimezone = false;
$colRes = $conn->query("SHOW COLUMNS FROM events LIKE 'timezone'");
if ($colRes && $colRes->num_rows > 0) {
  $hasTimezone = true;
}

$out = [];
while ($row = $res->fetch_assoc()) {
  $tz = 'America/Los_Angeles'; // safe default
  if ($hasTimezone) {
    // Re-fetch with timezone for this row if available
    $tzRes = $conn->query(
      "SELECT timezone FROM events WHERE event_id=" . (int)$row['event_id'] . " LIMIT 1"
    );
    if ($tzRes) {
      $tzRow = $tzRes->fetch_assoc();
      if (!empty($tzRow['timezone'])) $tz = $tzRow['timezone'];
    }
  }
  $out[] = [
    'event_id'   => (int)$row['event_id'],
    'event_code' => (string)$row['event_code'],
    'event_name' => (string)$row['event_name'],
    'race_date'  => (string)($row['event_date'] ?? ''),
    'timezone'   => $tz,
  ];
}

$conn->close();
echo json_encode($out);

