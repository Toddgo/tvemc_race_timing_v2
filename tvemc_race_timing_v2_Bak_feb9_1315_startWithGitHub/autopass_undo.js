/* autopass_undo.js
   15-second Undo/Switch bar for auto-pass routing
*/

(function(){
  const BAR_MS = 15000;

  let timer = null;
  let last = null; // { event_code, pass_id, from_code, to_code, choices[] }

  function ensureBar(){
    let el = document.getElementById("autoPassUndoBar");
    if (el) return el;

    el = document.createElement("div");
    el.id = "autoPassUndoBar";
    el.style.position = "fixed";
    el.style.left = "12px";
    el.style.right = "12px";
    el.style.bottom = "12px";
    el.style.zIndex = "9999";
    el.style.display = "none";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "12px";
    el.style.background = "rgba(0,0,0,0.92)";
    el.style.border = "1px solid rgba(255,255,255,0.25)";
    el.style.color = "#fff";
    el.style.fontWeight = "800";
    el.style.boxShadow = "0 10px 25px rgba(0,0,0,0.45)";

    el.innerHTML = `
      <span id="apub_text"></span>
      <span style="margin-left:10px;"></span>
      <button id="apub_undo" type="button" style="margin-left:10px; padding:8px 10px; border-radius:10px; font-weight:900;">Undo</button>
      <button id="apub_switch" type="button" style="margin-left:8px; padding:8px 10px; border-radius:10px; font-weight:900;">Switch</button>
      <button id="apub_close" type="button" style="margin-left:8px; padding:8px 10px; border-radius:10px; font-weight:900;">✕</button>
    `;

    document.body.appendChild(el);

    document.getElementById("apub_close").onclick = hide;
    document.getElementById("apub_undo").onclick = () => doMove("undo");
    document.getElementById("apub_switch").onclick = () => doMove("switch");

    return el;
  }

  function hide(){
    const el = document.getElementById("autoPassUndoBar");
    if (el) el.style.display = "none";
    if (timer) clearTimeout(timer);
    timer = null;
    last = null;
  }

  async function doMove(kind){
    if (!last) return;

    let target = null;

    if (kind === "undo") {
      target = last.from_code; // revert
    } else {
      // cycle to next choice
      const idx = last.choices.indexOf(last.to_code);
      const nextIdx = (idx >= 0) ? ((idx + 1) % last.choices.length) : 0;
      target = last.choices[nextIdx];
    }

    try {
      const res = await fetch("passes_update_station.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_code: last.event_code,
          pass_id: last.pass_id,
          station_code: target
        })
      });

      const txt = await res.text();
      let json;
      try { json = JSON.parse(txt); } catch { throw new Error("Non-JSON: " + txt.slice(0,120)); }

      if (!json.success) throw new Error(json.error || "Update failed");

      // Update UI message
      const t = document.getElementById("apub_text");
      if (t) t.textContent = `Updated to ${target}.`;

      // Optional: refresh passes list if you have a loader
      if (typeof window.loadPassesFromServer === "function") {
        window.loadPassesFromServer();
      }

      // Close after a moment
      setTimeout(hide, 1000);
    } catch (e) {
      console.error("Undo/Switch failed:", e);
      const t = document.getElementById("apub_text");
      if (t) t.textContent = `Update failed: ${e.message}`;
    }
  }

  function show(payload){
    // payload: {event_code, pass_id, from_code, to_code, choices}
    last = payload;

    const el = ensureBar();
    const t = document.getElementById("apub_text");
    if (t) t.textContent = `Recorded as ${payload.to_code}.`;

    el.style.display = "block";

    if (timer) clearTimeout(timer);
    timer = setTimeout(hide, BAR_MS);
  }

  // Public hook
  window.TvemcAutoPassUndo = { show };
})();
