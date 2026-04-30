<?php
session_start();
if (!empty($_SESSION['operator_access'])) {
    header('Location: index.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <title>Operator Access — TVEMC Race Timing</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(ellipse at center, #1c1c2e 0%, #0a0a14 100%);
      font-family: Arial, sans-serif;
    }

    .card {
      background: #1e2030;
      border: 2px solid #333a5c;
      border-radius: 18px;
      padding: 40px 36px 44px;
      max-width: 380px;
      width: 92%;
      text-align: center;
      box-shadow: 0 8px 40px rgba(0,0,0,0.7);
    }

    .logo {
      max-width: 160px;
      margin: 0 auto 18px;
      display: block;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
    }

    .org-name {
      font-size: 13px;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #7a8aaa;
      margin-bottom: 6px;
    }

    h1 {
      font-size: 22px;
      font-weight: bold;
      color: #FFEA00;
      margin-bottom: 28px;
      text-shadow: 0 1px 6px rgba(0,0,0,0.5);
    }

    .pin-label {
      font-size: 13px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #7a8aaa;
      margin-bottom: 10px;
    }

    #pinInput {
      width: 100%;
      padding: 16px 12px;
      font-size: 28px;
      letter-spacing: 10px;
      text-align: center;
      background: #12131f;
      border: 2px solid #333a5c;
      border-radius: 10px;
      color: #fff;
      outline: none;
      margin-bottom: 20px;
      transition: border-color 0.2s;
      -webkit-text-security: disc;
    }

    #pinInput:focus {
      border-color: #FFEA00;
    }

    #pinInput.error {
      border-color: #e05252;
      animation: shake 0.35s ease;
    }

    @keyframes shake {
      0%,100% { transform: translateX(0); }
      25%      { transform: translateX(-8px); }
      75%      { transform: translateX(8px); }
    }

    /* Numpad */
    .numpad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 18px;
    }

    .numpad button {
      background: #2a2d45;
      border: 1px solid #3a3f60;
      border-radius: 10px;
      color: #e8eaf0;
      font-size: 22px;
      font-weight: bold;
      padding: 16px 0;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      -webkit-tap-highlight-color: transparent;
    }

    .numpad button:active {
      background: #3c4170;
      transform: scale(0.93);
    }

    .numpad .btn-clear {
      font-size: 14px;
      letter-spacing: 1px;
      color: #e05252;
      border-color: #5a2020;
    }

    .numpad .btn-enter {
      background: #003d99;
      border-color: #003d99;
      color: #FFEA00;
      font-size: 14px;
      letter-spacing: 1px;
    }

    .numpad .btn-enter:active {
      background: #0050cc;
    }

    #errMsg {
      min-height: 22px;
      color: #e05252;
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 1px;
    }

    .footer-note {
      margin-top: 28px;
      font-size: 11px;
      color: #444a6a;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>

<div class="card">
  <img class="logo" src="assets/tvemcLogo.png" alt="TVEMC Logo">
  <p class="org-name">TVEMC Race Timing</p>
  <h1>Operator Access</h1>

  <p class="pin-label">Enter PIN</p>
  <input id="pinInput" type="tel" inputmode="numeric" maxlength="8"
         autocomplete="one-time-code" placeholder="••••">

  <div class="numpad">
    <button onclick="padPress('1')">1</button>
    <button onclick="padPress('2')">2</button>
    <button onclick="padPress('3')">3</button>
    <button onclick="padPress('4')">4</button>
    <button onclick="padPress('5')">5</button>
    <button onclick="padPress('6')">6</button>
    <button onclick="padPress('7')">7</button>
    <button onclick="padPress('8')">8</button>
    <button onclick="padPress('9')">9</button>
    <button class="btn-clear" onclick="padClear()">CLEAR</button>
    <button onclick="padPress('0')">0</button>
    <button class="btn-enter" onclick="submitPin()">ENTER</button>
  </div>

  <div id="errMsg"></div>

  <p class="footer-note">Authorized personnel only</p>
</div>

<script>
  var inp = document.getElementById('pinInput');
  var err = document.getElementById('errMsg');

  function padPress(digit) {
    if (inp.value.length < 8) inp.value += digit;
    err.textContent = '';
    inp.classList.remove('error');
  }

  function padClear() {
    inp.value = '';
    err.textContent = '';
    inp.classList.remove('error');
  }

  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitPin();
  });

  function submitPin() {
    var pin = inp.value.trim();
    if (!pin) { showError('Please enter PIN'); return; }

    fetch('operator_auth.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin })
    })
    .then(function(r) {
      return r.text().then(function(txt) {
        try { return JSON.parse(txt); }
        catch(e) { throw new Error('Server response: ' + txt.substring(0, 120)); }
      });
    })
    .then(function(data) {
      if (data.success) {
        window.location.replace('index.php');
      } else {
        inp.value = '';
        showError('Incorrect PIN — try again');
      }
    })
    .catch(function(e) {
      showError(e && e.message ? e.message : 'Connection error — please retry');
    });
  }

  function showError(msg) {
    err.textContent = msg;
    inp.classList.add('error');
    setTimeout(function() { inp.classList.remove('error'); }, 400);
  }
</script>

</body>
</html>
