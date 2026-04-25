
"use strict";

console.log("race_timing.js load", new Date().toISOString());

var event_code = String(window.TVEMC_EVENT_CODE || window.event_code || "AZM-300-2026-0004").trim();

let __CACHED_FINISH_CODE = null;

/* ---------------------------
   Global helpers
----------------------------*/

// -----------------------------
// Persist station + distance context (multi-tab safe)
// -----------------------------
function persistAidStationFromDropdown() {
  const sel = document.getElementById("aidStation");
  if (!sel) return;
  const val = String(sel.value || "").trim();
  if (!val) return;
  sessionStorage.setItem("tvemc_aidStation", val);
  // optional fallback:
  localStorage.setItem("tvemc_aidStation", val);
}

function persistDistanceForEvent() {
  const ec = (typeof getEventCode === "function" ? String(getEventCode() || "").trim() : "");
  if (!ec) return;

  const sel =
    document.getElementById("distanceSelect") ||
    document.getElementById("distance_code") ||
    document.getElementById("distanceCode");

  const dist = String(sel?.value || "").trim();
  if (!dist) return;

  const key = `tvemc_raceTimingData_${ec}`;
  let blob = {};
  try { blob = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
  blob.distance_code = dist;

  // ✅ REQUIRED for multi-tab station pages (event-scoped)
  localStorage.setItem(`tvemc_distance_code__${ec}`, dist);
  localStorage.setItem(key, JSON.stringify(blob));
}

// Run once after page settles (dropdowns are populated async)
// Run once after page settles (dropdowns are populated async)
window.addEventListener("load", () => {
  setTimeout(() => {
    persistAidStationFromDropdown();

    // ✅ AZM: force correct default distance once
    const ec = (typeof getEventCode === "function" ? String(getEventCode() || "").trim() : "");
    const distSel = document.getElementById("distanceSelect");

    if (ec === "AZM-300-2026-0004" && distSel) {
      distSel.value = "300M";
    }

    // Persist whichever distance is now selected (event-scoped)
    persistDistanceForEvent();
  }, 400);
});


// --- TEMP RACE-SAFE: lock distance per event (prevents defaulting to 30K) ---
window.addEventListener("load", () => {
  setTimeout(() => {
    const ec = (typeof getEventCode === "function" ? String(getEventCode() || "").trim() : "");
    const distSel = document.getElementById("distanceSelect");

    // AZM 300
    if (ec === "AZM-300-2026-0004" && distSel) {
      // pick the correct option if present
      const wanted = "300M"; // <-- change if your actual code differs
      const has = [...distSel.options].some(o => String(o.value).trim() === wanted);
      if (has) distSel.value = wanted;
    }

    // After setting, persist to event-scoped storage
    persistDistanceForEvent();
  }, 900);
});

// Update whenever dropdowns change
document.addEventListener("change", (e) => {
  if (!e.target) return;
  if (e.target.id === "aidStation") persistAidStationFromDropdown();

  if (
    e.target.id === "distanceSelect" ||
    e.target.id === "distance_code" ||
    e.target.id === "distanceCode"
  ) {
    persistDistanceForEvent();
  }
});

function persistDistanceSelection(distCode) {
  const ec = (typeof getEventCode === "function" ? String(getEventCode() || "").trim() : "DEFAULT");
  localStorage.setItem(`tvemc_distance_code__${ec}`, String(distCode || "").trim());
}

async function getFinishStationCode(event_code) {
  if (__CACHED_FINISH_CODE) return __CACHED_FINISH_CODE;

  // Try to load station list and find the one marked finish / or with "FINISH" in name
  try {
    const res = await fetch(`aid_stations_load.php?event_code=${encodeURIComponent(event_code)}`, { cache: "no-store" });
    if (!res.ok) throw new Error("aid_stations_load failed");
    const stations = await res.json();

    // Prefer explicit finish flag
    let fin = (stations || []).find(s => String(s.is_finish) === "1" || s.is_finish === 1 || s.is_finish === true);

    // Fallback: name contains FINISH
    if (!fin) fin = (stations || []).find(s => String(s.station_name || "").toUpperCase().includes("FINISH"));

    const code = String(fin?.station_code || "").trim().toUpperCase();
    if (code) {
      __CACHED_FINISH_CODE = code;
      console.log("Resolved finish station_code:", code);
      return code;
    }
  } catch (e) {
    console.warn("Could not auto-resolve finish station_code:", e.message);
  }

  return "";
}

// TODO: set this to the actual finish station_code in your aid_stations table for event 3
window.TVEMC_FINISH_STATION_CODE = "FINISH";

const STORAGE_KEY = `tvemc_raceTimingData_${event_code}`;

let entries = [];
let bibList = [];
let offlineQueue = [];
let messageLog = [];
let generalComments = [];

let timeLockedByBib = false;
let isSubmitting = false;
let showAlerts = true;
let showSafetyAlerts = true; // critical DNS/DNF warnings (separate from confirmations)

const SAFETY_ALERTS_KEY = "tvemc_showSafetyAlerts";

// Jan21 11:50 Sticky for DNS/DNF
const __stickyWarnedThisClick = new Set(); // bibs warned this click

// Sticky status cache (filled by recomputeStickyStatusSets)
let stickyStatusByBib = { dns: new Set(), dnf: new Set() };

// Global helper used by addEntry()
function getStickyStatusForBib(bib) {
  const b = String(bib || "").trim();
  if (!b) return "";
  if (stickyStatusByBib?.dns?.has(b)) return "DNS";
  if (stickyStatusByBib?.dnf?.has(b)) return "DNF";
  return "";
}

// NOTE [2026-01-11]: Race-day disable Undo/Switch popup for AUTO stations.
const ENABLE_UNDO_SWITCH = false;

// De-dupe guard (must be defined before submitPassToServer uses it)
const RECENT_SUBMITS = new Map(); // key -> timestamp(ms)

function submitKey(p) {
  return `${p.event_code}|${p.bib}|${p.distance_code}|${p.station_code}|${p.pass_type}`;
}

// Preflight guard BEFORE we hit the network (prevents refresh/double-tap duplicates)
function canSubmitNow(payload, windowMs = 2000) {
  const key = submitKey(payload);
  const now = Date.now();
  const last = RECENT_SUBMITS.get(key) || 0;
  if (now - last < windowMs) return false;
  RECENT_SUBMITS.set(key, now); // reserve immediately
  return true;
}

// Allow retry if server rejects
function releaseSubmit(payload) {
  const key = submitKey(payload);
  RECENT_SUBMITS.delete(key);
}

// Added Jan26 at 0010
function parseUtcLikeMysql(ts) {
  const s = String(ts || "").trim();
  if (!s) return 0;
  // MySQL datetime without timezone -> treat as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return Date.parse(s.replace(" ", "T") + "Z") || 0;
  }
  return Date.parse(s) || 0;
}

/* ---------------------------
   Station name -> code mapping
   (works even if <option value=""> isn't set)
----------------------------*/
const STATION_NAME_TO_CODE = {
  "🏁START": "START",
  "START": "START",

  "📍CORRAL CANYON #1": "AS1",
  "CORRAL CANYON #1": "AS1",

  "📍KANAN ROAD #1": "AS2",
  "KANAN ROAD #1": "AS2",

  "📍TURNAROUND SPOT (30K NO AID)": "T30K",
  "TURNAROUND SPOT (30K NO AID)": "T30K",

  "📍ZUMA EDISION RIDGE MTWY #1": "AS4",
  "ZUMA EDISION RIDGE MTWY #1": "AS4",

  "📍BONSALL": "AS5",
  "BONSALL": "AS5",

  "📍ZUMA EDISION RIDGE MTWY #2": "AS6",
  "ZUMA EDISION RIDGE MTWY #2": "AS6",

  "📍KANAN ROAD #2": "AS7",
  "KANAN ROAD #2": "AS7",

  "📍CORRAL CANYON #2": "AS8",
  "CORRAL CANYON #2": "AS8",

  "📍100K TURNAROUND - BULLDOG": "AS9",
  "100K TURNAROUND - BULLDOG": "AS9",

  "📍CORRAL CANYON #3": "AS10",
  "CORRAL CANYON #3": "AS10",

  "📍PIUMA CREEK (NO AID)": "AS11",
  "PIUMA CREEK (NO AID)": "AS11",

  "🏁FINISH LINE": "FINISH",
  "FINISH LINE": "FINISH",
  "FINISH": "FINISH"
};

function getStationNameAndCode() {
  const el = document.getElementById("aidStation");
  if (!el) return { station_name: "", station_code: "" };

  const station_name = (el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : "").trim();
  const rawValue = (el.value || "").trim();

  // If value is already a valid code, use it
  if (/^(START|FINISH|T30K|AS\d+)$/.test(rawValue)) {
    return { station_name, station_code: rawValue };
  }

  // Otherwise map from visible text (handles emoji labels)
  const key = station_name.replace(/\s+/g, " ").trim();
  const station_code = STATION_NAME_TO_CODE[key] || STATION_NAME_TO_CODE[key.replace(/^📍/, "").trim()] || "";

  return { station_name, station_code };
}

/* ---------------------------
   Utilities
----------------------------*/
function safeString(s) {
  return String(s ?? "").replace(/\u0000/g, "").trim();
}

function setCurrentTime(force = false) {
  const timeEl = document.getElementById("time");
  if (!timeEl) return;
  
  if (timeLockedByBib && !force) return;
  
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  timeEl.value = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  console.log("Time set to:", timeEl.value);
}

function cleanEventCode(ec) {
  ec = String(ec || "").trim();
  // strip anything after ?, &, or /
  ec = ec.split("?")[0].split("&")[0].split("/")[0];
  return ec.trim();
}

window.getEventCode = function getEventCode() {
  // Canonical source is sessionStorage (URL params are stripped on load)
  const fromSS = sessionStorage.getItem("tvemc_eventName") || "";

  // Fallbacks (tvemc_eventName is set by the event dropdown on change)
  const fromLSName = localStorage.getItem("tvemc_eventName") || "";
  const fromLSCode = localStorage.getItem("tvemc_event_code") || "";
  const fromInput =
    document.getElementById("eventCode")?.value ||
    document.getElementById("eventName")?.value ||
    "";

  return cleanEventCode(fromSS || fromInput || fromLSName || fromLSCode || "");
};

async function loadEventMetaFromServer() {    // Added Feb 6 at 11:00 
  const event_code = cleanEventCode(getEventCode());
  try {
    const res = await fetch(`events_load.php?event_code=${encodeURIComponent(event_code)}`, { cache: "no-store" });
    const meta = await res.json();
    if (!meta || !meta.event_id) {
      console.warn("events_load returned empty/invalid:", meta);
      return null;
    }

    window.TVEMC_EVENT_META = meta;

    // Ensure your timezone hook is DB-driven
    window.TVEMC_getEventTimeZone = function() {
      return String((window.TVEMC_EVENT_META && window.TVEMC_EVENT_META.timezone) || "UTC");
    };

    // Update the page title to reflect the selected event
    const titleEl = document.getElementById("pageTitle");
    if (titleEl && meta.event_name) {
      titleEl.textContent = `${meta.event_name} (${meta.event_code})`;
    }

    console.log("Loaded event meta:", meta);
    return meta;
  } catch (e) {
    console.warn("Failed to load event meta:", e);
    return null;
  }
}

// Populate the #eventName <select> dropdown from events_list.php.
// The currently-active event code (from URL ?event=, or localStorage tvemc_eventName) is
// pre-selected.  When the user picks a different event the page reloads with ?event=<code>
// so all stations, runners, and start-times refresh cleanly.
async function loadEventListIntoDropdown() {
  const sel = document.getElementById("eventName");
  if (!sel || sel.tagName !== "SELECT") return; // nothing to do if it's still a text input

  try {
    const res = await fetch("events_list.php", { cache: "no-store" });
    const events = await res.json();
    if (!Array.isArray(events) || events.length === 0) {
      console.warn("events_list returned empty array");
      sel.innerHTML = '<option value="">— No events found —</option>';
      return;
    }

    // Determine which event should be selected:
    // Priority: sessionStorage tvemc_eventName  →  localStorage tvemc_eventName  →  hidden #eventCode input
    const fromSS = cleanEventCode(sessionStorage.getItem("tvemc_eventName") || "");
    const fromLS = cleanEventCode(localStorage.getItem("tvemc_eventName") || "");
    const fromHidden = cleanEventCode(document.getElementById("eventCode")?.value || "");
    const active = fromSS || fromLS || fromHidden;

    // Rebuild options: blank placeholder + one per event
    sel.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— Select Event —";
    sel.appendChild(placeholder);

    let matched = false;
    for (const ev of events) {
      const opt = document.createElement("option");
      opt.value = ev.event_code;
      opt.textContent = `${ev.event_name} (${ev.event_code})`;
      if (ev.event_code === active) {
        opt.selected = true;
        matched = true;
      }
      sel.appendChild(opt);
    }

    if (matched) {
      // Ensure localStorage is in sync with what the dropdown shows
      localStorage.setItem("tvemc_eventName", active);

      // Update the page title immediately from events_list data (before events_load.php resolves)
      const activeEvent = events.find(ev => ev.event_code === active);
      if (activeEvent) {
        const titleEl = document.getElementById("pageTitle");
        if (titleEl) titleEl.textContent = `${activeEvent.event_name} (${activeEvent.event_code})`;
      }
    }

    console.log("Event list loaded:", events.length, "events; active:", active, "matched:", matched);

    // When the user picks a new event, persist and reload the page with ?event=<code>
    if (!sel.__tvemc_event_bound) {
      sel.__tvemc_event_bound = true;
      sel.addEventListener("change", (e) => {
        const chosen = cleanEventCode(e.target.value || "");
        if (!chosen) return;
        localStorage.setItem("tvemc_eventName", chosen);
        sessionStorage.setItem("tvemc_eventName", chosen);
        // Reload with plain URL so all data (stations, runners, start times) refreshes
        // without exposing the event code in the address bar
        window.location.href = window.location.pathname;
      });
    }
  } catch (e) {
    console.warn("loadEventListIntoDropdown failed:", e.message);
    sel.innerHTML = '<option value="">— Could not load events —</option>';
  }
}

// ---------------------------------------------------------------------------
// loadEventDocs — fetches event-specific PDFs/CSVs from event_docs.php and
// renders them in #eventDocsSection.  Called on page load and whenever the
// event changes (the existing event-dropdown change handler reloads the page,
// so a single call on DOMContentLoaded is sufficient).
// ---------------------------------------------------------------------------
async function loadEventDocs(eventCode) {
  const section  = document.getElementById("eventDocsSection");
  const listEl   = document.getElementById("eventDocsList");
  if (!section || !listEl) return;

  const ec = cleanEventCode(eventCode || (typeof getEventCode === "function" ? getEventCode() : ""));
  if (!ec) {
    section.style.display = "none";
    return;
  }

  try {
    const res   = await fetch(`event_docs.php?event_code=${encodeURIComponent(ec)}`, { cache: "no-store" });
    const files = await res.json();

    if (!Array.isArray(files) || files.length === 0) {
      section.style.display = "none";
      return;
    }

    listEl.innerHTML = "";
    for (const f of files) {
      const icon = f.ext === "csv" ? "📊" : "📄";
      const div  = document.createElement("div");
      div.style.marginBottom = "10px";
      const a = document.createElement("a");
      a.className   = "help-link";
      a.href        = f.url;
      a.target      = "_blank";
      a.rel         = "noopener";
      a.textContent = `${icon} ${f.name}`;
      div.appendChild(a);
      listEl.appendChild(div);
    }

    section.style.display = "block";
  } catch (e) {
    console.warn("loadEventDocs failed:", e.message);
    section.style.display = "none";
  }
}

function saveData() {
  try {
    const payload = {
      saved_at: new Date().toISOString(),
      event_code: (typeof getEventCode === "function") ? getEventCode() : "",
      station_code: (typeof getStationNameAndCode === "function") ? (getStationNameAndCode()?.station_code || "") : "",
      entries: Array.isArray(entries) ? entries : [],
      offlineQueue: Array.isArray(offlineQueue) ? offlineQueue : [],
      messageLog: Array.isArray(messageLog) ? messageLog : [],
      generalComments: Array.isArray(generalComments) ? generalComments : []
      // bibList intentionally not saved (deprecated)
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    console.log("Saved local snapshot:", {
      saved_at: payload.saved_at,
      entries: payload.entries.length,
      offlineQueue: payload.offlineQueue.length,
      generalComments: payload.generalComments.length
    });

    if (typeof showAlerts !== "undefined" && showAlerts) {
      alert(`Saved offline snapshot.\nEntries: ${payload.entries.length}\nQueued: ${payload.offlineQueue.length}`);
    }
  } catch (e) {
    console.error("saveData failed:", e);
    if (typeof showAlerts !== "undefined" && showAlerts) {
      alert("Save failed (storage may be full).");
    }
  }
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    entries = Array.isArray(data.entries) ? data.entries : [];
    bibList = Array.isArray(data.bibList) ? data.bibList : [];
    publishBibList();
    
    // Only publish roster globally if it’s non-empty (prevents stomping)
    if (Array.isArray(bibList) && bibList.length) {
      window.bibList = bibList;
   }
    
    offlineQueue = Array.isArray(data.offlineQueue) ? data.offlineQueue : [];
    messageLog = Array.isArray(data.messageLog) ? data.messageLog : [];
    generalComments = Array.isArray(data.generalComments) ? data.generalComments : [];
  } catch (e) {
    console.warn("loadData failed:", e);
  }
}

