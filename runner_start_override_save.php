<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) { http_response_code(500); echo json_encode(["success"=>false,"error"=>"DB connect failed"]); exit; }
$conn->set_charset('utf8mb4');

// JSON body
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) { http_response_code(400); echo json_encode(["success"=>false,"error"=>"Invalid JSON"]); exit; }

$event_code = trim((string)($data['event_code'] ?? ''));
$bib = (int)($data['bib'] ?? 0);
$start_ts_actual = trim((string)($data['start_ts_actual'] ?? ''));
$reason = trim((string)($data['reason'] ?? ''));
$set_by = trim((string)($data['set_by'] ?? ''));

if ($event_code === '' || $bib <= 0 || $start_ts_actual === '') {
  http_response_code(400);
  echo json_encode(["success"=>false,"error"=>"Missing event_code, bib, or start_ts_actual"]);
  exit;
}

// resolve event_id
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();
if (!$row) { http_response_code(404); echo json_encode(["success"=>false,"error"=>"Event not found"]); exit; }
$event_id = (int)$row['event_id'];

// Upsert into runner_starts
// Columns we saw: start_id, event_id, bib, start_ts_actual, reason, set_by, set_at
$stmt = $conn->prepare("
  INSERT INTO runner_starts (event_id, bib, start_ts_actual, reason, set_by, set_at)
  VALUES (?, ?, ?, ?, ?, NOW())
  ON DUPLICATE KEY UPDATE
    start_ts_actual = VALUES(start_ts_actual),
    reason = VALUES(reason),
    set_by = VALUES(set_by),
    set_at = NOW()
");
if (!$stmt) { http_response_code(500); echo json_encode(["success"=>false,"error"=>"Prepare failed"]); exit; }

$stmt->bind_param("iisss", $event_id, $bib, $start_ts_actual, $reason, $set_by);

if (!$stmt->execute()) {
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>"Execute failed: ".$stmt->error]);
  exit;
}

$stmt->close();
$conn->close();
echo json_encode(["success"=>true]);
