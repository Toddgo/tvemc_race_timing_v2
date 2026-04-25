// radio-system.js – single source of truth for all radio behavior

// ----------------------------------------------------------------------
// State & helpers
// ----------------------------------------------------------------------
let currentRadioMessageNum = parseInt(localStorage.getItem("radioMsgNum") || "1", 10);
let radioConnection = null;
window.radioConnection = window.radioConnection || null;

// ----------------------------------------------------------------------
// RX: replay-guard (seen MSG:NNN sequence numbers)
// ----------------------------------------------------------------------
const _seenRadioMsgNums = new Set();

// ----------------------------------------------------------------------
// RX: KISS frame accumulator and decoder
// ----------------------------------------------------------------------
let _kissBuffer = new Uint8Array(0);

function _appendKissBuffer(chunk) {
  const merged = new Uint8Array(_kissBuffer.length + chunk.length);
  merged.set(_kissBuffer);
  merged.set(chunk, _kissBuffer.length);
  _kissBuffer = merged;
}

function _extractKissFrames() {
  const frames = [];
  const buf = _kissBuffer;
  const FEND = 0xC0, FESC = 0xDB, TFEND = 0xDC, TFESC = 0xDD;

  let i = 0;
  let frameStart = -1;

  while (i < buf.length) {
    if (buf[i] === FEND) {
      if (frameStart === -1) {
        frameStart = i;
      } else {
        const raw = buf.slice(frameStart + 1, i);
        if (raw.length > 0) {
          const unescaped = [];
          for (let j = 0; j < raw.length; j++) {
            if (raw[j] === FESC && j + 1 < raw.length) {
              j++;
              unescaped.push(raw[j] === TFEND ? FEND : raw[j] === TFESC ? FESC : raw[j]);
            } else {
              unescaped.push(raw[j]);
            }
          }
          if (unescaped[0] === 0x00 && unescaped.length > 1) {
            frames.push(new Uint8Array(unescaped.slice(1)));
          }
        }
        frameStart = i;
      }
    }
    i++;
  }

  _kissBuffer = frameStart >= 0 ? buf.slice(frameStart) : new Uint8Array(0);
  return frames;
}

// ----------------------------------------------------------------------
// RX: AX.25 information-field extractor
// Walks the address field (7-byte groups, last address has H-bit=1),
// skips the control + PID bytes, returns the info field as UTF-8 text.
// ----------------------------------------------------------------------
function _extractAX25Info(frame) {
  if (!frame || frame.length < 15) return null;

  let pos = 0;
  while (pos + 7 <= frame.length) {
    const lastByte = frame[pos + 6];
    pos += 7;
    if (lastByte & 0x01) break;
    if (pos >= frame.length) return null;
  }

  const infoStart = pos + 2; // skip control + PID bytes
  if (infoStart >= frame.length) return null;

  return new TextDecoder("utf-8", { fatal: false }).decode(frame.slice(infoStart));
}

// ----------------------------------------------------------------------
// RX: entry point — called for every chunk/message from any TNC interface
// ----------------------------------------------------------------------
function handleIncomingRadioData(raw) {
  if (typeof raw === "string") {
    parseAndRouteRadioMessage(raw.trim());
    return;
  }

  let bytes;
  if (raw instanceof ArrayBuffer) {
    bytes = new Uint8Array(raw);
  } else if (raw instanceof Uint8Array) {
    bytes = raw;
  } else {
    return;
  }

  _appendKissBuffer(bytes);
  const frames = _extractKissFrames();
  for (const frame of frames) {
    const info = _extractAX25Info(frame);
    if (info) parseAndRouteRadioMessage(info.trim());
  }
}

// ----------------------------------------------------------------------
// RX: Serial read pump for TNC4 Web Serial
// ----------------------------------------------------------------------
async function pumpSerialReader(port) {
  try {
    const reader = port.readable.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      handleIncomingRadioData(value);
    }
  } catch (e) {
    console.warn("[Radio RX] Serial reader stopped:", e);
  }
}

// ----------------------------------------------------------------------
// RX: Minimal CSV line parser (handles RFC 4180 double-quoted fields)
// ----------------------------------------------------------------------
function _parseCSVLine(line) {
  const cols = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ",") { cols.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  cols.push(cur);
  return cols;
}

