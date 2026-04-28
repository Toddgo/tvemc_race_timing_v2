<?php
// station_reply.php
// Aid station → HQ message endpoint.
// Aid stations POST here to send a message to HQ.
// The row is stored in hq_messages with station_target='HQ' and sender_station=<calling station>.

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

function fail(int $code, string $msg, array $extra = []): void {
    http_response_code($code);
    echo json_encode(array_merge(["success" => false, "error" => $msg], $extra));
    exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    fail(405, "Method not allowed");
}

try {
    $configFile = __DIR__ . "/config.race.php";
    if (!file_exists($configFile)) {
        fail(500, "No config.race.php found");
    }

    $cfg = include $configFile;
    if (!is_array($cfg)) {
        fail(500, "config.race.php did not return an array");
    }

    $DB_HOST = (string)($cfg["host"] ?? "");
    $DB_USER = (string)($cfg["username"] ?? "");
    $DB_PASS = (string)($cfg["password"] ?? "");
    $DB_NAME = (string)($cfg["dbname"] ?? "");

    if ($DB_HOST === "" || $DB_USER === "" || $DB_NAME === "") {
        fail(500, "Config missing DB values");
    }

    $conn = new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
    if ($conn->connect_error) {
        fail(500, "DB connect failed", ["details" => $conn->connect_error]);
    }
    $conn->set_charset("utf8mb4");
    $conn->query("SET time_zone = '+00:00'");

    $raw  = file_get_contents("php://input");
    $data = json_decode($raw ?: "", true);
    if (!is_array($data)) {
        fail(400, "Invalid JSON payload");
    }

    // Resolve event_id from event_code
    $event_code = trim((string)($data["event_code"] ?? ""));
    if ($event_code === "") {
        fail(400, "Missing event_code");
    }

    $st = $conn->prepare("SELECT event_id FROM events WHERE event_code=? LIMIT 1");
    if (!$st) {
        fail(500, "DB prepare failed (event lookup)", ["details" => $conn->error]);
    }
    $st->bind_param("s", $event_code);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();

    if (!$row) {
        fail(400, "Unknown event_code", ["event_code" => $event_code]);
    }
    $event_id = (int)$row["event_id"];

    $sender_station = trim((string)($data["sender_station"] ?? ""));
    $message_text   = trim((string)($data["message_text"] ?? ""));
    $operator       = trim((string)($data["operator"] ?? ""));

    if ($sender_station === "") {
        fail(400, "Missing sender_station");
    }
    if ($message_text === "") {
        fail(400, "Missing message_text");
    }

    // station_target is always 'HQ' for station-originated messages
    $station_target = "HQ";
    $channel        = trim((string)($data["channel"] ?? "internet"));

    $sql = "INSERT INTO hq_messages
              (event_id, station_target, channel, message_text, operator, sender_station)
            VALUES (?, ?, ?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        fail(500, "DB prepare failed", ["details" => $conn->error]);
    }
    $stmt->bind_param("isssss", $event_id, $station_target, $channel, $message_text, $operator, $sender_station);

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
        "file"    => basename($e->getFile()),
        "line"    => $e->getLine()
    ]);
}
