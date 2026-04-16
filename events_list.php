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

// SELECT * — one query, one loop, no per-row re-queries that can corrupt the cursor
$res = $conn->query("SELECT * FROM events ORDER BY event_date DESC, event_id DESC");

if ($res === false) {
  error_log("events_list.php query failed: " . $conn->error);
  $conn->close();
  echo json_encode([]);
  exit;
}

$out = [];
while ($row = $res->fetch_assoc()) {
  $out[] = [
    'event_id'   => (int)($row['event_id'] ?? 0),
    'event_code' => (string)($row['event_code'] ?? ''),
    'event_name' => (string)($row['event_name'] ?? ''),
    'race_date'  => (string)($row['event_date'] ?? $row['race_date'] ?? ''),
    'timezone'   => (string)($row['timezone'] ?? 'America/Los_Angeles'),
  ];
}

$conn->close();
echo json_encode($out);

