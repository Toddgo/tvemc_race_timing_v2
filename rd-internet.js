// race_timing/rd-internet.js

// Helper: POST HQ messages to the server
async function logHqMessageToServer(payload) {
  try {
    const response = await fetch("hq_log_message.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Try to parse JSON even on errors (so we can show real server error)
    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      // response wasn't JSON (rare, but possible)
    }

    if (!response.ok) {
      const serverMsg =
        (data && (data.error || data.message)) ? (data.error || data.message) : null;
      console.error("Log HQ message HTTP error", response.status, serverMsg || "");
      return { success: false, error: serverMsg || ("HTTP " + response.status) };
    }

    if (data && data.success === false) {
      console.error("Log HQ message API error", data.error || "Unknown API error");
      return { success: false, error: data.error || "Unknown API error" };
    }

    return data || { success: true };
  } catch (err) {
    console.error("Log HQ message fetch error", err);
    return { success: false, error: err.message || "Fetch error" };
  }
}

   // Aid station → HQ: send a message from the station compose box to HQ
window.sendStationToHQ = async function () {
  if (window.__sendingStationToHQ) return;
  window.__sendingStationToHQ = true;
  setTimeout(() => (window.__sendingStationToHQ = false), 1500);

  const btn = document.getElementById("stationToHqSendBtn");
  if (btn) {
    btn.disabled = true;
    setTimeout(() => (btn.disabled = false), 1500);
  }

  const textEl   = document.getElementById("stationToHqText");
  const statusEl = document.getElementById("stationToHqStatus");
  const text     = (textEl ? textEl.value : "").trim();

  if (!text) {
    alert("Type a message first");
    return;
  }

  const eventCode =
    (typeof getEventCode === "function" ? getEventCode() : "") ||
    (window.TVEMC_EVENT_CODE || "");

  if (!eventCode) {
    alert("Missing Event Code — cannot send.");
    return;
  }

  // Determine sender station id
  const senderStation = (window.TVEMC_STATION_ID || "").trim();
  if (!senderStation) {
    alert("Station ID not set — cannot send to HQ.");
    return;
  }

  const operator = (document.getElementById("operatorName")?.value || "").trim();

  if (statusEl) statusEl.textContent = "Sending...";

  try {
    const res = await fetch("station_reply.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_code:     eventCode,
        sender_station: senderStation,
        message_text:   text,
        operator:       operator
      })
    });

    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }

    if (!res.ok || (data && data.success === false)) {
      const errMsg = (data && data.error) ? data.error : ("HTTP " + res.status);
      if (statusEl) {
        statusEl.textContent = "Error: " + errMsg;
        setTimeout(() => (statusEl.textContent = "Status: Ready"), 4000);
      }
      alert("Could not send message to HQ: " + errMsg);
      return;
    }

    if (textEl) textEl.value = "";
    if (statusEl) {
      statusEl.textContent = "Sent to HQ ✓";
      setTimeout(() => (statusEl.textContent = "Status: Ready"), 3000);
    }
    console.log("Station→HQ message sent:", data);
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = "Error: " + (err.message || "Fetch error");
      setTimeout(() => (statusEl.textContent = "Status: Ready"), 4000);
    }
    alert("Could not send message to HQ: " + (err.message || "Fetch error"));
  }
};

   window.sendInternetToSelected = async function () {
     if (window.__sendingInternetSelected) return;  // added Jan 20 0001
       window.__sendingInternetSelected = true;
       setTimeout(() => (window.__sendingInternetSelected = false), 1500); //last line of added
    
    // Optional: disable button briefly so operators can’t double-click
  const btn = document.getElementById("sendInternetSelectedBtn");
  if (btn) {
    btn.disabled = true;
    setTimeout(() => (btn.disabled = false), 1500);
  }

    
  const targetEl = document.getElementById("hqTarget");
  const textEl = document.getElementById("hqMessageText");
  const hqStatus = document.getElementById("hqStatus");

  const rawTarget = targetEl ? (targetEl.value || "").trim() : "ALL";
  const text = (textEl ? textEl.value : "").trim();
 
  if (!text) {
    alert("Type a message first");
    return;
  }

  // Prefer event_code (server resolves event_id safely)
  const eventCode =
    (typeof getEventCode === "function" ? getEventCode() : "") ||
    (window.TVEMC_EVENT_CODE || "") ||
    "KH_SOB_2026_0003";

  // Legacy fallback (only used if present & numeric)
  const eventIdRaw =
    (document.getElementById("eventId")?.value || window.TVEMC_EVENT_ID || "")
      .toString()
      .trim();
  const eventId = /^\d+$/.test(eventIdRaw) ? eventIdRaw : null;

  const operator =
    (document.getElementById("operatorName")?.value || "").trim();

  // ✅ Only block if BOTH are missing
  if (!eventCode && !eventId) {
    alert("Missing Event Code / Event ID.");
    return;
  }

  // --- AUTO fan-out mapping ---
  // Support either internal codes (KANAN_AUTO) or label-like values (KANAN ROAD (AUTO))
  const AUTO_FANOUT = {
    "CORRAL_AUTO": ["AS1"],  // , "AS8", "AS10"
  //  "CORRAL (AUTO)": ["AS1", "AS8", "AS10"],
  //  "CORRAL ROAD (AUTO)": ["AS1", "AS8", "AS10"],

    "KANAN_AUTO": ["AS7"],  // , "AS7" "AS2"
  // "KANAN (AUTO)": ["AS2", "AS7"],
  //  "KANAN ROAD (AUTO)": ["AS2", "AS7"],

    "ZUMA_AUTO": ["AS4"], // , "AS6"
 // "ZUMA (AUTO)": ["AS4", "AS6"],
 // "ZUMA ROAD (AUTO)": ["AS4", "AS6"],
  };
  
  // Expand target(s)
  let expandedTargets = AUTO_FANOUT[rawTarget] || [rawTarget];
  expandedTargets = Array.from(new Set(expandedTargets.map(t => String(t).toUpperCase())));
  
  if (hqStatus) hqStatus.textContent = "Sending Internet message...";

  // Group id so the HQ log can correlate the fan-out (optional but helpful)
  const fanoutGroup = "AUTO_" + Date.now() + "_" + Math.random().toString(16).slice(2);

  // Send 1 DB log row per real target
  const results = [];
  for (const target of expandedTargets) {
    const payload = {
      event_code: eventCode,             // ✅ authoritative
      event_id: eventId,                 // optional legacy fallback
      station_target: target,            // ✅ must be REAL station target for inbox matching
      channel: "internet",
      message_text: text,
      operator: operator || "",
      msg_number: null,

      // Optional metadata (safe if server ignores unknown fields)
      auto_source: (AUTO_FANOUT[rawTarget] ? rawTarget : ""),
      fanout_group: (AUTO_FANOUT[rawTarget] ? fanoutGroup : ""),
    };

    const r = await logHqMessageToServer(payload);
    results.push(r);

    if (!r || !r.success) {
      if (hqStatus) {
        hqStatus.textContent = "Error sending Internet message";
        setTimeout(() => (hqStatus.textContent = "Status: Ready"), 4000);
      }
      alert("Could not log Internet HQ message: " + (r?.error || "Unknown error"));
      return;
    }
  }
  
  // Clear input on success
  if (textEl) textEl.value = "";

  if (hqStatus) {
    const sentCount = expandedTargets.length;
    hqStatus.textContent = sentCount > 1
      ? `Internet message logged (${sentCount} stations)!`
      : "Internet message logged!";
    setTimeout(() => (hqStatus.textContent = "Status: Ready"), 3000);
  }

  // Log first id if returned
  console.log("Internet HQ message logged:", results);
};