(function initHQTimeMode(){
  const isHQ = sessionStorage.getItem("hq_mode") === "1";
  const box = document.getElementById("hqTimeModeBox");
  const sel = document.getElementById("hqTimeMode");
  const meta = document.getElementById("hqTimeMeta");

  if (!box || !sel || !meta) return;
  if (!isHQ) return; // HQ-only

  box.style.display = ""; // show

  const eventCode = (document.getElementById("eventCode")?.value || "").trim() || "UNKNOWN";
  const key = `tvemc_time_mode_${eventCode}`;

  // Default LOCAL
  const saved = (localStorage.getItem(key) || "LOCAL").toUpperCase();
  sel.value = (saved === "UTC") ? "UTC" : "LOCAL";

  // Provide a global getter for time mode (used by Step 4 formatter)
  window.TVEMC_getTimeMode = function() {
    const v = (localStorage.getItem(key) || sel.value || "LOCAL").toUpperCase();
    return (v === "UTC") ? "UTC" : "LOCAL";
  };

  // SOB Phase 1 timezone (fixed)
  const EVENT_TZ = "America/Los_Angeles";
  window.TVEMC_getEventTimeZone = function() { return EVENT_TZ; };

  // Offset meta (computed for "now")
  function offsetLabelNow(){
    try {
      const d = new Date();
      // Use Intl parts to get offset minutes indirectly
      // (We’ll keep it simple: show TZ + (Winter/DST) based on LA)
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: EVENT_TZ,
        timeZoneName: "shortOffset",
        hour: "2-digit"
      }).formatToParts(d);
      const tzPart = parts.find(p => p.type === "timeZoneName")?.value || "";
      // tzPart often like "GMT-8"
      const m = tzPart.match(/GMT([+\-]\d{1,2})(?::(\d{2}))?/i);
      let off = "";
      if (m) {
        const hh = String(Math.abs(parseInt(m[1],10))).padStart(2,"0");
        const mm = String(m[2] || "00").padStart(2,"0");
        const sign = (parseInt(m[1],10) < 0) ? "-" : "+";
        off = `UTC${sign}${hh}:${mm}`;
      } else {
        off = "UTC offset";
      }

      // DST label (simple heuristic for LA)
      const short = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TZ, timeZoneName: "short" }).formatToParts(d)
        .find(p => p.type === "timeZoneName")?.value || "";
      const season = (short.includes("DT")) ? "DST" : "Winter";

      return `Event TZ: ${EVENT_TZ}<br>Offset: ${off} (${season})`;
    } catch {
      return `Event TZ: ${EVENT_TZ}`;
    }
  }

  meta.innerHTML = offsetLabelNow();

  sel.addEventListener("change", () => {
    const v = (sel.value || "LOCAL").toUpperCase();
    localStorage.setItem(key, (v === "UTC") ? "UTC" : "LOCAL");
    
    // Refresh visible outputs (we wire these in Step 4)
    try { if (typeof window.refreshCards === "function") window.refreshCards(); } catch {}
    try { if (typeof window.renderBibLog === "function") window.renderBibLog(); } catch {}
    try { if (typeof window.filterBibLog === "function") window.filterBibLog(); } catch {}
  });
})();

// HQ finish
function updateFinishButtonVisibility() {
  const btn = document.getElementById("finishBtn");
  if (!btn) return;

  const isHq = sessionStorage.getItem("hq_mode") === "1";
  btn.style.display = isHq ? "inline-block" : "none";
}

window.addEventListener("load", updateFinishButtonVisibility);
updateFinishButtonVisibility();

(function initHQTimeMode(){
  const isHQ = sessionStorage.getItem("hq_mode") === "1";
  const box = document.getElementById("hqTimeModeBox");
  const sel = document.getElementById("hqTimeMode");
  const meta = document.getElementById("hqTimeMeta");

  if (!box || !sel || !meta) return;
  if (!isHQ) return; // HQ-only

  box.style.display = ""; // show

  const eventCode = (document.getElementById("eventCode")?.value || "").trim() || "UNKNOWN";
  const key = `tvemc_time_mode_${eventCode}`;

  // Default LOCAL
  const saved = (localStorage.getItem(key) || "LOCAL").toUpperCase();
  sel.value = (saved === "UTC") ? "UTC" : "LOCAL";

  // Provide a global getter for time mode (used by Step 4 formatter)
  window.TVEMC_getTimeMode = function() {
    const v = (localStorage.getItem(key) || sel.value || "LOCAL").toUpperCase();
    return (v === "UTC") ? "UTC" : "LOCAL";
  };

  // SOB Phase 1 timezone (fixed)
  const EVENT_TZ = "America/Los_Angeles";
  window.TVEMC_getEventTimeZone = function() { return EVENT_TZ; };

  // Offset meta (computed for "now")
  function offsetLabelNow(){
    try {
      const d = new Date();
      // Use Intl parts to get offset minutes indirectly
      // (We’ll keep it simple: show TZ + (Winter/DST) based on LA)
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: EVENT_TZ,
        timeZoneName: "shortOffset",
        hour: "2-digit"
      }).formatToParts(d);
      const tzPart = parts.find(p => p.type === "timeZoneName")?.value || "";
      // tzPart often like "GMT-8"
      const m = tzPart.match(/GMT([+\-]\d{1,2})(?::(\d{2}))?/i);
      let off = "";
      if (m) {
        const hh = String(Math.abs(parseInt(m[1],10))).padStart(2,"0");
        const mm = String(m[2] || "00").padStart(2,"0");
        const sign = (parseInt(m[1],10) < 0) ? "-" : "+";
        off = `UTC${sign}${hh}:${mm}`;
      } else {
        off = "UTC offset";
      }

      // DST label (simple heuristic for LA)
      const short = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TZ, timeZoneName: "short" }).formatToParts(d)
        .find(p => p.type === "timeZoneName")?.value || "";
      const season = (short.includes("DT")) ? "DST" : "Winter";

      return `Event TZ: ${EVENT_TZ}<br>Offset: ${off} (${season})`;
    } catch {
      return `Event TZ: ${EVENT_TZ}`;
    }
  }

  meta.innerHTML = offsetLabelNow();

  sel.addEventListener("change", () => {
    const v = (sel.value || "LOCAL").toUpperCase();
    localStorage.setItem(key, (v === "UTC") ? "UTC" : "LOCAL");
    try { if (typeof loadPassesFromServer === "function") loadPassesFromServer().then(() => { try { if (typeof window.filterBibLog === "function") window.filterBibLog(); } catch {} }); } catch {}

    // Refresh visible outputs (we wire these in Step 4)
    try { if (typeof window.refreshCards === "function") window.refreshCards(); } catch {}
    try { if (typeof window.renderBibLog === "function") window.renderBibLog(); } catch {}
    try { if (typeof window.filterBibLog === "function") window.filterBibLog(); } catch {}
  });
})();

/* ---------------------------
   Connectivity
----------------------------*/
async function isOnline() {
  try {
    const ec = (typeof getEventCode === "function") ? getEventCode() : "";
    if (!ec) return false;

    const res = await fetch(
      `passes_load.php?event_code=${encodeURIComponent(ec)}&limit=1`,
      { cache: "no-store" }
    );

    return !!res.ok;
  } catch {
    return false;
  }
}


/* ---------------------------
   Subject + message number
----------------------------*/
function updateSubject() {
  try {
    const eventName = document.getElementById("eventName")?.value || "AZM-300-2026-0004";
    const msgNum = document.getElementById("messageNum")?.value || "1";
    const subjectInput = document.getElementById("subject");
    if (!subjectInput) return;

    const { station_name } = getStationNameAndCode();
    subjectInput.value = `${eventName} ${station_name} Message #${msgNum}`;
    console.log("Subject updated:", subjectInput.value);
  } catch (e) {
    console.error("Error updating subject:", e);
  }
}

function incrementMessage() {
  try {
    const msgEl = document.getElementById("messageNum");
    if (!msgEl) return;
    msgEl.value = String(parseInt(msgEl.value || "1", 10) + 1);
    updateSubject();
    console.log("Message number incremented to:", msgEl.value);
  } catch (e) {
    console.error("Error incrementing message:", e);
  }
}

/* ---------------------------
   Runners info pop-up under bib box
----------------------------*/
function updateBibInfo() {
  try {
    // ⏱ Lock time on first bib entry (so time doesn't keep changing)
    const bibEl = document.getElementById("bibNumber");
    if (bibEl) {
      const val = bibEl.value.trim();

      // First character typed → capture + lock time
      if (val !== "" && !timeLockedByBib) {
        setCurrentTime(true);   // force-set once
        timeLockedByBib = true; // lock so interval won't overwrite
      }

      // If bib box is cleared, unlock time
      if (val === "") {
        timeLockedByBib = false;
      }
    }
  
    const bib = (document.getElementById("bibNumber")?.value || "").trim();
    const tbody = document.querySelector("#bibInfoTable tbody");
    const table = document.getElementById("bibInfoTable");
    if (!tbody || !table) return;

    tbody.innerHTML = "";

    if (!bib || bibList.length === 0) {
      table.style.display = "none";
      return;
    }
    console.log("bibList sample:", bibList[0]);

    const runner = bibList.find(r =>
      String(r?.bib ?? r?.bib_number ?? "").trim() === String(bib).trim()
    );

    if (!runner) {
      table.style.display = "none";
      console.log("No runner found for bib:", bib);
      return;
    }
    
    // ✅ Create the row BEFORE using row.innerHTML
    const row = document.createElement("tr");

    const rbib = runner?.bib ?? runner?.bib_number ?? "N/A";
    const fn   = runner?.firstName ?? runner?.first_name ?? "N/A";
    const ln   = runner?.lastName ?? runner?.last_name ?? "N/A";
    const age  = runner?.age ?? "N/A";
    const gen  = runner?.gender ?? runner?.Gender ?? "N/A";
    const dist = runner?.distance_code ?? runner?.distance ?? "N/A";
    const prev = runner?.previousDistance ?? runner?.previous_distance ?? "N/A";
    
    row.innerHTML = `
      <td>${rbib}</td>
      <td>${fn}</td>
      <td>${ln}</td>
      <td>${age}</td>
      <td>${gen}</td>
      <td>${dist}</td>
      <td>${prev}</td>
    `;
    tbody.appendChild(row);
    table.style.display = "table";
    console.log("Bib info updated:", runner);
  } catch (e) {
    console.error("Error updating bib info:", e);
  }
}

/* ---------------------------
   Submit pass to server
----------------------------*/
async function submitPassToServer(payload) {
  console.log("SUBMIT DEBUG payload:", payload);

  const res = await fetch("passes_submit.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  // Always read body (even on 400/500)
  const text = await res.text();

  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // If server sent HTML or garbage, surface it
    data = { success: false, error: "Bad JSON from server", raw: text.slice(0, 200) };
  }

  // If HTTP status not OK, still return JSON error payload
  if (!res.ok) {
    if (!data || typeof data !== "object") {
      data = { success: false, error: `HTTP ${res.status}` };
    }
    if (data.success !== false) data.success = false;
    if (!data.error) data.error = `HTTP ${res.status}`;
  }

  return data;
}

/*---------------------------
 Load Bib Log Viewer table
-----------------------------*/
function formatLocalTime(tsUtc) {
  // tsUtc like "2026-01-02 04:50:24" (UTC stored)
  // Convert to local time display in America/Los_Angeles
  const d = new Date(tsUtc.replace(" ", "T") + "Z");
  const opts = { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false };
  return d.toLocaleTimeString("en-US", opts);
}

async function toggleBibLog() {
  const table = document.getElementById("bibLogTable");
  if (!table) return;

  const showing = table.style.display === "table";
  if (showing) {
    table.style.display = "none";
    return;
  }

  await loadPassesFromServer();
  filterBibLog();
}
window.toggleBibLog = toggleBibLog;

function formatLocalDate(tsUtc) {
  const d = new Date(tsUtc.replace(" ", "T") + "Z");
  return d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });
}

function dayLabelFromTs(tsUtc) {
  // optional; you can keep using Today/Yesterday logic, but this makes DB rows consistent:
  const d = new Date(tsUtc.replace(" ", "T") + "Z");
  const local = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const diffDays = Math.floor((nowLocal - local) / (1000 * 60 * 60 * 24));
  return diffDays >= 1 ? "Yesterday" : "Today";
}

function stationNameFromOrder(order) {
  const el = document.getElementById("aidStation");
  if (!el || order === null || order === undefined) return "N/A";

  // Special case: 30K Turnaround is coded as T30K in the dropdown (not AS3)
  let code;
  if (order === 0) code = "START";
  else if (order === 3) code = "T30K";
  else code = `AS${order}`;

  // Try match option value
  for (const opt of el.options) {
    if ((opt.value || "").trim() === code) return opt.text.trim();
  }

  // fallback (still return the code, but now order=3 becomes T30K)
  return code;
}

function stationNameFromCode(station_code) {
  const code = String(station_code || "").trim();
  if (!code) return "N/A";

  const el = document.getElementById("aidStation");
  if (el) {
    for (const opt of el.options) {
      if (String(opt.value || "").trim() === code) {
        return opt.text.trim();
      }
    }
  }
  return code; // fallback to showing AS3 if dropdown lookup fails
}

 // Bib # pass count 01-07-2026-20:00
 function stationGroupFromName(station) {
  if (!station) return "";
  const s = station.toUpperCase();
  if (s.includes("CORRAL CANYON")) return "CORRAL";
  if (s.includes("KANAN ROAD")) return "KANAN";
  if (s.includes("ZUMA")) return "ZUMA";
  return ""; // non-ambiguous stations
}
 // Added Feb3-12:07 help misMatch
function TVEMC_timeMode() {
  try {
    return (typeof window.TVEMC_getTimeMode === "function")
      ? window.TVEMC_getTimeMode()
      : "LOCAL";
  } catch {
    return "LOCAL";
  }
}

function TVEMC_timeZone() {
  // SOB Phase 1: fixed TZ, later v2 will load per event
  return (typeof window.TVEMC_getEventTimeZone === "function")
    ? window.TVEMC_getEventTimeZone()
    : "America/Los_Angeles";
}
// Added Feb3 at 1600 help Open List Not finished
function publishBibList() {
  try {
    if (Array.isArray(bibList) && bibList.length) {
      window.bibList = bibList;
    }
  } catch {}
}