// ----------------------------------------------------------------------
// RX: import runner CSV rows from a radio message into localStorage
// and (on HQ page) POST each row to passes_submit.php
// ----------------------------------------------------------------------
function _importRadioRunnerData(lines) {
  // lines[0] = "MSG:NNN TVEMC {station} Runner Updates"
  // lines[1] = CSV header
  // lines[2+] = data rows (until "END")
  const dataLines = [];
  for (let i = 2; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l === "END") break;
    dataLines.push(l);
  }
  if (!dataLines.length) return;

  // CSV field order matches buildRadioRunnerMessage:
  // bib_number, action, time, day, station, comment, eta, operator, date,
  // eventName, first_name, last_name, age, gender, distance
  const newEntries = dataLines.map((line) => {
    const c = _parseCSVLine(line);
    return {
      bib_number: c[0] || "",
      action:     c[1] || "",
      time:       c[2] || "",
      day:        c[3] || "",
      station:    c[4] || "",
      comment:    c[5] || "",
      eta:        c[6] || "",
      operator:   c[7] || "",
      date:       c[8] || "",
      eventName:  c[9] || "",
      first_name: c[10] || "",
      last_name:  c[11] || "",
      age:        c[12] || "",
      gender:     c[13] || "",
      distance:   c[14] || "",
      radioReceived: true,
      radioSent: true
    };
  }).filter((e) => e.bib_number !== "");

  if (!newEntries.length) return;

  const existing = JSON.parse(localStorage.getItem("bibEntries") || "[]");
  let added = 0;
  for (const entry of newEntries) {
    const key = `${entry.bib_number}|${entry.action}|${entry.time}|${entry.station}`;
    const isDuplicate = existing.some(
      (e) =>
        `${e.bib_number || e["Bib #"]}|${e.action}|${e.time}|${e.station || e["Station"]}` === key
    );
    if (!isDuplicate) {
      existing.push(entry);
      added++;
    }
  }

  if (added > 0) {
    localStorage.setItem("bibEntries", JSON.stringify(existing));
    console.log(`[Radio RX] Imported ${added} new bib entries`);
    if (typeof window.loadData === "function") window.loadData();
    window.dispatchEvent(new CustomEvent("bibEntriesUpdated", { detail: { added } }));
  }

  // On HQ page: persist each entry to the DB via passes_submit.php
  if (new URLSearchParams(window.location.search).get("hq") === "1") {
    const eventCode =
      (typeof getEventCode === "function" && getEventCode()) || "";
    newEntries.forEach((entry) => {
      if (!entry.bib_number) return;
      fetch("passes_submit.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_code:    eventCode,
          bib:           parseInt(entry.bib_number, 10) || 0,
          distance_code: entry.distance || "",
          pass_type:     (entry.action || "IN").toUpperCase(),
          station_code:  entry.station || "",
          operator:      entry.operator || "",
          note:          entry.comment || ""
        })
      }).catch((e) => console.error("[Radio RX] passes_submit POST failed", e));
    });
  }
}

