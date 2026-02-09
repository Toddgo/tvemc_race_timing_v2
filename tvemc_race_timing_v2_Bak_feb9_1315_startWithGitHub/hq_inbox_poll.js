// hq_inbox_poll.js
// ==============================
// Poller: fetch messages from hq_messages for this station
// - Pending inbox: fetch_hq_messages.php (acknowledged = 0)
// - History: fetch_hq_log.php
// ==============================
(function () {
  const seenHqMessageIds = new Set();
    
    // Aid Station: show a new message from HQ (Pending inbox UI + ACK)
window.showHqMessageAtStation = function (msg) {
  // msg can be a string OR an object { text, channel, created_at, operator, id, station_label }
  const inbox = document.getElementById("stationInbox");
  const body = document.getElementById("stationInboxBody");
  const title = document.getElementById("stationInboxTitle");
  if (!inbox || !body) return;

  // Ensure box is visible
  inbox.style.display = "block";

  // Optional title (pretty station label if available)
  const stationLabel =
    (msg && typeof msg === "object" && msg.station_label) ||
    window.TVEMC_STATION_LABEL ||
    "";
  if (title) {
    title.textContent = stationLabel ? ("HQ Inbox — " + stationLabel) : "HQ Inbox";
  }

  // If placeholder exists, clear it
  if (body.textContent.trim() === "No messages from HQ yet.") {
    body.textContent = "";
  }

  // Normalize msg
  let text = "";
  let channel = "";
  let created = "";
  let operator = "";
  let messageId = null;

  if (typeof msg === "string") {
    text = msg;
  } else if (msg && typeof msg === "object") {
    text = msg.text || "";
    channel = msg.channel || "";
    created = msg.created_at || "";
    operator = msg.operator || "";
    messageId = msg.id || null; // DB id from fetch_hq_messages.php
  }

  const ts = created || new Date().toLocaleTimeString();
  
  if (messageId && seenHqMessageIds.has(messageId)) return;
  if (messageId) seenHqMessageIds.add(messageId);

  // Container for this message
  const wrapper = document.createElement("div");
  wrapper.style.borderBottom = "1px solid #555";
  wrapper.style.padding = "6px 0";
  wrapper.style.display = "flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "10px";

  // Left side: message text
  const msgText = document.createElement("div");
  msgText.style.flex = "1";

  let line = `[${ts}] ${text}`;
  if (channel) line += ` (via ${String(channel).toUpperCase()})`;
  if (operator) line += ` – ${operator}`;
  msgText.textContent = line;

  // Right side: "Received" checkbox
  const ackLabel = document.createElement("label");
  ackLabel.style.fontSize = "12px";
  ackLabel.style.whiteSpace = "nowrap";
  ackLabel.style.cursor = "pointer";

  const ackCheckbox = document.createElement("input");
  ackCheckbox.type = "checkbox";
  ackCheckbox.style.marginRight = "6px";
  ackCheckbox.disabled = !messageId; // can't ACK without id

  const ackText = document.createElement("span");
  ackText.textContent = "Received";

  ackLabel.appendChild(ackCheckbox);
  ackLabel.appendChild(ackText);

  // When the station checks "Received"
  ackCheckbox.addEventListener("change", async function () {
    if (!ackCheckbox.checked) return;

    stopHqInboxFlash();
    ackCheckbox.disabled = true;

    if (messageId) {
      const result = await sendHqAckToServer(messageId);
      if (!result.success) {
        // Rollback if failed
        ackCheckbox.checked = false;
        ackCheckbox.disabled = false;
        alert("ACK failed: " + (result.error || "Unknown error"));
        return;
      }
    }

    ackText.textContent = "Received ✓";
    wrapper.style.opacity = "0.7";
  });

  wrapper.appendChild(msgText);
  wrapper.appendChild(ackLabel);

  // Newest message at the TOP
  if (body.firstChild) {
    body.insertBefore(wrapper, body.firstChild);
  } else {
    body.appendChild(wrapper);
  }

  // Flash to draw attention
  startHqInboxFlash();
};


// Send ACK back to server so HQ can see message was received
async function sendHqAckToServer(messageId) {
  if (!messageId) return { success: false, error: "Missing message id" };

  try {
    const res = await fetch("hq_ack_message.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: messageId }) // ✅ matches PHP: $data['id']
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = (data && data.error) ? data.error : ("HTTP " + res.status);
      return { success: false, error: msg };
    }

    if (data && data.success) return { success: true, updated: data.updated || 0 };

    return { success: false, error: (data && data.error) ? data.error : "Unknown ACK response" };
  } catch (err) {
    return { success: false, error: err.message || "Fetch error" };
  }
}


// Start flashing the inbox
function startHqInboxFlash() {
  const inbox = document.getElementById("stationInbox");
  if (!inbox) return;
  inbox.classList.add("hq-inbox-new");
}

// Stop flashing (used when they scroll or acknowledge)
function stopHqInboxFlash() {
  const inbox = document.getElementById("stationInbox");
  if (!inbox) return;
  inbox.classList.remove("hq-inbox-new");
}

// Stop flashing when the station scrolls the inbox
window.addEventListener("load", function () {
  const body = document.getElementById("stationInboxBody");
  if (!body) return;

  body.addEventListener("scroll", function () {
    stopHqInboxFlash();
  });
});

    
  // Fallback mapping ONLY if a station dropdown ever uses human text as the value
  function stationNameToId(name) {
    if (!name) return "";
    const trimmed = name.trim().toUpperCase();

    switch (trimmed) {
      case "📍 CORRAL CANYON #1": return "AS1";
      case "📍 KANAN ROAD #1": return "AS2";
      // NOTE: if the turnaround spot isn't a real aid station code in DB, don't map it to AS3.
      // Keep it only if you truly log HQ messages to station_target="AS3".
      case "📍 TURNAROUND SPOT (30K NO AID)": return "AS3";
      case "📍 ZUMA EDISION RIDGE MTWY #1": return "AS4";
      case "📍 BANSALL": return "AS5";
      case "📍 ZUMA EDISON RIDGE MTWY #2": return "AS6";
      case "📍 KANAN ROAD #2": return "AS7";
      case "📍 CORRAL CANYON #2": return "AS8";
      case "📍 100K TURNAROUND - BULLDOG": return "AS9";
      case "📍 CORRAL CANYON #3": return "AS10";
      case "📍 PIUMA CREEK (NO AID)": return "AS11";

      case "START":
      case "🏁START":
      case "🏁 START":
        return "START";

      case "FINISH LINE":
      case "🏁FINISH LINE":
      case "🏁 FINISH LINE":
        return "FINISH";

      case "ALL":
        return "ALL";
      
            // AUTO station modes (critical for Sean O’Brien)
      case "📍 CORRAL CANYON (AUTO)":
      case "CORRAL_AUTO":
        return "CORRAL_AUTO";

      case "📍 KANAN ROAD (AUTO)":
      case "KANAN_AUTO":
        return "KANAN_AUTO";

      case "📍 ZUMA (AUTO)":
      case "ZUMA_AUTO":
        return "ZUMA_AUTO";    

      default:
        return "";
    }
  }

  // Get station target used for DB filtering (AS2/START/FINISH/ALL)
  function getStationId() {
    const raw = (window.TVEMC_STATION_ID || "").trim();
    if (!raw) return "";

    // already an ID?
    if (
      /^AS\d+$/i.test(raw) ||
      raw === "START" ||
      raw === "FINISH" ||
      raw === "ALL" ||
      raw === "T30K" ||
      /_AUTO$/i.test(raw)        // ✅ allow CORRAL_AUTO / KANAN_AUTO / ZUMA_AUTO
    ) {
      return raw;
    }

    // fallback mapping from label/name
    return stationNameToId(raw);
  }

  let lastHqMessageId = 0;

  // Pending inbox polling: only NOT ACKed messages
  async function pollHqMessagesForStation() {
    const stationId = getStationId();
    console.log("HQ inbox polling as stationId =", stationId);
    if (!stationId) return;

    try {
      const urlObj = new URL("fetch_hq_messages.php", window.location.href);
      urlObj.searchParams.set("event_code",(typeof getEventCode === "function" && getEventCode()) || "AZM-300-2026-0004");
         // urlObj.searchParams.set("event_code", "KH_SOB_2026_01");   // KH_SOB_2026_01
      urlObj.searchParams.set("station", stationId);
      if (lastHqMessageId > 0) urlObj.searchParams.set("since_id", String(lastHqMessageId));
      const url = urlObj.toString();

      const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) {
        console.error("fetch_hq_messages HTTP error", response.status);
        return;
      }

      const data = await response.json();
      if (!data.success) {
        console.error("fetch_hq_messages API error", data.error);
        return;
      }

      const messages = data.messages || [];
      if (!messages.length) return;

      messages.forEach((msg) => {
        if (msg.id && msg.id > lastHqMessageId) lastHqMessageId = msg.id;

        if (typeof window.showHqMessageAtStation === "function") {
          window.showHqMessageAtStation({
            text: msg.message_text,
            channel: msg.channel,
            operator: msg.operator,
            created_at: msg.created_at,
            id: msg.id,

            // Optional: give the UI a pretty station label if it wants it
            station_id: stationId,
            station_label: window.TVEMC_STATION_LABEL || stationId
          });
        }
      });
    } catch (err) {
      console.error("fetch_hq_messages fetch error", err);
    }
  }

  // History loader: last 10 messages for this station (including broadcasts)
  async function loadStationHistory() {
    const stationId = getStationId();
    if (!stationId) return;

    const historyBox = document.getElementById("stationHistory");
    const historyBody = document.getElementById("stationHistoryBody");
    if (!historyBox || !historyBody) return;

    try {
      const urlObj = new URL("fetch_hq_log.php", window.location.href);
      // urlObj.searchParams.set("event_code", "KH_SOB_2026_01");   /// WAS  KH_SOB_TEST
      urlObj.searchParams.set("event_code",(typeof getEventCode === "function" && getEventCode()) || "AZM-300-2026-0004");

      urlObj.searchParams.set("station", stationId);
      urlObj.searchParams.set("limit", "10");
      const url = urlObj.toString();

      const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) {
        console.error("station history HTTP error", response.status);
        return;
      }

      const data = await response.json();
      if (!data.success) {
        console.error("station history API error", data.error);
        return;
      }

      const messages = data.messages || [];
      historyBox.style.display = "block";
      historyBody.innerHTML = "";

      if (!messages.length) {
        const div = document.createElement("div");
        div.style.fontStyle = "italic";
        div.style.color = "#ccc";
        div.textContent = "No recent HQ messages.";
        historyBody.appendChild(div);
        return;
      }

      messages.forEach((msg) => {
        const div = document.createElement("div");
        div.style.borderBottom = "1px solid #444";
        div.style.padding = "2px 0";

        const time = msg.created_at || "";
        const text = msg.message_text || "";
        const channel = (msg.channel || "").toUpperCase();
        const operator = msg.operator || "";

        div.textContent = `[${time}] ${text} (${channel})`;
        if (operator) div.textContent += ` – ${operator}`;
        historyBody.appendChild(div);
      });
    } catch (err) {
      console.error("station history fetch error", err);
    }
  }

  // Start polling when page is loaded (aid station view)
  window.addEventListener("load", function () {
    // Do NOT poll in HQ mode (?hq=1)
    if (window.location.search.includes("hq=1")) return;

    // ✅ The dropdown value is the station ID (AS2). Use it directly.
    const stationSelect = document.getElementById("aidStation");
    if (stationSelect) {
      const val = (stationSelect.value || "").trim();

      // if val is already AS-code or START/FINISH/ALL, use it
      if (
      /^AS\d+$/i.test(val) ||
      val === "START" ||
      val === "FINISH" ||
      val === "ALL" ||
      val === "T30K" ||
      /_AUTO$/i.test(val)        // ✅ accept AUTO codes directly
    ) {
      window.TVEMC_STATION_ID = val;
    } else {

        // fallback: treat val as label/name
        const mapped = stationNameToId(val);
        if (mapped) window.TVEMC_STATION_ID = mapped;
      }

      // store label for pretty UI (optional)
      const label = (stationSelect.selectedOptions?.[0]?.textContent || "").trim();
      if (label) window.TVEMC_STATION_LABEL = label;
    }

    const stationId = getStationId();
    if (!stationId) return;

    const stored = localStorage.getItem("TVEMC_lastHqMessageId_" + stationId);
    if (stored) lastHqMessageId = parseInt(stored, 10) || 0;

    pollHqMessagesForStation();
    loadStationHistory();

    setInterval(pollHqMessagesForStation, 30000);
    setInterval(loadStationHistory, 30000);

    setInterval(function () {
      localStorage.setItem("TVEMC_lastHqMessageId_" + stationId, String(lastHqMessageId));
    }, 60000);
  });
})();
