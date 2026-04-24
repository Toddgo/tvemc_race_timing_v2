// hq_log.js =======================
// HQ Message Log (HQ / ?hq=1 only)
// ==============================
(function () {
  // formatHqTimestamp is defined and exposed as window.formatHqTimestamp by
  // hq_inbox_poll.js (which loads before this file).  Use that shared implementation;
  // fall back to a raw-string display only if somehow not available.
  function safeFormatTimestamp(ts) {
    if (typeof window.formatHqTimestamp === "function") {
      return window.formatHqTimestamp(ts);
    }
    return ts || "";
  }

  // Map a station code from the DB (AS1, AS4, START, etc.)
  // to a human-friendly label using the HQ filter dropdown.
  // Includes a safe override for AS1 (HELL HILL AID #1).
  function prettyStationLabel(codeRaw) {
    if (!codeRaw) return "";

    // Normalize whatever we got from the DB
    var code = String(codeRaw).trim().toUpperCase();

    // Hard override for Hell Hill, in case the dropdown or DB ever disagree.
    if (code === "AS1") {
      return "📍 CORRAL CANYON #1";
    }

    // Look at the existing HQ log station filter for labels
    var filter = document.getElementById("hqLogStationFilter");
    if (!filter) return code;

    var opt = Array.from(filter.options).find(function (o) {
      return String(o.value).trim().toUpperCase() === code;
    });

    // If we find a matching option, use its visible text; otherwise show the code
    return opt && opt.textContent.trim() ? opt.textContent.trim() : code;
  }

 async function loadHqLog() {
  const stationFilter = document.getElementById("hqLogStationFilter");
  const ackFilter = document.getElementById("hqLogAckFilter");
  const statusEl = document.getElementById("hqLogStatus");
  const table = document.getElementById("hqLogTable");
  const tbody = table ? table.querySelector("tbody") : null;

  // Require event_code (single source of truth)
  const event_code = (typeof getEventCode === "function") ? getEventCode() : "";
    if (!event_code) {
      // Don’t spam console; just try again next refresh
      if (statusEl) statusEl.textContent = "Waiting for event code...";
      return;
    }

  if (!table || !tbody) {
    console.warn("HQ log table not found (#hqLogTable).");
    return;
  }

  // HQ filters
  const station = stationFilter ? stationFilter.value : "";
  const ack = ackFilter ? ackFilter.value : "";

  // Build URL with event_code included
  const urlObj = new URL("fetch_hq_log.php", window.location.href);
  urlObj.searchParams.set("event_code", event_code);
  urlObj.searchParams.set("station", station || "ALL");
  if (ack) urlObj.searchParams.set("ack", ack);
  urlObj.searchParams.set("limit", "100");

  const url = urlObj.toString();

  if (statusEl) statusEl.textContent = "Loading log...";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    if (!response.ok) {
      console.error("fetch_hq_log HTTP error", response.status);
      if (statusEl) statusEl.textContent = `Error loading log (HTTP ${response.status})`;
      return;
    }

    const data = await response.json();
    if (!data.success) {
      console.error("fetch_hq_log API error", data.error);
      if (statusEl) statusEl.textContent = "Error: " + (data.error || "Unknown error");
      return;
    }

    const messages = data.messages || [];
    tbody.innerHTML = "";

    if (!messages.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.style.padding = "6px";
      cell.style.textAlign = "center";
      cell.style.fontStyle = "italic";
      cell.textContent = "No messages found for this filter.";
      row.appendChild(cell);
      tbody.appendChild(row);
      if (statusEl) statusEl.textContent = "0 messages";
      return;
    }

    messages.forEach(function (msg) {
      const row = document.createElement("tr");

      // Highlight rows where a station replied to HQ
      const isFromStation = (msg.station_target || "").toUpperCase() === "HQ";
      if (isFromStation) {
        row.style.background = "#fffbe6";
      }

      function td(text) {
        const c = document.createElement("td");
        c.style.borderBottom = "1px solid #eee";
        c.style.padding = "4px";
        c.textContent = text;
        return c;
      }

      const timeText = safeFormatTimestamp(msg.created_at);
      // For station→HQ rows show "→ HQ"; for HQ→station rows show destination
      const stationText = isFromStation
        ? "→ HQ"
        : prettyStationLabel(msg.station_target || "");
      // "From" column: sender_station if present
      const fromText = isFromStation
        ? prettyStationLabel(msg.sender_station || "")
        : "";
      const channelText = (msg.channel || "").toUpperCase();
      const messageText = msg.message_text || "";
      const operatorText = msg.operator || "";

      const acked = Number(msg.acknowledged || 0) === 1;
      const ackTimeText = acked && msg.ack_time ? safeFormatTimestamp(msg.ack_time) : "";

      row.appendChild(td(timeText));
      row.appendChild(td(stationText));
      row.appendChild(td(fromText));
      row.appendChild(td(channelText));
      row.appendChild(td(messageText));
      row.appendChild(td(operatorText));

      // ACK cell — station→HQ rows get a clickable ACK button when unacknowledged
      const ackCell = document.createElement("td");
      ackCell.style.borderBottom = "1px solid #eee";
      ackCell.style.padding = "4px";
      ackCell.style.textAlign = "center";

      if (acked) {
        ackCell.textContent = "✅";
      } else if (isFromStation && msg.id) {
        // HQ needs to acknowledge this incoming station message
        const ackBtn = document.createElement("button");
        ackBtn.textContent = "⏳ ACK";
        ackBtn.title = "Click to confirm HQ received this message";
        ackBtn.style.cssText =
          "cursor:pointer;padding:2px 8px;font-size:12px;background:#fffbe6;" +
          "border:1px solid #ccc;border-radius:4px;";

        const ackTimeCell = document.createElement("td");
        ackTimeCell.style.borderBottom = "1px solid #eee";
        ackTimeCell.style.padding = "4px";

        ackBtn.addEventListener("click", async function () {
          ackBtn.disabled = true;
          ackBtn.textContent = "Saving…";
          try {
            const res = await fetch("hq_ack_message.php", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: msg.id })
            });
            const result = await res.json().catch(() => null);
            if (result && result.success) {
              ackCell.textContent = "✅";
              ackTimeCell.textContent = safeFormatTimestamp(
                new Date().toISOString().replace("T", " ").substring(0, 19)
              );
              row.style.background = "";
            } else {
              ackBtn.disabled = false;
              ackBtn.textContent = "⏳ ACK";
              alert("ACK failed: " + ((result && result.error) || "Unknown error"));
            }
          } catch (err) {
            ackBtn.disabled = false;
            ackBtn.textContent = "⏳ ACK";
            alert("ACK error: " + err.message);
          }
        });

        ackCell.appendChild(ackBtn);
        row.appendChild(ackCell);
        ackTimeCell.textContent = ackTimeText;
        row.appendChild(ackTimeCell);
        tbody.appendChild(row);
        return; // row already appended — skip the two appends below
      } else {
        ackCell.textContent = "⏳";
      }

      row.appendChild(ackCell);

      const ackTimeCellPlain = document.createElement("td");
      ackTimeCellPlain.style.borderBottom = "1px solid #eee";
      ackTimeCellPlain.style.padding = "4px";
      ackTimeCellPlain.textContent = ackTimeText;
      row.appendChild(ackTimeCellPlain);

      tbody.appendChild(row);
    });

    if (statusEl) statusEl.textContent = `${messages.length} messages loaded`;
  } catch (err) {
    console.error("fetch_hq_log fetch error", err);
    if (statusEl) statusEl.textContent = "Error loading log: " + err.message;
  }
}


  window.addEventListener("load", function () {
    // Only show and run the HQ log in HQ mode
    if (!window.location.search.includes("hq=1")) {
      return;
    }

    const logBox = document.getElementById("hqLogBox");
    if (logBox) {
      logBox.style.display = "block";
    }

    const stationFilter = document.getElementById("hqLogStationFilter");
    const ackFilter = document.getElementById("hqLogAckFilter");
    const refreshBtn = document.getElementById("hqLogRefreshBtn");

    if (stationFilter) {
      stationFilter.addEventListener("change", loadHqLog);
    }
    if (ackFilter) {
      ackFilter.addEventListener("change", loadHqLog);
    }
    if (refreshBtn) {
      refreshBtn.addEventListener("click", loadHqLog);
    }

    // Initial load
    loadHqLog();

    // Auto-refresh every 30 seconds
    setTimeout(loadHqLog, 200);
    setInterval(loadHqLog, 20000);

    // Poll for new station→HQ reply messages and flash the log box
    let lastSeenReplyId = 0;

    async function pollStationReplies() {
      const event_code = (typeof getEventCode === "function") ? getEventCode() : "";
      if (!event_code) return;

      try {
        const urlObj = new URL("fetch_hq_messages.php", window.location.href);
        urlObj.searchParams.set("event_code", event_code);
        urlObj.searchParams.set("station", "HQ");
        if (lastSeenReplyId > 0) urlObj.searchParams.set("since_id", String(lastSeenReplyId));

        const res = await fetch(urlObj.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store"
        });
        if (!res.ok) return;

        const data = await res.json().catch(() => null);
        if (!data || !data.success) return;

        const replies = data.messages || [];
        if (!replies.length) return;

        replies.forEach(function (msg) {
          if (msg.id && msg.id > lastSeenReplyId) lastSeenReplyId = msg.id;
        });

        // Flash the HQ log box and reload to show new messages
        const logBox = document.getElementById("hqLogBox");
        if (logBox) {
          logBox.classList.add("hq-inbox-new");
          setTimeout(function () { logBox.classList.remove("hq-inbox-new"); }, 6000);
        }
        loadHqLog();
      } catch (e) {
        // Silently ignore poll errors
      }
    }

    setInterval(pollStationReplies, 30000);

  });
})();
