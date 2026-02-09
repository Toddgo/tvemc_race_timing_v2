<?php
// start_times_save.php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

date_default_timezone_set('America/Los_Angeles');

$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) { http_response_code(500); echo json_encode(["success"=>false, "error"=>"DB connect failed"]); exit; }
$conn->set_charset('utf8mb4');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(["success"=>false,"error"=>"POST required"]);
  exit;
}

$raw = file_get_contents("php://input");
$data = json_decode($raw, true);
if (!$data || !isset($data['event_code']) || !isset($data['times'])) {
  http_response_code(400);
  echo json_encode(["success"=>false,"error"=>"Bad JSON"]);
  exit;
}

$event_code = trim($data['event_code']);
$times = $data['times'];
$set_by = trim($data['set_by'] ?? '');

if ($event_code === '' || !is_array($times)) {
  http_response_code(400);
  echo json_encode(["success"=>false,"error"=>"Missing fields"]);
  exit;
}

// Normalize incoming timestamps to "YYYY-MM-DD HH:MM:SS" in America/Los_Angeles
function normalizeToLA($tsRaw) {
  $tsRaw = trim((string)$tsRaw);
  if ($tsRaw === '') return '';

  // Accept "YYYY-MM-DD HH:MM:SS" (no TZ) as LA wall-clock
  // Accept ISO strings too and convert to LA
  try {
    if (strpos($tsRaw, 'T') !== false || preg_match('/[zZ]|[+\-]\d\d:\d\d$/', $tsRaw)) {
      // ISO or timezone-aware string
      $dt = new DateTime($tsRaw);
      $dt->setTimezone(new DateTimeZone('America/Los_Angeles'));
      return $dt->format('Y-m-d H:i:s');
    }

    // "YYYY-MM-DD HH:MM:SS" style; treat as LA local
    $dt = new DateTime($tsRaw, new DateTimeZone('America/Los_Angeles'));
    return $dt->format('Y-m-d H:i:s');

  } catch (Exception $e) {
    return '';
  }
}

// event_id
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();
if (!$row) {
  echo json_encode(["success"=>false,"error"=>"Unknown event_code"]);
  exit;
}
$event_id = (int)$row['event_id'];

$conn->begin_transaction();

try {
  $stmt = $conn->prepare("
    INSERT INTO event_start_times (event_id, distance_code, start_ts, set_by)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE start_ts=VALUES(start_ts), set_by=VALUES(set_by)
  ");

  $saved = 0;
  $skipped = 0;

  foreach ($times as $distance_code => $start_ts) {
    $dc = trim((string)$distance_code);
    if ($dc === '') { $skipped++; continue; }

    $ts = normalizeToLA($start_ts);
    if ($ts === '') { $skipped++; continue; }

    $stmt->bind_param("isss", $event_id, $dc, $ts, $set_by);
    $stmt->execute();
    $saved++;
  }

  $stmt->close();
  $conn->commit();
  echo json_encode(["success"=>true,"saved"=>$saved,"skipped"=>$skipped]);
} catch (Exception $e) {
  $conn->rollback();
  http_response_code(500);
  echo json_encode(["success"=>false,"error"=>$e->getMessage()]);
}

$conn->close();
