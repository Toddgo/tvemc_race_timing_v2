/**********************************************
 *  message-batches.js
 *  TVEMC Message Batch Core
 *  --------------------------------------
 *  - Manages three message counters (BIB, GM, RD)
 *  - Builds batch metadata envelopes
 *  - Provides helpers for Bib batch creation
 *
 *  STEP 2: Includes Bib batch builder only.
 *  We will add GM + RD builders in later steps.
 **********************************************/

// Storage keys (scoped per browser / aid station device)
const TVEMC_MSG_COUNTERS_KEY = "TVEMC_MessageCounters";

// Optional: place to store event info if we ever set it explicitly
const TVEMC_EVENT_INFO_KEY   = "TVEMC_EventInfo";

// Mapping Expott key
const TVEMC_BIB_EXPORTS_KEY = "TVEMC_BibExports";

function tvemcLoadBibExports() {
  try {
    const raw = localStorage.getItem(TVEMC_BIB_EXPORTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.warn("TVEMC_BatchCore: failed to load bib exports map, resetting.", e);
    return {};
  }
}

function tvemcSaveBibExports(map) {
  try {
    localStorage.setItem(TVEMC_BIB_EXPORTS_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn("TVEMC_BatchCore: failed to save bib exports map", e);
  }
}

// Build a stable key for a bib entry
function tvemcBibEntryKey(e) {
  if (!e) return "";
  const parts = [
    e.bib_number,
    e.action,
    e.time,
    e.day,
    e.station,
    e.date
  ];
  return parts.map(v => String(v || "").replace(/\|/g, "-")).join("|");
}


/* -------------------------------------------
   Load or initialize counters
-------------------------------------------- */
function tvemcLoadMessageCounters() {
  let counters = localStorage.getItem(TVEMC_MSG_COUNTERS_KEY);
  if (!counters) {
    counters = {
      BIB: 1,
      GM: 1,
      RD: 1
    };
    localStorage.setItem(TVEMC_MSG_COUNTERS_KEY, JSON.stringify(counters));
  } else {
    try {
      counters = JSON.parse(counters);
    } catch (e) {
      console.error("Failed to parse message counters, resetting.", e);
      counters = { BIB: 1, GM: 1, RD: 1 };
      localStorage.setItem(TVEMC_MSG_COUNTERS_KEY, JSON.stringify(counters));
    }
  }
  return counters;
}

function tvemcSaveMessageCounters(counters) {
  localStorage.setItem(TVEMC_MSG_COUNTERS_KEY, JSON.stringify(counters));
}

/* -------------------------------------------
   Helper: Get next number for a type
-------------------------------------------- */
function tvemcGetNextMessageNumber(type) {
  const counters = tvemcLoadMessageCounters();
  const current = Number(counters[type] || 1);
  const next = current + 1;
  counters[type] = next;
  tvemcSaveMessageCounters(counters);
  return current;
}

/* -------------------------------------------
   Helper: Timestamp builder
-------------------------------------------- */
function tvemcGetLocalTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const dd   = String(now.getDate()).padStart(2, "0");
  const hh   = String(now.getHours()).padStart(2, "0");
  const min  = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/* -------------------------------------------
   Event info helpers
-------------------------------------------- */
function tvemcMapEventIdFromName(name) {
  if (!name) return "";
  const lower = name.toLowerCase();

  if (lower.includes("ray miller")) return "RM50";
  if (lower.includes("sean o'brien") || lower.includes("sean obrien")) return "SO100k";
  if (lower.includes("bigfoot 200")) return "BF200";
  if (lower.includes("tahoe 200")) return "T200";
  if (lower.includes("arizona monster") || lower.includes("monster 300")) return "AM300";

  return "";
}

function tvemcGetEventInfo() {
  // Start from any saved info
  let info = {};
  try {
    info = JSON.parse(localStorage.getItem(TVEMC_EVENT_INFO_KEY) || "{}");
  } catch (e) {
    info = {};
  }

  // Prefer live form fields if present
  const eventInput = document.getElementById("eventName");
  const stationSel = document.getElementById("aidStation");
  const opInput    = document.getElementById("operatorName");

  const eventName = eventInput && eventInput.value ? eventInput.value : (info.event_name || "");
  const aidStationName = stationSel && stationSel.value ? stationSel.value : (info.aid_station_name || "");
  const operatorName   = opInput && opInput.value ? opInput.value : (info.operator || "");

  const eventId = info.event_id || tvemcMapEventIdFromName(eventName);

  return {
    event_id: eventId,
    event_name: eventName,
    aid_station_name: aidStationName,
    operator: operatorName
  };
}

/* -------------------------------------------
   Build base metadata for ANY batch
-------------------------------------------- */
function tvemcBuildBatchMetadata(options) {
  const { message_type, channel } = options; // "BIB" | "GM" | "RD", channel string

  const eventInfo = tvemcGetEventInfo();

  return {
    event_id: eventInfo.event_id || "",
    event_name: eventInfo.event_name || "",
    aid_station_name: eventInfo.aid_station_name || "",
    operator: eventInfo.operator || "",

    message_type,
    message_number: tvemcGetNextMessageNumber(message_type),

    timestamp_local: tvemcGetLocalTimestamp(),
    channel,

    records: [] // To be filled in by batch builders
  };
}

/* -------------------------------------------
   Helper: Derive filename for a batch
-------------------------------------------- */
function tvemcFilenameForBatch(batch, extension) {
  const eventId = batch.event_id || "EVENT";
  const station = (batch.aid_station_name || "Station").replace(/\s+/g, "");
  const type    = batch.message_type || "MSG";
  const msgNum  = String(batch.message_number || 0).padStart(3, "0");

  // Timestamp in filename-friendly format
  const stamp = (batch.timestamp_local || "").replace(" ", "_").replace(/:/g, "");
  const safeStamp = stamp || tvemcGetLocalTimestamp().replace(" ", "_").replace(/:/g, "");

  return `${eventId}_${station}_${type}_MSG${msgNum}_${safeStamp}.${extension}`;
}

/* -------------------------------------------
   BIB batch builder (no duplicates)
-------------------------------------------- */
/**
 * Create a BIB batch for export.
 * - channel: "csv" or "winlink" (for now)
 * - Uses global `entries` array from race_timing.js
 * - Only includes entries that:
 *     - are NOT action === "GENERAL"
 *     - do NOT already have `bibExportMsg` set
 * - Marks included entries with `bibExportMsg = batch.message_number`
 */
function tvemcCreateBibBatchForExport(channel) {
  channel = channel || "csv";

  // Try to find the entries array from either window.entries or a global `entries`
  let sourceEntries = null;

  if (Array.isArray(window.entries)) {
    sourceEntries = window.entries;
  } else if (typeof entries !== "undefined" && Array.isArray(entries)) {
    sourceEntries = entries;
  }

  if (!sourceEntries) {
    console.warn("TVEMC_BatchCore: entries[] not found (window.entries or global entries).");
    return null;
  }

  // Load export history
  const exportMap = tvemcLoadBibExports();

  // Only entries that:
  //  - are not GENERAL
  //  - do not already appear in exportMap
  const unexported = sourceEntries.filter(e => {
    if (!e || e.action === "GENERAL") return false;
    const key = tvemcBibEntryKey(e);
    return !exportMap[key];
  });

  if (unexported.length === 0) {
    console.log("TVEMC_BatchCore: No new bib entries to export.");
    return null;
  }

  const batch = tvemcBuildBatchMetadata({
    message_type: "BIB",
    channel
  });

  // Copy selected entries into the batch
  batch.records = unexported.map(e => ({ ...e }));

  // Mark them as exported: both in the entries themselves and in the exportMap
  unexported.forEach(e => {
    const key = tvemcBibEntryKey(e);
    exportMap[key] = batch.message_number;
    // Optional: keep a local property for debugging / UI
    e.bibExportMsg = batch.message_number;
  });

  // Persist updated export history
  tvemcSaveBibExports(exportMap);

  // Ask main app to persist if saveData() exists
  try {
    if (typeof window.saveData === "function") {
      window.saveData(false);
    }
  } catch (e) {
    console.warn("TVEMC_BatchCore: saveData() failed or not available", e);
  }

  return batch;
}



/* -------------------------------------------
   Public API
-------------------------------------------- */
window.TVEMC_BatchCore = {
  // Core helpers
  loadMessageCounters: tvemcLoadMessageCounters,
  getNextMessageNumber: tvemcGetNextMessageNumber,
  getLocalTimestamp: tvemcGetLocalTimestamp,
  buildBatchMetadata: tvemcBuildBatchMetadata,
  filenameForBatch: tvemcFilenameForBatch,

  // Batch builders
  createBibBatchForExport: tvemcCreateBibBatchForExport
};
