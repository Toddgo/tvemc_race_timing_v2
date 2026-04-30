<?php
ob_start();
error_reporting(0);
ini_set('display_errors', '0');

session_start();
header('Content-Type: application/json; charset=utf-8');

$config = @include __DIR__ . '/config.race.php';

$data = json_decode(file_get_contents('php://input'), true) ?: [];
$pin  = (string)($data['pin'] ?? '');

$ok = is_array($config) && isset($config['operator_pin'])
    && hash_equals((string)$config['operator_pin'], $pin);

if ($ok) {
    $_SESSION['operator_access'] = true;
}

ob_end_clean();
echo json_encode(['success' => $ok]);