async function loadPassesFromServer() {
  if (window.__loadingPasses) return;
  window.__loadingPasses = true;

  try {
    const event_code = cleanEventCode(
      (typeof getEventCode === "function")
        ? getEventCode()
        : (document.getElementById("eventName")?.value || "AZM-300-2026-0004").trim()
    );

    if (!event_code) return; // keep

    const res = await fetch(
      `passes_load.php?event_code=${encodeURIComponent(event_code)}&limit=500`,
      { cache: "no-store" }
    );

    const rows = await res.json();

    if (!Array.isArray(rows)) {
      console.error("passes_load returned non-array:", rows);
      return;
    }

    // --- Auto-derive start times from earliest Start-Line IN pass ---------------
    // Covers the common case where the user never explicitly saved start times in
    // the UI but has already tagged runners through the Start Line.
    // Only fills distances that have NO entry in TVEMC_startByDistance yet.
    // Explicit saved start times (from event_start_times via loadResultsConfig)
    // always take precedence and are never overwritten here.
    if (!window.TVEMC_startByDistance) {
      window.TVEMC_startByDistance = new Map();
    }
    {
      const derivedStarts = new Map(); // distance_code -> earliest UTC ms
      for (const r of rows) {
        const dc = String(r.distance_code || "").trim();
        if (!dc || dc === "N/A") continue;
        // Check for a saved start time using canonical key comparison so "50K" and "50 K" match
        const dcCanon = canonicalDistanceCode(dc);
        const hasExplicit = [...window.TVEMC_startByDistance.keys()].some(
          k => canonicalDistanceCode(k) === dcCanon
        );
        if (hasExplicit) continue; // explicit start already set — skip auto-derive
        const isStartStation = (r.station_order === 0) ||
          String(r.station_code || "").toUpperCase() === "START";
        const isIn = String(r.pass_type || "").toUpperCase() === "IN";
        if (!isStartStation || !isIn) continue;
        const d = new Date(String(r.pass_ts || "").replace(" ", "T") + "Z");
        if (isNaN(d.getTime())) continue;
        const existing = derivedStarts.get(dc);
        if (existing === undefined || d.getTime() < existing) {
          derivedStarts.set(dc, d.getTime());
        }
      }
      for (const [dc, ms] of derivedStarts) {
        window.TVEMC_startByDistance.set(dc, new Date(ms).toISOString());
        console.log(`[auto-start] No saved start time for ${dc}; using earliest Start Line IN pass: ${new Date(ms).toISOString()}`);
      }
    }
    // -------------------------------------------------------------------------

    // Map DB passes -> your Bib Log entry shape expected by filterBibLog()
    entries = rows.map(r => {
      const bib = String(r.bib);
      const runner = bibList.find(x => String(x.bib) === bib) || {};
    
      const action = String(r.pass_type || "").toUpperCase();
    
      const station_order = (r.station_order === null || r.station_order === undefined)
        ? null
        : parseInt(r.station_order, 10);
    
      // Base station label from order (fallback)
      let station = stationNameFromOrder(station_order);
    
      // FINISH label safety
      if (action === "FINISH" || String(r.station_code || "").toUpperCase() === "FINISH") {
        station = "🏁 FINISH LINE";
      }
    
      // Distance & station order for computations
      const distance_code = canonicalDistanceCode(runner.distance || r.distance_code || "N/A");
    
      let station_order_num = (r.station_order !== null && r.station_order !== undefined)
        ? parseInt(r.station_order, 10)
        : stationOrderFromCode(r.station_code);

      // Mismatch correction: when the pass was flagged as a mismatch the stored
      // station_id belongs to a different distance (e.g. a 50K runner scanned at
      // the 100K "AS6" checkpoint).  The JOIN therefore returns the wrong
      // station_order and mile.  If that station_order doesn't exist in the
      // runner's own distance map, try to resolve the correct station by name so
      // that pace and ETA math uses the right mileage.
      let correctedMile = r.mile;
      if (distance_code && distance_code !== "N/A") {
        const inDistMap = (station_order_num !== null)
          ? lookupStationByOrder(distance_code, station_order_num)
          : null;
        if (!inDistMap) {
          const byName = lookupStationByName(distance_code, r.station_name);
          if (byName) {
            station_order_num = byName.station_order;
            correctedMile = byName.mile;
          }
        }
      }

      // Time parsing
      const passDateUtc = r.pass_ts ? parsePassTsUtcToDate(r.pass_ts) : new Date(NaN);
      const mode = TVEMC_timeMode();
      const tz = TVEMC_timeZone();
    
      const timeStr = isNaN(passDateUtc.getTime()) ? "" :
        (mode === "UTC"
          ? passDateUtc.toLocaleTimeString("en-US", { timeZone: "UTC", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false })
          : passDateUtc.toLocaleTimeString("en-US", { timeZone: tz, hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false })
        );
    
      const dateStr = isNaN(passDateUtc.getTime()) ? "" :
        (mode === "UTC"
          ? passDateUtc.toLocaleDateString("en-US", { timeZone: "UTC" })
          : passDateUtc.toLocaleDateString("en-US", { timeZone: tz })
        );
    
      // Results computations — pass correctedMile as fallback so pace/ETA work even when the
      // AID_STATION_MAP lookup fails (e.g. mile not yet entered in station config).
      // correctedMile falls back to r.mile when no name-based station correction was found.
      const computed = computeElapsedPaceEta(distance_code, station_order_num, r.pass_ts, correctedMile);
    
      const distCode = canonicalDistanceCode(safeString(r.distance_code || r.distance || ""));
      let sc = String(r.station_code ?? "").trim().toUpperCase();
    
      const sname =
        String(r.station_name ?? "").trim() ||
        stationNameFromMapByCode(sc) ||
        station ||
        sc;
    
      const stationDisplay =
        (action === "FINISH" || sc === "FINISH")
          ? "🏁 FINISH LINE"
          : (sname ? `📍 ${sname}` : "N/A");
    
      return {
        pass_id: r.pass_id,
        bib_number: bib,
        action,
        time: timeStr,
        date: dateStr,
    
        station_id: (r.station_id ?? null),
        station: stationDisplay,
        station_code: sc,
        station_name: r.station_name ?? r.station_display ?? r.station ?? "",
        station_order: (r.station_order != null ? Number(r.station_order) : null),
        // Use correctedMile (resolved via station-name lookup for mismatch passes) so
        // that results_engine computes avg_pace from the runner's actual distance mileage.
        mile: (correctedMile != null ? Number(correctedMile) : null),
    
        event_code: r.event_code ?? "",
    
        comment: (() => {
          // Strip any legacy mismatch prefix baked into the note by the old passes_submit.php.
          // The mismatch flag (r.mismatch) is stored as a proper column and drives display.
          const rawNote = String(r.note || "");
          const operatorNote = rawNote.replace(/^⚠️\s*RUNNER OFF COURSE\s*—[^.]*\.\s*/i, "").trim();
          const mismatchLabel = (r.mismatch == 1)
            ? `⚠️ RUNNER OFF COURSE — ${distCode} at ${String(r.station_code || "").toUpperCase() || "UNKNOWN"}.`
            : "";
          return mismatchLabel
            ? (operatorNote ? `${mismatchLabel} ${operatorNote}` : mismatchLabel)
            : operatorNote;
        })(),
    
        pass_ts: r.pass_ts || "",
        pass_ts_ms: isNaN(passDateUtc.getTime()) ? null : passDateUtc.getTime(),
    
        distance_code: distCode,
    
        eta: computed.eta_next,
        elapsed: computed.elapsed,
        pace: computed.pace,
    
        operator: r.operator || "Unknown",
        first_name: runner.firstName || "N/A",
        last_name: runner.lastName || "N/A",
        age: runner.age || "N/A",
        gender: runner.gender || "N/A",
        distance: runner.distance || r.distance_code || "N/A",
        previous_distance: runner.previousDistance || "N/A"
      };
    });

  // ----- PASS NUMBER DERIVATION (display only, chronological-safe) 01-07-2026-20:45-----
  // Work on a chronologically sorted copy (oldest -> newest)
  // ----- PASS NUMBER DERIVATION (IN increments; others inherit last IN) -----
  // Group key is "DIST|BASE_STATION_NAME" (strips "#N" suffix) so stations like
  // "Lake Hughes #1" and "Lake Hughes #2" in the same distance share the same group.
  // This is AID_STATION_MAP-driven and works for any event without hardcoding.

  // Pre-compute which (dist|base) groups are multi-pass (2+ station codes share the base name)
  const multiPassGroups = new Set();
  for (const [distCode, stations] of Object.entries(AID_STATION_MAP || {})) {
    const groupCounts = {};
    for (const st of stations) {
      const name = String(st.station_name || '').trim();
      const base = name.replace(/\s*#\d+\s*$/i, '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
      if (!base) continue;
      const key = `${distCode.toUpperCase()}|${base}`;
      groupCounts[key] = (groupCounts[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(groupCounts)) {
      if (count > 1) multiPassGroups.add(key);
    }
  }

  function stationGroupFromEntry(entry) {
    const distCode = String(entry.distance_code || '').toUpperCase();
    const stCode = String(entry.station_code || '').toUpperCase();
    const distStations = AID_STATION_MAP[distCode] || [];
    const stObj = distStations.find(s => String(s.station_code || '').toUpperCase() === stCode);
    const name = String(stObj?.station_name || entry.station_name || '').trim();
    if (!name) return '';
    const base = name.replace(/\s*#\d+\s*$/i, '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return base ? `${distCode}|${base}` : '';
  }

  const chron = [...entries].sort((a, b) => (a.pass_ts_ms || 0) - (b.pass_ts_ms || 0));

  const inCount = {};           // "bib|GROUP" -> number of INs
  const lastInPass = {};        // "bib|GROUP" -> last IN pass #
  const passLabelByPassId = {}; // pass_id -> pass #

  for (const e of chron) {
    const bib = String(e.bib_number || "");
    const group = stationGroupFromEntry(e);
    if (!bib || !group) continue;

    const k = `${bib}|${group}`;
    const act = String(e.action || "").toUpperCase();

    if (act === "IN") {
      inCount[k] = (inCount[k] || 0) + 1;   // increment only on IN
      lastInPass[k] = inCount[k];
      passLabelByPassId[e.pass_id] = lastInPass[k];
    } else {
     // OUT/DNF/NOTE/etc: inherit last IN, or blank if none
      passLabelByPassId[e.pass_id] = lastInPass[k] || null;
    }
  }

  for (const e of entries) {
    const group = stationGroupFromEntry(e);
    if (!group) continue;

    const n = passLabelByPassId[e.pass_id];
    // Only store a pass number for multi-pass stations (so single-pass stations stay blank)
    e.pass_num = (multiPassGroups.has(group) && n) ? String(n) : "";
  }


  function stripPassSuffix(s) {
    return String(s || "").replace(/\s*\(PASS\s+\d+\)\s*$/i, "").trim();
  }

    // Compute Finish/Elapsed/Pace etc (if results engine is present)
      if (typeof window.TVEMC_computeResults === "function") {
        try {
          entries = await window.TVEMC_computeResults(entries);
        } catch (e) {
          console.warn("Results compute skipped:", e.message);
    }
  }
 
   // Now redraw the existing viewer
   if (typeof filterBibLog === "function") filterBibLog();
   const entryCount = document.getElementById("entryCount");
   if (entryCount) entryCount.textContent = entries.length;
  console.log("Loaded passes from DB into Bib Log:", entries.length);

   // refresh DNS/DNF sticky status after load (honor overrides)
   // refresh DNS/DNF sticky status after load (honor overrides)
   await loadStatusOverrides(getEventCode());
   if (typeof recomputeStickyStatusSets === "function") recomputeStickyStatusSets();
   
   } finally {
     window.__loadingPasses = false;
   }
   }

// ------------------------------------------------------------
// Sticky status helper (race-safe)
// Ensures we can warn about DNS/DNF without breaking submission
// ------------------------------------------------------------
function getStickyStatusForBibSafe(bib) {
  try {
    // Prefer existing project helper if present
    if (typeof getStickyStatusForBib === "function") {
      const v = getStickyStatusForBib(bib);

      // Allow either string ("DNS") or object ({dns:true,...})
      if (typeof v === "string") return v.trim().toUpperCase();

      if (v && typeof v === "object") {
        if (v.dns) return "DNS";
        if (v.dnf) return "DNF";
        if (v.finish) return "FINISH";
        // some older shapes
        if (v.status) return String(v.status).trim().toUpperCase();
      }
    }

    // Fallback: if STATUS_OVERRIDES exists and you want “sticky cleared” only,
    // return empty so it never blocks submits.
    return "";
  } catch (e) {
    return "";
  }
}

async function addEntry(action) {
  try {
    if (isSubmitting) return;
    isSubmitting = true;
    __stickyWarnedThisClick.clear();

    const bibInput = safeString(document.getElementById("bibNumber")?.value || "");
    if (!bibInput && action !== "GENERAL") {
      if (showAlerts) alert("Please enter a Bib Number.");
      return;
    }

    const bibs = bibInput.split(",").map(s => s.trim()).filter(Boolean);
    if (action === "GENERAL" && bibs.length > 1) {
      if (showAlerts) alert("Multiple bibs not supported for GENERAL comments.");
      return;
    }

    // Keep time fresh
    setCurrentTime(false);
    const time = safeString(document.getElementById("time")?.value || "");
    const day = "Today";
    const commentInputId = (action === "GENERAL") ? "generalComment" : "comment";
    const note = safeString(document.getElementById(commentInputId)?.value || "");
    const eta = safeString(document.getElementById("eta")?.value || "N/A");
    const operator = safeString(document.getElementById("operatorName")?.value || "");
    const event_code = cleanEventCode(getEventCode());
    const messageNum = safeString(document.getElementById("messageNum")?.value || "1");
    const date = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });

    // Station source-of-truth: dropdown value (code) + option text (label)
    const stationSelect = document.getElementById("aidStation");
    const selectedStationCode = safeString(stationSelect?.value || "").toUpperCase();
    const selectedStationLabel = safeString(stationSelect?.selectedOptions?.[0]?.textContent || "");
    
    // Detect AUTO selection in a way that matches YOUR dropdown reality:
    // If your option values are CORRAL_AUTO/KANAN_AUTO/ZUMA_AUTO, this works.
    // If your option values are AS1/AS4/etc but the label contains "(AUTO)", this also works.
    const auto_base =
      ["CORRAL_AUTO", "KANAN_AUTO", "ZUMA_AUTO"].includes(selectedStationCode)
        ? selectedStationCode
        : (/\(AUTO\)/i.test(selectedStationLabel) ? "AUTO" : "");

    // Keep existing helper as fallback only
    const stationInfo = (typeof getStationNameAndCode === "function") ? getStationNameAndCode() : null;

    const station_name = safeString(selectedStationLabel || stationInfo?.station_name || "");

    // Keep subject human-friendly
    const subjectInput = document.getElementById("subject");
    if (subjectInput) subjectInput.value = `${event_code} ${station_name} Message #${messageNum}`;
    
    for (const bib of bibs) {
      const runner = bibList.find(r => String(r.bib).trim() === String(bib).trim()) || null;
    
      // Fresh station_code for each bib loop (don’t carry over mutations between bibs)
      let station_code = safeString(selectedStationCode || stationInfo?.station_code || "");
    
      // Always define pass_type
      let pass_type = safeString(action).toUpperCase();
    
      // DNS safety
      if (pass_type === "DNS") {
        if (station_code.toUpperCase() === "START") {
          station_code = "AS1";
        }
      }
    
      // Force FINISH record (HQ/RD only)
     // if (pass_type === "FINISH") {
     //   station_code = "FINISH";
     //   pass_type = "FINISH";
     // }
    
      // Define distance_code explicitly (do not self-reference)
      const distance_code = safeString(
        runner?.distance && String(runner.distance).toUpperCase() !== "DNS"
          ? runner.distance
          : (runner?.previousDistance || "")
      );
    
      // Registry safety (distance missing)
      if (!distance_code || distance_code === "N/A") {
        if (showAlerts) alert("Bib not found in registry (distance missing). Load registry or check bib.");
        continue; // skip this bib
      }
    
      if (!station_code) {
       if (showAlerts) alert("Station Code missing — cannot submit. Re-select Aid Station.");
       continue; // skip this bib safely
      }
    
      // Auto-pass routing for multi-pass stations (Corral/Kanan/Zuma)
      const baseStation = station_code.toUpperCase();
      const isAuto = ["CORRAL_AUTO", "KANAN_AUTO", "ZUMA_AUTO"].includes(baseStation);
    
      let choices = [];
      if (baseStation === "CORRAL_AUTO") choices = ["AS1", "AS8", "AS10"];
      if (baseStation === "KANAN_AUTO")  choices = ["AS2", "AS7"];
      if (baseStation === "ZUMA_AUTO")   choices = ["AS4", "AS6"];
    
      // Temporary undo target (what we defaulted to if auto-routing happens)
      const previousStationCode = (choices[0] || station_code).toUpperCase();
    
      // Hard fallback: never submit *_AUTO as station_code
      if (isAuto) {
        const upper = station_code.toUpperCase();
        if (upper === baseStation || upper.endsWith("_AUTO")) {
          station_code = (choices[0] || station_code).toUpperCase();
        }
      }
    
      // Define auto_base safely (used in entry object)
      const auto_base = isAuto ? baseStation : "";
    
      // Create entry AFTER station_code is finalized (physical AS#)
      const entry = {
        eventName: event_code,
        bib_number: bib,
        action,
        time,
        day,
    
        station: station_name,
        station_code,        // machine truth (physical)
        auto_base,           // flag
    
        comment: note,
        eta,
        operator,
        date,
        messageNum,
        first_name: runner?.firstName || "N/A",
        last_name: runner?.lastName || "N/A",
        age: runner?.age || "N/A",
        gender: runner?.gender || "N/A",
        distance: runner?.distance || "N/A",
        distance_code,
        previous_distance: runner?.previousDistance || "N/A"
      };
    
      // GENERAL comments: store locally (no server submit)
      if (action === "GENERAL") {
        console.log("AUTO FLAG CHECK:", { selectedStationCode, auto_base, station_code, station_name, entry });
        entries.unshift(entry);
        saveData();
        continue;
      }
      
      const distCode = canonicalDistanceCode(safeString(distance_code || ""));
      
      const payload = {
        event_code: entry.eventName || "AZM-300-2026-0004",
        bib: parseInt(bib, 10),
        distance_code: distCode,
        station_code: safeString(station_code).toUpperCase(),
        pass_type: safeString(pass_type).toUpperCase(),
        operator: operator || "Unknown",
        note
      };
    
      // Sticky DNS/DNF warning (one-time per bib per click)
      const sticky = (typeof getStickyStatusForBibSafe === "function")
        ? getStickyStatusForBibSafe(bib)
        : "";

      if (sticky && pass_type !== "DNS" && pass_type !== "DNF") {
        const bibKey = String(bib).trim();
        if (!__stickyWarnedThisClick.has(bibKey)) {
          __stickyWarnedThisClick.add(bibKey);
          alert(`Bib ${bib} is currently marked ${sticky}. Clicking OK will still submit this ${pass_type} pass. Notify Net Control / HQ / Finish to monitor this runner.`);
          // allow submit to proceed
        }
      }

      console.log("POST payload for add:", payload);
    
      // --- helpers (local to loop) ---
      const isMismatchMsg = (msg) => String(msg || "").includes("RUNNER OFF COURSE");
    
      const isNetworkish = (msg) => {
        const m = String(msg || "").toLowerCase();
        // Typical fetch/network failures across browsers
        return (
          m.includes("failed to fetch") ||
          m.includes("networkerror") ||
          m.includes("load failed") ||
          m.includes("fetch") && m.includes("failed") ||
          m.includes("timeout") ||
          m.includes("connection") && m.includes("reset")
        );
      };
    
      // --- ONE submit path ---
      let online = false;
      try {
        online = await isOnline();
      } catch (_) {
        // if isOnline itself fails, treat as offline
        online = false;
      }
    
          if (!online) {
        // Offline: queue + show locally
        offlineQueue.push(entry);
        entries.unshift(entry);
        saveData();
        if (showAlerts) alert("Offline: saved locally and queued.");
        continue;
      }

      // Online submit
      let result = null;
      try {
        result = await submitPassToServer(payload);
        
      // Jan29 19:25 add for Miss Match 
      // UI cleanup AFTER success so operator is ready for next bib
      try {
      const bibEl = document.getElementById("bibNumber");
      if (bibEl) {
        bibEl.value = "";
        bibEl.focus();   // ✅ THIS IS THE KEY LINE
      }
        
      const table = document.getElementById("bibInfoTable");
      if (table) table.style.display = "none";
        
      timeLockedByBib = false;
        
      if (typeof filterBibLog === "function") filterBibLog();
      } catch (_) {}    

        // True validation failure (rare now): do not save as a pass
        if (result && result.success === false) {
          const errMsg = String(result.error || "");
          if (showAlerts) alert("Submit rejected: " + (errMsg || "Unknown server rejection"));
           continue;
    
        }

        if (result?.mismatch === true) {
          entry.mismatch = true;
          const warn = String(result.warning || "RUNNER OFF COURSE");
          // Keep operator comment intact; store warning separately
          entry.mismatch_warning = warn;
          // Optional: only prefix comment if comment is empty
          if (!entry.comment || !String(entry.comment).trim()) {
            entry.comment = `⚠️ ${warn}`;
          }
        }

        // Attach server fields
        if (result?.success) {
          if (result.pass_id != null) entry.pass_id = result.pass_id;
          if (result.pass_ts != null) entry.pass_ts = result.pass_ts;
          if (result.pass_ts_utc != null) entry.pass_ts_utc = result.pass_ts_utc;
        }

        // Restore Elapsed / Avg Pace / ETA Next for IN/OUT rows
        // Look up the real station_order from AID_STATION_MAP (handles events like LD where
        // START occupies order=1, so AS1 is order=2 — parsing the suffix would give wrong result).
        // For courses where the same station_code appears more than once (e.g. Junction in the
        // 20M Bishop Ultra), count previous IN passes for this bib at this station_code to
        // select the correct occurrence in the path.
        const so = (() => {
          const dc = String(payload.distance_code || '').toUpperCase();
          const sc = String(payload.station_code || '').toUpperCase();
          const sorted = (AID_STATION_MAP[dc] || []).slice()
            .sort((a, b) => Number(a.station_order) - Number(b.station_order));
          const matches = sorted.filter(s => String(s.station_code || '').toUpperCase() === sc);
          if (matches.length > 1) {
            // Determine which occurrence this pass belongs to:
            // IN passes start a new occurrence; OUT/other passes share the most recent IN's.
            const passModeIsIn = String(payload.pass_type || '').toUpperCase() === 'IN';
            const inCount = entries.filter(e =>
              String(e.bib_number || '').trim() === String(bib).trim() &&
              String(e.station_code || '').toUpperCase() === sc &&
              String(e.action || '').toUpperCase() === 'IN'
            ).length;
            const occurrenceIdx = passModeIsIn ? inCount : Math.max(0, inCount - 1);
            const match = matches[occurrenceIdx] || matches[matches.length - 1];
            if (match?.station_order != null) return Number(match.station_order);
          } else if (matches.length === 1 && matches[0].station_order != null) {
            return Number(matches[0].station_order);
          }
          return stationOrderFromCode(payload.station_code); // fallback
        })();
        // Store station_order on the entry so Card C path-lookup in recomputeExpectedFromPrevForUI
        // and computeExpectedFromPrev_PATH correctly handle courses where the same station_code
        // appears more than once (e.g. Junction visited twice in the 20M course).
        if (so != null) entry.station_order = so;
        if (so != null && (entry.pass_ts_utc || entry.pass_ts) && !entry.mismatch) {
          const m = computeElapsedPaceEta(payload.distance_code, so, entry.pass_ts_utc || entry.pass_ts);
          entry.elapsed_total = m.elapsed;
          entry.avg_pace = m.pace;
          entry.eta = m.eta_next;
        }

        if (typeof window.recomputeRowMetrics === "function") {
          window.recomputeRowMetrics(entry, { event_code, station_code, distance_code });
        }

        // Store locally + refresh sticky state
        entries.unshift(entry);
        saveData();
        recomputeStickyStatusSets();

        // Undo/Switch (only if enabled + server gave pass_id)
        if (ENABLE_UNDO_SWITCH && isAuto && result?.pass_id && window.TvemcAutoPassUndo?.show) {
          window.TvemcAutoPassUndo.show({
            event_code,
            pass_id: result.pass_id,
            from_code: previousStationCode,
            to_code: station_code.toUpperCase(),
            choices
          });
        }

        // ✅ UI cleanup AFTER success so operator is ready for next bib
        try {
          const bibEl = document.getElementById("bibNumber");
          if (bibEl) bibEl.value = "";
          const table = document.getElementById("bibInfoTable");
          if (table) table.style.display = "none";
          timeLockedByBib = false;

          if (typeof filterBibLog === "function") filterBibLog();
        } catch (_) {}

      } catch (e) {
        if (typeof releaseSubmit === "function") releaseSubmit(payload);

        const em = String(e?.message || e || "");

        // Network failure: queue offline
        if (isNetworkish(em)) {
          console.warn("Online submit failed (network), queueing offline:", em);
          offlineQueue.push(entry);
          entries.unshift(entry);
          saveData();
          if (showAlerts) alert("Submit failed (queued offline): " + em);
          continue;
        }

        // Other errors: do not queue
        console.warn("Online submit failed:", em);
        if (showAlerts) alert("Submit failed: " + em);
        continue;
      }
      
    }    // ✅ END for (const bib of bibs)

  } catch (e) {
    console.error("Error adding entry:", e);
    if (showAlerts) alert("Failed to add entry: " + (e?.message || e));
  } finally {
    isSubmitting = false;
    focusBibBox();   // ✅ always restore focus after any submit attempt
  }
} // ✅ END async function addEntry(action)

/*--------------------------
 Added to Temp Correction of edit time
 -------------------------*/
 function correctedTimeFromNote(note) {
  const s = String(note || "");
  // Matches: "Corrected time: 15:15:00" or "Corrected time: 15:15"
  const m = s.match(/Corrected time:\s*(\d{1,2}:\d{2}(?::\d{2})?)/i);
  return m ? m[1] : null;
}

function displayTimeForEntry(e) {
  const corrected = correctedTimeFromNote(e.comment);
  return corrected || (e.time ?? "");
}

function populateStationDropdownsFromMap(map, distanceCode) {
  const dist = String(distanceCode || "").trim() || Object.keys(map || {})[0] || "";
  const list = (map && map[dist]) ? map[dist] : [];
  const ev = String((typeof getEventCode === "function" ? getEventCode() : "") || "").toUpperCase();
  const isSOB = ev.includes("SOB"); // apply SOB-only filters/options only for SOB events
  
  // Build station options from DB/map
  let stationOpts = list
    .map(s => ({
      value: String(s.station_code || "").trim().toUpperCase(),
      label: `📍 ${String(s.station_name || "").trim()}`
    }))
    .filter(o => o.value);

// Added Feb 11 at 22:50 with Global helper
window.addEventListener("load", () => setTimeout(persistDistanceForEvent, 400));

document.addEventListener("change", (e) => {
  if (e.target && (e.target.id === "distanceSelect" || e.target.id === "distance_code" || e.target.id === "distanceCode")) {
    persistDistanceForEvent();
  }
});

  // ---------------------------
  // TEMP SAFETY FILTER (v2 migration)
  // Prevent phantom codes like AS3 that cause 400s.
  // Once aid_stations.station_code is populated for the event, REMOVE this filter.
  // ---------------------------
  if (isSOB) {
  const TEMP_VALID_CODES = new Set([
    "START","FINISH",
    "AS1","AS2","AS4","AS5","AS6","AS7","AS8","AS9","AS10","AS11",
    "T30K",
    // allow any explicitly provided AUTO codes too (even though they are synthetic)
    "CORRAL_AUTO","KANAN_AUTO","ZUMA_AUTO"
  ]);
  stationOpts = stationOpts.filter(o => TEMP_VALID_CODES.has(o.value));
  }
  
  // AUTO group options (UI views, not DB stations)
  const autoOpts = isSOB ? [
  { value: "CORRAL_AUTO", label: "📍 CORRAL CANYON (AUTO)" },
  { value: "KANAN_AUTO",  label: "📍 KANAN ROAD (AUTO)" },
  { value: "ZUMA_AUTO",   label: "📍 ZUMA (AUTO)" }
 ] : [];

  // HQ extras (non-station message targets)
  const hqExtras = [
    { value: "DT-RD", label: "DT-RD" },
    { value: "Garrett", label: "Garrett-Boss" },
    { value: "B-Medic-1", label: "B-Medic-1" },
    { value: "NETCONTROL", label: "Net Control" }
  ];

  // aidStation (field selector)
  const hasStart  = stationOpts.some(o => o.value === "START");
  const hasFinish = stationOpts.some(o => o.value === "FINISH");

  setSelectOptions("aidStation", stationOpts, {
    prepend: [
      ...(hasStart  ? [] : [{ value: "START",  label: "🏁 START" }]),
      ...autoOpts,
      ...(hasFinish ? [] : [{ value: "FINISH", label: "🏁 FINISH" }]),
    ],
    append: []
  });

  // hqTarget (message target)
  setSelectOptions("hqTarget", stationOpts, {
    prepend: [
      { value: "ALL", label: "📡 Broadcast to ALL Stations" },
      ...autoOpts
    ],
    append: hqExtras
  });

  // hqLogStationFilter (log filter)
  setSelectOptions("hqLogStationFilter", stationOpts, {
    prepend: [
      { value: "", label: "All" },
      ...autoOpts
    ],
    append: hqExtras
  });

  console.log("Dropdowns populated for distance:", dist, "stations:", stationOpts.length);
  persistAidStationFromDropdown();
  persistDistanceForEvent();

  // Correct the station label after the dropdown has been rebuilt with event-specific names.
  // hq_inbox_poll.js captures TVEMC_STATION_LABEL on window.load (before this async call
  // finishes) and can end up with the stale hardcoded SOB option text (e.g. "KANAN ROAD #1").
  // Overwriting it here ensures the HQ Inbox title reflects the actual event's station name.
  const aidEl = document.getElementById("aidStation");
  if (aidEl) {
    const freshLabel = (aidEl.selectedOptions?.[0]?.textContent || "").trim();
    if (freshLabel) {
      window.TVEMC_STATION_LABEL = freshLabel;
      // Also update the live DOM title so it corrects immediately if messages were
      // already displayed with the stale label.
      const titleEl = document.getElementById("stationInboxTitle");
      if (titleEl && titleEl.textContent.startsWith("HQ Inbox")) {
        titleEl.textContent = "HQ Inbox — " + freshLabel;
      }
    }
  }

}

// small helper
function setSelectOptions(selectId, options, { prepend = [], append = [] } = {}) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  const keep = (sel.value || "").trim();

  sel.innerHTML = "";

  // Prepend items (e.g., ALL, START, FINISH)
  for (const p of prepend) {
    const opt = document.createElement("option");
    opt.value = p.value;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }

  // Main station list
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }

  // Append extras (e.g., SOBRD, NETCONTROL)
  for (const a of append) {
    const opt = document.createElement("option");
    opt.value = a.value;
    opt.textContent = a.label;
    sel.appendChild(opt);
  }

  // Restore selection if possible
  if (keep) sel.value = keep;
}

