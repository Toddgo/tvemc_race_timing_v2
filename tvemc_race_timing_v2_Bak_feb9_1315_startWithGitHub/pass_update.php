<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) { http_response_code(500); echo json_encode(['success'=>false,'error'=>'DB connect failed']); exit; }
$conn->set_charset('utf8mb4');

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!$data) { http_response_code(400); echo json_encode(['success'=>false,'error'=>'Invalid JSON']); exit; }

$pass_id = (int)($data['pass_id'] ?? 0);
$note = trim($data['note'] ?? '');
$time_local = trim($data['time_local'] ?? '');

if ($pass_id <= 0) { http_response_code(400); echo json_encode(['success'=>false,'error'=>'pass_id required']); exit; }

if ($time_local !== '') {
  $note = ($note ? $note . " | " : "") . "Corrected time: " . $time_local;
}

$stmt = $conn->prepare("UPDATE passes SET note=? WHERE pass_id=? LIMIT 1");
$stmt->bind_param("si", $note, $pass_id);
$ok = $stmt->execute();
$stmt->close();
$conn->close();

echo json_encode(['success'=>$ok]);
