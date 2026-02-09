/* station_autopass.js
   Auto-routes multi-pass stations (Corral/Kanan/Zuma) to the correct instance
   based on runner history + distance-aware time gates.

   Public API:
   window.TvemcAutoPass.resolveStationCode({ base_station_code, action, distance_code, entries, bib, now_ms })
*/

(function(){
  const SETTINGS_KEY = "tvemc_autopass_advance_rule"; // "IN_ONLY" | "IN_OUT"

  function getAdvanceRule(){
    const v = localStorage.getItem(SETTINGS_KEY);
    return v === "IN_OUT" ? "IN_OUT" : "IN_ONLY";
  }

  function setAdvanceRule(v){
    localStorage.setItem(SETTINGS_KEY, v === "IN_OUT" ? "IN_OUT" : "IN_ONLY");
  }

  // Station group definitions (you confirmed these)
  const GROUPS = {
    CORRAL_AUTO: ["AS1", "AS8", "AS10"], // CC1, CC2, CC3
    KANAN_AUTO:  ["AS2", "AS7"],         // KR1, KR2
    ZUMA_AUTO:   ["AS4", "AS6"]          // Zuma1, Zuma2
  };

  // Distance-aware minimum minutes between passes in the same group.
  // Guardrail only: prevents accidental double-scan from advancing pass too soon.
  const MIN_MINUTES = {
    CORRAL_AUTO: { "30K": 15, "26.2": 40, "50K": 60, "50M": 90, "100K": 120 },
    KANAN_AUTO:  { "50K": 60, "50M": 90, "100K": 90, "26.2": 0, "30K": 0 },
    ZUMA_AUTO:   { "50M": 90, "100K": 90, "50K": 0, "26.2": 0, "30K": 0 }
  };

  function up(x){ return String(x||"").trim().toUpperCase(); }

  function parseMs(e){
    if (typeof e?.pass_ts_ms === "number" && isFinite(e.pass_ts_ms)) return e.pass_ts_ms;
    const raw = e?.pass_ts || "";
    const ms = Date.parse(raw);
    return isFinite(ms) ? ms : 0;
  }

  function actionCountsForPassAdvance(action){
    const rule = getAdvanceRule();
    const a = up(action);
    if (rule === "IN_OUT") return (a === "IN" || a === "OUT");
    return (a === "IN");
  }

  function minMinutesFor(base, dist){
    const d = up(dist);
    const t = MIN_MINUTES[base] || {};
    return Number(t[d] ?? 0);
  }

  // entries = your in-memory bib log entries array (already loaded)
  // We filter by this bib and this group’s station codes
  function resolveStationCode({ base_station_code, action, distance_code, entries, bib, now_ms }) {
    const base = up(base_station_code);
    const group = GROUPS[base];
    if (!group) return null; // not an auto group

    const bibStr = String(bib || "").trim();
    const dist = up(distance_code);

    // Gather history for this bib in this group, sorted oldest->newest
    const hist = (Array.isArray(entries) ? entries : [])
      .filter(e => String(e?.bib_number ?? "").trim() === bibStr)
      .filter(e => group.includes(up(e?.station_code || "")))
      .sort((a,b) => parseMs(a) - parseMs(b));

    // Count how many times this runner has "advanced pass" in this group
    let advances = 0;
    for (const e of hist) {
      if (actionCountsForPassAdvance(e.action)) advances++;
    }

    // Candidate index is "next" station in the sequence, but clamped
    // Example Corral: 0->AS1, 1->AS8, 2->AS10
    let idx = Math.min(advances, group.length - 1);

    // Time gate: if the last group hit is too recent, do NOT advance.
    // We compare last recorded hit time in group with now.
    const last = hist.length ? hist[hist.length - 1] : null;
    if (last) {
      const lastMs = parseMs(last);
      const now = Number(now_ms || Date.now());
      const minM = minMinutesFor(base, dist);
      if (minM > 0 && lastMs > 0) {
        const deltaMin = (now - lastMs) / 60000;
        // If too soon, keep same station instance as last (don’t advance)
        if (deltaMin < minM) {
          const lastCode = up(last.station_code || "");
          const lastIdx = group.indexOf(lastCode);
          if (lastIdx >= 0) idx = lastIdx;
        }
      }
    }

    return group[idx];
  }

  window.TvemcAutoPass = {
    resolveStationCode,
    getAdvanceRule,
    setAdvanceRule
  };
})();
