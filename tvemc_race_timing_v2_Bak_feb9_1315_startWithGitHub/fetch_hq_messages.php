<?php
// fetch_hq_messages.php
// Used by aid station pages to pull NEW, PENDING messages from HQ

header('Content-Type: application/json');

// TEMP: show errors while we debug (remove in production)
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// 1) Connect to DB using local config.race.php (same folder)
$configFile = __DIR__ . '/config.race.php';

if (!file_exists($configFile)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'No config.race.php found in race_timing']);
    exit;
}

$cfg = include $configFile;

$conn = new mysqli($cfg['host'], $cfg['username'], $cfg['password'], $cfg['dbname']);
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'DB connect failed: ' . $conn->connect_error]);
    exit;
}

// 2) Read query parameters
$station = isset($_GET['station']) ? trim($_GET['station']) : '';
if ($station === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing station parameter']);
    $conn->close();
    exit;
}

$event_code = trim($_GET['event_code'] ?? '');
if ($event_code === '') {
    http_response_code(400);
    echo json_encode(['success'=>false,'error'=>'Missing event_code']);
    $conn->close();
    exit;
}

// Resolve event_id from event_code
$st = $conn->prepare("SELECT event_id FROM events WHERE event_code=?");
if (!$st) {
    http_response_code(500);
    echo json_encode(['success'=>false,'error'=>'Prepare failed (events lookup): '.$conn->error]);
    $conn->close();
    exit;
}
$st->bind_param("s", $event_code);
$st->execute();
$row = $st->get_result()->fetch_assoc();
$st->close();

if (!$row) {
    http_response_code(400);
    echo json_encode(['success'=>false,'error'=>'Unknown event_code','event_code'=>$event_code]);
    $conn->close();
    exit;
}
$event_id = (int)$row['event_id'];

// 3) AUTO mailbox expansion (station inbox sees messages for itself + its physical instances + ALL)
$AUTO_INBOX_EXPAND = [
    'CORRAL_AUTO' => ['AS1', 'AS8', 'AS10'],
    'KANAN_AUTO'  => ['AS2', 'AS7'],
    'ZUMA_AUTO'   => ['AS4', 'AS6'],
];

// Build list of acceptable station_target values for this inbox
$targets = [$station, 'ALL'];
if (isset($AUTO_INBOX_EXPAND[$station])) {
    // Also accept messages targeted to the physical instances
    foreach ($AUTO_INBOX_EXPAND[$station] as $t) {
        $targets[] = $t;
    }
}

// De-dupe targets
$targets = array_values(array_unique($targets));

// 4) Query pending messages
$limit = 10;

// Build placeholders for IN clause
// Example: station_target IN (?, ?, ?, ?)
$inPlaceholders = implode(',', array_fill(0, count($targets), '?'));

$sql = "
  SELECT
    id,
    event_id,
    station_target,
    channel,
    message_text,
    operator,
    msg_number,
    acknowledged,
    ack_time,
    created_at
  FROM hq_messages
  WHERE
    event_id = ?
    AND station_target IN ($inPlaceholders)
    AND acknowledged = 0
  ORDER BY id ASC
  LIMIT ?
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Prepare failed: ' . $conn->error]);
    $conn->close();
    exit;
}

// Bind params dynamically: event_id (int) + targets (strings...) + limit (int)
$types = "i" . str_repeat("s", count($targets)) . "i";
$params = array_merge([$event_id], $targets, [$limit]);

// mysqli bind_param needs references
$bindNames = [];
$bindNames[] = $types;
for ($i = 0; $i < count($params); $i++) {
    $bindNames[] = &$params[$i];
}

call_user_func_array([$stmt, 'bind_param'], $bindNames);

if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Execute failed: ' . $stmt->error]);
    $stmt->close();
    $conn->close();
    exit;
}

// ✅ IMPORTANT: do NOT re-prepare again (this was your bug)
$result = $stmt->get_result();
$messages = [];

while ($r = $result->fetch_assoc()) {
    $messages[] = $r;
}

$stmt->close();
$conn->close();

echo json_encode([
    'success'  => true,
    'messages' => $messages,
    // helpful while debugging (remove later)
    'debug' => [
        'station' => $station,
        'targets' => $targets,
        'event_id' => $event_id,
        'limit' => $limit
    ]
]);
