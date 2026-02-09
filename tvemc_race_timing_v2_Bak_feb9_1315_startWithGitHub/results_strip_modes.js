/* results_strip_modes.js (MODE ONLY) */
(function(){
  const STORAGE_KEY = "tvemc_occupancy_mode"; // auto | inout | lastseen

  function getEventCode(){
    if (window.getEventCode) return window.getEventCode();
    return (document.getElementById("eventCode")?.value
      || document.getElementById("eventName")?.value
      || "").trim();
  }

  function defaultModeByEvent(){
    const code = getEventCode().toUpperCase();
    if (code.startsWith("KH_")) return "lastseen";
    if (code.startsWith("DT_")) return "inout";
    return "inout";
  }

  function getMode(){
    const stored = localStorage.getItem(STORAGE_KEY) || "auto";
    return stored === "auto" ? defaultModeByEvent() : stored;
  }

  function setMode(mode){
    localStorage.setItem(STORAGE_KEY, mode);
  }

  window.ResultsStripMode = { getMode, setMode };
})();
