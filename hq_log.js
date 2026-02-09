// hq_log.js =======================
// HQ Message Log (HQ / ?hq=1 only)
// ==============================
(function () {
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
      cell.colSpan = 7;
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

      function td(text) {
        const c = document.createElement("td");
        c.style.borderBottom = "1px solid #eee";
        c.style.padding = "4px";
        c.textContent = text;
        return c;
      }

      const timeText = msg.created_at || "";
      const stationText = prettyStationLabel(msg.station_target || "");
      const channelText = (msg.channel || "").toUpperCase();
      const messageText = msg.message_text || "";
      const operatorText = msg.operator || "";

      const acked = Number(msg.acknowledged || 0) === 1;
      const ackText = acked ? "✅" : "⏳";
      const ackTimeText = acked && msg.ack_time ? msg.ack_time : "";

      row.appendChild(td(timeText));
      row.appendChild(td(stationText));
      row.appendChild(td(channelText));
      row.appendChild(td(messageText));
      row.appendChild(td(operatorText));
      row.appendChild(td(ackText));
      row.appendChild(td(ackTimeText));

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

  });
})();
