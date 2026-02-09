<?php
// runners_load.php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'DB connect failed']);
  exit;
}

$event_code = trim($_GET['event_code'] ?? 'AZM-300-2026-0004');   // KH_SOB_2026_TEST

$ev = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
$ev->bind_param("s", $event_code);
$ev->execute();
$event = $ev->get_result()->fetch_assoc();
$ev->close();

if (!$event) {
  http_response_code(404);
  echo json_encode(['success'=>false,'error'=>'Unknown event_code']);
  exit;
}
$event_id = (int)$event['event_id'];

// Return fields in the SAME names your JS expects (bib, firstName, lastName, etc.)
$sql = "SELECT
          bib AS bib,
          first_name AS firstName,
          last_name AS lastName,
          age AS age,
          gender AS gender,
          distance_code AS distance,
          '' AS previousDistance
        FROM runners
        WHERE event_id=?
        ORDER BY bib ASC";

$stmt = $conn->prepare($sql);
$stmt->bind_param("i", $event_id);
$stmt->execute();
$res = $stmt->get_result();

$out = [];
while ($row = $res->fetch_assoc()) $out[] = $row;

$stmt->close();
$conn->close();

echo json_encode($out);
