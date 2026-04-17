<?php
// events_list.php
// Returns all active events as a JSON array for the event-picker dropdown.
ob_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  ob_end_clean();
  http_response_code(500);
  echo json_encode([]);
  exit;
}
$conn->set_charset('utf8mb4');

$res = $conn->query(
  "SELECT event_id, event_code, event_name, event_date, timezone
     FROM events
    ORDER BY event_date DESC, event_id DESC"
);

$out = [];
if ($res) {
  while ($r = $res->fetch_assoc()) {
    $out[] = [
      'event_id'   => (int)$r['event_id'],
      'event_code' => (string)$r['event_code'],
      'event_name' => (string)$r['event_name'],
      'event_date' => (string)$r['event_date'],
      'timezone'   => (string)$r['timezone'],
    ];
  }
}

$conn->close();
ob_end_clean();
echo json_encode($out);
