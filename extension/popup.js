const $ = (id) => document.getElementById(id);

async function loadConfig() {
  const cfg = await chrome.storage.sync.get(["location", "durations", "models"]);
  $("location").value = cfg.location || "Perth (all locations), Australia";
  $("durations").value = cfg.durations || "1,2,3,4,5,6,7,8";
  $("models").value = cfg.models || "";
}

async function saveConfig() {
  const location = $("location").value.trim();
  const durations = $("durations").value.trim();
  const models = $("models").value.trim();
  await chrome.storage.sync.set({ location, durations, models });
  return { location, durations, models };
}

function setStatus(t) {
  $("status").textContent = t;
}

$("run").addEventListener("click", async () => {
  setStatus("Starting...");

  const cfg = await saveConfig();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab.");
    return;
  }

  chrome.tabs.sendMessage(
    tab.id,
    { type: "RUN_SCRAPER", cfg },
    (resp) => {
      const err = chrome.runtime.lastError;
      if (err) {
        setStatus("Cannot reach page. Refresh tab and try again.");
        return;
      }
      if (!resp?.ok) {
        setStatus(resp?.error || "Failed to start.");
        return;
      }
      setStatus("Running... check DevTools console for logs.");
    }
  );
});

loadConfig();
