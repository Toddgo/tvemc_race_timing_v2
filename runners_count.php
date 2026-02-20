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
  echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code=ALL, "entrant_count"=>0]);
  $conn->close();
  exit;
}
$event_id = (int)$row['event_id'];

// Personnel / unknown station codes -> total entrants (only runners with at least one pass)
if (!preg_match('/^(START|FINISH|T30K|AS\d+)$/', $station_code)) {
  $sql = "
    SELECT COUNT(DISTINCT r.bib) AS c
    FROM runners r
    WHERE r.event_id = ?
      AND EXISTS (
        SELECT 1 FROM passes p
        WHERE p.event_code = ?
          AND p.bib = r.bib
      )
  ";
  $q = $conn->prepare($sql);
  $q->bind_param("is", $event_id, $event_code);
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

// START: show total entrants who have started (at least one pass)
if ($station_code === "START") {
  $sql = "
    SELECT COUNT(DISTINCT r.bib) AS c
    FROM runners r
    WHERE r.event_id = ?
      AND EXISTS (
        SELECT 1 FROM passes p
        WHERE p.event_code = ?
          AND p.bib = r.bib
      )
  ";
  $q = $conn->prepare($sql);
  $q->bind_param("is", $event_id, $event_code);
  $q->execute();
  $c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
  $q->close();
  echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code, "entrant_count"=>$c]);
  $conn->close();
  exit;
}

// Map station_code -> station_name pattern (distance-safe)
$pattern = null;
switch ($station_code) {
  case "AS1": $pattern = "CORRAL CANYON #1"; break;
  case "AS2": $pattern = "KANAN ROAD #1"; break;
  case "T30K": $pattern = "TURNAROUND"; break;
  case "AS4": $pattern = "ZUMA EDISON RIDGE MTWY #1"; break;
  case "AS5": $pattern = "BONSALL"; break;
  case "AS6": $pattern = "ZUMA EDISON RIDGE MTWY #2"; break;
  case "AS7": $pattern = "KANAN ROAD #2"; break;
  case "AS8": $pattern = "CORRAL CANYON #2"; break;
  case "AS9": $pattern = "BULLDOG"; break;
  case "AS10": $pattern = "CORRAL CANYON #3"; break;
  case "AS11": $pattern = "PIUMA CREEK"; break;
}

if (!$pattern) {
  // fallback total entrants (only runners with at least one pass)
  $sql = "
    SELECT COUNT(DISTINCT r.bib) AS c
    FROM runners r
    WHERE r.event_id = ?
      AND EXISTS (
        SELECT 1 FROM passes p
        WHERE p.event_code = ?
          AND p.bib = r.bib
      )
  ";
  $q = $conn->prepare($sql);
  $q->bind_param("is", $event_id, $event_code);
  $q->execute();
  $c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
  $q->close();
  echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code, "entrant_count"=>$c]);
  $conn->close();
  exit;
}

// Count expected here by station_name match (LIKE is forgiving for "(NO AID)" variants)
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
$q->bind_param("is", $event_id, $pattern);
$q->execute();
$c = (int)($q->get_result()->fetch_assoc()['c'] ?? 0);
$q->close();

echo json_encode(["event_code"=>$event_code, "station_code"=>$station_code, "entrant_count"=>$c]);
$conn->close();
