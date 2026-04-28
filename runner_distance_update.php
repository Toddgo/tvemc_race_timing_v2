<?php
// runner_distance_update.php
// Persists a distance change to the runners table.
// Called by updateDistance() in race_timing.js whenever an operator
// changes a runner's distance via the Change Distance popup.
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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['success'=>false,'error'=>'Method not allowed']);
  exit;
}

$data = json_decode(file_get_contents('php://input'), true) ?: [];

$event_code   = trim($data['event_code']   ?? '');
$bib          = (int)($data['bib']          ?? 0);
$new_distance = strtoupper(trim($data['new_distance'] ?? ''));

if (!$event_code || $bib <= 0 || !$new_distance) {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Missing event_code, bib, or new_distance']);
  exit;
}

// Resolve event_id
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
if (!$st) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'Prepare failed']);
  exit;
}
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();

if (!$row) {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Unknown event_code']);
  exit;
}
$event_id = (int)$row['event_id'];

// Check if prev_distance_code column exists (added by add_prev_distance_column.sql migration)
$has_prev = false;
$chk = $conn->query("SHOW COLUMNS FROM runners LIKE 'prev_distance_code'");
if ($chk && $chk->num_rows > 0) $has_prev = true;

if ($has_prev) {
  // Save old distance_code as prev_distance_code before overwriting
  $stmt = $conn->prepare(
    "UPDATE runners SET prev_distance_code=distance_code, distance_code=? WHERE event_id=? AND bib=?"
  );
  $stmt->bind_param("sii", $new_distance, $event_id, $bib);
} else {
  // Column not yet added — just update current distance
  $stmt = $conn->prepare("UPDATE runners SET distance_code=? WHERE event_id=? AND bib=?");
  $stmt->bind_param("sii", $new_distance, $event_id, $bib);
}

$ok       = $stmt->execute();
$affected = $stmt->affected_rows;
$stmt->close();
$conn->close();

echo json_encode(['success' => (bool)$ok, 'affected' => $affected]);
exit;
