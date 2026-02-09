<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'DB connect failed']);
  exit;
}
$conn->set_charset('utf8mb4');

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!$data) {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Invalid JSON']);
  exit;
}

$event_code   = trim($data['event_code'] ?? '');
$pass_id      = (int)($data['pass_id'] ?? 0);
$station_code = strtoupper(trim($data['station_code'] ?? ''));

if ($event_code === '' || $pass_id <= 0 || $station_code === '') {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'event_code, pass_id, station_code required']);
  exit;
}

// Resolve event_id
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

// Load the pass we are updating (verify it belongs to this event)
$q = $conn->prepare("SELECT event_id, distance_code FROM passes WHERE pass_id=? LIMIT 1");
$q->bind_param("i", $pass_id);
$q->execute();
$passRow = $q->get_result()->fetch_assoc();
$q->close();

if (!$passRow) {
  http_response_code(404);
  echo json_encode(['success'=>false,'error'=>'pass_id not found']);
  exit;
}

if ((int)$passRow['event_id'] !== $event_id) {
  http_response_code(403);
  echo json_encode(['success'=>false,'error'=>'pass does not belong to this event']);
  exit;
}

$distance_code = trim($passRow['distance_code'] ?? '');

// Map station_code -> station_id for THIS distance (same rules as submit)
$station_id = null;

if (preg_match('/^AS(\d+)$/i', $station_code, $m)) {
  $station_order = (int)$m[1];
  $s = $conn->prepare("SELECT station_id FROM aid_stations WHERE event_id=? AND distance_code=? AND station_order=? LIMIT 1");
  $s->bind_param("isi", $event_id, $distance_code, $station_order);
  $s->execute();
  $r = $s->get_result()->fetch_assoc();
  $s->close();
  if ($r) $station_id = (int)$r['station_id'];
} elseif ($station_code === 'FINISH') {
  $s = $conn->prepare("SELECT station_id FROM aid_stations WHERE event_id=? AND distance_code=? AND is_finish=1 LIMIT 1");
  $s->bind_param("is", $event_id, $distance_code);
  $s->execute();
  $r = $s->get_result()->fetch_assoc();
  $s->close();
  if ($r) $station_id = (int)$r['station_id'];
} else {
  // We do not allow START/personnel here because passes requires a real station_id
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Unsupported station_code for update','station_code'=>$station_code]);
  exit;
}

if (!$station_id) {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Station not found for distance','distance_code'=>$distance_code,'station_code'=>$station_code]);
  exit;
}

// Update station_id only
$u = $conn->prepare("UPDATE passes SET station_id=? WHERE pass_id=? LIMIT 1");
$u->bind_param("ii", $station_id, $pass_id);
$ok = $u->execute();
$u->close();
$conn->close();

echo json_encode(['success'=>$ok, 'pass_id'=>$pass_id, 'station_code'=>$station_code]);