/*---------------------------
 Bib Log Viewer query
 ---------------------------*/
 function renderBibLog(list) {
  const tbody = document.querySelector("#bibLogTable tbody");
  const table = document.getElementById("bibLogTable");
  if (!tbody || !table) {
    console.warn("Bib log table not found (#bibLogTable tbody).");
    return;
  }
  
  console.log("renderBibLog list length:", Array.isArray(list) ? list.length : "not array");

  // --- Stats Strip update (bolt-on) ---
if (window.ResultsStrip?.update) {
  window.ResultsStrip.update(list, document.getElementById("aidStation")?.value || "");
}

  tbody.innerHTML = "";

  for (const e of list) {
  const tr = document.createElement("tr");

    // Show Pass # only for stations that are part of a multi-pass group in AID_STATION_MAP.
    // pass_num is already blank for single-pass stations (set during derivation above).
    const passNum = e.pass_num || "";

    // AUTO suffix: only show for SOB events where CORRAL/KANAN/ZUMA auto groups are active.
    // For non-SOB events (e.g. LD-100), no auto groups exist so never append "(AUTO)".
    const sc = safeString(e.station_code).toUpperCase();
    const currentEventCode = String(typeof getEventCode === "function" ? getEventCode() : (localStorage.getItem("tvemc_eventName") || "")).toUpperCase();
    const isSOBEvent = currentEventCode.includes("SOB") || currentEventCode.includes("KH_SOB");
    const SOB_AUTO_STATIONS = new Set(["AS1","AS8","AS10","AS12","AS2","AS7","AS4","AS6"]);
    const autoSuffix = (isSOBEvent && SOB_AUTO_STATIONS.has(sc)) ? " (AUTO)" : "";


    // Only show Pass # for Corral Canyon rows
   // const showPass = /(CORRAL CANYON|KANAN ROAD|ZUMA)/i.test(stationLabelRaw);
    // const passNum = showPass ? rawPassNum : "";
  

  const act = String(e.action || "").toUpperCase();
  if (act === "DNS") tr.classList.add("row-dns");
  if (act === "DNF") tr.classList.add("row-dnf");
    tr.innerHTML = `
      <td class="bib-cell">${e.bib_number ?? ""}</td>
      <td>${e.overall_place || ""}</td>
      <td>${e.action ?? ""}</td>
      <td title="Original: ${e.time ?? ""}">${displayTimeForEntry(e)}${correctedTimeFromNote(e.comment) ? " ✎" : ""}</td>
      <td>${e.date ?? ""}</td>
      <td class="pass-col">${passNum}</td>
      <td>${((e.station_name ?? stationNameFromCode(e.station_code) ?? e.station ?? "") || "") + autoSuffix}</td>
      <td>${e.comment ?? ""}</td>
      <td>${e.operator ?? ""}</td>
      <td>${e.finish_time || ""}</td>
      <td>${e.elapsed_total || e.elapsed || "N/A"}</td>
      <td>${e.avg_pace || e.pace || "N/A"}</td>
      <td>${e.gender_place || ""}</td>
      <td>${e.age_group || ""}</td>
      <td>${e.ag_place || ""}</td>
      <td>${e.eta_next != null ? e.eta_next : (e.eta ?? "N/A")}</td>
      <td>${e.date ?? ""}</td>
      <td>${e.first_name ?? "N/A"}</td>
      <td>${e.last_name ?? "N/A"}</td>
      <td>${e.age ?? "N/A"}</td>
      <td>${e.gender ?? "N/A"}</td>
      <td>${e.distance ?? "N/A"}</td>
      <td>${e.previous_distance ?? "N/A"}</td>
      <td><a href="#" onclick="editPass('${e.pass_id}'); return false;">Edit</a></td>
    `;
    tbody.appendChild(tr);
  }

  table.style.display = "table";
}

function filterBibLog() {
  const el = document.getElementById("logSearch");
  const q = String(el?.value ?? "").trim().toLowerCase();

  const filtered = !q
    ? entries
    : entries.filter(e => {
        const bib = String(e?.bib_number ?? "").trim();

        const hay = [
          bib,
          e?.action,
          e?.station,
          e?.comment,
          e?.operator,
          e?.first_name,
          e?.last_name,
          e?.distance,
          e?.distance_code,
          e?.station_code
        ]
          .map(v => String(v ?? "").trim())
          .join(" ")
          .toLowerCase();

        // Numeric shortcut: "3" matches 3, 30, 301, etc.
        if (/^\d+$/.test(q)) {
          if (bib.startsWith(q)) return true;
        }

        return hay.includes(q);
      });

  renderBibLog(filtered);

  // Update count INSIDE the function (filtered is in scope here)
  const entryCount = document.getElementById("entryCount");
  if (entryCount) entryCount.textContent = filtered.length;
}

/*---------------------------
Bib Log Viewer table runner row edit
----------------------------*/
function editPass(pass_id) {
  const entry = entries.find(e => String(e.pass_id) === String(pass_id));
  if (!entry) return alert("Pass not found.");

  const originalLocal = entry.time || "";

  const newTime = prompt("Edit Time (HH:MM:SS, 24hr):", originalLocal);
  if (newTime === null) return;
  const correctedLocal = newTime.trim();

  // Strip any legacy baked-in mismatch prefix so the user sees their original note only
  const cleanedComment = String(entry.comment || "").replace(/^⚠️\s*RUNNER OFF COURSE\s*—[^.]*\.\s*/i, "").trim();

  const newNote = prompt("Edit Note:", cleanedComment);
  if (newNote === null) return;
  const userNote = (newNote || "").trim();

  // Build a consistent correction tag (includes original + corrected)
  const correctionTag = `Changed Time | Original: ${originalLocal} | Corrected time: ${correctedLocal}`;

  // Prevent duplicating the same correction tag repeatedly
  let finalNote = userNote;
  if (!finalNote) {
    finalNote = correctionTag;
  } else {
    // If user note already contains a correction tag, don't append again
    if (!/Changed Time \| Original:/i.test(finalNote)) {
      finalNote = `${finalNote} | ${correctionTag}`;
    }
  }

  // Update local display immediately (for operator)
  entry.time = correctedLocal;
  entry.comment = finalNote;

  filterBibLog();

  // Send update to server (audit safe: update NOTE only)
  updatePassOnServer(pass_id, { note: entry.comment })
    .catch(err => alert("Update failed: " + err.message));
}

