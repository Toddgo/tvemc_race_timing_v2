<?php
// status_overrides_load.php Jan21 11:30
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

if ($event_code === '') {
  http_response_code(400);
  echo json_encode(["success"=>false, "error"=>"Missing event_code"]);
  exit;
}

$stmt = $conn->prepare("SELECT bib, cleared_dns_at, cleared_dnf_at, cleared_by, note FROM status_overrides WHERE event_code = ?");
if (!$stmt) {
  http_response_code(500);
  echo json_encode(["success"=>false, "error"=>"Prepare failed", "details"=>$conn->error]);
  exit;
}
$stmt->bind_param("s", $event_code);
$stmt->execute();

$stmt->bind_result($bib, $cleared_dns_at, $cleared_dnf_at, $cleared_by, $note);

$rows = [];
while ($stmt->fetch()) {
  $rows[] = [
    "bib" => $bib,
    "cleared_dns_at" => $cleared_dns_at,
    "cleared_dnf_at" => $cleared_dnf_at,
    "cleared_by" => $cleared_by,
    "note" => $note
  ];
}
$stmt->close();

echo json_encode(["success"=>true, "rows"=>$rows]);
