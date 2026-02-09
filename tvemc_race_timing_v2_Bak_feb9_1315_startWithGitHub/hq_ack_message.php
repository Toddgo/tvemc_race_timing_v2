<?php
// hq_ack_message.php
header('Content-Type: application/json');

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

/// 1) Connect to DB using local config.race.php (same folder)
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


// 2) Read JSON body
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid JSON']);
    exit;
}

$messageId = isset($data['id']) ? (int)$data['id'] : 0;

if ($messageId <= 0) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing or invalid id']);
    exit;
}

try {
    $stmt = $conn->prepare("
        UPDATE hq_messages
        SET acknowledged = 1,
            ack_time = NOW()
        WHERE id = ?
    ");

    if (!$stmt) {
        throw new Exception('Prepare failed: ' . $conn->error);
    }

    $stmt->bind_param("i", $messageId);

    if (!$stmt->execute()) {
        throw new Exception('Execute failed: ' . $stmt->error);
    }

    $rows = $stmt->affected_rows;
    $stmt->close();
    $conn->close();

    echo json_encode([
        'success' => true,
        'updated' => $rows
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error'   => $e->getMessage()
    ]);
}
