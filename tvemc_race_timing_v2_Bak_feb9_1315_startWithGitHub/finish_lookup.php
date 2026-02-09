<?php
// finish_lookup.php (LIVE VERSION) Jan22 - 15:25
// JSON for finish lookup page
//   ?log=1        -> full bib log (all passes)
//   ?finishers=1  -> only FINISH passes
// Optional:
//   ?event_code=KH_SOB_2026_0003

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

header('Content-Type: application/json');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) { http_response_code(500); echo json_encode(['success'=>false,'error'=>$conn->connect_error]); exit; }

$conn->set_charset('utf8mb4');

$event_code = trim($_GET['event_code'] ?? 'KH_SOB_2026_0003');
$want_log = isset($_GET['log']) && $_GET['log'] == '1';
$want_finishers = isset($_GET['finishers']) && $_GET['finishers'] == '1';

// Resolve event_id from events table
$event_id = 0;
$stmt = $conn->prepare("SELECT event_id FROM events WHERE event_code = ? LIMIT 1");
/* if (!$stmt) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'Prepare failed','details'=>$conn->error]);
  exit;
} */
$stmt->bind_param("s", $event_code);
$stmt->execute();
$stmt->bind_result($event_id);
$stmt->fetch();
$stmt->close();

if (!$event_id) {
  http_response_code(404);
  echo json_encode(['success'=>false,'error'=>'Unknown event_code','event_code'=>$event_code]);
  exit;
}

// Build query
$limit = 2000; // adjust if needed
$wherePass = "";
if ($want_finishers) $wherePass = " AND p.pass_type = 'FINISH' ";

$sql = "
  SELECT
    p.pass_id,
    p.bib,
    p.distance_code,
    p.pass_type AS action,
    p.pass_ts AS raw_timestamp,
    a.station_name,
    a.station_order,
    r.first_name,
    r.last_name,
    r.age,
    r.gender,
    r.distance_code AS runner_distance_code
  FROM passes p
  JOIN aid_stations a
    ON a.station_id = p.station_id
  LEFT JOIN runners r
    ON r.event_id = p.event_id AND r.bib = p.bib
  WHERE p.event_id = ?
  $wherePass
  ORDER BY p.pass_ts DESC
  LIMIT $limit
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'Prepare failed','details'=>$conn->error]);
  exit;
}

$stmt->bind_param("i", $event_id);
$stmt->execute();

$stmt->bind_result(
  $pass_id,
  $bib,
  $distance_code,
  $action,
  $raw_timestamp,
  $station_name,
  $station_order,
  $first_name,
  $last_name,
  $age,
  $gender,
  $runner_distance_code
);

$rows = [];
while ($stmt->fetch()) {
  /* Runner distance_code (preferred), otherwise pass distance_code */
  $dist = ($runner_distance_code && trim($runner_distance_code) !== "") ? $runner_distance_code : $distance_code;
  /*  //  $dist = $distance_code; */

  $rows[] = [
    "pass_id" => $pass_id,
    "bib" => (int)$bib,
    "action" => $action,
    "distance" => $dist,
    "distance_code" => $distance_code,
    "station" => $station_name,
    "station_order" => $station_order,
    "raw_timestamp" => $raw_timestamp,
    "first_name" => $first_name ?: "",
    "last_name"  => $last_name ?: "",
    "age" => $age ?: "",
    "gender" => $gender ?: "",
    "time" => "",
    "date" => ""
  ];
}

$stmt->close();
$conn->close();
echo json_encode($rows);