async function updatePassOnServer(pass_id, changes) {
  const res = await fetch("pass_update.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pass_id, ...changes })
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error("Server returned non-JSON: " + text.slice(0, 140)); }

  if (!json.success) throw new Error(json.error || "Server rejected update");

  console.log("Pass updated:", pass_id, changes);
}

/* ---------------------------
   Offline queue sync
----------------------------*/
async function syncOfflineEntries() {
  if (!(await isOnline())) return;    
  if (!offlineQueue.length) return;
  
  let synced = 0;
  offlineQueue = offlineQueue.filter(e => e && (e.distance_code || e.distance) && (e.distance_code || e.distance) !== "N/A");
  saveData();

  for (let i = offlineQueue.length - 1; i >= 0; i--) {
    const entry = offlineQueue[i];

    const payload = {
      event_code: entry.eventName || "AZM-300-2026-0004",
      bib: parseInt(entry.bib_number, 10),
      distance_code: canonicalDistanceCode(safeString(entry.distance_code || entry.distance || "")),
      station_code: safeString(entry.station_code || ""),
      pass_type: safeString(entry.action).toUpperCase(),
      operator: entry.operator || "Unknown",
      note: entry.comment || ""
    };

    try {
      await submitPassToServer(payload);
      offlineQueue.splice(i, 1);
      synced++;
    } catch (e) {
      console.warn("Offline sync failed for entry:", payload, e.message);
    }
  }

  if (synced > 0) saveData();
  console.log("Offline sync complete. Synced:", synced, "Remaining:", offlineQueue.length);
}

function restoreHeaderFields() {
  // Event name: default if empty, but user can change it
  const eventEl = document.getElementById("eventName");
  if (eventEl) {
    const savedEvent = localStorage.getItem("tvemc_eventName");
    eventEl.value = (savedEvent && savedEvent.trim()) ? savedEvent : (eventEl.value || "AZM-300-2026-0004");
  }

  // Message number (optional to persist right now)
  const msgEl = document.getElementById("messageNum");
  if (msgEl) {
    const savedMsg = localStorage.getItem("tvemc_messageNum");
    if (savedMsg) msgEl.value = savedMsg;
  }

  // Operator name persists
  const opEl = document.getElementById("operatorName");
  if (opEl) {
    const savedOp = localStorage.getItem("tvemc_operatorName");
    if (savedOp) opEl.value = savedOp;
  }

  // Send-to persists
  const sendEl = document.getElementById("sendTo");
  if (sendEl) {
    const savedSend = localStorage.getItem("tvemc_sendTo");
    if (savedSend) sendEl.value = savedSend;
  }

  // Aid station persists (by value/code like START/AS1/etc.) Lines below commented out on Feb 8 13:45
 // Aid station persists (per-tab first; fallback to localStorage)
 const asEl = document.getElementById("aidStation");
 if (asEl) {
   const savedAS = String(
   sessionStorage.getItem("tvemc_aidStation") ||
   localStorage.getItem("tvemc_aidStation") ||
   ""
  ).trim().toUpperCase();
    
  if (savedAS) asEl.value = savedAS;
    
  if (!asEl.__tvemcBound) {
    asEl.__tvemcBound = true;
    asEl.addEventListener("change", (e) => {
      const sc = String(e.target.value || "").trim().toUpperCase();
      try { sessionStorage.setItem("tvemc_aidStation", sc); } catch (err) {}
      localStorage.setItem("tvemc_aidStation", sc);
      updateSubject();
    });
  }
}


  // Now that fields are restored, refresh subject line
  updateSubject();
}

function wireHeaderFieldPersistence() {
  document.getElementById("eventName")?.addEventListener("input", (e) => {
    localStorage.setItem("tvemc_eventName", e.target.value || "");
    updateSubject();
  });
  // Also handle <select> change events (for the event picker dropdown)
  document.getElementById("eventName")?.addEventListener("change", (e) => {
    localStorage.setItem("tvemc_eventName", e.target.value || "");
    updateSubject();
  });

  document.getElementById("messageNum")?.addEventListener("input", (e) => {
    localStorage.setItem("tvemc_messageNum", e.target.value || "");
    updateSubject();
  });

  document.getElementById("operatorName")?.addEventListener("input", (e) => {
    localStorage.setItem("tvemc_operatorName", e.target.value || "");
  });

  document.getElementById("sendTo")?.addEventListener("input", (e) => {
    localStorage.setItem("tvemc_sendTo", e.target.value || "");
  });

  document.getElementById("aidStation")?.addEventListener("change", (e) => {
  const sc = String(e.target.value || "").trim().toUpperCase();

  // Per-tab station (multi-window testing)
  try { sessionStorage.setItem("tvemc_aidStation", sc); } catch (err) {}

  // Keep legacy/global (optional, but fine)
  localStorage.setItem("tvemc_aidStation", sc);

  // Update the cached station immediately so the results strip 5-second interval
  // uses the new station rather than the previous one (fixes stale-FINISH Card C bug).
  window.__rs_lastStationCode = sc;

  updateSubject();

  // Re-render Card C immediately for the newly selected station without waiting
  // for the 10-second auto-refresh cycle.
  if (window.ResultsStrip?.update) {
    window.ResultsStrip.update(window.__rs_lastList || entries, sc);
  }
});
}

function setupHighContrastToggle() {
  // Try common IDs (so you don't have to guess which one your HTML uses)
  const el =
    document.getElementById("highContrast") ||
    document.getElementById("highContrastToggle") ||
    document.getElementById("contrastToggle") ||
    document.getElementById("sunlightMode") ||
    document.querySelector('input[type="checkbox"][name="highContrast"]');

  if (!el) {
    console.warn("High contrast toggle not found (no matching element id/name).");
    return;
  }

  const KEY = "tvemc_highContrast";
  const apply = (on) => {
    document.body.classList.toggle("high-contrast", !!on);
  };

  // restore saved state
  const saved = localStorage.getItem(KEY);
  const isOn = saved === "1";
  el.checked = isOn;
  apply(isOn);

  // save + apply on change
  el.addEventListener("change", () => {
    localStorage.setItem(KEY, el.checked ? "1" : "0");
    apply(el.checked);
  });

  console.log("High contrast toggle wired:", el.id || el.name || "(unknown)");
}


function setupFastTabAndAlerts() {

  // ===== Show confirmation pop-ups =====
  const alertsEl = document.getElementById("showAlerts");
  const ALERTS_KEY = "tvemc_showAlerts";

  if (alertsEl) {
    const saved = localStorage.getItem(ALERTS_KEY);
    showAlerts = saved === null ? alertsEl.checked : (saved === "1");
    alertsEl.checked = showAlerts;

    alertsEl.addEventListener("change", () => {
      showAlerts = alertsEl.checked;
      localStorage.setItem(ALERTS_KEY, showAlerts ? "1" : "0");
      console.log("Show alerts:", showAlerts);
    });
  }
  
  // ===== Safety Alerts (DNS/DNF warnings) =====
    const safetyEl =
      document.getElementById("showSafetyAlerts") ||  // if you add a checkbox later
      null;
    
    const savedSafety = localStorage.getItem(SAFETY_ALERTS_KEY);
    showSafetyAlerts = (savedSafety === null) ? true : (savedSafety === "1");
    
    if (safetyEl) {
      safetyEl.checked = showSafetyAlerts;
      safetyEl.addEventListener("change", () => {
        showSafetyAlerts = safetyEl.checked;
        localStorage.setItem(SAFETY_ALERTS_KEY, showSafetyAlerts ? "1" : "0");
        console.log("Show SAFETY alerts:", showSafetyAlerts);
      });
    } else {
      // No UI checkbox yet: still persist default
      localStorage.setItem(SAFETY_ALERTS_KEY, showSafetyAlerts ? "1" : "0");
    }


  // ===== Fast Tab Mode =====
  const fastModeEl = document.getElementById("fastMode");
  const FASTTAB_KEY = "tvemc_fastTabMode";
  let fastTabOn = false;

  if (fastModeEl) {
    const saved = localStorage.getItem(FASTTAB_KEY);
    fastTabOn = saved === "1";
    fastModeEl.checked = fastTabOn;

    fastModeEl.addEventListener("change", () => {
      fastTabOn = fastModeEl.checked;
      localStorage.setItem(FASTTAB_KEY, fastTabOn ? "1" : "0");
      console.log("Fast Tab Mode:", fastTabOn);
    });
  }

  // ===== Intercept TAB from Bib Number =====
  const bibEl = document.getElementById("bibNumber");
  if (!bibEl) return;

  bibEl.addEventListener("keydown", (e) => {
    if (!fastTabOn) return;
    if (e.key !== "Tab") return;
    if (e.shiftKey) return;     // keep Shift+Tab normal

    e.preventDefault();

    // Your IN button has class="in-button"
    const inBtn = document.querySelector("button.in-button");
    if (inBtn) inBtn.focus();
  });
}

function showDistancePopup() {
  const pop = document.getElementById("distancePopup");
  if (!pop) return;

  const bib = (document.getElementById("bibNumber")?.value || "").trim();
  if (!bib) {
    if (showAlerts) alert("Enter a Bib Number first, then Change Distance.");
    return;
  }

  pop.style.display = "block";
  document.getElementById("distanceSelect")?.focus();    
 
}

function closeDistancePopup() {
  const pop = document.getElementById("distancePopup");
  if (pop) pop.style.display = "none";
  document.getElementById("bibNumber")?.focus();
}

window.saveRunnerStartOverride = async function ({ event_code, bib, start_ts_actual, reason, set_by }) {
  const res = await fetch("runner_start_override_save.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_code, bib, start_ts_actual, reason, set_by })
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || ("HTTP " + res.status));
  return true;
};

console.log("saveRunnerStartOverride loaded:", typeof window.saveRunnerStartOverride);

async function updateDistance(e) {
  e?.preventDefault?.();

  const bibStr = (document.getElementById("bibNumber")?.value || "").trim();
  const newDist = (document.getElementById("distanceSelect")?.value || "").trim();
  

  if (!bibStr || !newDist) {
    if (showAlerts) alert("Missing Bib Number or Distance selection.");
    return;
  }

  const runner = bibList.find(r => String(r.bib).trim() === String(bibStr).trim());
  if (!runner) {
    if (showAlerts) alert("Bib not found in runner list.");
    return;
  }
  
// DNS is a STATUS (pass_type), NOT a distance.
// Do NOT set runner.distance = "DNS".
    if (newDist.toUpperCase() === "DNS") {
      const oldDist = runner.distance || runner.previousDistance || "N/A";
    
      // Put a helpful note if blank
      const noteBox = document.getElementById("comment");
      if (noteBox && !noteBox.value.trim()) {
        noteBox.value = `DNS (Did Not Start) — distance ${oldDist}`;
      }
    
              // Safety: prevent addEntry from crashing if sticky helper is missing   Jan 25 at 19:33
              // function getStickyStatusForBib(bib) {
              // return { dns: false, dnf: false, finish: false, note: "" };
              // }
    
      // Submit a DNS pass entry
      await addEntry("DNS");
    
     // Force UI + cards to refresh after DNS submit (race-safe)
      try {
        // Clear the runner panel and bib input (prevents operator confusion)
        const bibEl = document.getElementById("bibNumber");
        if (bibEl) bibEl.value = "";
        if (typeof clearRunnerInfoPanel === "function") clearRunnerInfoPanel();

        // Let the browser repaint before heavy reloads
        setTimeout(async () => {
          try {
            if (typeof renderBibLog === "function") await renderBibLog();
          } catch {}
          try {
            if (typeof loadPasses === "function") await loadPasses();
          } catch {}
          try {
            if (typeof refreshStatusOverrides === "function") await refreshStatusOverrides();
          } catch {}
          try {
            if (typeof refreshCards === "function") await refreshCards();
          } catch {}
        }, 0);
      } catch {}

      closeDistancePopup();
      if (showAlerts) alert(`DNS recorded for Bib ${bibStr} (${oldDist})`);
      return;
  }
    
  runner.previousDistance = runner.distance || runner.previousDistance || "N/A";
  runner.distance = newDist;

  updateBibInfo();

  const oldDist = runner.previousDistance || "N/A";
  const noteBox = document.getElementById("comment");
  if (noteBox && !noteBox.value.trim()) {
    noteBox.value = `Distance changed ${oldDist} → ${newDist}`;
  }

  // Optional: set manual runner start override (per bib)
  try {
    const bibNum = parseInt(bibStr || "0", 10);
    if (bibNum > 0) {
      const doOverride = confirm("Override start time for this runner? (OK = yes, Cancel = no)");
      if (doOverride) {
        const suggested =
          (window.TVEMC_runnerStartByBib?.get(String(bibNum)) ||
           window.TVEMC_startByDistance?.get(String(newDist)) ||
           "");

        const input = prompt("Enter start time (YYYY-MM-DD HH:MM:SS)", suggested);
        if (input && input.trim()) {
          const event_code = (window.TVEMC_EVENT_CODE || "AZM-300-2026-0004").trim();
          const set_by = (document.getElementById("operatorName")?.value || "").trim() || "station";
          const reason = "Distance change";

          await window.saveRunnerStartOverride({
            event_code,
            bib: bibNum,
            start_ts_actual: input.trim(),
            reason,
            set_by
          });

          // Update local map so results update immediately
          if (window.TVEMC_runnerStartByBib) {
            window.TVEMC_runnerStartByBib.set(String(bibNum), input.trim());
            // optional: refresh config on next results compute
            // (or call loadResultsConfig() if you want immediate refresh)
           }
          alert("Runner start override saved.");
        }
      }
    }
  } catch (err) {
    alert("Start override failed: " + err.message);
  }

  closeDistancePopup();
  if (showAlerts) alert(`Distance updated for Bib ${bibStr}: ${oldDist} → ${newDist}`);
}


