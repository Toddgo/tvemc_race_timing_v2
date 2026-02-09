<?php
// passes_load.php (v2) — include station_id + station_code/name via join
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

$config = include __DIR__ . '/config.race.php';

$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'DB connect failed','details'=>$conn->connect_error]);
  exit;
}
$conn->set_charset('utf8mb4');

$event_code = trim($_GET['event_code'] ?? '');
$limit = (int)($_GET['limit'] ?? 500);
if ($limit < 1) $limit = 500;
if ($limit > 5000) $limit = 5000;

if ($event_code === '') {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Missing event_code']);
  exit;
}

// Resolve event_id
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
if (!$st) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'Prepare failed (event lookup)','details'=>$conn->error]);
  exit;
}
$st->bind_param("s", $event_code);
$st->execute();
$er = $st->get_result()->fetch_assoc();
$st->close();

if (!$er) {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Unknown event_code','event_code'=>$event_code]);
  exit;
}
$event_id = (int)$er['event_id'];

// Pull passes + station metadata
$sql = "
  SELECT
    p.pass_id,
    p.event_id,
    p.bib,
    p.distance_code,
    p.station_id,
    p.pass_type,
    p.pass_ts,
    p.operator,
    p.note,
    p.mismatch,
    p.created_at,

    a.station_code AS station_code,
    a.station_name AS station_name,
    a.station_order AS station_order,
    a.mile AS mile
  FROM passes p
  LEFT JOIN aid_stations a
    ON a.station_id = p.station_id
  WHERE p.event_id = ?
  ORDER BY p.pass_ts DESC, p.pass_id DESC
  LIMIT ?
";
$q = $conn->prepare($sql);
if (!$q) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'Prepare failed (passes load)','details'=>$conn->error]);
  exit;
}
$q->bind_param("ii", $event_id, $limit);
$q->execute();

$res = $q->get_result();
$out = [];
while ($row = $res->fetch_assoc()) {
  // Normalize types a bit
  $row['pass_id'] = (int)$row['pass_id'];
  $row['event_id'] = (int)$row['event_id'];
  $row['bib'] = (int)$row['bib'];
  $row['station_id'] = $row['station_id'] === null ? null : (int)$row['station_id'];
  $row['mismatch'] = (int)($row['mismatch'] ?? 0);
  $row['station_order'] = $row['station_order'] === null ? null : (int)$row['station_order'];
  $row['mile'] = $row['mile'] === null ? null : (float)$row['mile'];

  $out[] = $row;
}
$q->close();
$conn->close();

echo json_encode($out);
exit;
