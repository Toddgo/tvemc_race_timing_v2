<?php
// passes_last_seen.php — Returns the most recent IN passes for a given station.
// Used by the "Last Seen Here" open-list popup in results_strip.js.
// Params: event_code (string), station (station_code string), limit (int, default 50)
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'DB connect failed']);
  exit;
}
$conn->set_charset('utf8mb4');

$event_code   = trim($_GET['event_code'] ?? '');
$station_code = trim($_GET['station'] ?? '');
$limit        = max(1, min(500, (int)($_GET['limit'] ?? 50)));

if ($event_code === '') {
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Missing event_code']);
  exit;
}

// Resolve event_id
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code = ? LIMIT 1");
$st->bind_param("s", $event_code);
$st->execute();
$er = $st->get_result()->fetch_assoc();
$st->close();

if (!$er) {
  http_response_code(400);
  echo json_encode(['success' => false, 'error' => 'Unknown event_code']);
  exit;
}
$event_id = (int)$er['event_id'];

// Build query.  When a station_code is provided, restrict to that station only.
// Use a LEFT JOIN so that pass rows with a missing aid_stations record still appear.
if ($station_code !== '') {
  $sql = "
    SELECT
      p.bib,
      p.distance_code,
      a.station_name,
      a.station_code,
      p.pass_type,
      p.pass_ts,
      p.operator,
      p.note,
      COUNT(*) OVER (PARTITION BY p.bib, a.station_id) AS pass_count
    FROM passes p
    LEFT JOIN aid_stations a ON a.station_id = p.station_id
    WHERE p.event_id = ?
      AND a.station_code = ?
      AND p.pass_type NOT IN ('DNS', 'DNF')
    ORDER BY p.pass_ts DESC, p.pass_id DESC
    LIMIT ?
  ";
  $q = $conn->prepare($sql);
  $q->bind_param("isi", $event_id, $station_code, $limit);
} else {
  // No station filter — return most-recent passes for the event
  $sql = "
    SELECT
      p.bib,
      p.distance_code,
      a.station_name,
      a.station_code,
      p.pass_type,
      p.pass_ts,
      p.operator,
      p.note,
      COUNT(*) OVER (PARTITION BY p.bib, a.station_id) AS pass_count
    FROM passes p
    LEFT JOIN aid_stations a ON a.station_id = p.station_id
    WHERE p.event_id = ?
      AND p.pass_type NOT IN ('DNS', 'DNF')
    ORDER BY p.pass_ts DESC, p.pass_id DESC
    LIMIT ?
  ";
  $q = $conn->prepare($sql);
  $q->bind_param("ii", $event_id, $limit);
}

if (!$q) {
  http_response_code(500);
  echo json_encode(['success' => false, 'error' => 'Prepare failed: ' . $conn->error]);
  exit;
}

$q->execute();
$res = $q->get_result();
$rows = [];
while ($row = $res->fetch_assoc()) {
  $rows[] = [
    'bib'           => (int)$row['bib'],
    'distance_code' => (string)($row['distance_code'] ?? ''),
    'station_name'  => (string)($row['station_name'] ?? ''),
    'station_code'  => (string)($row['station_code'] ?? ''),
    'pass_type'     => (string)($row['pass_type'] ?? ''),
    'pass_ts'       => (string)($row['pass_ts'] ?? ''),
    'operator'      => (string)($row['operator'] ?? ''),
    'note'          => (string)($row['note'] ?? ''),
    'pass_count'    => (int)($row['pass_count'] ?? 1),
  ];
}
$q->close();
$conn->close();

echo json_encode(['success' => true, 'rows' => $rows]);
exit;
