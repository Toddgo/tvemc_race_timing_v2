// general_comments.js
// === GENERAL MESSAGE LOG SYSTEM (race_timing) ===
console.log("general_comments.js loaded ✅", new Date().toISOString());

let rtGeneralComments = [];
let rtLastGeneralId = 0;

// Format DB datetime -> readable LA time
function formatToLA(ts) {
  if (!ts) return "";
  // If server returns "YYYY-MM-DD HH:MM:SS", treat as local-ish string:
  // We'll render with Intl for consistency (works fine with Date parsing on most browsers).
  const d = new Date(ts.replace(" ", "T"));
  if (isNaN(d.getTime())) return ts;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(d);
}

function getEventId() { return (document.getElementById("eventId")?.value || "AZM-300-2026-0004").trim(); }


function getStationLabel() {
  const sel = document.getElementById("aidStation");
  return (sel?.selectedOptions?.[0]?.textContent || sel?.value || "").trim();
}

function updateGeneralMessageLog() {
  const table = document.getElementById("generalMessageLogTable");
  const tbody = table ? table.querySelector("tbody") : null;
  if (!tbody) return;

  tbody.innerHTML = "";

  rtGeneralComments.forEach((c) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${cleanGeneralStationName(c.station_name || "")}</td>
      <td>${c.comment_id || ""}</td>
      <td>${c.comment || ""}</td>
      <td>${c.operator || ""}</td>
      <td>${c.display_time || ""}</td>
    `;
    tbody.appendChild(row);
  });
}

async function loadGeneralComments() {
  const eventId = getEventId();
  if (!eventId) return;

  try {
    const url = new URL("load_general_comments.php", window.location.href);
    url.searchParams.set("event_id", eventId);
    url.searchParams.set("limit", "200");

    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = await res.json();

    if (!data.success) throw new Error(data.error || "Load failed");

    const rows = data.comments || [];
    // newest-first already if since_id not used
    rtGeneralComments = rows.map(r => ({
      comment_id: r.comment_id,
      station_name: r.station_name || "",
      operator: r.operator || "",
      comment: r.comment || "",
      comment_ts: r.comment_ts || "",
      display_time: formatToLA(r.comment_ts || "")
    }));

    // Track highest id for incremental exports
    rtLastGeneralId = Math.max(0, ...rtGeneralComments.map(x => Number(x.comment_id || 0)));

    updateGeneralMessageLog();
  } catch (e) {
    console.warn("loadGeneralComments failed:", e.message);
  }
}

async function addGeneralComment() {
  if (window.__addingGeneralComment) return;
  window.__addingGeneralComment = true;
  setTimeout(() => (window.__addingGeneralComment = false), 1200);

  const commentInput = document.getElementById("generalComment");
  const comment = (commentInput?.value || "").trim();
  if (!comment) return alert("Please enter a general comment.");

  const eventId = getEventId();
  if (!eventId) return alert("Missing eventId.");

  const operator = (document.getElementById("operatorName")?.value || "").trim() || "";
  const stationLabel = getStationLabel();

  try {
    const res = await fetch("submit_general_comment.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: eventId,
        station_name: stationLabel,
        operator: operator,
        comment: comment
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || ("HTTP " + res.status));
    }

    // Clear box
    if (commentInput) commentInput.value = "";

    // Reload to pull server timestamp + correct ordering
    await loadGeneralComments();
  } catch (e) {
    alert("General comment failed: " + e.message);
  }
}

// ---- helpers ----
function cleanGeneralStationName(name) {
  return String(name || "")
    .replace(/^\?\s*/, "")   // strip "? " prefix
    .trim();
}

function toggleGeneralMessageLog() {
  const table = document.getElementById("generalMessageLogTable");
  if (!table) return;
  table.style.display = (table.style.display === "none" ? "table" : "none");
  if (table.style.display === "table") updateGeneralMessageLog();
}

// ---- exports (incremental) ----
function getGeneralExportCursorKey(kind) {
  const eventId = getEventId() || "0";
  return `TVEMC_general_export_last_id_${kind}_${eventId}`;
}

function getNewGeneralRowsOnly(kind) {
  const last = parseInt(localStorage.getItem(getGeneralExportCursorKey(kind)) || "0", 10);

  const rows = rtGeneralComments
    .filter(r => Number(r.comment_id || 0) > last)
    .sort((a,b) => Number(a.comment_id) - Number(b.comment_id));

  const newest = rows.length ? Number(rows[rows.length - 1].comment_id) : last;
  return { rows, last, newest };
}

function bumpGeneralExportCursor(kind, newestId) {
  localStorage.setItem(getGeneralExportCursorKey(kind), String(newestId || 0));
}

function exportGeneralCSV() {
  const { rows, newest } = getNewGeneralRowsOnly("CSV");
  if (!rows.length) return alert("No NEW general messages to export.");

  const csv = [
    "Station,Comment ID,Comment,Operator,Time",
    ...rows.map(r => `"${cleanGeneralStationName(r.station_name||"").replace(/"/g,'""')}","${r.comment_id}","${(r.comment||"").replace(/"/g,'""')}","${(r.operator||"").replace(/"/g,'""')}","${(r.display_time||"").replace(/"/g,'""')}"`)
  ].join("\n");

  downloadFile(csv, `GM_${new Date().toISOString().slice(0,19).replace(/[-T:]/g,'')}.csv`, "text/csv");
  bumpGeneralExportCursor("CSV", newest);
}

function exportGeneralWinlink() {
  const { rows, newest } = getNewGeneralRowsOnly("WINLINK");
  if (!rows.length) return alert("No NEW general messages to export.");

  const text = [
    "Station\tCommentID\tComment\tOperator\tTime",
    ...rows.map(r => `${cleanGeneralStationName(r.station_name||"")}\t${r.comment_id}\t${r.comment||""}\t${r.operator||""}\t${r.display_time||""}`)
  ].join("\n");

  downloadFile(text, `GM_${new Date().toISOString().slice(0,19).replace(/[-T:]/g,'')}.txt`, "text/plain");
  bumpGeneralExportCursor("WINLINK", newest);
}

function exportGeneralPDF() {
  const { rows, newest } = getNewGeneralRowsOnly("PDF");
  if (!rows.length) return alert("No NEW general messages to export.");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text("General Message Log (NEW)", 10, 12);
  doc.setFontSize(10);

  let y = 22;
  rows.forEach(r => {
    if (y > 275) { doc.addPage(); y = 15; }
    doc.text(`${r.comment_id} | ${cleanGeneralStationName(r.station_name || "")}`, 10, y); y += 6;
    doc.text(`${r.comment || ""}`, 10, y); y += 6;
    doc.text(`${r.operator || ""} @ ${r.display_time || ""}`, 10, y); y += 10;
  });

  doc.save(`GM_${new Date().toISOString().slice(0,19).replace(/[-T:]/g,'')}.pdf`);
  bumpGeneralExportCursor("PDF", newest);
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  
  // Allow browser time to start the download (important for Safari/iOS)
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

window.addEventListener("load", () => {
  loadGeneralComments();
  setInterval(loadGeneralComments, 30000);
});

// Make functions available to inline onclick=""
window.addGeneralComment = addGeneralComment;
// window.addEventListener("load", () => { loadGeneralComments(); ... });

window.loadGeneralComments = loadGeneralComments;
window.toggleGeneralMessageLog = toggleGeneralMessageLog;
window.exportGeneralCSV = exportGeneralCSV;
window.exportGeneralPDF = exportGeneralPDF;
window.exportGeneralWinlink = exportGeneralWinlink;

