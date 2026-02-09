// results_math.js
// Pure math + formatting helpers (no DOM, no fetch)

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatHMS(totalSeconds) {
  if (totalSeconds == null || !isFinite(totalSeconds)) return "N/A";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

export function paceMinPerMile(totalSeconds, miles) {
  if (!miles || miles <= 0 || totalSeconds == null || !isFinite(totalSeconds)) return "N/A";
  const paceSec = totalSeconds / miles;
  const m = Math.floor(paceSec / 60);
  const s = Math.round(paceSec % 60);
  return `${m}:${pad2(s)}`;
}

export function parseTs(ts) {
  if (!ts) return null;
  const str = String(ts).trim();

  // If it's already ISO with timezone, trust it
  if (/[zZ]|[+\-]\d\d:\d\d$/.test(str)) {
    const ms0 = new Date(str).getTime();
    return isNaN(ms0) ? null : ms0;
  }

  // If it's "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" (no timezone),
  // force PST offset for this race window.
  const isoNoTz = str.includes("T") ? str : str.replace(" ", "T");
  const forced = isoNoTz + "-08:00";   // PST
  const ms = new Date(forced).getTime();
  return isNaN(ms) ? null : ms;
}


export function ageGroup(age) {
  const a = Number(age);
  if (!isFinite(a) || a <= 0) return "UNK";
  if (a < 20) return "19under";
  const lo = Math.floor(a / 10) * 10;
  const hi = lo + 9;
  return `${lo}-${hi}`;
}

export function safeUpper(x) {
  return (x == null ? "" : String(x)).trim().toUpperCase();
}
