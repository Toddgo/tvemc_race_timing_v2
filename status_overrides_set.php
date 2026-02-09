<?php
// status_oversides_set.php  Jan 21 11:30
header('Content-Type: application/json');

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

$raw = file_get_contents("php://input");
$in = json_decode($raw, true);

$event_code = trim($in['event_code'] ?? '');
$bib = (int)($in['bib'] ?? 0);
$clear = strtoupper(trim($in['clear'] ?? '')); // DNS or DNF
$cleared_by = trim($in['cleared_by'] ?? '');
$note = trim($in['note'] ?? '');

if ($event_code === '' || $bib <= 0 || ($clear !== 'DNS' && $clear !== 'DNF')) {
  http_response_code(400);
  echo json_encode(["success"=>false, "error"=>"Missing/invalid event_code, bib, or clear"]);
  exit;
}

$field = ($clear === 'DNS') ? 'cleared_dns_at' : 'cleared_dnf_at';

$sql = "
  INSERT INTO status_overrides (event_code, bib, $field, cleared_by, note)
  VALUES (?, ?, UTC_TIMESTAMP(), ?, ?)  
  ON DUPLICATE KEY UPDATE
    $field = UTC_TIMESTAMP(),
    cleared_by = VALUES(cleared_by),
    note = VALUES(note)
";

$stmt = $conn->prepare($sql);
if (!$stmt) {
  http_response_code(500);
  echo json_encode(["success"=>false, "error"=>"Prepare failed", "details"=>$conn->error]);
  exit;
}

$stmt->bind_param("siss", $event_code, $bib, $cleared_by, $note);
$ok = $stmt->execute();
if (!$ok) {
  http_response_code(500);
  echo json_encode(["success"=>false, "error"=>"Execute failed", "details"=>$stmt->error]);
  $stmt->close();
  exit;
}
$stmt->close();

echo json_encode(["success"=>true]);
