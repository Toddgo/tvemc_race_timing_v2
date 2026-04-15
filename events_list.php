<?php
// events_list.php — returns all events ordered by race_date desc
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

$res = $conn->query(
  "SELECT event_id, event_code, event_name, race_date, timezone
   FROM events
   ORDER BY race_date DESC, event_id DESC"
);

$out = [];
while ($row = $res->fetch_assoc()) {
  $out[] = [
    'event_id'   => (int)$row['event_id'],
    'event_code' => (string)$row['event_code'],
    'event_name' => (string)$row['event_name'],
    'race_date'  => (string)($row['race_date'] ?? ''),
    'timezone'   => (string)($row['timezone'] ?? 'UTC'),
  ];
}

$conn->close();
echo json_encode($out);