async function exportBibCSV_v2() {
  try {
    const event_code = cleanEventCode(getEventCode());
    const { station_code } = getStationNameAndCode(); // uses your dropdown mapping

    // Track last export per event+station
    // const key = `tvemc_lastExport_passId_${event_code}_${station_code || "ALL"}`; REMOVE AFTER TEST
    const key = `tvemc_lastExport_passId_CSV_${event_code}_${station_code || "ALL"}`;
    const lastExportedId = parseInt(localStorage.getItem(key) || "0", 10);

    const res = await fetch(
      `passes_load.php?event_code=${encodeURIComponent(event_code)}&limit=5000`,
      { cache: "no-store" }
    );

    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("passes_load returned non-array");

    // Only export rows newer than the last export
    const newRows = rows
      .filter(r => parseInt(r.pass_id || "0", 10) > lastExportedId)
      .sort((a, b) => parseInt(a.pass_id, 10) - parseInt(b.pass_id, 10));

    if (newRows.length === 0) {
      if (showAlerts) alert("No new passes since last export.");
      return;
    }

    // Build a lookup from pass_id -> computed/display row (Bib Log Viewer shape)
    const byPassId = new Map(entries.map(e => [String(e.pass_id), e]));
    
    // Bib Log Viewer headers (canonical)
    const headers = [
      "Bib #","Place","Action","Time","Day","Station","Comment","Operator",
      "Finish","Elapsed","Avg Pace","Gender Place","AgeGrp","AG Place","ETA Next","Date",
      "First Name","Last Name","Age","Gender","Distance","Previous Distance"
    ];
    
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    
    const lines = newRows.map(r => {
      const e = byPassId.get(String(r.pass_id)) || {};
    
      // Prefer computed/display fields from the viewer entry object
      return [
        e.bib_number ?? r.bib,
        e.overall_place ?? "",
        e.action ?? (r.pass_type || ""),
        e.time ?? "",
        e.day ?? "",
        e.station ?? "",
        e.comment ?? r.note ?? "",
        e.operator ?? r.operator ?? "",
        e.finish_time ?? "",
        e.elapsed_total ?? e.elapsed ?? "",
        e.gender_place ?? e.place ?? "",
        e.avg_pace ?? e.pace ?? "",
        e.age_group ?? "",
        e.ag_place ?? "",
        e.eta ?? e.eta_next ?? "",
        e.date ?? "",
        e.first_name ?? "",
        e.last_name ?? "",
        e.age ?? "",
        e.gender ?? "",
        e.distance ?? e.distance_code ?? "",
        e.previous_distance ?? ""
      ].map(esc).join(",");
    });
    
    const csv = [headers.join(","), ...lines].join("\n");


    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const msgNum = String(document.getElementById("messageNum")?.value || "1").padStart(3, "0");
    const d = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(d);
    const get = (t) => parts.find(p => p.type === t)?.value || "";
    const stamp = `${get("year")}-${get("month")}-${get("day")}_${get("hour")}${get("minute")}`;

    const a = document.createElement("a");
    a.href = url;
    a.download = `passes_${event_code}_${station_code || "ALL"}_MSG${msgNum}_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // Update last exported pass_id
    const maxId = Math.max(...newRows.map(r => parseInt(r.pass_id, 10)));
    localStorage.setItem(key, String(maxId));

    if (showAlerts) alert(`Exported ${newRows.length} NEW passes to CSV.`);
  } catch (e) {
    console.error("exportBibCSV_v2 failed:", e);
    if (showAlerts) alert("CSV export failed: " + e.message);
  }
}

async function exportBibWinlinkTxt_v2() {
  try {
    const event_code = cleanEventCode(getEventCode());
    const { station_code } = getStationNameAndCode(); // optional, but helpful in filename

    if (typeof loadPassesFromServer === "function") {
      await loadPassesFromServer();
    }

    // Track last Winlink export per event+station (separate from CSV)
    // const key = `tvemc_lastWinlinkExport_passId_${event_code}_${station_code || "ALL"}`;   REMOVE AFTER TESTING
    const key = `tvemc_lastExport_passId_WINLINK_${event_code}_${station_code || "ALL"}`;
    const lastExportedId = parseInt(localStorage.getItem(key) || "0", 10);

    const res = await fetch(
      `passes_load.php?event_code=${encodeURIComponent(event_code)}&limit=5000`,
      { cache: "no-store" }
    );

    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("passes_load returned non-array");

    const newRows = rows
      .filter(r => parseInt(r.pass_id || "0", 10) > lastExportedId)
      .sort((a, b) => parseInt(a.pass_id, 10) - parseInt(b.pass_id, 10));

    if (newRows.length === 0) {
      if (showAlerts) alert("No new passes since last Winlink export.");
      return;
    }

    // Build tab-delimited Winlink text (small + readable)
    // Header line first (optional, but nice)
     // Use current Bib Log Viewer rows so Winlink matches what stations will see/import
    const byPassId = new Map(entries.map(e => [String(e.pass_id), e]));
    
    const header = [
      "Bib #","Place","Action","Time","Day","Station","Comment","Operator",
      "Finish","Elapsed","Avg Pace","Gender Place","AgeGrp","AG Place","ETA Next","Date",
      "First Name","Last Name","Age","Gender","Distance","Previous Distance"
    ].join("\t");
    
    const safe = (v) => String(v ?? "").replace(/\r?\n/g, " ").trim();
    
    const lines = newRows.map(r => {
      const e = byPassId.get(String(r.pass_id)) || {};
      return [
        e.bib_number ?? r.bib,
        e.overall_place ?? "",
        e.action ?? (r.pass_type || ""),
        e.time ?? "",
        e.day ?? "",
        e.station ?? "",
        e.comment ?? r.note ?? "",
        e.operator ?? r.operator ?? "",
        e.finish_time ?? "",
        e.elapsed_total ?? e.elapsed ?? "",
        e.avg_pace ?? e.pace ?? "",
        e.gender_place ?? "",
        e.age_group ?? "",
        e.ag_place ?? "",
        e.eta ?? e.eta_next ?? "",
        e.date ?? "",
        e.first_name ?? "",
        e.last_name ?? "",
        e.age ?? "",
        e.gender ?? "",
        e.distance ?? e.distance_code ?? "",
        e.previous_distance ?? ""
      ].map(safe).join("\t");
    });

    const text = [header, ...lines].join("\n");

    // 1) Copy to clipboard
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.warn("Clipboard copy failed (still downloading .txt):", e.message);
    }

    // 2) Download .txt with MSG### + local timestamp
    const msgNum = String(document.getElementById("messageNum")?.value || "1").padStart(3, "0");
    const d = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(d);
    const get = (t) => parts.find(p => p.type === t)?.value || "";
    const stamp = `${get("year")}-${get("month")}-${get("day")}_${get("hour")}${get("minute")}`;

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `winlink_${event_code}_${station_code || "ALL"}_MSG${msgNum}_${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // Update last exported pass_id for Winlink
    const maxId = Math.max(...newRows.map(r => parseInt(r.pass_id, 10)));
    localStorage.setItem(key, String(maxId));

    if (showAlerts) alert(`Winlink: copied + downloaded ${newRows.length} NEW passes.`);
  } catch (e) {
    console.error("exportBibWinlinkTxt_v2 failed:", e);
    if (showAlerts) alert("Winlink export failed: " + e.message);
  }
}

/*---------------------------
Import Radio Winlink (.txt or .csv)
Matches exportBibWinlinkTxt_v2 + exportBibCSV_v2 headers
---------------------------*/
function importRadioWinlinkTxt() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.csv";

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const text = raw.replace(/\uFEFF/g, ""); // strip BOM if present
      const lines = text.split(/\r?\n/).filter(l => l.trim());

      if (!lines.length) throw new Error("File is empty.");

      // --- Detect delimiter / format ---
      const firstLine = lines[0];
      const looksTab = firstLine.includes("\t");
      const looksCsv = firstLine.includes(",") && /"[^"]*"/.test(firstLine); // light heuristic

      const format = looksTab ? "TSV" : (looksCsv ? "CSV" : "TSV"); // default to TSV

      // --- Parsers ---
      const parseTSV = (line) => line.split("\t").map(s => String(s ?? "").trim());

      const parseCSV = (line) => {
        // Simple CSV parser w/ quotes
        const out = [];
        let cur = "";
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQ) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') inQ = false;
            else cur += ch;
          } else {
            if (ch === '"') inQ = true;
            else if (ch === ",") { out.push(cur.trim()); cur = ""; }
            else cur += ch;
          }
        }
        out.push(cur.trim());
        return out;
      };

      const parseLine = (line) => (format === "CSV" ? parseCSV(line) : parseTSV(line));

      // --- Header row ---
      const header = parseLine(lines.shift()).map(h => String(h || "").trim());

      // Helper: find a column by trying multiple header names
      const idxAny = (...names) => {
        for (const n of names) {
          const i = header.indexOf(n);
          if (i !== -1) return i;
        }
        return -1;
      };

      // --- Column indices (supports NEW and OLD) ---
      const iBib   = idxAny("Bib #", "bib", "bib_number");
      const iType  = idxAny("Action", "pass_type", "type");
      const iStnCd = idxAny("station_code", "Station Code");
      const iStnNm = idxAny("Station", "station", "Aid Station");
      const iNote  = idxAny("Comment", "note", "Notes");
      const iOp    = idxAny("Operator", "operator");
      const iDist  = idxAny("Distance", "distance_code", "distance");
      const iPrevD = idxAny("Previous Distance", "previous_distance");

      // Time building:
      const iPassTs = idxAny("pass_ts", "Pass TS", "Timestamp"); // legacy
      const iDate   = idxAny("Date");
      const iTime   = idxAny("Time");

      if (iBib === -1 || iType === -1) {
        throw new Error("Missing required columns: Bib # (or bib) AND Action (or pass_type).");
      }

      const event_code = cleanEventCode(getEventCode());

      // Build a station display -> station_code map from your dropdown at runtime (most reliable)
      function buildStationDisplayToCodeMap() {
        const map = {};
        const sel = document.getElementById("aidStation");
        // const sel = document.getElementById("stationSelect"); Remove if above line works Jan.8 2026
        if (!sel) return map;

        for (const opt of sel.options) {
          const label = String(opt.text || "").trim();
          const code  = String(opt.value || "").trim();

          if (!label || !code) continue;

          const norm = normalizeStationDisplay(label);
          if (norm) map[norm] = code;

          // Also map raw label (sometimes already clean)
          map[label] = code;
        }
        return map;
      }

      const STATION_DISPLAY_TO_CODE = buildStationDisplayToCodeMap();

      function normalizeStationDisplay(stationText) {
        let s = String(stationText || "").trim();
        if (!s) return "";

        // Strip emoji markers and extra whitespace
        s = s.replace(/^📍\s*/g, "").replace(/^🏁\s*/g, "").trim();

        // Strip " (Pass X)" suffix
        s = s.replace(/\s*\(Pass\s*\d+\)\s*$/i, "").trim();

        // Some displays include "#1" in text; keep it (because your dropdown likely matches it)
        // But also normalize multiple spaces
        s = s.replace(/\s+/g, " ").trim();
        return s;
      }

      function deriveStationCodeFromStationName(stationName) {
        const rawName = String(stationName || "").trim();
        if (!rawName) return "";

        const norm = normalizeStationDisplay(rawName);

        // Try direct + normalized + raw
        return (
          STATION_DISPLAY_TO_CODE[rawName] ||
          STATION_DISPLAY_TO_CODE[norm] ||
          // fallback: if you also have a global mapping object
          (typeof STATION_NAME_TO_CODE !== "undefined" ? (STATION_NAME_TO_CODE[rawName] || STATION_NAME_TO_CODE[norm]) : "") ||
          ""
        );
      }

      function normalizeDateToYYYYMMDD(dateStr) {
        const d = String(dateStr || "").trim();
        if (!d) return "";

        // Handles M/D/YYYY or MM/DD/YYYY
        const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return "";
        const mm = String(m[1]).padStart(2, "0");
        const dd = String(m[2]).padStart(2, "0");
        const yy = m[3];
        return `${yy}-${mm}-${dd}`;
      }

      function normalizeTimeToHHMMSS(timeStr) {
        let t = String(timeStr || "").trim();
        if (!t) return "";

        // Accept HH:MM or HH:MM:SS
        const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!m) return "";
        const hh = String(m[1]).padStart(2, "0");
        const mm = m[2];
        const ss = String(m[3] || "00").padStart(2, "0");
        return `${hh}:${mm}:${ss}`;
      }

      function derivePassTs(cols) {
        // Prefer explicit pass_ts for legacy files
        if (iPassTs !== -1) {
          const v = String(cols[iPassTs] || "").trim();
          if (v) return v;
        }

        // New-format: Date + Time
        const dateRaw = iDate !== -1 ? cols[iDate] : "";
        const timeRaw = iTime !== -1 ? cols[iTime] : "";

        const ymd = normalizeDateToYYYYMMDD(dateRaw);
        const hms = normalizeTimeToHHMMSS(timeRaw);

        if (!ymd || !hms) return "";
        return `${ymd} ${hms}`;
      }

      // --- Build rows to import ---
      const parsed = lines.map((line, lineIdx) => {
        const cols = parseLine(line);

        const bib = String(cols[iBib] ?? "").trim();
        const pass_type = String(cols[iType] ?? "").trim();

        // station_code: prefer explicit, else derive from Station display
        let station_code = (iStnCd !== -1 ? String(cols[iStnCd] || "").trim() : "");
        if (!station_code && iStnNm !== -1) {
          station_code = deriveStationCodeFromStationName(cols[iStnNm] || "");
        }

        const pass_ts = derivePassTs(cols);

        const note = (iNote !== -1 ? String(cols[iNote] || "") : "").trim();
        const operator = (iOp !== -1 ? String(cols[iOp] || "") : "").trim();
        const distance_code = (iDist !== -1 ? String(cols[iDist] || "") : "").trim();
        const previous_distance = (iPrevD !== -1 ? String(cols[iPrevD] || "") : "").trim();

        // Collect validation issues (for console visibility)
        const issues = [];
        if (!bib) issues.push("missing bib");
        if (!pass_type) issues.push("missing action/pass_type");
        if (!station_code) issues.push("missing station_code (could not derive from Station)");
        if (!pass_ts) issues.push("missing pass_ts (could not derive from Date+Time)");

        return {
          __line: lineIdx + 2, // +2 because header was removed, and humans count from 1
          __issues: issues,
          event_code,
          bib,
          pass_type,
          pass_ts,
          station_code,
          note,
          operator,
          distance_code,
          previous_distance
        };
      });

      // Keep only rows that are valid enough to insert
      const filtered = parsed.filter(r =>
        String(r.bib).trim() &&
        String(r.pass_type).trim() &&
        String(r.station_code).trim() &&
        String(r.pass_ts).trim()
      );

      const rejected = parsed.filter(r => r.__issues?.length);

      if (!filtered.length) {
        console.group("Winlink import rejected rows");
        rejected.slice(0, 50).forEach(r => console.warn(`Line ${r.__line}: ${r.__issues.join(", ")}`, r));
        console.groupEnd();
        throw new Error("No valid rows found. Need bib + action + station_code + pass_ts (Date+Time).");
      }

      // (Optional) log rejections so you can spot mapping/date issues quickly
      if (rejected.length) {
        console.group(`Winlink import: ${rejected.length} rejected row(s)`);
        rejected.slice(0, 50).forEach(r => console.warn(`Line ${r.__line}: ${r.__issues.join(", ")}`, r));
        console.groupEnd();
      }

      const res = await fetch("passes_import.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: filtered })
      });

      // If server returns non-JSON error HTML, this avoids "Unexpected token <"
      const contentType = res.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await res.json() : { success: false, error: await res.text() };

      if (!payload.success) {
        throw new Error(payload.error || "Import failed");
      }

      if (showAlerts) {
        alert(
          `Radio Import Complete\n\n` +
          `Inserted: ${payload.inserted}\n` +
          `Skipped: ${payload.skipped}\n` +
          `Errors: ${payload.errors?.length || 0}\n` +
          (rejected.length ? `Rejected (client-side): ${rejected.length}` : "")
        );
      }

      // Refresh view
      const table = document.getElementById("bibLogTable");
      if (table && table.style.display !== "none" && typeof loadPassesFromServer === "function") {
        loadPassesFromServer();
      }

    } catch (e) {
      console.error("Radio import failed:", e);
      if (showAlerts) alert("Radio import failed: " + e.message);
    }
  };

  input.click();
}

    // Added with the new distances start times Feb-11 at 17:35
    function localInputToDb(tsLocal) {
      const v = String(tsLocal || "").trim();
      if (!v) return "";
      // "YYYY-MM-DDTHH:MM" -> "YYYY-MM-DD HH:MM:00"
      return v.replace("T", " ") + ":00";
    }

/*----------------------------
          START TIME 
----------------------------*/
async function saveStartTimes() {
  const btn = document.getElementById("saveStartTimesBtn");
  const statusEl = document.getElementById("saveStartTimesStatus");

  const setStatus = (msg, color) => {
    if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
  };
  const setBtnText = (txt) => { if (btn) btn.textContent = txt; };
  const disableBtn = (d) => { if (btn) btn.disabled = d; };

  setBtnText("Saving…");
  disableBtn(true);
  setStatus("", "");

  try {
    const event_code = cleanEventCode(getEventCode());
    const set_by = safeString(document.getElementById("operatorName")?.value || "HQ");

    const times = {
      "20M":  localInputToDb(document.getElementById("start_20M")?.value),
      "30K":  localInputToDb(document.getElementById("start_30K")?.value),
      "26.2": localInputToDb(document.getElementById("start_26_2")?.value),
      "50K":  localInputToDb(document.getElementById("start_50K")?.value),
      "50M":  localInputToDb(document.getElementById("start_50M")?.value),
      "100K": localInputToDb(document.getElementById("start_100K")?.value),
      "100M": localInputToDb(document.getElementById("start_100M")?.value),
      "200M": localInputToDb(document.getElementById("start_200M")?.value),
      "240M": localInputToDb(document.getElementById("start_240M")?.value),
      "300M": localInputToDb(document.getElementById("start_300M")?.value)
    };


    // remove blanks so server doesn't silently save 0
    Object.keys(times).forEach(k => {
      if (!times[k] || !String(times[k]).trim()) delete times[k];
    });

    const res = await fetch("start_times_save.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_code, set_by, times })
    });

    const j = await res.json();
    if (!j.success) throw new Error(j.error || "Save failed");

    setBtnText("Save Start Times");
    disableBtn(false);
    setStatus(`✓ Saved (${j.saved} time${j.saved !== 1 ? "s" : ""})`, "#00ff00");
    setTimeout(() => setStatus("", ""), 5000);

    if (showAlerts) alert(`Start times saved to DB (${j.saved}).`);

    // Post-save refresh: reload config + reload passes + re-render
    try {
      await loadResultsConfig();
      await loadPassesFromServer();
      // Always update cards/results strip even if bib log is hidden
      if (window.ResultsStrip?.update) {
        window.ResultsStrip.update(entries, document.getElementById("aidStation")?.value || "");
    }
        
      // Only redraw the table if it's visible
      const table = document.getElementById("bibLogTable");
      const tableVisible = table && table.style.display !== "none";
      if (tableVisible && typeof filterBibLog === "function") {
       filterBibLog();
    }
    
    } catch (e) {
      console.warn("Post-save refresh failed:", e.message);
    }

  } catch (e) {
    console.error("Save start times failed:", e);
    setBtnText("Save Start Times");
    disableBtn(false);
    setStatus("✗ Save failed: " + e.message, "#ff4444");
    setTimeout(() => setStatus("", ""), 8000);
    if (showAlerts) alert("Save start times failed: " + e.message);
  }
}

function loadStartTimesIntoUI() {
  // Legacy localStorage loader (kept for backward compatibility)
  // If getStartTimes was removed, do nothing.
  if (typeof getStartTimes !== "function") return;

  const times = getStartTimes();
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  setVal("start_20M",  times["20M"]);
  setVal("start_30K",  times["30K"]);
  setVal("start_26_2", times["26.2"]);
  setVal("start_50K",  times["50K"]);
  setVal("start_50M",  times["50M"]);
  setVal("start_100K", times["100K"]);
  setVal("start_100M", times["100M"]);
  setVal("start_200M", times["200M"]);
  setVal("start_240M", times["240M"]);
  setVal("start_300M", times["300M"]);
}

