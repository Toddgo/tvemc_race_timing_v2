// results_engine.js
// Computes Finish/Elapsed/AvgPace/AgeGrp/AGPlace/OverallPlace using:
// - runner_starts override (per bib)
// - else event_start_times (per distance)
// - event_distances (distance_miles)
// Works with whatever rows you already render in Bib Log Viewer.

import { formatHMS, paceMinPerMile, parseTs, ageGroup, safeUpper } from "./results_math.js";

function key(...parts) {
  return parts.map(p => String(p ?? "")).join("|");
}

// ✅ PASS TIMESTAMP PARSER (DB pass_ts is UTC, stored as "YYYY-MM-DD HH:MM:SS")
function parsePassTsUtc(ts) {
  if (!ts) return null;
  const str = String(ts).trim();
  if (!str) return null;

  // If ts already has timezone info, let Date parse it
  if (/[zZ]|[+\-]\d\d:\d\d$/.test(str)) {
    const ms0 = new Date(str).getTime();
    return isNaN(ms0) ? null : ms0;
  }

  // If it's ISO without TZ or "YYYY-MM-DD HH:MM:SS", treat as UTC by appending Z
  const iso = str.includes("T") ? str : str.replace(" ", "T");
  const ms = new Date(iso + "Z").getTime();
  return isNaN(ms) ? null : ms;
}

export function computeResultsForRows({
  rows,                 // array of pass/view rows (your Bib Log Viewer rows)
  runnerStartByBib,     // Map(bib -> start_ts_actual string)
  startByDistance,      // Map(distance_code -> start_ts string)
  milesByDistance,      // Map(distance_code -> miles number)
  finishStationCode = "FINISH"
}) {
  // Build per-runner aggregates from the rows we have loaded
  // We compute based on "most recent distance_code" for that runner in the loaded dataset.
  const runners = new Map(); // bib -> state

  for (const r of rows) {
    const bib = Number(r.bib ?? r.bib_number ?? r.bibNumber);
    if (!isFinite(bib)) continue;

    const distance = String(r.distance_code ?? r.distance ?? "").trim();
    const station = String(r.station_id ?? r.station_code ?? r.station ?? "").trim();
    const passType = safeUpper(r.pass_type ?? r.action ?? "");
    const passTs = r.pass_ts ?? r.pass_time ?? r.time_ts ?? r.created_at ?? r.passTs;

    // ✅ Pass timestamps are UTC
    const ms = parsePassTsUtc(passTs);
    if (ms == null) continue;

    const age = r.age ?? r.Age ?? "";
    const gender = r.gender ?? r.Gender ?? "";

    if (!runners.has(bib)) {
      runners.set(bib, {
        bib,
        distance,
        age,
        gender,
        lastTs: ms,
        lastStation: station,
        finishedTs: null
      });
    }

    const st = runners.get(bib);

    // Keep latest seen distance as "current distance"
    if (distance) st.distance = distance;

    // Track last seen
    if (ms > st.lastTs) {
      st.lastTs = ms;
      st.lastStation = station;
    }

    // Detect finish (either explicit pass_type or station_id)
    const isFinish = (safeUpper(station) === finishStationCode) || (passType === "FINISH") || (passType === "FIN");
    if (isFinish) {
      if (st.finishedTs == null || ms < st.finishedTs) {
        // first finish time (earliest FINISH pass)
        st.finishedTs = ms;
      }
    }
  }

  // Compute finishers list per distance for placement
  const finishersByDistance = new Map(); // distance -> array of runner states with computed elapsed

  for (const st of runners.values()) {
    if (!st.distance) continue;

    // start time precedence: runner_starts override > event_start_times
    const override = runnerStartByBib.get(st.bib);
    const startTsStr = override || startByDistance.get(st.distance) || null;

    // ✅ Start times come from DB as ISO with offset now (start_times_iso / runner_starts_iso)
    const startMs = parseTs(startTsStr);

    const miles = milesByDistance.get(st.distance);

    st.startMs = startMs;
    st.totalMiles = miles;

    if (st.finishedTs != null && startMs != null && miles) {
      st.elapsedSec = (st.finishedTs - startMs) / 1000;
      st.avgPace = paceMinPerMile(st.elapsedSec, miles);
      st.elapsedHMS = formatHMS(st.elapsedSec);
      st.ageGroup = ageGroup(st.age);
      st.genderNorm = safeUpper(st.gender) || "UNK";

      const list = finishersByDistance.get(st.distance) || [];
      list.push(st);
      finishersByDistance.set(st.distance, list);
    }
  }

  // Sort for overall placing per distance (finish time ascending)
  const overallPlace = new Map(); // bib -> place number
  const agPlace = new Map();      // bib -> AG place number
  const genderPlace = new Map();   // bib -> "N M" / "N F" / etc

  for (const [dist, list] of finishersByDistance.entries()) {
    list.sort((a, b) => a.finishedTs - b.finishedTs);

    // overall place
    list.forEach((st, idx) => overallPlace.set(st.bib, idx + 1));
    
    // gender place (within distance + gender)
    const gCount = new Map(); // gender -> count
    for (const st of list) {
      const g = st.genderNorm || "UNK";
      const n = (gCount.get(g) || 0) + 1;
      gCount.set(g, n);
      genderPlace.set(st.bib, `${n} ${g}`);
    }

    // age group place (within distance + gender + ageGroup)
    const buckets = new Map();
    for (const st of list) {
      const k = key(dist, st.genderNorm, st.ageGroup);
      const arr = buckets.get(k) || [];
      arr.push(st);
      buckets.set(k, arr);
    }
    for (const arr of buckets.values()) {
      arr.sort((a, b) => a.finishedTs - b.finishedTs);
      arr.forEach((st, idx) => agPlace.set(st.bib, idx + 1));
    }
  }

  // Return a new rows array with computed fields attached (for table rendering)
  return rows.map(r => {
    const bib = Number(r.bib ?? r.bib_number ?? r.bibNumber);
    const st = runners.get(bib);
    if (!st) return r;

    const dist = st.distance || (r.distance_code ?? r.distance ?? "");
    const miles = milesByDistance.get(dist);
    
    const out = { ...r };

    // Finish fields (only if finished)
    if (st.finishedTs != null && st.startMs != null && miles) {
      // ✅ Always format Finish in America/Los_Angeles
      out.finish_time = new Date(st.finishedTs).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles"
      });

      out.finish_ts_ms  = st.finishedTs;
      out.elapsed_total = st.elapsedHMS;
      out.avg_pace = st.avgPace;
      const act = safeUpper(out.action || st.action || "");
      out.gender_place = (act === "FINISH") ? (genderPlace.get(bib) ?? "") : "";
      out.age_group = st.ageGroup;
      out.ag_place = agPlace.get(bib) ?? "";
      out.overall_place = overallPlace.get(bib) ?? "";
      out.eta_next = "—";
    } else {
      // Not finished (keep existing computed fields or mark blank)
      out.finish_time = "";
      out.elapsed_total = "";
      out.avg_pace = "";
      out.gender_place = "";
      out.age_group = ageGroup(st.age);
      out.ag_place = "";
      out.overall_place = "";
      // eta_next handled elsewhere (station-to-next math) — leave as-is
    }

    return out;
  });
}

