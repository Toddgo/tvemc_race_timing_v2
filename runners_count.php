<?php
// runners_count.php
ob_start();
@ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  ob_clean();
  http_response_code(500);
  echo json_encode(["error" => "db_connect_failed"]);
  exit;
}
$conn->set_charset('utf8mb4');

$event_code   = trim($_GET['event_code']   ?? '');
$station_code = strtoupper(trim($_GET['station_code'] ?? ''));

if ($event_code === '') {
  ob_clean();
  http_response_code(400);
  echo json_encode(["error" => "missing_event_code"]);
  exit;
}

// Resolve event_id
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
$st->bind_param("s", $event_code);
$st->execute();
$evrow = $st->get_result()->fetch_assoc();
$st->close();

if (!$evrow) {
  ob_clean();
  echo json_encode(["event_code" => $event_code, "station_code" => $station_code, "entrant_count" => 0]);
  $conn->close();
  exit;
}
$event_id = (int)$evrow['event_id'];

// ------------------------------------------------------------------
// Baseline = ALL REGISTERED RUNNERS for this event.
// DNS / DNF / Finish subtraction is done client-side in results_strip.js.
// ------------------------------------------------------------------

// Personnel / HQ / unknown station codes → total registered runners
if (!preg_match('/^(START|FINISH|T30K|AS\d+)$/', $station_code)) {
  $q = $conn->prepare("SELECT COUNT(*) AS c FROM runners WHERE event_id=?");
  $q->bind_param("i", $event_id);
  $q->execute();
  $c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
  $q->close();
  ob_clean();
  echo json_encode(["event_code" => $event_code, "station_code" => $station_code, "entrant_count" => $c]);
  $conn->close();
  exit;
}

// START → total registered runners (all are expected to start)
if ($station_code === 'START') {
  $q = $conn->prepare("SELECT COUNT(*) AS c FROM runners WHERE event_id=?");
  $q->bind_param("i", $event_id);
  $q->execute();
  $c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
  $q->close();
  ob_clean();
  echo json_encode(["event_code" => $event_code, "station_code" => $station_code, "entrant_count" => $c]);
  $conn->close();
  exit;
}

// FINISH → runners whose distance has a finish station
if ($station_code === 'FINISH') {
  $sql = "
    SELECT COUNT(*) AS c
    FROM runners r
    WHERE r.event_id = ?
      AND EXISTS (
        SELECT 1 FROM aid_stations a
        WHERE a.event_id       = r.event_id
          AND a.distance_code  = r.distance_code
          AND a.is_finish      = 1
      )
  ";
  $q = $conn->prepare($sql);
  $q->bind_param("i", $event_id);
  $q->execute();
  $c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
  $q->close();
  ob_clean();
  echo json_encode(["event_code" => $event_code, "station_code" => $station_code, "entrant_count" => $c]);
  $conn->close();
  exit;
}

// AS stations (T30K, AS1 … AS99) → registered runners whose distance includes this station
$sql = "
  SELECT COUNT(*) AS c
  FROM runners r
  WHERE r.event_id = ?
    AND EXISTS (
      SELECT 1 FROM aid_stations a
      WHERE a.event_id      = r.event_id
        AND a.distance_code = r.distance_code
        AND a.station_code  = ?
    )
";
$q = $conn->prepare($sql);
$q->bind_param("is", $event_id, $station_code);
$q->execute();
$c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
$q->close();

ob_clean();
echo json_encode(["event_code" => $event_code, "station_code" => $station_code, "entrant_count" => $c]);
$conn->close();
