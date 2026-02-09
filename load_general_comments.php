<?php
// load_general_comments.php
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

$event_id = isset($_GET['event_id']) ? (int)$_GET['event_id'] : 0;
if ($event_id <= 0) {
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Missing/invalid event_id']);
  exit;
}

$limit = isset($_GET['limit']) ? max(1, min(500, (int)$_GET['limit'])) : 200;
$since_id = isset($_GET['since_id']) ? (int)$_GET['since_id'] : 0;

if ($since_id > 0) {
  $stmt = $conn->prepare("
    SELECT comment_id, event_id, comment_ts, station_name, operator, comment
    FROM general_comments
    WHERE event_id = ? AND comment_id > ?
    ORDER BY comment_id ASC
    LIMIT ?
  ");
  $stmt->bind_param("iii", $event_id, $since_id, $limit);
} else {
  $stmt = $conn->prepare("
    SELECT comment_id, event_id, comment_ts, station_name, operator, comment
    FROM general_comments
    WHERE event_id = ?
    ORDER BY comment_id DESC
    LIMIT ?
  ");
  $stmt->bind_param("ii", $event_id, $limit);
}

if (!$stmt->execute()) {
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'Execute failed: ' . $stmt->error]);
  exit;
}

$res = $stmt->get_result();
$rows = [];
while ($r = $res->fetch_assoc()) $rows[] = $r;

$stmt->close();
$conn->close();

echo json_encode(['success' => true, 'comments' => $rows]);