// ----------------------------------------------------------------------
// RX: parse and route a fully-decoded text message
// ----------------------------------------------------------------------
async function parseAndRouteRadioMessage(text) {
  if (!text || !text.startsWith("MSG:")) return;

  const lines = text.split("\n");
  const firstLine = lines[0];

  const numMatch = firstLine.match(/^MSG:(\d+)\s/);
  if (!numMatch) return;
  const msgNum = parseInt(numMatch[1], 10);

  if (_seenRadioMsgNums.has(msgNum)) {
    console.log(`[Radio RX] Duplicate MSG:${String(msgNum).padStart(3, "0")} – ignored`);
    return;
  }
  _seenRadioMsgNums.add(msgNum);
  console.log(`[Radio RX] MSG:${String(msgNum).padStart(3, "0")} received`);

  // HQ → Station: "MSG:NNN TVEMC HQ TO {target}: {text}"
  const hqToStation = firstLine.match(/^MSG:\d+ TVEMC HQ TO ([^:]+):\s*(.*)/);
  if (hqToStation) {
    const target  = hqToStation[1].trim();
    const msgText = hqToStation[2].trim();
    if (typeof window.showHqMessageAtStation === "function") {
      window.showHqMessageAtStation({
        text:        msgText,
        channel:     "radio",
        created_at:  new Date().toISOString(),
        operator:    "",
        id:          null,
        station_label: target
      });
    }
    return;
  }

  // Station → HQ: "MSG:NNN TVEMC {station} TO HQ: {text}"
  const stationToHq = firstLine.match(/^MSG:\d+ TVEMC (.+?) TO HQ:\s*(.*)/);
  if (stationToHq && new URLSearchParams(window.location.search).get("hq") === "1") {
    const senderStation = stationToHq[1].trim();
    const msgText       = stationToHq[2].trim();
    const eventCode =
      (typeof getEventCode === "function" && getEventCode()) || "";
    fetch("station_reply.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_code:     eventCode,
        sender_station: senderStation,
        message_text:   msgText,
        operator:       "",
        channel:        "radio"
      })
    }).catch((e) => console.error("[Radio RX] station_reply POST failed", e));
    return;
  }

  // Runner data: "MSG:NNN TVEMC {station} Runner Updates"
  if (/^MSG:\d+ TVEMC .+ Runner Updates/.test(firstLine)) {
    _importRadioRunnerData(lines);
    return;
  }

  // General comment: "MSG:NNN TVEMC {station} General: {text}"
  const general = firstLine.match(/^MSG:\d+ TVEMC (.+?) General:\s*(.*)/);
  if (general) {
    console.log(
      `[Radio RX] General comment from ${general[1].trim()}: ${general[2].trim()}`
    );
    return;
  }
}

function saveRadioMessageNum() {
  localStorage.setItem("radioMsgNum", currentRadioMessageNum.toString());
  const el = document.getElementById("messageNumber");
  if (el) {
    el.textContent = `Next Msg#: ${String(currentRadioMessageNum).padStart(3, "0")}`;
  }
}

function showRadioStatus(text, color = "white") {
  const el = document.getElementById("radioStatus");
  if (el) {
    el.textContent = `Radio: ${text}`;
    el.style.color = color;
  }
}

// ----------------------------------------------------------------------
// Auto-connect to Direwolf / VARA via TCP-KISS, or Mobilinkd TNC4 via Web Serial
// ----------------------------------------------------------------------
async function autoConnectRadio() {
  if (radioConnection) {
    showRadioStatus("Already connected", "lime");
    return true;
  }

  // Try TCP KISS for Direwolf/VARA
  for (const port of [8001, 8100, 8300]) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.binaryType = "arraybuffer";

      const connected = await new Promise((resolve) => {
        ws.onopen = () => {
          radioConnection = ws;
          window.radioConnection = ws;
          resolve(true);
        };
        ws.onerror = () => resolve(false);
        ws.onclose = () => resolve(false);
        setTimeout(() => resolve(false), 3000);
      });

      if (connected) {
        ws.onmessage = function (event) {
          handleIncomingRadioData(event.data);
        };
        showRadioStatus(`Connected TCP KISS (port ${port}) – Direwolf/VARA ready`, "lime");
        saveRadioMessageNum();
        return true;
      }

      ws.close();
    } catch (e) {
      // try next port
    }
  }

  // Try Mobilinkd TNC4 via Web Serial
  if ("serial" in navigator) {
    try {
      const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x1a86 }] });
      await port.open({ baudRate: 57600 });

      const writer = port.writable.getWriter();
      await writer.write(new TextEncoder().encode("\r\nKISS ON\r\nRESTART\r\n"));
      await new Promise((r) => setTimeout(r, 1800));
      writer.releaseLock();

      radioConnection = port;
      window.radioConnection = port;
      pumpSerialReader(port);
      showRadioStatus("Connected to Mobilinkd TNC4", "green");
      saveRadioMessageNum();
      return true;
    } catch (e) {
      // fall through to error
    }
  }

  showRadioStatus("No radio interface found – start Direwolf or pair TNC4", "red");
  return false;
}

