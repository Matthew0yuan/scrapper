function sendToTab(message) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) return resolve(null);
      chrome.tabs.sendMessage(tabs[0].id, message, (resp) => {
        resolve(resp);
      });
    });
  });
}

document.getElementById("start").addEventListener("click", async () => {
  const modelsStr = document.getElementById("models").value || "";
  const models = modelsStr
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const resp = await sendToTab({ type: "START", models });
  const status = document.getElementById("status");
  status.textContent = resp && resp.ok ? "采集已开始，在页面上往下滚。" : "启动失败";
});

document.getElementById("stop").addEventListener("click", async () => {
  const resp = await sendToTab({ type: "STOP" });
  const status = document.getElementById("status");
  status.textContent = resp && resp.ok ? "采集已停止。" : "停止失败";
});

document.getElementById("download").addEventListener("click", async () => {
  const resp = await sendToTab({ type: "DOWNLOAD" });
  const status = document.getElementById("status");
  if (resp && resp.ok) {
    status.textContent = `已下载 CSV，记录数：${resp.count}`;
  } else {
    status.textContent = "下载失败，可能没采集到数据。";
  }
});
