<?php
header('Content-Type: application/json; charset=utf-8');

function json_out($arr, $code = 200) {
  http_response_code($code);
  echo json_encode($arr);
  exit;
}

function safe_str($v) {
  return trim(str_replace("\0", "", (string)($v ?? "")));
}

function station_order_from_code($code) {
  $code = strtoupper(safe_str($code));
  if ($code === "START") return 0;
  if ($code === "FINISH") return 999;
  if (preg_match('/^AS(\d+)$/', $code, $m)) return (int)$m[1];
  return null;
}

// ---- Require POST JSON ----
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_out(["success" => false, "error" => "POST required"], 405);
}

$raw = file_get_contents("php://input");
$data = json_decode($raw, true);
if (!$data) json_out(["success" => false, "error" => "Invalid JSON"], 400);

// Accept either {"rows":[...]} or just [...]
$rows = $data["rows"] ?? $data;
if (!is_array($rows)) json_out(["success" => false, "error" => "Expected rows array"], 400);

// ---- Load config + connect PDO ----
$config = require __DIR__ . "/config.race.php";
if (!is_array($config)) json_out(["success" => false, "error" => "config.race.php did not return an array"], 500);

$dsn = sprintf(
  "mysql:host=%s;dbname=%s;charset=utf8mb4",
  $config["host"] ?? "localhost",
  $config["dbname"] ?? ""
);

try {
  $pdo = new PDO(
    $dsn,
    $config["username"] ?? "",
    $config["password"] ?? "",
    [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]
  );
} catch (Exception $e) {
  json_out(["success" => false, "error" => "DB connect failed: " . $e->getMessage()], 500);
}

$inserted = 0;
$skipped = 0;
$errors = [];

try {
  $pdo->beginTransaction();

  $stmtEvent = $pdo->prepare("SELECT event_id FROM events WHERE event_code = ? LIMIT 1");

  // Idempotent de-dupe check:
  // same event+bib+type+ts+station(+distance/operator/note) => skip
  $stmtDup = $pdo->prepare("
    SELECT pass_id
    FROM passes
    WHERE event_id = ?
      AND bib = ?
      AND UPPER(pass_type) = UPPER(?)
      AND pass_ts = ?
      AND (
            (station_code IS NOT NULL AND station_code = ?)
         OR (station_order IS NOT NULL AND station_order = ?)
          )
      AND (distance_code = ? OR ? = '')
      AND (operator = ? OR ? = '')
      AND (note = ? OR ? = '')
    LIMIT 1
  ");

  $stmtIns = $pdo->prepare("
    INSERT INTO passes
      (event_id, bib, pass_type, pass_ts, station_code, station_order, note, operator, distance_code)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ");

  foreach ($rows as $i => $r) {
    $event_code   = safe_str($r["event_code"] ?? "");
    $bib          = (int)($r["bib"] ?? 0);
    $pass_type    = strtoupper(safe_str($r["pass_type"] ?? ""));
    $pass_ts      = safe_str($r["pass_ts"] ?? "");
    $station_code = strtoupper(safe_str($r["station_code"] ?? ""));
    $note         = safe_str($r["note"] ?? "");
    $operator     = safe_str($r["operator"] ?? "");
    $distance     = safe_str($r["distance_code"] ?? "");

    if ($event_code === "" || $bib <= 0 || $pass_type === "" || $pass_ts === "" || $station_code === "") {
      $errors[] = ["row" => $i, "error" => "Missing required fields", "data" => $r];
      continue;
    }

    $stmtEvent->execute([$event_code]);
    $ev = $stmtEvent->fetch();
    if (!$ev) {
      $errors[] = ["row" => $i, "error" => "Unknown event_code: $event_code", "data" => $r];
      continue;
    }
    $event_id = (int)$ev["event_id"];

    $station_order = station_order_from_code($station_code);

    $stmtDup->execute([
      $event_id,
      $bib,
      $pass_type,
      $pass_ts,
      $station_code,
      $station_order,
      $distance, $distance,
      $operator, $operator,
      $note, $note
    ]);

    if ($stmtDup->fetch()) {
      $skipped++;
      continue;
    }

    $stmtIns->execute([
      $event_id,
      $bib,
      $pass_type,
      $pass_ts,
      $station_code,
      $station_order,
      $note,
      ($operator !== "" ? $operator : "Unknown"),
      $distance
    ]);

    $inserted++;
  }

  $pdo->commit();

} catch (Exception $e) {
  if ($pdo->inTransaction()) $pdo->rollBack();
  json_out(["success" => false, "error" => "Import failed: " . $e->getMessage()], 500);
}

json_out([
  "success" => true,
  "inserted" => $inserted,
  "skipped" => $skipped,
  "errors" => $errors,
  "total_rows" => count($rows)
]);
