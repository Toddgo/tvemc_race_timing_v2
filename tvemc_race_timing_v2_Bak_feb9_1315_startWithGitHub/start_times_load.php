<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) { http_response_code(500); echo json_encode(["success"=>false]); exit; }
$conn->set_charset('utf8mb4');

$event_code = trim($_GET['event_code'] ?? '');
if ($event_code === '') { echo json_encode([]); exit; }

// event_id
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();
if (!$row) { echo json_encode([]); exit; }
$event_id = (int)$row['event_id'];

$sql = "SELECT distance_code, start_ts FROM event_start_times WHERE event_id=? ORDER BY distance_code";
$stmt = $conn->prepare($sql);
$stmt->bind_param("i", $event_id);
$stmt->execute();
$res = $stmt->get_result();

$out = [];
while ($r = $res->fetch_assoc()) $out[] = $r;

$stmt->close();
$conn->close();
echo json_encode($out);
