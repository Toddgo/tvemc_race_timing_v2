<?php
header('Content-Type: application/json; charset=utf-8');
$config = include __DIR__ . '/config.race.php';

$data = json_decode(file_get_contents('php://input'), true) ?: [];
$pass = (string)($data['password'] ?? '');

$ok = isset($config['hq_password']) && hash_equals((string)$config['hq_password'], $pass);

echo json_encode(['success' => $ok]);