/*---- added 07012026-11:32 ---*/
async function loadStartTimesFromDBIntoUI() {
  try {
    const event_code = cleanEventCode(getEventCode());
    const res = await fetch(`start_times_load.php?event_code=${encodeURIComponent(event_code)}`, { cache: "no-store" });
    const rows = await res.json();

    if (!Array.isArray(rows)) {
      console.warn("start_times_load returned non-array:", rows);
      return;
    }

    const map = {};
    for (const r of rows) {
      const dc = String(r.distance_code || "").trim();
      const ts = String(r.start_ts || "").trim(); // "YYYY-MM-DD HH:MM:SS"
      if (dc && ts) map[dc] = ts;
    }

    // Convert "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM" for datetime-local
    const toLocalInput = (ts) => ts ? ts.replace(" ", "T").slice(0, 16) : "";

    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el && v) el.value = v;
    };

    setVal("start_20M",  toLocalInput(map["20M"]));
    setVal("start_30K",  toLocalInput(map["30K"]));
    setVal("start_26_2", toLocalInput(map["26.2"]));
    setVal("start_50K",  toLocalInput(map["50K"]));
    setVal("start_50M",  toLocalInput(map["50M"]));
    setVal("start_100K", toLocalInput(map["100K"]));
    setVal("start_100M", toLocalInput(map["100M"]));
    setVal("start_200M", toLocalInput(map["200M"]));
    setVal("start_240M", toLocalInput(map["240M"]));
    setVal("start_300M", toLocalInput(map["300M"]));

  } catch (e) {
    console.warn("loadStartTimesFromDBIntoUI failed:", e.message);
  }
}

let AID_STATION_MAP = {}; 
// shape: { "26.2": [{station_order, station_code, station_name, mile, lat, lon}, ...], "30K": [...] }

// Haversine straight-line distance in miles between two lat/lon points.
// Used as a fallback when aid stations have coordinates but no mile markers.
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadAidStationsFromServer() {
  const event_code = cleanEventCode(getEventCode());
  const res = await fetch(`aid_stations_load.php?event_code=${encodeURIComponent(event_code)}`, { cache: "no-store" });
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    console.warn("aid_stations_load returned non-array:", rows);
    return;
  }

  const map = {};
  for (const r of rows) {
    const d = String(r.distance_code || "").trim();
    if (!d) continue;
    if (!map[d]) map[d] = [];
    map[d].push({
      station_order: parseInt(r.station_order, 10),
      station_code: String(r.station_code || "").trim(),
      station_name: String(r.station_name || "").trim(),
      mile: parseFloat(r.mile || "0"),
      lat: r.lat != null ? parseFloat(r.lat) : null,
      lon: r.lon != null ? parseFloat(r.lon) : null
    });
  }

  // sort
  for (const d of Object.keys(map)) {
    map[d].sort((a, b) => a.station_order - b.station_order);
  }

  // Haversine fallback: if a distance group has lat/lon for every station but
  // no mile values on any non-START station, compute cumulative straight-line
  // distances so the ETA formula has something to work with.
  for (const d of Object.keys(map)) {
    const stations = map[d];
    const nonStart = stations.filter(s => s.station_order > 0);
    const allMilesMissing = nonStart.length > 0 && nonStart.every(s => !s.mile);
    const allHaveLatLon = stations.every(s => s.lat !== null && s.lon !== null);
    if (allMilesMissing && allHaveLatLon) {
      let cumMile = 0;
      for (let i = 1; i < stations.length; i++) {
        const prev = stations[i - 1];
        const cur  = stations[i];
        cumMile += haversineMiles(prev.lat, prev.lon, cur.lat, cur.lon);
        cur.mile = parseFloat(cumMile.toFixed(3));
      }
      console.log(`[haversine-miles] No mile data for "${d}"; computed from lat/lon:`,
        stations.map(s => `${s.station_code}=${s.mile}mi`).join(', '));
    }
  }

  AID_STATION_MAP = map;
  // ✅ DEBUG — correct scope & names
  window.__AID_STATION_MAP_DEBUG = AID_STATION_MAP;   // Remove after testing Feb 6, 11:00
  window.__AID_STATION_ROWS_DEBUG = rows;             // Remove after testing Feb 6, 11:00
  
  console.log("Loaded aid station map distances:", Object.keys(AID_STATION_MAP));  // This stays Org. line
  console.log("Debug: __AID_STATION_MAP_DEBUG set", window.__AID_STATION_MAP_DEBUG);     // Remove after testing Feb 6, 11:00
}
 
function parsePassTsUtcToDate(tsUtc) {
  // "YYYY-MM-DD HH:MM:SS" stored UTC
  return new Date(String(tsUtc).replace(" ", "T") + "Z");
}

