<?php
// ----- CORS (allow your public page + local testing) -----
$allowed = [
  'https://tvemc.org',
  'https://commtrailer.duckdns.org'
  'https://tvemcdb.tail4a524f.ts.net',
  'http://localhost',
  'http://127.0.0.1',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed, true)) {
  header("Access-Control-Allow-Origin: $origin");
} else {
  header("Access-Control-Allow-Origin: *"); // safe for now at the event
}
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

header('Content-Type: application/json');
error_reporting(E_ALL);
ini_set('display_errors', 1);

// ----- Load config (works with constants or array return) -----
// ----- Load DEV config first -----
$cfgPath = '/var/www/html/orgs/kh-races_dev/ray-miller-50-50/config.race.php';
if (file_exists($cfgPath)) {
    $cfg = include $cfgPath;
} else {
    $cfg = @include __DIR__ . '/config.1.3.3.php';
}

// Verify we got the dev config array
if (!is_array($cfg)) {
    http_response_code(500);
    echo json_encode(['error' => 'Config load failed']);
    exit;
}

$host = defined('DB_HOST') ? DB_HOST : ($cfg['servername'] ?? '127.0.0.1');
$user = defined('DB_USER') ? DB_USER : ($cfg['username']   ?? '');
$pass = defined('DB_PASS') ? DB_PASS : ($cfg['password']   ?? '');
$name = defined('DB_NAME') ? DB_NAME : ($cfg['dbname']     ?? '');
$charset = $cfg['charset'] ?? 'utf8mb4';

// ----- Connect -----
mysqli_report(MYSQLI_REPORT_OFF);
$conn = @new mysqli($host, $user, $pass, $name);
if ($conn->connect_errno) {
  http_response_code(500);
  echo json_encode(['error' => 'DB connect failed: '.$conn->connect_error]);
  exit;
}
$conn->set_charset($charset);

// ----- GET: return rows for the table (latest first) -----
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $limit = max(1, (int)($_GET['limit'] ?? 500)); // avoid flooding UI
  $sql = "SELECT * FROM bib_data ORDER BY id DESC LIMIT ?";
  $stmt = $conn->prepare($sql);
  if (!$stmt) {
    http_response_code(500);
    echo json_encode(['error' => 'Prepare failed: '.$conn->error]);
    exit;
  }
  $stmt->bind_param('i', $limit);
  if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(['error' => 'Query failed: '.$stmt->error]);
    exit;
  }
  $res = $stmt->get_result();
  $rows = $res->fetch_all(MYSQLI_ASSOC);
  echo json_encode($rows);
  exit;
}

// ----- POST: insert a new entry -----
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  // Accept either form-data or JSON
  $payload = $_POST;
  if (empty($payload)) {
    $raw = file_get_contents('php://input');
    if ($raw) { $payload = json_decode($raw, true) ?: []; }
  }

  $bib       = (int)($payload['bib'] ?? 0);
  $first     = trim($payload['first_name'] ?? '');
  $last      = trim($payload['last_name'] ?? '');
  $gender    = trim($payload['gender'] ?? '');
  $age       = trim($payload['age'] ?? '');
  $status    = trim($payload['status'] ?? '');
  $distance  = trim($payload['distance'] ?? '');
  $prev_dist = trim($payload['previous_distance'] ?? '');

  if ($bib <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Bib number missing or invalid']);
    exit;
  }

  // Adjust columns to match your bib_data schema if different
  $sql = "INSERT INTO bib_data (bib, status, first_name, last_name, age, gender, distance, previous_distance)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  $stmt = $conn->prepare($sql);
  if (!$stmt) {
    http_response_code(500);
    echo json_encode(['error' => 'Prepare failed: '.$conn->error]);
    exit;
  }
  $stmt->bind_param('isssssss', $bib, $status, $first, $last, $age, $gender, $distance, $prev_dist);
  if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(['error' => 'Insert failed: '.$stmt->error]);
    exit;
  }
  echo json_encode(['success' => true, 'id' => $stmt->insert_id]);
  exit;
}

// ----- Unsupported -----
http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);

