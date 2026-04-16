<?php
/**
 * test_events.php — Diagnostic page
 * Visit: https://yourserver.com/tvemc/test_events.php
 *
 * Shows you exactly what the DB returns for the events table.
 * DELETE or password-protect this file after debugging.
 */
header('Content-Type: text/html; charset=utf-8');
$config = include __DIR__ . '/config.race.php';
$conn = new mysqli($config['host'], $config['username'], $config['password'], $config['dbname']);
?><!DOCTYPE html>
<html>
<head>
  <title>events_list.php Diagnostic</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1a1a1a; color: #eee; }
    h2 { color: #4af; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 30px; }
    th { background: #333; color: #4af; padding: 8px 12px; text-align: left; }
    td { padding: 6px 12px; border-bottom: 1px solid #333; }
    tr:nth-child(even) td { background: #222; }
    .ok { color: #4f4; }
    .err { color: #f44; }
    .box { background: #222; border: 1px solid #444; padding: 15px; margin: 15px 0; border-radius: 4px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
<h2>🔧 TVEMC Race Timing — DB Diagnostic</h2>

<?php
// 1. DB connection
if ($conn->connect_error) {
  echo '<p class="err">❌ DB connection failed: ' . htmlspecialchars($conn->connect_error) . '</p>';
  exit;
}
$conn->set_charset('utf8mb4');
echo '<p class="ok">✅ DB connected: <strong>' . htmlspecialchars($config['dbname']) . '</strong></p>';

// 2. PHP + MySQL version
echo '<div class="box"><pre>';
echo 'PHP version  : ' . PHP_VERSION . "\n";
$vRes = $conn->query("SELECT VERSION() AS v");
$vRow = $vRes ? $vRes->fetch_assoc() : null;
echo 'MySQL version: ' . ($vRow ? $vRow['v'] : 'unknown') . "\n";
echo 'File version : events_list.php v4 (SELECT * single-query)' . "\n";
echo '</pre></div>';

// 3. Raw events table — all rows
echo '<h2>events table (all rows)</h2>';
$res = $conn->query("SELECT * FROM events ORDER BY event_id ASC");
if ($res === false) {
  echo '<p class="err">❌ Query failed: ' . htmlspecialchars($conn->error) . '</p>';
} else {
  $rows = [];
  while ($r = $res->fetch_assoc()) $rows[] = $r;
  if (empty($rows)) {
    echo '<p class="err">⚠️ No rows returned from events table!</p>';
  } else {
    echo '<p class="ok">✅ ' . count($rows) . ' row(s) found</p>';
    $cols = array_keys($rows[0]);
    echo '<table><tr>';
    foreach ($cols as $c) echo '<th>' . htmlspecialchars($c) . '</th>';
    echo '</tr>';
    foreach ($rows as $r) {
      echo '<tr>';
      foreach ($cols as $c) echo '<td>' . htmlspecialchars((string)($r[$c] ?? '')) . '</td>';
      echo '</tr>';
    }
    echo '</table>';
  }
}

// 4. Simulate events_list.php output
echo '<h2>Simulated events_list.php JSON output</h2>';
$res2 = $conn->query("SELECT * FROM events ORDER BY event_date DESC, event_id DESC");
$out = [];
if ($res2) {
  while ($row = $res2->fetch_assoc()) {
    $out[] = [
      'event_id'   => (int)($row['event_id'] ?? 0),
      'event_code' => (string)($row['event_code'] ?? ''),
      'event_name' => (string)($row['event_name'] ?? ''),
      'race_date'  => (string)($row['event_date'] ?? $row['race_date'] ?? ''),
      'timezone'   => (string)($row['timezone'] ?? 'America/Los_Angeles'),
    ];
  }
}
echo '<div class="box"><pre>' . htmlspecialchars(json_encode($out, JSON_PRETTY_PRINT)) . '</pre></div>';

// 5. event_distances for event_id=5
echo '<h2>event_distances for event_id=5 (Leona Divide)</h2>';
$res3 = $conn->query("SELECT * FROM event_distances WHERE event_id=5 ORDER BY distance_code");
if ($res3 === false) {
  echo '<p class="err">❌ ' . htmlspecialchars($conn->error) . '</p>';
} else {
  $rows3 = [];
  while ($r = $res3->fetch_assoc()) $rows3[] = $r;
  if (empty($rows3)) {
    echo '<p class="err">⚠️ No distance rows for event_id=5</p>';
  } else {
    echo '<p class="ok">✅ ' . count($rows3) . ' distance(s)</p>';
    $cols = array_keys($rows3[0]);
    echo '<table><tr>';
    foreach ($cols as $c) echo '<th>' . htmlspecialchars($c) . '</th>';
    echo '</tr>';
    foreach ($rows3 as $r) {
      echo '<tr>';
      foreach ($cols as $c) echo '<td>' . htmlspecialchars((string)($r[$c] ?? '')) . '</td>';
      echo '</tr>';
    }
    echo '</table>';
  }
}

// 6. aid_stations count per event
echo '<h2>aid_stations — count per event</h2>';
$res4 = $conn->query("SELECT event_id, COUNT(*) AS cnt FROM aid_stations GROUP BY event_id ORDER BY event_id");
if ($res4) {
  echo '<table><tr><th>event_id</th><th>station_rows</th></tr>';
  while ($r = $res4->fetch_assoc()) {
    echo '<tr><td>' . (int)$r['event_id'] . '</td><td>' . (int)$r['cnt'] . '</td></tr>';
  }
  echo '</table>';
}

$conn->close();
?>
<p style="color:#888; margin-top:40px">⚠️ Delete <code>test_events.php</code> from your server after debugging.</p>
</body>
</html>
