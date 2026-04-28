<?php
// passes_submit.php (Option A mismatch storage) Jan28
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

$config = include __DIR__ . '/config.race.php';

$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'DB connect failed','details'=>$conn->connect_error]);
  exit;
}
$conn->set_charset('utf8mb4');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['success'=>false,'error'=>'Method not allowed']);
  exit;
}

$data = json_decode(file_get_contents('php://input'), true) ?: [];

// Normalize human-readable distance labels to canonical codes so they match aid_stations.distance_code
function canonicalDistanceCode($d) {
  // Strip ALL internal whitespace so "50 K" → "50K", "50 M" → "50M", etc.
  $x = strtoupper(preg_replace('/\s+/', '', trim((string)($d ?? ''))));
  if (!$x) return (string)$d;
  if (in_array($x, ['20M','20MI','20MILE','20MILES'])) return '20M';
  if (in_array($x, ['50MILER','50MI','50M'])) return '50M';
  if ($x === '50K') return '50K';
  if ($x === '30K') return '30K';
  if (in_array($x, ['26.2','MARATHON'])) return '26.2';
  if ($x === '100K') return '100K';
  if (in_array($x, ['100M','100MI','100MILE','100MILES','100MILER'])) return '100M';
  if (in_array($x, ['200M','200MI','200MILE','200MILES'])) return '200M';
  if (in_array($x, ['240M','240MI','240MILE','240MILES'])) return '240M';
  if (in_array($x, ['300M','300MI','300MILE','300MILES'])) return '300M';
  return (string)$d;
}

// required
$event_code    = trim($data['event_code'] ?? 'AZM-300-2026-0004');
$bib           = (int)($data['bib'] ?? 0);
$distance_code = canonicalDistanceCode(trim($data['distance_code'] ?? ''));
$pass_type     = strtoupper(trim($data['pass_type'] ?? 'IN'));
$station_code  = trim($data['station_code'] ?? '');
$operator      = trim($data['operator'] ?? '');
$note          = trim($data['note'] ?? '');
// Optional station_order hint sent by the client to disambiguate multi-pass stations
// (e.g. Junction visited twice in the 20M course has the same station_code but
// different station_orders). When provided, it is used to select the correct station_id.
$station_order_hint = (isset($data['station_order']) && is_numeric($data['station_order']))
  ? (int)$data['station_order'] : null;

// timestamp: store UTC
$pass_ts = gmdate('Y-m-d H:i:s');

if ($bib <= 0 || $distance_code === '' || $station_code === '') {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Missing bib, distance_code, or station_code']);
  exit;
}

// ---------- resolve event_id ----------
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=?");
if (!$st) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'Prepare failed (event lookup)','details'=>$conn->error]);
  exit;
}
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();

if (!$row) {
  http_response_code(400);
  echo json_encode(['success'=>false,'error'=>'Unknown event_code','event_code'=>$event_code]);
  exit;
}
$event_id = (int)$row['event_id'];

// ---------- station resolution (v2: station_code + mismatch support) ----------

$scode = strtoupper(trim($station_code));

// Defaults for mismatch logic
$is_mismatch  = 0;
$warning      = null;
$station_id   = 0;
$station_name = null;

// Detect whether aid_stations.station_code exists
$has_station_code = false;
$chk = $conn->query("SHOW COLUMNS FROM aid_stations LIKE 'station_code'");
if ($chk && $chk->num_rows > 0) $has_station_code = true;

