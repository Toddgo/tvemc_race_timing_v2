<?php
// load_general_comments.php
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
// Read timestamps as UTC so JS can parse them correctly
$conn->query("SET time_zone = '+00:00'");

// Accept numeric event_id OR event_code string
$event_id = 0;
$raw_id   = trim($_GET['event_id'] ?? '');
if ($raw_id !== '') {
  if (is_numeric($raw_id)) {
    $event_id = (int)$raw_id;
  } else {
    // treat as event_code
    $st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
    $st->bind_param("s", $raw_id);
    $st->execute();
    $evrow = $st->get_result()->fetch_assoc();
    $st->close();
    if ($evrow) $event_id = (int)$evrow['event_id'];
  }
}
if ($event_id <= 0) {
  ob_clean();
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
while ($r = $res->fetch_assoc()) {
  // Normalize timestamp to ISO-8601 UTC string so JS Date() parses it correctly
  if (!empty($r['comment_ts'])) {
    $ts = $r['comment_ts'];
    // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SSZ"
    if (!str_contains($ts, 'T') && !str_contains($ts, 'Z') && !str_contains($ts, '+')) {
      $ts = str_replace(' ', 'T', $ts) . 'Z';
    }
    $r['comment_ts'] = $ts;
  }
  $rows[] = $r;
}

$stmt->close();
$conn->close();

ob_clean();
echo json_encode(['success' => true, 'comments' => $rows]);
