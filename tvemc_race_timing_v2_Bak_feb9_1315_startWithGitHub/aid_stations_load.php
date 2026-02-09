<?php
// aid_station_load.php Feb 6, 2026 10:00 (v2 safe + future-proof)
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) { http_response_code(500); echo json_encode([]); exit; }
$conn->set_charset('utf8mb4');

$event_code = trim($_GET['event_code'] ?? '');
if ($event_code === '') { echo json_encode([]); exit; }

// resolve event_id
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();
if (!$row) { echo json_encode([]); exit; }
$event_id = (int)$row['event_id'];

// Detect whether aid_stations.station_code exists (so we don’t break older schemas)
$has_station_code = false;
$chk = $conn->query("SHOW COLUMNS FROM aid_stations LIKE 'station_code'");
if ($chk && $chk->num_rows > 0) $has_station_code = true;

// Build SQL safely depending on schema
$sql = "
  SELECT
    station_id,
    distance_code,
    station_order,
    station_name,
    mile,
    is_aid,
    is_finish" .
    ($has_station_code ? ", station_code" : "") . "
  FROM aid_stations
  WHERE event_id = ?
  ORDER BY distance_code ASC, station_order ASC
";

$stmt = $conn->prepare($sql);
$stmt->bind_param("i", $event_id);
$stmt->execute();
$res = $stmt->get_result();

$out = [];
while ($r = $res->fetch_assoc()) {
  // Type normalization (optional but nice)
  $r['station_id'] = (int)($r['station_id'] ?? 0);
  $r['station_order'] = (int)($r['station_order'] ?? 0);
  $r['mile'] = isset($r['mile']) ? (float)$r['mile'] : 0.0;
  $r['is_aid'] = (int)($r['is_aid'] ?? 0);
  $r['is_finish'] = (int)($r['is_finish'] ?? 0);

  // If station_code exists in DB and is non-empty, use it.
  $dbCode = trim((string)($r['station_code'] ?? ''));
  if ($dbCode !== '') {
    $r['station_code'] = $dbCode;
  } else {
    // Fallback: derive station_code from order/finish flag (today’s behavior)
    $order = (int)$r['station_order'];
    if ($order === 0) $r['station_code'] = 'START';
    else if ($order >= 999 || (int)$r['is_finish'] === 1) $r['station_code'] = 'FINISH';
    else $r['station_code'] = 'AS' . $order;
  }

  $out[] = $r;
}

$stmt->close();
$conn->close();

echo json_encode($out);
