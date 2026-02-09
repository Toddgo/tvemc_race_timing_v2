<?php
// results_config_load.php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode(["success"=>false]);
  exit;
}
$conn->set_charset('utf8mb4');

$event_code = trim($_GET['event_code'] ?? '');
if ($event_code === '') {
  echo json_encode(["success"=>false, "error"=>"Missing event_code"]);
  exit;
}

// added 07-01-2026_10:00
function toIsoLA($ts) {
  if (!$ts) return null;
  try {
    $dt = new DateTime($ts, new DateTimeZone('America/Los_Angeles'));
    return $dt->format('c'); // 2026-01-31T07:01:35-08:00
  } catch (Exception $e) {
    return null;
  }
}


/* Resolve event_id */
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();
if (!$row) {
  echo json_encode(["success"=>false, "error"=>"Event not found"]);
  exit;
}
$event_id = (int)$row['event_id'];

/* Distances + miles */
$dist = [];
$res = $conn->query("SELECT distance_code, distance_miles FROM event_distances WHERE event_id=$event_id");
while ($r = $res->fetch_assoc()) {
  $dist[$r['distance_code']] = (float)$r['distance_miles'];
}

/* Start times */
    $starts = [];
    $res = $conn->query("SELECT distance_code, start_ts FROM event_start_times WHERE event_id=$event_id");
    while ($r = $res->fetch_assoc()) {
      $code = $r['distance_code'];
      $ts   = $r['start_ts'];
    
      $starts[$code] = $ts;              // keep raw (backward compatible)
      $starts_iso[$code] = toIsoLA($ts); // ✅ new ISO-safe value

}

/* Runner overrides */
$runnerStarts = [];
$res = $conn->query("SELECT bib, start_ts_actual FROM runner_starts WHERE event_id=$event_id");
while ($r = $res->fetch_assoc()) {
  $runnerStarts[(string)$r['bib']] = $r['start_ts_actual'];
}

$conn->close();

echo json_encode([
  "success" => true,
  "event_id" => $event_id,
  "distances" => $dist,
  "start_times" => $starts,          // existing behavior
  "start_times_iso" => $starts_iso,  // ✅ new, correct
  "runner_starts" => $runnerStarts,
  "runner_starts_iso" => $runnerStarts_iso
]);
