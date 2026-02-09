// radio-system.js – single source of truth for all radio behavior

// ----------------------------------------------------------------------
// State & helpers
// ----------------------------------------------------------------------
let currentRadioMessageNum = parseInt(localStorage.getItem("radioMsgNum") || "1", 10);
let radioConnection = null;
window.radioConnection = window.radioConnection || null;

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
