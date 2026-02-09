<?php
// fetch_hq_log.php
header('Content-Type: application/json');

$configFile = __DIR__ . '/config.race.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'No config.race.php found']);
  exit;
}
$cfg = include $configFile;

$conn = new mysqli($cfg['host'], $cfg['username'], $cfg['password'], $cfg['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'DB connect failed: '.$conn->connect_error]);
  exit;
}

$event_code = trim($_GET['event_code'] ?? '');
if ($event_code === '') {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Missing event_code']);
  exit;
}

$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();

if (!$row) {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Unknown event_code','event_code'=>$event_code]);
  exit;
}
$event_id = (int)$row['event_id'];

$station = trim($_GET['station'] ?? ''); // optional
$ack = trim($_GET['ack'] ?? '');         // optional: "0" or "1"
$limit = (int)($_GET['limit'] ?? 100);
if ($limit <= 0 || $limit > 500) $limit = 100;

$where = "WHERE event_id = ?";
$types = "i";
$args = [$event_id];

if ($station !== '' && strtoupper($station) !== 'ALL') {
  $where .= " AND (station_target = ? OR station_target = 'ALL')";
  $types .= "s";
  $args[] = $station;
}

if ($ack === "0" || $ack === "1") {
  $where .= " AND acknowledged = ?";
  $types .= "i";
  $args[] = (int)$ack;
}

$sql = "
  SELECT id, event_id, station_target, channel, message_text, operator, msg_number,
         acknowledged, ack_time, created_at
  FROM hq_messages
  $where
  ORDER BY id DESC
  LIMIT ?
";

$types .= "i";
$args[] = $limit;

$stmt = $conn->prepare($sql);
$stmt->bind_param($types, ...$args);
$stmt->execute();
$result = $stmt->get_result();

$messages = [];
while ($r = $result->fetch_assoc()) $messages[] = $r;

$stmt->close();
$conn->close();

echo json_encode(['success'=>true,'messages'=>$messages]);
