<?php
// aid_stations_import.php - import aid stations from a CSV file upload
// Columns expected: event_id, distance_code, station_order, station_code, station_key, is_aid, is_finish
// station_key maps to station_name in the aid_stations table.
// mile defaults to 0.00 when not present in the CSV.
// Optional column: mile (decimal)
//
// Usage: POST multipart/form-data with field "csv_file" containing the CSV file.
// Optional POST fields:
//   replace=1  – delete existing aid_stations rows for each (event_id, distance_code)
//                pair found in the CSV before inserting (default: 0 = skip duplicates).

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function json_out($arr, $code = 200) {
    http_response_code($code);
    echo json_encode($arr);
    exit;
}

function safe_str($v) {
    return trim(str_replace("\0", "", (string)($v ?? "")));
}

// ---- Validate upload ----
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_out(["success" => false, "error" => "POST required"], 405);
}

if (empty($_FILES['csv_file']) || $_FILES['csv_file']['error'] !== UPLOAD_ERR_OK) {
    $err = $_FILES['csv_file']['error'] ?? 'no file';
    json_out(["success" => false, "error" => "File upload error: $err"], 400);
}

$replace_mode = (int)($_POST['replace'] ?? 0) === 1;

// ---- Parse CSV ----
$handle = fopen($_FILES['csv_file']['tmp_name'], 'r');
if (!$handle) {
    json_out(["success" => false, "error" => "Cannot read uploaded file"], 500);
}

$header = null;
$rows = [];
while (($line = fgetcsv($handle)) !== false) {
    if ($header === null) {
        $header = array_map('strtolower', array_map('trim', $line));
        continue;
    }
    if (count($line) !== count($header)) {
        $errors[] = ["row" => count($rows) + 2, "error" => "Column count mismatch (expected " . count($header) . ", got " . count($line) . ")", "data" => $line];
        continue;
    }
    $rows[] = array_combine($header, $line);
}
fclose($handle);

if (empty($rows)) {
    json_out(["success" => false, "error" => "CSV is empty or header-only"], 400);
}

// Required columns
$required = ['event_id', 'distance_code', 'station_order', 'station_code', 'station_key', 'is_aid', 'is_finish'];
foreach ($required as $col) {
    if (!in_array($col, $header, true)) {
        json_out(["success" => false, "error" => "Missing required column: $col"], 400);
    }
}

// ---- DB connect ----
$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
if ($conn->connect_error) {
    json_out(["success" => false, "error" => "DB connect failed: " . $conn->connect_error], 500);
}
$conn->set_charset('utf8mb4');

$inserted = 0;
$skipped  = 0;
$deleted  = 0;
$errors   = [];

$conn->begin_transaction();

try {
    // When replace=1 we delete existing rows for each (event_id, distance_code) pair once.
    $deleted_pairs = [];

    $stmt_del = $conn->prepare(
        "DELETE FROM aid_stations WHERE event_id = ? AND distance_code = ?"
    );

    $stmt_dup = $conn->prepare("
        SELECT station_id FROM aid_stations
        WHERE event_id = ? AND distance_code = ? AND station_order = ?
        LIMIT 1
    ");

    $stmt_ins = $conn->prepare("
        INSERT INTO aid_stations
            (event_id, distance_code, station_order, station_code, station_name, mile, is_aid, is_finish)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ");

    foreach ($rows as $i => $r) {
        $event_id      = (int)safe_str($r['event_id']);
        $distance_code = safe_str($r['distance_code']);
        $station_order = (int)safe_str($r['station_order']);
        $station_code  = strtoupper(safe_str($r['station_code']));
        $station_name  = safe_str($r['station_key']);   // station_key → station_name
        $mile          = isset($r['mile']) ? (float)$r['mile'] : 0.00;  // 0.00 when mile column absent; add a mile column to the CSV to populate distances
        $is_aid        = (int)safe_str($r['is_aid']);
        $is_finish     = (int)safe_str($r['is_finish']);

        if ($event_id <= 0 || $distance_code === '' || $station_code === '' || $station_name === '') {
            $errors[] = ["row" => $i + 2, "error" => "Missing required fields", "data" => $r];
            continue;
        }

        // Delete existing rows for this (event_id, distance_code) once per pair in replace mode
        if ($replace_mode) {
            $pair_key = "$event_id|$distance_code";
            if (!isset($deleted_pairs[$pair_key])) {
                $stmt_del->bind_param("is", $event_id, $distance_code);
                $stmt_del->execute();
                $deleted += $stmt_del->affected_rows;
                $deleted_pairs[$pair_key] = true;
            }
        } else {
            // Skip exact duplicate (same event + distance + order)
            $stmt_dup->bind_param("isi", $event_id, $distance_code, $station_order);
            $stmt_dup->execute();
            $dup_result = $stmt_dup->get_result();
            if ($dup_result->num_rows > 0) {
                $skipped++;
                continue;
            }
        }

        $stmt_ins->bind_param("isissdii",
            $event_id, $distance_code, $station_order,
            $station_code, $station_name, $mile, $is_aid, $is_finish
        );
        $stmt_ins->execute();
        $inserted++;
    }

    $stmt_del->close();
    $stmt_dup->close();
    $stmt_ins->close();

    $conn->commit();

} catch (Exception $e) {
    $conn->rollback();
    json_out(["success" => false, "error" => "Import failed: " . $e->getMessage()], 500);
}

$conn->close();

json_out([
    "success"    => true,
    "inserted"   => $inserted,
    "skipped"    => $skipped,
    "deleted"    => $deleted,
    "errors"     => $errors,
    "total_rows" => count($rows),
]);
