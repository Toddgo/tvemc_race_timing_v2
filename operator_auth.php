<?php
session_start();
header('Content-Type: application/json; charset=utf-8');

$config = include __DIR__ . '/config.race.php';

$data = json_decode(file_get_contents('php://input'), true) ?: [];
$pin  = (string)($data['pin'] ?? '');

$ok = isset($config['operator_pin']) && hash_equals((string)$config['operator_pin'], $pin);

if ($ok) {
    $_SESSION['operator_access'] = true;
}

echo json_encode(['success' => $ok]);
