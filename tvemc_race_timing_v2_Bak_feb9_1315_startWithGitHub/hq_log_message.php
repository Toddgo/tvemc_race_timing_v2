<?php
// race_timing/hq_log_message.php — forced-config version

header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");
header("Expires: Mon, 26 Jul 1997 05:00:00 GMT");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");
header("Access-Control-Max-Age: 86400");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
  http_response_code(200);
  echo json_encode(["success" => true, "preflight" => true]);
  exit;
}

function fail(int $code, string $msg, array $extra = []) : void {
  http_response_code($code);
  echo json_encode(array_merge(["success" => false, "error" => $msg], $extra));
  exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
  fail(405, "Method not allowed");
}

try {
  // 1) Load config array
  $configFile = __DIR__ . "/config.race.php";
  if (!file_exists($configFile)) {
    fail(500, "No config.race.php found in race_timing");
  }

  $cfg = include $configFile;
  if (!is_array($cfg)) {
    fail(500, "config.race.php did not return an array", ["cfg_type" => gettype($cfg)]);
  }

  // 2) Force credentials into locals (no chance of accidentally using old globals)
  $DB_HOST = (string)($cfg["host"] ?? "");
  $DB_USER = (string)($cfg["username"] ?? "");
  $DB_PASS = (string)($cfg["password"] ?? "");
  $DB_NAME = (string)($cfg["dbname"] ?? "");

  if ($DB_HOST === "" || $DB_USER === "" || $DB_NAME === "") {
    fail(500, "Config missing DB values", [
      "host_present" => $DB_HOST !== "",
      "user_present" => $DB_USER !== "",
      "pass_present" => $DB_PASS !== "",
      "db_present"   => $DB_NAME !== ""
    ]);
  }

  // 3) Connect ONCE using locals
  $conn = new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
  if ($conn->connect_error) {
    fail(500, "DB connect failed", ["details" => $conn->connect_error]);
  }
  $conn->set_charset("utf8mb4");

  // 4) Read JSON
  $raw = file_get_contents("php://input");
  $data = json_decode($raw ?: "", true);
  if (!is_array($data)) {
    fail(400, "Invalid JSON payload");
  }

 // $event_id_raw = $data["event_id"] ?? null;
 // if ($event_id_raw === null || $event_id_raw === "" || !is_numeric($event_id_raw)) {
 //   fail(400, "Missing or invalid event_id (must be an integer)");
 // }
 // $event_id = (int)$event_id_raw;
 
   // Prefer event_code, resolve event_id server-side (prevents mismatches)
  $event_code = trim((string)($data["event_code"] ?? ""));
  $event_id = null;

  if ($event_code !== "") {
    $st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
    if (!$st) fail(500, "DB prepare failed (event lookup)", ["details" => $conn->error]);
    $st->bind_param("s", $event_code);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();

    if (!$row) {
      fail(400, "Unknown event_code", ["event_code" => $event_code]);
    }
    $event_id = (int)$row["event_id"];
  } else {
    // Fallback: allow legacy clients that still send event_id
    $event_id_raw = $data["event_id"] ?? null;
    if ($event_id_raw === null || $event_id_raw === "" || !is_numeric($event_id_raw)) {
      fail(400, "Missing event_code or invalid event_id");
    }
    $event_id = (int)$event_id_raw;
  }


  $station_target = trim((string)($data["station_target"] ?? ""));
  $channel = trim((string)($data["channel"] ?? "internet"));
  $message_text = trim((string)($data["message_text"] ?? ""));
  $operator = trim((string)($data["operator"] ?? ""));
  $msg_number = $data["msg_number"] ?? null;

  if ($station_target === "") fail(400, "Missing station_target");
  if ($message_text === "") fail(400, "Missing message_text");
  if ($channel === "") $channel = "internet";

  $msg_num_int = null;
  if ($msg_number !== null && $msg_number !== "" && is_numeric($msg_number)) {
    $msg_num_int = (int)$msg_number;
  }

  $table = "hq_messages";

  if ($msg_num_int === null) {
    $sql = "INSERT INTO `$table`
            (event_id, station_target, channel, message_text, operator, msg_number)
            VALUES (?, ?, ?, ?, ?, NULL)";
    $stmt = $conn->prepare($sql);
    if (!$stmt) fail(500, "DB prepare failed", ["details" => $conn->error]);

    $stmt->bind_param("issss", $event_id, $station_target, $channel, $message_text, $operator);
  } else {
    $sql = "INSERT INTO `$table`
            (event_id, station_target, channel, message_text, operator, msg_number)
            VALUES (?, ?, ?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    if (!$stmt) fail(500, "DB prepare failed", ["details" => $conn->error]);

    $stmt->bind_param("issssi", $event_id, $station_target, $channel, $message_text, $operator, $msg_num_int);
  }

  if (!$stmt->execute()) {
    fail(500, "DB insert failed", ["details" => $stmt->error]);
  }

  $newId = $stmt->insert_id;
  $stmt->close();
  $conn->close();

  echo json_encode(["success" => true, "id" => $newId]);
  exit;

} catch (Throwable $e) {
  fail(500, "Server exception", [
    "details" => $e->getMessage(),
    "file" => basename($e->getFile()),
    "line" => $e->getLine()
  ]);
}
