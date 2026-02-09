<?php
// submit_general_comment.php
header('Content-Type: application/json');

$configFile = __DIR__ . '/config.race.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'No config.race.php found']);
  exit;
}
$cfg = include $configFile;

$conn = new mysqli($cfg['host'], $cfg['username'], $cfg['password'], $cfg['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'DB connect failed: ' . $conn->connect_error]);
  exit;
}
$conn->set_charset("utf8mb4");

// Read JSON
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Invalid JSON']);
  exit;
}

// Required
$event_id = isset($data['event_id']) ? (int)$data['event_id'] : 0;
$comment  = isset($data['comment']) ? trim((string)$data['comment']) : '';

if ($event_id <= 0) {
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

echo json_encode(['success' => true, 'comment_id' => $newId]);