// ----------------------------------------------------------------------
// Hook into addEntry() once, to mark new entries as needing radio send
// ----------------------------------------------------------------------
(function setupAddEntryHook() {
  let hooked = false;

  function hook() {
    if (hooked) return;
    if (typeof window.addEntry !== "function") return;

    const originalAddEntry = window.addEntry;

    window.addEntry = function (action) {
      // Call your original addEntry from tvemc_tracker.1.3.3.js
      originalAddEntry.apply(this, arguments);

      // Mark last entry as not yet sent via radio
      try {
        const entries = JSON.parse(localStorage.getItem("bibEntries") || "[]");
        const newEntry = entries[entries.length - 1];
        if (newEntry) {
          newEntry.radioSent = false;
          localStorage.setItem("bibEntries", JSON.stringify(entries));
        }
      } catch (e) {
        console.error("Radio hook: failed to flag entry for radio send", e);
      }
    };

    hooked = true;
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    hook();
  } else {
    document.addEventListener("DOMContentLoaded", hook);
  }

  // Safety: try again shortly in case tvemc_tracker loads a bit later
  setTimeout(hook, 1000);
})();

// ----------------------------------------------------------------------
// Build radio messages
// ----------------------------------------------------------------------
function buildRadioRunnerMessage() {
  const entries = JSON.parse(localStorage.getItem("bibEntries") || "[]");

  // Only unsent entries, max 20 per message
  const lines = entries.filter((e) => e && !e.radioSent).slice(0, 20);
  if (lines.length === 0) return null;

  const msgNum = String(currentRadioMessageNum).padStart(3, "0");
  const aidStation =
    document.getElementById("aidStation")?.value || "HQ";

  const header = `MSG:${msgNum} TVEMC ${aidStation} Runner Updates`;

  const csvLines = lines.map((e) =>
    [
      e.bib_number || e["Bib #"] || "",
      e.action || "",
      e.time || "",
      e.day || "",
      e.station || e["Station"] || "",
      `"${(e.comment || "").replace(/"/g, '""')}"`,
      e.eta || "",
      e.operator || e["Operator"] || "",
      e.date || "",
      e.eventName || e["Event"] || "",
      e.first_name || e["First Name"] || "",
      e.last_name || e["Last Name"] || "",
      e.age || "",
      e.gender || "",
      e.distance || "",
    ].join(",")
  );

  // Mark them as sent
  lines.forEach((e) => {
    e.radioSent = true;
  });
  localStorage.setItem("bibEntries", JSON.stringify(entries));

  currentRadioMessageNum++;
  saveRadioMessageNum();

  return [
    header,
    "Bib#,Action,Time,Day,Station,Comment,ETA,Operator,Date,Event,First,Last,Age,Gender,Distance",
    ...csvLines,
    "END",
  ].join("\n");
}

function buildRadioGeneralMessage() {
  currentRadioMessageNum++;
  saveRadioMessageNum();
  const msgNum = String(currentRadioMessageNum - 1).padStart(3, "0");

  const aidStation =
    document.getElementById("aidStation")?.value || "HQ";
  const comment =
    document.getElementById("generalComment")?.value || "All good";

  return `MSG:${msgNum} TVEMC ${aidStation} General: ${comment}\nEND`;
}

// ----------------------------------------------------------------------
// Low-level send function
// ----------------------------------------------------------------------
async function sendRadioMessage(text) {
  const data = new TextEncoder().encode(text + "\n");

  try {
    if (radioConnection instanceof WebSocket) {
      radioConnection.send(data);
    } else if (radioConnection && radioConnection.writable) {
      const writer = radioConnection.writable.getWriter();
      await writer.write(data);
      writer.releaseLock();
    } else {
      throw new Error("No radio connection");
    }

    showRadioStatus(
      `TX OK → MSG #${String(currentRadioMessageNum - 1).padStart(3, "0")}`,
      "lime"
    );
  } catch (e) {
    console.error("sendRadioMessage error", e);
    showRadioStatus("TX FAILED: " + e.message, "red");
  }
}

// ----------------------------------------------------------------------
// Public functions called by your HTML buttons
// ----------------------------------------------------------------------
window.sendRunnerUpdatesViaRadio = async function () {
  if (!radioConnection) await autoConnectRadio();
  if (!radioConnection) return alert("Connect radio first (Direwolf or TNC4)");

  const message = buildRadioRunnerMessage();
  if (!message) return alert("No new runner updates to send");

  await sendRadioMessage(message);

  const runnerCount = message.split("\n").length - 3; // header + CSV header + END
  alert(
    `Sent Message #${String(currentRadioMessageNum - 1).padStart(
      3,
      "0"
    )} with ${runnerCount} runners`
  );
};

