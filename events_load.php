<?php
// events_load.php Feb 6, 2026 10:00
ob_start(); // buffer any stray PHP output so it never corrupts the JSON response
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) { ob_end_clean(); http_response_code(500); echo json_encode(null); exit; }
$conn->set_charset('utf8mb4');

$event_code = trim($_GET['event_code'] ?? '');
if ($event_code === '') { ob_end_clean(); echo json_encode(null); exit; }

$sql = "SELECT event_id, event_code, event_name, timezone FROM events WHERE event_code=? LIMIT 1";
$stmt = $conn->prepare($sql);
if (!$stmt) { ob_end_clean(); echo json_encode(null); exit; }
$stmt->bind_param("s", $event_code);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();
$conn->close();

if (!$row) { ob_end_clean(); echo json_encode(null); exit; }

// Ensure types
$row['event_id'] = (int)($row['event_id'] ?? 0);
$row['event_code'] = (string)($row['event_code'] ?? '');
$row['event_name'] = (string)($row['event_name'] ?? '');
$row['timezone'] = (string)($row['timezone'] ?? 'UTC');

ob_end_clean();
echo json_encode($row);
