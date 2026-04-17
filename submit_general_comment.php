<?php
// submit_general_comment.php
ob_start();
@ini_set('display_errors', '0');
header('Content-Type: application/json');

$configFile = __DIR__ . '/config.race.php';
if (!file_exists($configFile)) {
  ob_clean();
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'No config.race.php found']);
  exit;
}
$cfg = include $configFile;

$conn = new mysqli($cfg['host'], $cfg['username'], $cfg['password'], $cfg['dbname']);
if ($conn->connect_error) {
  ob_clean();
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'DB connect failed: ' . $conn->connect_error]);
  exit;
}
$conn->set_charset("utf8mb4");
// Always store timestamps in UTC so display is timezone-independent
$conn->query("SET time_zone = '+00:00'");

// Read JSON
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
  ob_clean();
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Invalid JSON']);
  exit;
}

$comment = isset($data['comment']) ? trim((string)$data['comment']) : '';
if ($comment === '') {
  ob_clean();
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Missing comment']);
  exit;
}

// Accept either a numeric event_id or an event_code string
$event_id = 0;
if (!empty($data['event_id']) && is_numeric($data['event_id'])) {
  $event_id = (int)$data['event_id'];
} elseif (!empty($data['event_code'])) {
  $ec = trim((string)$data['event_code']);
  $st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
  $st->bind_param("s", $ec);
  $st->execute();
  $evrow = $st->get_result()->fetch_assoc();
  $st->close();
  if ($evrow) $event_id = (int)$evrow['event_id'];
} elseif (!empty($data['event_id'])) {
  // event_id sent as non-numeric string → treat as event_code
  $ec = trim((string)$data['event_id']);
  $st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
  $st->bind_param("s", $ec);
  $st->execute();
  $evrow = $st->get_result()->fetch_assoc();
  $st->close();
  if ($evrow) $event_id = (int)$evrow['event_id'];
}

if ($event_id <= 0) {
  ob_clean();
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Missing/invalid event_id']);
  exit;
}
if ($comment === '') {
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Missing comment']);
  exit;
}

// Optional
$station_name = isset($data['station_name']) ? trim((string)$data['station_name']) : null;
$operator     = isset($data['operator']) ? trim((string)$data['operator']) : null;

// Use server time for comment_ts
$stmt = $conn->prepare("
  INSERT INTO general_comments (event_id, comment_ts, station_name, operator, comment)
  VALUES (?, NOW(), ?, ?, ?)
");
if (!$stmt) {
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'Prepare failed: ' . $conn->error]);
  exit;
}

$stmt->bind_param("isss", $event_id, $station_name, $operator, $comment);

if (!$stmt->execute()) {
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'Execute failed: ' . $stmt->error]);
  exit;
}

$newId = $stmt->insert_id;
$stmt->close();
$conn->close();

ob_clean();
echo json_encode(['success' => true, 'comment_id' => $newId]);