/*----change 07012026-11:55 --*/
function getStartTimeForDistance(distance_code) {
  const dc = String(distance_code || "").trim();
  const canon = canonicalDistanceCode(dc);

  // Helper: try a Map with both the raw key and canonical key
  function mapGet(map, key) {
    if (!map) return undefined;
    if (map.has(key)) return map.get(key);
    if (map.has(canon)) return map.get(canon);
    // Also try every key through canonical lookup
    for (const [k, v] of map.entries()) {
      if (canonicalDistanceCode(k) === canon) return v;
    }
    return undefined;
  }

  // Prefer ISO values loaded from results_config_load.php
  const iso = mapGet(window.TVEMC_startByDistance, dc);
  if (iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback: if we only have a raw DB string like "YYYY-MM-DD HH:MM:SS"
  const raw = mapGet(window.TVEMC_startByDistanceRaw, dc);
  if (raw) {
    const d2 = new Date(String(raw).replace(" ", "T") + "-08:00"); // Jan race = PST
    return isNaN(d2.getTime()) ? null : d2;
  }

  return null;
}


function stationOrderFromCode(code) {
  const c = String(code || "").toUpperCase().trim();
  if (c === "START") return 0;
  if (c === "FINISH") return 999;
  const m = c.match(/^AS(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

function _aidStationList(distance_code) {
  // Direct lookup
  if (AID_STATION_MAP[distance_code]) return AID_STATION_MAP[distance_code];
  // Canonical fallback: find map key that canonicalizes to the same code
  const canon = canonicalDistanceCode(distance_code);
  for (const k of Object.keys(AID_STATION_MAP)) {
    if (canonicalDistanceCode(k) === canon) return AID_STATION_MAP[k];
  }
  return [];
}

function lookupStationByOrder(distance_code, station_order) {
  const list = _aidStationList(distance_code);
  return list.find(s => s.station_order === station_order) || null;
}

function lookupNextStation(distance_code, station_order) {
  const list = _aidStationList(distance_code);
  return list.find(s => s.station_order > station_order) || null;
}

// Look up a station within a distance by exact station_name (case-insensitive).
// Used as a fallback when a mismatch pass stores a station_id from a different
// distance, so station_order from the DB JOIN doesn't exist in the runner's
// distance map.  Returns null when no match is found.
function lookupStationByName(distance_code, station_name) {
  const list = _aidStationList(distance_code);
  if (!list || !list.length) return null;
  const name = String(station_name || "").trim().toLowerCase();
  if (!name) return null;
  return list.find(s => String(s.station_name || "").trim().toLowerCase() === name) || null;
}

function formatHMS(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "N/A";
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function computeElapsedPaceEta(distance_code, station_order, pass_ts_utc, fallback_mile) {
  const start = getStartTimeForDistance(distance_code);
  if (!start) return { elapsed: "N/A", pace: "N/A", eta_next: "N/A" };

  const passDate = parsePassTsUtcToDate(pass_ts_utc);
  const elapsedSec = (passDate.getTime() - start.getTime()) / 1000;
  if (!isFinite(elapsedSec) || elapsedSec <= 0) return { elapsed: "N/A", pace: "N/A", eta_next: "N/A" };

  const cur = lookupStationByOrder(distance_code, station_order);
  // Use the station's configured mile; fall back to the mile carried on the pass row itself
  // (which comes from the passes_load.php JOIN with aid_stations).
  const curMile = (cur && isFinite(cur.mile) && cur.mile > 0)
    ? cur.mile
    : (isFinite(Number(fallback_mile)) && Number(fallback_mile) > 0 ? Number(fallback_mile) : 0);
  if (curMile <= 0) {
    return { elapsed: formatHMS(elapsedSec), pace: "N/A", eta_next: "N/A" };
  }

  const elapsedHours = elapsedSec / 3600;
  const mph = curMile / elapsedHours;
  const paceMinPerMile = mph > 0 ? (60 / mph) : null;

  const next = lookupNextStation(distance_code, station_order);
  let etaNext = "N/A";
  if (next && isFinite(next.mile) && next.mile > curMile && mph > 0) {
    const hrsToNext = (next.mile - curMile) / mph;
    const etaDate = new Date(passDate.getTime() + hrsToNext * 3600 * 1000);

    // show local time HH:MM:SS
    etaNext = etaDate.toLocaleTimeString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }

  const pace = paceMinPerMile ? `${paceMinPerMile.toFixed(2)} min/mi` : "N/A";
  return { elapsed: formatHMS(elapsedSec), pace, eta_next: etaNext };
}

 // BIb Log Viewer table Sortable Headers
let sortState = { col: null, dir: 1 }; // dir: 1 asc, -1 desc

function parseTimeToSeconds(v) {
  const s = String(v || "").trim();
  // Supports HH:MM or HH:MM:SS
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = m[3] ? parseInt(m[3], 10) : 0;
  return hh * 3600 + mm * 60 + ss;
}

function parseUSDate(v) {
  // expects M/D/YYYY from your formatLocalDate
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return NaN;
  const mm = parseInt(m[1], 10) - 1;
  const dd = parseInt(m[2], 10);
  const yy = parseInt(m[3], 10);
  return new Date(yy, mm, dd).getTime();
}

function valueForSort(e, col) {
  switch (col) {
    case 0:  return parseInt(e.bib_number, 10);                       // Bib #
    case 1: return parseInt(e.overall_place, 10);                     // Place
    case 2:  return String(e.action || "");                           // Action
    case 3:  return parseTimeToSeconds(e.time);                       // Time
    case 4: return parseUSDate(e.date);                              // Date
    case 5: return parseInt(e.pass || "0", 10);                       // pass #
    case 6:  return String(e.station || "");                          // Station
    case 7:  return String(e.comment || "");                          // Comment
    case 8: return String(e.operator || "");                          // Operator
    case 9: return Number(e.finish_ts_ms || NaN);
    case 10:  return parseTimeToSeconds(e.elapsed_total || e.elapsed); // Elapsed
    case 11:  return String(e.avg_pace || e.pace || "");              // Avg Pace
    case 12:  return String(e.gender_place || e.place || "");         // Gender Place
    case 13:  return String(e.age_group || "");                       // AgeGrp
    case 14: return parseInt(e.ag_place, 10);                         // AG Place (number)
    case 15: return parseTimeToSeconds(e.eta);                        // ETA Next
    case 16: return parseUSDate(e.date);                              // Date
    case 17: return String(e.first_name || "");                       // First Name
    case 18: return String(e.last_name || "");                        // Last Name
    case 19: return parseInt(e.age, 10);                              // Age
    case 20: return String(e.gender || "");                           // Gender
    case 21: return String(e.distance || "");                         // Distance
    case 22: return String(e.previous_distance || "");                // Previous Distance

    default: return "";
  }
}


function sortBibTable(col) {
  // toggle direction if same column
  if (sortState.col === col) sortState.dir *= -1;
  else sortState = { col, dir: 1 };

  const dir = sortState.dir;

  const sorted = [...entries].sort((a, b) => {
    const va = valueForSort(a, col);
    const vb = valueForSort(b, col);

    // Handle NaN for time/date/number sorts
    const aNaN = typeof va === "number" && Number.isNaN(va);
    const bNaN = typeof vb === "number" && Number.isNaN(vb);
    if (aNaN && bNaN) return 0;
    if (aNaN) return 1;
    if (bNaN) return -1;

    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * dir;
    }

    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * dir;
  });

  renderBibLog(sorted);
}

 // Reset to Last Bib Entered
 async function resetToNewest() {
  // Clear search box
  const s = document.getElementById("logSearch");
  if (s) s.value = "";

  // Reset sort state (so next header click starts fresh)
  sortState = { col: null, dir: 1 };

  // Reload newest from DB and re-render
  try {
    await loadPassesFromServer();   // loads newest first
    filterBibLog();                 // renders entries (no search filter)
  } catch (e) {
    console.warn("resetToNewest failed:", e.message);
    if (showAlerts) alert("Reset failed: " + e.message);
  }
}

// Timing Module Jan 7 11:56
async function loadResultsConfig() {
  const eventCode = cleanEventCode(getEventCode());
  const res = await fetch(`results_config_load.php?event_code=${encodeURIComponent(eventCode)}`, { cache: "no-store" });
  const data = await res.json();
  if (!data.success) throw new Error("Results config load failed");

  window.TVEMC_milesByDistance = new Map(Object.entries(data.distances || {}));

  // Only replace TVEMC_startByDistance if the server returned actual start times.
  // Don't clobber auto-derived start times (from Start Line passes) with an empty map.
  const newStarts = new Map(Object.entries(data.start_times_iso || data.start_times || {}));
  if (newStarts.size > 0) {
    window.TVEMC_startByDistance = newStarts;
  } else if (!window.TVEMC_startByDistance) {
    window.TVEMC_startByDistance = new Map();
  }

  // Optional raw fallback
  window.TVEMC_startByDistanceRaw = new Map(Object.entries(data.start_times || {}));

  window.TVEMC_runnerStartByBib = new Map(Object.entries(data.runner_starts_iso || data.runner_starts || {}));
}

   // added 07012026 at 12:30
  function dayLabelFromDate(d) {
  if (!d || isNaN(d.getTime())) return "";
  const la = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const nowLa = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const yestLa = new Date(nowLa);
  yestLa.setDate(nowLa.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(la, nowLa)) return "Today";
  if (sameDay(la, yestLa)) return "Yesterday";
  return "";
}

  // For AUTO aid station naming
function isAutoStationCode(code) {
  return typeof code === "string" && /_AUTO$/i.test(code.trim());
}

// NOTE [2026-01-11]: Derive station_order for pace/ETA math from station_code.
function stationOrderFromCode(station_code) {
  const code = String(station_code || "").trim().toUpperCase();
  const m = code.match(/^AS(\d+)$/);
  if (m) return parseInt(m[1], 10);
  if (code === "T30K") return 3;      // only if your lookupStationByOrder expects 3 for the turnaround
  if (code === "START") return 0;
  if (code === "FINISH") return 999;  // not used by computeElapsedPaceEta
  return null;
}

function shouldAutoFocusBib() {
  const ae = document.activeElement;
  if (!ae) return true;
  const tag = (ae.tagName || "").toUpperCase();
  return !(tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA");
}

function stationGroupFromCode(station_code) {
  const sc = String(station_code || "").toUpperCase();
  if (["AS1", "AS8", "AS10", "AS12"].includes(sc)) return "CORRAL";
  if (["AS2", "AS7"].includes(sc)) return "KANAN";
  if (["AS4", "AS6"].includes(sc)) return "ZUMA";
  return "";
}

// Jan 21 @ 11:50 DNS/DNF sticky (UPDATED: honor status_overrides clears) SEE NOTES, Jan 27 at 10:43 changed
function recomputeStickyStatusSets() {
  const lastDns = new Map(); // bib -> ms
  const lastDnf = new Map(); // bib -> ms

  for (const e of (entries || [])) {
    const bib = String(e?.bib_number ?? e?.bib ?? "").trim();
    if (!bib) continue;

    // const tsMs = parseUtcLikeMysql(e?.pass_ts_utc || e?.pass_ts || e?.created_at || e?.timestamp);
    const tsMs = parseUtcLikeMysql(e.pass_ts || e.pass_ts_utc || e.pass_ts_ms || e.created_at || e.timestamp);
    if (!tsMs) continue;

    const act = String(e?.action ?? e?.pass_type ?? "").toUpperCase();

    if (act === "DNS") {
      if (tsMs > (lastDns.get(bib) || 0)) lastDns.set(bib, tsMs);
    } else if (act === "DNF") {
      if (tsMs > (lastDnf.get(bib) || 0)) lastDnf.set(bib, tsMs);
    }
  }

  const dns = new Set();
  const dnf = new Set();

  // DNS latches until cleared
  for (const [bib, tDns] of lastDns.entries()) {
    const cleared = STATUS_OVERRIDES?.dnsClearedAtMs?.get(String(bib)) || 0;
    if (tDns > cleared) dns.add(bib);
  }

  // DNF latches until cleared (IN does NOT cancel it)
  for (const [bib, tDnf] of lastDnf.entries()) {
    const cleared = STATUS_OVERRIDES?.dnfClearedAtMs?.get(String(bib)) || 0;
    if (tDnf > cleared) dnf.add(bib);
  }

  stickyStatusByBib = { dns, dnf };
}

let STATUS_OVERRIDES = { dnsClearedAtMs: new Map(), dnfClearedAtMs: new Map() };

async function loadStatusOverrides(event_code) {
  try {
    const res = await fetch("status_overrides_load.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_code })
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!res.ok || !data?.success) {
      console.warn("Overrides load failed:", text?.slice(0, 160) || res.status);
      STATUS_OVERRIDES = { dnsClearedAtMs: new Map(), dnfClearedAtMs: new Map() };
      window.STATUS_OVERRIDES = STATUS_OVERRIDES;
      return STATUS_OVERRIDES;
    }

    const dns = new Map();
    const dnf = new Map();
    for (const r of (data.rows || [])) {
      const bib = String(r.bib ?? "").trim();
      if (!bib) continue;

      if (r.cleared_dns_at) dns.set(bib, Date.parse(String(r.cleared_dns_at).replace(" ", "T") + "Z") || 0);
      if (r.cleared_dnf_at) dnf.set(bib, Date.parse(String(r.cleared_dnf_at).replace(" ", "T") + "Z") || 0);
    }

    STATUS_OVERRIDES = { dnsClearedAtMs: dns, dnfClearedAtMs: dnf };
    window.STATUS_OVERRIDES = STATUS_OVERRIDES;
    return STATUS_OVERRIDES;
  } catch (e) {
    console.warn("Overrides load exception:", e.message);
    STATUS_OVERRIDES = { dnsClearedAtMs: new Map(), dnfClearedAtMs: new Map() };
    return STATUS_OVERRIDES;
  }
}

window.clearStickyStatus = async function(kind, bib) {
  try {
    const event_code = cleanEventCode(getEventCode());
    const cleared_by = (document.getElementById("operatorName")?.value || "HQ").trim();
    const note = "HQ cleared status (confirmed running)";

    // Call the existing endpoint that updates status_overrides
    const res = await fetch("status_overrides_set.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_code,
        bib: parseInt(bib, 10),
        clear: String(kind).toUpperCase(),  // "DNS" or "DNF"
        cleared_by,
        note
      })
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!res.ok || !data?.success) throw new Error((data && data.error) ? data.error : text.slice(0,200));

    // THESE TWO LINES GO RIGHT HERE:
    await loadStatusOverrides(event_code);
    recomputeStickyStatusSets();

    // Refresh the strip/cards immediately if present
    if (window.ResultsStrip?.update) {
      window.ResultsStrip.update(entries, document.getElementById("aidStation")?.value || "");
    }

    alert(`${kind} cleared for Bib ${bib}`);
  } catch (e) {
    console.error("clearStickyStatus failed:", e);
    alert("CLEAR failed: " + (e?.message || e));
  }
};

function focusBibBox() {
  // Defer twice to beat DOM redraw + any synchronous UI updates
  setTimeout(() => {
    const bibEl = document.getElementById("bibNumber");
    if (bibEl) bibEl.focus({ preventScroll: true });
  }, 0);

  setTimeout(() => {
    const bibEl = document.getElementById("bibNumber");
    if (bibEl) bibEl.focus({ preventScroll: true });
  }, 50);
}

function canonicalDistanceCode(d) {
  const x = String(d || "").trim();
  if (!x) return "";

  // Strip ALL internal whitespace so "50 K" → "50K", "50 M" → "50M", etc.
  const u = x.toUpperCase().replace(/\s+/g, "");

  if (u === "20M" || u === "20MI" || u === "20MILE" || u === "20MILES") return "20M";
  if (u === "50MILER" || u === "50MI" || u === "50M") return "50M";
  if (u === "50K") return "50K";
  if (u === "30K") return "30K";
  if (u === "26.2" || u === "MARATHON") return "26.2";
  if (u === "100K") return "100K";
  if (new Set(["100M","100MI","100MILE","100MILES","100MILER"]).has(u)) return "100M";

  // Optional future-proofing (AZM/Bigfoot/Moab style)
  if (u === "200M" || u === "200MI" || u === "200MILE" || u === "200MILES") return "200M";
  if (u === "240M" || u === "240MI" || u === "240MILE" || u === "240MILES") return "240M";
  if (u === "300M" || u === "300MI" || u === "300MILE" || u === "300MILES") return "300M";

  return x; // if already a code like "50M"
}

//function stationNameFromMapByCode(code) {    Commented out Feb 7 at 10:05
//  const sc = String(code || "").trim().toUpperCase();
//  if (!sc) return "";

//  for (const d of Object.keys(AID_STATION_MAP || {})) {
//    const arr = AID_STATION_MAP[d] || [];
//    const hit = arr.find(x => String(x.station_code || "").toUpperCase() === sc);
//    if (hit && hit.station_name) return String(hit.station_name).trim();
//  }
//  return "";
//}

// Safe station-name lookup across ALL distances in AID_STATION_MAP  Added Feb7-08:30
function stationNameFromMapByCode(code) {
  const sc = String(code ?? "").trim().toUpperCase();
  if (!sc) return "";

  // If AID_STATION_MAP isn't ready yet, fail safely
  const map = (typeof AID_STATION_MAP === "object" && AID_STATION_MAP) ? AID_STATION_MAP : null;
  if (!map) return "";

  try {
    for (const d of Object.keys(map)) {
      const arr = Array.isArray(map[d]) ? map[d] : [];
      const hit = arr.find(x =>
        String(x?.station_code ?? "").trim().toUpperCase() === sc
      );
      if (hit?.station_name) return String(hit.station_name).trim();
    }
  } catch (e) {
    console.warn("stationNameFromMapByCode failed:", e);
  }

  return "";
}

/* ---------------------------
   Load runners from DB
----------------------------*/
async function loadRunnerRegistryFromServer() {
  const ec = (typeof getEventCode === "function") ? getEventCode() : "";
  if (!ec) {
    console.warn("No event_code yet — skipping runners load");
    return;
  }

  const res = await fetch(
    `runners_load.php?event_code=${encodeURIComponent(ec)}`,
    { cache: "no-store" }
  );

  const text = await res.text();

  if (!res.ok) {
    console.error("runners_load HTTP error:", {
      status: res.status,
      url: res.url,
      preview: text.slice(0, 200)
    });
    return;
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch (e) {
    console.error("runners_load returned non-JSON:", {
      url: res.url,
      status: res.status,
      preview: text.slice(0, 200)
    });
    return;
  }

  if (!Array.isArray(rows)) {
    console.warn("runners_load returned non-array:", rows);
    return;
  }

  bibList = rows;
  window.bibList = bibList;
  console.log("Runner registry loaded:", bibList.length);
}

/* ---------------------------
   Boot
----------------------------*/
document.addEventListener("DOMContentLoaded", async () => {
  // Strip ?hq=1 and ?event=... from the address bar immediately, storing state
  // in sessionStorage so curious users cannot bookmark or share privileged URLs.
  (function stripURLParams() {
    const qs = new URLSearchParams(window.location.search);
    const hq = qs.get("hq");
    const event = qs.get("event");
    if (hq === "1") {
      sessionStorage.setItem("hq_mode", "1");
    }
    if (event) {
      sessionStorage.setItem("tvemc_eventName", event);
      localStorage.setItem("tvemc_eventName", event); // keep localStorage in sync
    }
    if (hq || event) {
      history.replaceState(null, "", window.location.pathname);
    }
  })();

  loadData();
  setupFastTabAndAlerts();
  setupHighContrastToggle();
  restoreHeaderFields();
  wireHeaderFieldPersistence();

  // Populate event picker dropdown before restoring fields so the saved value can be selected
  try {
    await loadEventListIntoDropdown();
  } catch (e) {
    console.warn("Event list dropdown load skipped:", e.message);
  }

  // Load event-specific documents (PDFs / CSVs) for the bottom of the page.
  try {
    await loadEventDocs();
  } catch (e) {
    console.warn("loadEventDocs skipped:", e.message);
  }
  
  // ✅ Data bootstrap (must be early)
  await loadEventMetaFromServer();
  await loadAidStationsFromServer();
  await loadRunnerRegistryFromServer();
  // Pick a default distance for dropdowns (use event primary later) Added Feb 6 14:17 with Line 1263
  const defaultDist = Object.keys(AID_STATION_MAP || {})[0] || "";
  populateStationDropdownsFromMap(AID_STATION_MAP, defaultDist);


 // Now that meta+stations exist, you can update derived UI
  updateSubject();
  updateBibInfo();
  
  // Start times UI should be loaded AFTER DOM is ready
  //loadStartTimesIntoUI();
      try { 
      await loadStartTimesFromDBIntoUI(); 
    } catch (e) {
      console.warn("Start times DB load skipped:", e.message);
    }

  // Keep UI responsive
  setCurrentTime();
  setInterval(setCurrentTime, 1000);
 // updateSubject();
 // updateBibInfo();

  // Attach listeners — support both "input" (text box) and "change" (select) on eventName
  document.getElementById("eventName")?.addEventListener("input", updateSubject);
  document.getElementById("eventName")?.addEventListener("change", updateSubject);
  document.getElementById("aidStation")?.addEventListener("change", updateSubject);
  document.getElementById("messageNum")?.addEventListener("input", updateSubject);
  document.getElementById("bibNumber")?.addEventListener("input", updateBibInfo);

  // Pull runners from DB if online
  try {
    if (await isOnline()) {
      await loadRunnerRegistryFromServer();
      updateBibInfo();
    }
  } catch (e) {
    console.warn("Runners auto-load skipped:", e.message);
  }

  // Load station mile map BEFORE we start refreshing the viewer
  try {
    await loadAidStationsFromServer();
  } catch (e) {
    console.warn("Aid station map load failed:", e.message);
  }

  // Load results config (start times + distances) so computeElapsedPaceEta works
  // without requiring the user to manually save start times first.
  try {
    await loadResultsConfig();
  } catch (e) {
    console.warn("Results config load skipped:", e.message);
  }

  // Initial pass load now that start times are in memory.
  // This ensures elapsed/pace/ETA are computed correctly on the first open.
  try {
    await loadPassesFromServer();
  } catch (e) {
    console.warn("Initial passes load skipped:", e.message);
  }

  // Refresh Bib Log periodically — only when the table is open (saves bandwidth when hidden)
  setInterval(() => {
    const table = document.getElementById("bibLogTable");
    if (table && table.style.display !== "none") {
      loadPassesFromServer().catch(() => {});
    }
  }, 15000);

  // Periodic offline sync
  setInterval(syncOfflineEntries, 30000);
});

function importCSV() {
  if (showAlerts) {
    alert(
      "CSV import is not used right now.\n\n" +
      "For offline updates, use: Import Radio Data (Winlink/TNC)."
    );
  }
}

function importBibList() {
  if (showAlerts) {
    alert(
      "Bib List import is deprecated.\n\n" +
      "Runners registry is server-managed.\n" +
      "For offline updates, use: Import Radio Data (Winlink/TNC)."
    );
  }
}

function loadDataButton() {
  loadData();

  // Re-render the Bib Log Viewer from restored data
  if (typeof renderBibLogViewer === "function") {
//    renderBibLogViewer();                                 // commented out Jan29-12:55
  } else if (typeof loadPassesFromServer === "function") {
    // Fallback: if viewer normally comes from server
    loadPassesFromServer().catch(() => {});
  }

  if (typeof showAlerts !== "undefined" && showAlerts) {
    alert(
      `Loaded offline snapshot.\n` +
      `Entries: ${entries?.length || 0}\n` +
      `Queued: ${offlineQueue?.length || 0}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// FIELD MODE – dark full-screen mobile bib-entry overlay
// ═══════════════════════════════════════════════════════════════
(function () {
  "use strict";

  // Internal bib digit buffer
  let _fmBib = "";

  function _fmUpdateDisplay() {
    const digitsEl = document.getElementById("fm-bib-digits");
    const hintEl   = document.getElementById("fm-bib-hint");
    if (!digitsEl) return;
    if (_fmBib.length === 0) {
      digitsEl.textContent = "\u2014"; // em dash
      digitsEl.classList.add("fm-bib-empty");
      if (hintEl) hintEl.style.visibility = "visible";
    } else {
      digitsEl.textContent = _fmBib;
      digitsEl.classList.remove("fm-bib-empty");
      if (hintEl) hintEl.style.visibility = "hidden";
    }
  }

  function _fmFlashStatus(msg, isErr) {
    const el = document.getElementById("fm-status");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isErr ? "#ff6b6b" : "#00e5ff";
    clearTimeout(el._fmTimer);
    el._fmTimer = setTimeout(() => { el.textContent = ""; }, 2200);
  }

  window.openFieldMode = function openFieldMode() {
    const modal = document.getElementById("fieldModeModal");
    if (!modal) return;

    // Populate header with event name and station
    const eventCode = (typeof getEventCode === "function") ? getEventCode() : "";
    const stationInfo = (typeof getStationNameAndCode === "function")
      ? getStationNameAndCode()
      : { station_name: "", station_code: "" };

    const eventLabel   = document.getElementById("fm-event-label");
    const stationChip  = document.getElementById("fm-station-chip");

    if (eventLabel)  eventLabel.textContent  = eventCode || "";
    if (stationChip) {
      const name = stationInfo.station_name || stationInfo.station_code || "—";
      stationChip.textContent = "\uD83D\uDCCD " + name; // 📍
    }

    // Sync distance picker options with the main-page dropdown
    const mainSel = document.getElementById("distanceSelect");
    const fmSel   = document.getElementById("fm-dist-select");
    if (mainSel && fmSel && mainSel.options.length > 0) {
      const currentVal = mainSel.value;
      fmSel.innerHTML = mainSel.innerHTML;
      fmSel.value = currentVal;
    }

    // Reset bib buffer and status
    _fmBib = "";
    _fmUpdateDisplay();
    const statusEl = document.getElementById("fm-status");
    if (statusEl) statusEl.textContent = "";

    // Hide distance picker in case it was left open
    fieldHideDistancePicker();

    // Show modal
    modal.classList.add("fm-open");
    document.body.style.overflow = "hidden";
  };

  window.closeFieldMode = function closeFieldMode() {
    const modal = document.getElementById("fieldModeModal");
    if (!modal) return;
    modal.classList.remove("fm-open");
    document.body.style.overflow = "";
    fieldHideDistancePicker();
  };

  window.fieldKeyPress = function fieldKeyPress(digit) {
    if (_fmBib.length >= 6) return; // max 6 digits
    _fmBib += digit;
    _fmUpdateDisplay();
  };

  window.fieldBackspace = function fieldBackspace() {
    if (_fmBib.length === 0) return;
    _fmBib = _fmBib.slice(0, -1);
    _fmUpdateDisplay();
  };

  window.fieldSubmit = async function fieldSubmit(action) {
    if (!_fmBib) {
      _fmFlashStatus("Enter a bib number first", true);
      return;
    }

    // Copy bib into the main form's bib input so addEntry() works normally
    const bibEl = document.getElementById("bibNumber");
    if (!bibEl) {
      _fmFlashStatus("Error: bib input not found", true);
      return;
    }
    bibEl.value = _fmBib;

    // Refresh time to now before submit
    if (typeof setCurrentTime === "function") setCurrentTime(false);

    // Clear any leftover comment so a fresh note isn't added accidentally
    // (leave it alone – operators may want a pre-filled comment)

    try {
      await addEntry(action);
      _fmFlashStatus("\u2713 " + action + " – Bib " + _fmBib + " recorded");
      _fmBib = "";
      _fmUpdateDisplay();
    } catch (err) {
      _fmFlashStatus("Submit error: " + (err.message || err), true);
    }
  };

  window.fieldShowDistancePicker = function fieldShowDistancePicker() {
    if (!_fmBib) {
      _fmFlashStatus("Enter a bib number first", true);
      return;
    }
    const picker = document.getElementById("fm-dist-picker");
    if (picker) picker.classList.add("fm-dist-open");
  };

  window.fieldHideDistancePicker = function fieldHideDistancePicker() {
    const picker = document.getElementById("fm-dist-picker");
    if (picker) picker.classList.remove("fm-dist-open");
  };

  window.fieldUpdateDistance = async function fieldUpdateDistance() {
    if (!_fmBib) {
      _fmFlashStatus("Enter a bib number first", true);
      fieldHideDistancePicker();
      return;
    }

    const fmSel   = document.getElementById("fm-dist-select");
    const mainSel = document.getElementById("distanceSelect");
    const bibEl   = document.getElementById("bibNumber");

    if (!fmSel || !bibEl) {
      fieldHideDistancePicker();
      return;
    }

    const newDist = fmSel.value;
    bibEl.value = _fmBib;

    // Sync selection to the main distance select so updateDistance() reads it
    if (mainSel) mainSel.value = newDist;

    // Close picker first (updateDistance may show its own alerts)
    fieldHideDistancePicker();

    // Re-use the main updateDistance() function (already handles DNS, overrides, etc.)
    if (typeof updateDistance === "function") {
      try {
        await updateDistance(null);
        _fmFlashStatus("\u2713 Distance updated – Bib " + _fmBib);
        _fmBib = "";
        _fmUpdateDisplay();
      } catch (err) {
        _fmFlashStatus("Distance error: " + (err.message || err), true);
      }
    }
  };

  // Close modal on Escape key (desktop fallback)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      const modal = document.getElementById("fieldModeModal");
      if (modal && modal.classList.contains("fm-open")) closeFieldMode();
    }
  });
})();

// Expose functions used by HTML buttons
window.saveStartTimes = saveStartTimes;

window.addEntry = addEntry;
window.incrementMessage = incrementMessage;
window.updateSubject = updateSubject;

window.showDistancePopup = showDistancePopup;
window.closeDistancePopup = closeDistancePopup;
window.updateDistance = updateDistance;

// Field Mode modal
window.openFieldMode          = window.openFieldMode;          // already assigned in IIFE
window.closeFieldMode         = window.closeFieldMode;
window.fieldKeyPress          = window.fieldKeyPress;
window.fieldBackspace         = window.fieldBackspace;
window.fieldSubmit            = window.fieldSubmit;
window.fieldShowDistancePicker= window.fieldShowDistancePicker;
window.fieldHideDistancePicker= window.fieldHideDistancePicker;
window.fieldUpdateDistance    = window.fieldUpdateDistance;

window.updateBibInfo = updateBibInfo;
window.filterBibLog = filterBibLog;
window.sortBibTable = sortBibTable;
window.resetToNewest = resetToNewest;

window.exportBibCSV_v2 = exportBibCSV_v2;
window.exportBibWinlinkTxt_v2 = exportBibWinlinkTxt_v2;

window.importCSV = importCSV;
window.importBibList = importBibList;
window.importRadioWinlinkTxt = importRadioWinlinkTxt;