window.sendGeneralMessageViaRadio = async function () {
  if (!radioConnection) await autoConnectRadio();
  if (!radioConnection) return alert("Connect radio first (Direwolf or TNC4)");

  const message = buildRadioGeneralMessage();
  await sendRadioMessage(message);

  alert(
    `Sent General Message #${String(currentRadioMessageNum - 1).padStart(3, "0")}`
  );
};

// Aid station → HQ: send a text message via radio/TNC
window.sendStationToHQViaRadio = async function () {
  if (window.__sendingStationToHQRadio) return;
  window.__sendingStationToHQRadio = true;

  const radioBtn = document.getElementById("stationToHqRadioBtn");
  const textEl   = document.getElementById("stationToHqText");
  const statusEl = document.getElementById("stationToHqStatus");

  if (radioBtn) radioBtn.disabled = true;

  try {
    const text = (textEl ? textEl.value : "").trim();
    if (!text) { alert("Type a message first"); return; }

    if (!radioConnection) {
      if (statusEl) statusEl.textContent = "Connecting to radio...";
      await autoConnectRadio();
    }

    if (!radioConnection) {
      if (statusEl) {
        statusEl.textContent = "No radio connected";
        setTimeout(() => (statusEl.textContent = "Status: Ready"), 4000);
      }
      alert("Connect radio first (Direwolf or TNC4)");
      return;
    }

    const stationId    = (window.TVEMC_STATION_ID  || "").trim() ||
                         (document.getElementById("aidStation")?.value || "STATION");
    const stationLabel = (window.TVEMC_STATION_LABEL || stationId).trim();

    currentRadioMessageNum++;
    saveRadioMessageNum();
    const msgNum = String(currentRadioMessageNum - 1).padStart(3, "0");

    const message = `MSG:${msgNum} TVEMC ${stationLabel} TO HQ: ${text}\nEND`;

    if (statusEl) statusEl.textContent = "Sending via Radio...";

    try {
      await sendRadioMessage(message);
      if (textEl) textEl.value = "";
      if (statusEl) {
        statusEl.textContent = `Sent via Radio ✓ (Msg #${msgNum})`;
        setTimeout(() => (statusEl.textContent = "Status: Ready"), 4000);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = "Radio TX failed: " + err.message;
        setTimeout(() => (statusEl.textContent = "Status: Ready"), 4000);
      }
    }
  } finally {
    window.__sendingStationToHQRadio = false;
    if (radioBtn) radioBtn.disabled = false;
  }
};

window.sendHqMessage = async function () {
  if (!radioConnection) await autoConnectRadio();
  if (!radioConnection) return alert("Connect radio first (Direwolf or TNC4)");

  const targetEl = document.getElementById("hqTarget");
  const textEl = document.getElementById("hqMessageText");
  const hqStatus = document.getElementById("hqStatus");

  const target = targetEl ? targetEl.value : "ALL";
  const text = (textEl ? textEl.value : "").trim();

  if (!text) return alert("Type a message first");

  currentRadioMessageNum++;
  saveRadioMessageNum();
  const msgNum = String(currentRadioMessageNum - 1).padStart(3, "0");

  const message =
    target === "ALL"
      ? `MSG:${msgNum} TVEMC HQ TO ALL: ${text}\nEND`
      : `MSG:${msgNum} TVEMC HQ TO ${target}: ${text}\nEND`;

  await sendRadioMessage(message);

  if (textEl) textEl.value = "";

  if (hqStatus) {
    hqStatus.textContent = "HQ message sent!";
    setTimeout(() => {
      hqStatus.textContent = "Status: Ready";
    }, 3000);
  }

  // Simulate receive for aid stations (black bar)
  const incoming = document.getElementById("incomingMsg");
  const recvArea = document.getElementById("receiveArea");
  if (incoming && recvArea) {
    incoming.textContent = message;
    recvArea.style.display = "block";
    setTimeout(() => {
      recvArea.style.display = "none";
    }, 10000);
  }
};


// ----------------------------------------------------------------------
// Init on page load
// ----------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  saveRadioMessageNum();
  autoConnectRadio();
});

// Show HQ box if ?hq=1
if (new URLSearchParams(window.location.search).get("hq") === "1") {
  const hqBox = document.getElementById("hqRadioBox");
  if (hqBox) hqBox.style.display = "block";
}
