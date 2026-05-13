<?php
// runners_count.php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode(["error" => "db_connect_failed"]);
  exit;
}
$conn->set_charset('utf8mb4');

$event_code = trim($_GET['event_code'] ?? 'AZM-300-2026-0004');
$station_code = strtoupper(trim($_GET['station_code'] ?? ''));

// Resolve event_id
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();

if (!$row) {
  echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code, "entrant_count"=>0]);
  $conn->close();
  exit;
}
$event_id = (int)$row['event_id'];

// Personnel / unknown station codes -> total entrants
if (!preg_match('/^(START|FINISH|T30K|AS\d+)$/', $station_code)) {
  $q = $conn->prepare("SELECT COUNT(*) AS c FROM runners WHERE event_id=?");
  $q->bind_param("i", $event_id);
  $q->execute();
  $c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
  $q->close();
  echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code, "entrant_count"=>$c]);
  $conn->close();
  exit;
}

// FINISH: use is_finish flag (best, distance-safe)
if ($station_code === "FINISH") {
  $sql = "
    SELECT COUNT(*) AS c
    FROM runners r
    WHERE r.event_id = ?
      AND EXISTS (
        SELECT 1
        FROM aid_stations a
        WHERE a.event_id = r.event_id
          AND a.distance_code = r.distance_code
          AND a.is_finish = 1
      )
  ";
  $q = $conn->prepare($sql);
  $q->bind_param("i", $event_id);
  $q->execute();
  $c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
  $q->close();
  echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code, "entrant_count"=>$c]);
  $conn->close();
  exit;
}

// START: show total entrants (simplest + least confusing)
if ($station_code === "START") {
  $q = $conn->prepare("SELECT COUNT(*) AS c FROM runners WHERE event_id=?");
  $q->bind_param("i", $event_id);
  $q->execute();
  $c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
  $q->close();
  echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code, "entrant_count"=>$c]);
  $conn->close();
  exit;
}

// Resolve station_name from DB using station_code or station_order, then count runners
// whose distance path includes that station.

// First try: look up by station_code column directly in aid_stations
$sn_q = $conn->prepare(
  "SELECT station_name FROM aid_stations WHERE event_id=? AND station_code=? LIMIT 1"
);
$sn_q->bind_param("is", $event_id, $station_code);
$sn_q->execute();
$sn_row = $sn_q->get_result()->fetch_assoc();
$sn_q->close();
$db_station_name = $sn_row ? trim($sn_row['station_name']) : null;

// Second try: for AS-style codes, fall back to lookup by station_order
if (!$db_station_name && preg_match('/^AS(\d+)$/', $station_code, $m)) {
  $order = (int)$m[1];
  $so_q = $conn->prepare(
    "SELECT station_name FROM aid_stations WHERE event_id=? AND station_order=? LIMIT 1"
  );
  $so_q->bind_param("ii", $event_id, $order);
  $so_q->execute();
  $so_row = $so_q->get_result()->fetch_assoc();
  $so_q->close();
  if ($so_row) $db_station_name = trim($so_row['station_name']);
}

if (!$db_station_name) {
  // No matching station found — return total entrants as a safe fallback
  $q = $conn->prepare("SELECT COUNT(*) AS c FROM runners WHERE event_id=?");
  $q->bind_param("i", $event_id);
  $q->execute();
  $c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
  $q->close();
  echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code, "entrant_count"=>$c]);
  $conn->close();
  exit;
}

// Count runners whose distance path includes this station (LIKE is forgiving for suffix variants)
$sql = "
  SELECT COUNT(*) AS c
  FROM runners r
  WHERE r.event_id = ?
    AND EXISTS (
      SELECT 1
      FROM aid_stations a
      WHERE a.event_id = r.event_id
        AND a.distance_code = r.distance_code
        AND a.station_name LIKE CONCAT('%', ?, '%')
    )
";
$q = $conn->prepare($sql);
$q->bind_param("is", $event_id, $db_station_name);
$q->execute();
$c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
$q->close();

echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code, "entrant_count"=>$c]);
$conn->close();
