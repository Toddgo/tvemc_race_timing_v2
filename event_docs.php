<?php
// event_docs.php
// Returns a JSON array of PDF and CSV files in docs/{event_code}/.
// Called by the front-end loadEventDocs() in race_timing.js.
//
// Example:  GET event_docs.php?event_code=LDV-100-2026-0001
// Response: [{"name":"Course_Map.pdf","url":"docs/LDV-100-2026-0001/Course_Map.pdf"}, ...]

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$event_code = trim($_GET['event_code'] ?? '');

// Validate event_code: allow only alphanumerics, hyphens and underscores.
if ($event_code === '' || !preg_match('/^[A-Za-z0-9_\-]+$/', $event_code)) {
    echo json_encode([]);
    exit;
}

$base_dir  = __DIR__ . '/docs/' . $event_code;
$base_url  = 'docs/' . $event_code;

if (!is_dir($base_dir)) {
    echo json_encode([]);
    exit;
}

$allowed_ext = ['pdf', 'csv'];
$files = [];

foreach (scandir($base_dir) as $entry) {
    if ($entry === '.' || $entry === '..') continue;
    if (!is_file($base_dir . '/' . $entry)) continue;

    $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed_ext, true)) continue;

    $files[] = [
        'name' => $entry,
        'url'  => $base_url . '/' . rawurlencode($entry),
        'ext'  => $ext,
    ];
}

// Sort alphabetically by name so the order is predictable.
usort($files, fn($a, $b) => strcasecmp($a['name'], $b['name']));

echo json_encode($files);
