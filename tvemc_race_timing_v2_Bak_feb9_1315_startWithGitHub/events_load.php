<?php
// events_load.php Feb 6, 2026 10:00
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) { http_response_code(500); echo json_encode(null); exit; }
$conn->set_charset('utf8mb4');

$event_code = trim($_GET['event_code'] ?? '');
if ($event_code === '') { echo json_encode(null); exit; }

$sql = "SELECT event_id, event_code, event_name, timezone FROM events WHERE event_code=? LIMIT 1";
$stmt = $conn->prepare($sql);
$stmt->bind_param("s", $event_code);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();
$conn->close();

if (!$row) { echo json_encode(null); exit; }

// Ensure types
$row['event_id'] = (int)($row['event_id'] ?? 0);
$row['event_code'] = (string)($row['event_code'] ?? '');
$row['event_name'] = (string)($row['event_name'] ?? '');
$row['timezone'] = (string)($row['timezone'] ?? 'UTC');

echo json_encode($row);