// Helper: resolve by station_code if present, else fallback to station_name matching (legacy)
if ($has_station_code) {

  // 1) Canonical station for this event regardless of distance (exists?)
  //    - START: station_order=0
  //    - FINISH: is_finish=1
  //    - else: station_code match
  $q1 = $conn->prepare("
    SELECT station_id, station_name, distance_code
    FROM aid_stations
    WHERE event_id = ?
      AND (
        ( ? = 'START'  AND station_order = 0 )
        OR ( ? = 'FINISH' AND is_finish = 1 )
        OR (station_code = ?)
      )
    LIMIT 1
  ");
  if (!$q1) {
    http_response_code(500);
    echo json_encode(['success'=>false,'error'=>'Prepare failed (station_code lookup)','details'=>$conn->error]);
    exit;
  }
  $q1->bind_param("isss", $event_id, $scode, $scode, $scode);
  $q1->execute();
  $station_row = $q1->get_result()->fetch_assoc();
  $q1->close();

  if (!$station_row) {
    http_response_code(400);
    echo json_encode(['success'=>false,'error'=>'Unknown station_code','station_code'=>$station_code]);
    exit;
  }

  $station_name = (string)($station_row['station_name'] ?? '');
  $station_id_any = (int)($station_row['station_id'] ?? 0);

  // 2) Is it valid for this distance?
  // Fetch ALL stations for this event sharing this station_code, then compare distances
  // using canonicalDistanceCode() on both sides to tolerate format differences in the DB
  // (e.g. "50 K" in aid_stations vs "50K" sent by the client).
  $q2 = $conn->prepare("
    SELECT station_id, distance_code
    FROM aid_stations
    WHERE event_id = ?
      AND (
        ( ? = 'START'  AND station_order = 0 )
        OR ( ? = 'FINISH' AND is_finish = 1 )
        OR (station_code = ?)
      )
  ");
  if (!$q2) {
    http_response_code(500);
    echo json_encode(['success'=>false,'error'=>'Prepare failed (distance station lookup)','details'=>$conn->error]);
    exit;
  }
  $q2->bind_param("isss", $event_id, $scode, $scode, $scode);
  $q2->execute();
  $q2_rows = $q2->get_result()->fetch_all(MYSQLI_ASSOC);
  $q2->close();

  // Find the station row for this distance.
  // When station_order_hint is provided (sent by the client to disambiguate multi-pass
  // stations like Junction visited twice), prefer the row with the matching station_order.
  // Otherwise fall back to the first distance match (existing behaviour).
  $station_for_dist = null;
  foreach ($q2_rows as $q2row) {
    if (canonicalDistanceCode((string)($q2row['distance_code'] ?? '')) === $distance_code) {
      if ($station_order_hint !== null && (int)$q2row['station_order'] === $station_order_hint) {
        // Exact occurrence match — use this and stop looking.
        $station_for_dist = $q2row;
        break;
      } elseif ($station_for_dist === null) {
        // Save as fallback (first distance match); keep scanning for exact hint match.
        $station_for_dist = $q2row;
        if ($station_order_hint === null) break; // no hint — first match is sufficient
      }
    }
  }

  if (!$station_for_dist) {
    // The submitted station_code is not in this runner's distance.
    // Before flagging off-course, check whether the physical location
    // (station_name) appears in the runner's distance under a different
    // station_code — e.g. device left on AS15 (50M Hwy 168) while a
    // 20M runner passes through (correct location, wrong device code).
    $q_autofix = $conn->prepare("
      SELECT station_id FROM aid_stations
      WHERE event_id     = ?
        AND distance_code = ?
        AND station_name  = ?
      ORDER BY station_order ASC
      LIMIT 1
    ");
    $autofix_station_id = null;
    if ($q_autofix) {
      $q_autofix->bind_param("iss", $event_id, $distance_code, $station_name);
      $q_autofix->execute();
      $autofix_row = $q_autofix->get_result()->fetch_assoc();
      $q_autofix->close();
      if ($autofix_row) {
        $autofix_station_id = (int)$autofix_row['station_id'];
      }
    }

    if ($autofix_station_id !== null) {
      // Same physical location exists in the runner's distance — auto-correct.
      // No mismatch: the runner was on course; the device code was wrong.
      $station_id = $autofix_station_id;
    } else {
      // Station name is genuinely not in this runner's distance: flag off-course.
      $is_mismatch = 1;
      $warning = 'RUNNER OFF COURSE';
      $station_id = $station_id_any;
    }
  } else {
    $station_id = (int)$station_for_dist['station_id'];
  }

} else {

  // ---------- Legacy fallback (your current mapping approach) ----------
  // Keep this ONLY until station_code exists in the table.

  $STATION_CODE_TO_NAME = [
    'AS1'  => 'CORRAL CANYON #1',
    'AS2'  => 'KANAN ROAD #1',
    'AS4'  => 'ZUMA EDISON RIDGE MTWY #1',
    'AS5'  => 'BONSALL',
    'AS6'  => 'ZUMA EDISON RIDGE MTWY #2',
    'AS7'  => 'KANAN ROAD #2',
    'AS8'  => 'CORRAL CANYON #2',
    'AS9'  => '100K TURNAROUND - BULLDOG',
    'AS10' => 'CORRAL CANYON #3',
    'AS11' => 'PIUMA CREEK',
    'T30K' => 'TURNAROUND SPOT (30K NO AID)',
  ];

  // Allow START alias (legacy race-day convenience)
  if ($scode === 'START') {
    $scode = 'AS1';
  }

  if ($scode === 'FINISH') {

    $q = $conn->prepare("
      SELECT station_id, station_name
      FROM aid_stations
      WHERE event_id = ?
        AND distance_code = ?
        AND is_finish = 1
      LIMIT 1
    ");
    if (!$q) {
      http_response_code(500);
      echo json_encode(['success'=>false,'error'=>'Prepare failed (finish lookup)','details'=>$conn->error]);
      exit;
    }
    $q->bind_param("is", $event_id, $distance_code);
    $q->execute();
    $r = $q->get_result()->fetch_assoc();
    $q->close();

    if (!$r) {
      http_response_code(400);
      echo json_encode(['success'=>false,'error'=>'Finish station not found','distance_code'=>$distance_code]);
      exit;
    }

    $station_id = (int)$r['station_id'];
    $station_name = (string)($r['station_name'] ?? 'FINISH');

  } elseif (isset($STATION_CODE_TO_NAME[$scode])) {

    $station_name = $STATION_CODE_TO_NAME[$scode];

    // 1) Station exists regardless of distance
    $q1 = $conn->prepare("
      SELECT station_id
      FROM aid_stations
      WHERE event_id = ?
        AND station_name = ?
      LIMIT 1
    ");
    if (!$q1) {
      http_response_code(500);
      echo json_encode(['success'=>false,'error'=>'Prepare failed (station_code lookup)','details'=>$conn->error]);
      exit;
    }
    $q1->bind_param("is", $event_id, $station_name);
    $q1->execute();
    $station_row = $q1->get_result()->fetch_assoc();
    $q1->close();

    if (!$station_row) {
      http_response_code(400);
      echo json_encode(['success'=>false,'error'=>'Unknown station_code','station_code'=>$station_code]);
      exit;
    }

    // 2) Station valid for this distance
    $q2 = $conn->prepare("
      SELECT station_id
      FROM aid_stations
      WHERE event_id = ?
        AND distance_code = ?
        AND station_name = ?
      LIMIT 1
    ");
    if (!$q2) {
      http_response_code(500);
      echo json_encode(['success'=>false,'error'=>'Prepare failed (distance station lookup)','details'=>$conn->error]);
      exit;
    }
    $q2->bind_param("iss", $event_id, $distance_code, $station_name);
    $q2->execute();
    $r = $q2->get_result()->fetch_assoc();
    $q2->close();

    if (!$r) {
      $is_mismatch = 1;
      $warning = 'RUNNER OFF COURSE';
      $station_id = (int)$station_row['station_id'];
    } else {
      $station_id = (int)$r['station_id'];
    }

  } else {
    http_response_code(400);
    echo json_encode(['success'=>false,'error'=>'Unknown station_code','station_code'=>$station_code]);
    exit;
  }
}

// ---------- insert pass ----------
$stmt = $conn->prepare("
  INSERT INTO passes
    (event_id, bib, distance_code, station_id, pass_type, pass_ts, operator, note, mismatch)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
");
if (!$stmt) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'Prepare failed (insert)','details'=>$conn->error]);
  exit;
}

$stmt->bind_param(
  "iisissssi",
  $event_id,
  $bib,
  $distance_code,
  $station_id,
  $pass_type,
  $pass_ts,
  $operator,
  $note,
  $is_mismatch
);

if (!$stmt->execute()) {
  http_response_code(500);
  echo json_encode(['success'=>false,'error'=>'Insert failed','details'=>$stmt->error]);
  $stmt->close();
  exit;
}

$pass_id = (int)$stmt->insert_id;
$stmt->close();

// Return ISO string in the EVENT timezone for UI
function toIsoEvent_fromUtcLike($ts, $tz) {
  if (!$ts) return null;
  $tz = $tz ?: 'UTC';
  try {
    $dt = new DateTime($ts, new DateTimeZone('UTC'));
    $dt->setTimezone(new DateTimeZone($tz));
    return $dt->format('c');
  } catch (Exception $e) {
    return null;
  }
}

// Look up event timezone once (so AZM Phoenix just works)
$event_tz = 'UTC';
$tq = $conn->prepare("SELECT timezone FROM events WHERE event_id=? LIMIT 1");
if ($tq) {
  $tq->bind_param("i", $event_id);
  $tq->execute();
  $tr = $tq->get_result()->fetch_assoc();
  $tq->close();
  if ($tr && !empty($tr['timezone'])) $event_tz = trim((string)$tr['timezone']);
}

echo json_encode([
  'success'        => true,
  'mismatch'       => ($is_mismatch === 1),
  'warning'        => $warning,
  'distance_code'  => $distance_code,
  'station_code'   => $scode,
  'station_name'   => $station_name,
  'pass_id'        => $pass_id,
  'pass_ts'        => toIsoEvent_fromUtcLike($pass_ts, $event_tz),
  'event_timezone' => $event_tz,
  'pass_ts_utc'    => $pass_ts
]);
$conn->close();
exit;
