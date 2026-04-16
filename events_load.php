<?php
// events_load.php — returns single event row by event_code
ob_start();
@ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  ob_clean();
  http_response_code(500);
  echo json_encode(null);
  exit;
}
$conn->set_charset('utf8mb4');

$event_code = trim($_GET['event_code'] ?? '');
if ($event_code === '') {
  ob_clean();
  echo json_encode(null);
  exit;
}

// SELECT * so we work regardless of which optional columns (timezone, etc.) exist
$stmt = $conn->prepare("SELECT * FROM events WHERE event_code=? LIMIT 1");
if (!$stmt) {
  ob_clean();
  http_response_code(500);
  echo json_encode(['error' => 'prepare_failed', 'detail' => $conn->error]);
  exit;
}
$stmt->bind_param("s", $event_code);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();
$conn->close();

if (!$row) {
  ob_clean();
  echo json_encode(null);
  exit;
}

// Normalize to guaranteed fields
$out = [
  'event_id'   => (int)($row['event_id'] ?? 0),
  'event_code' => (string)($row['event_code'] ?? ''),
  'event_name' => (string)($row['event_name'] ?? ''),
  'event_date' => (string)($row['event_date'] ?? $row['race_date'] ?? ''),
  'timezone'   => (string)($row['timezone'] ?? 'America/Los_Angeles'),
];

ob_clean();
echo json_encode($out);

