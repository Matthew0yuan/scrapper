// ===========================
// 配置：你关心哪些车型
// ===========================
let TARGET_MODELS = ["MG3"]; // 也可以之后从 popup 动态设置

const SCAN_INTERVAL_MS = 1000;
const scrapedCars = [];
const seenKeys = new Set();
let scanIntervalId = null;

// 简单 CSV 转义
function csvEscape(value) {
  if (value == null) return "";
  const v = String(value).replace(/"/g, '""');
  return `"${v}"`;
}

function parseCarCard(card) {
  const text = card.innerText || "";
  const lower = text.toLowerCase();

  const model = TARGET_MODELS.find(m =>
    lower.includes(m.toLowerCase())
  );
  if (!model) return null;

  // 价格
  let price = "";
  const totalMatch = text.match(/\$\s*\d+[^\n$]*total/i);
  if (totalMatch) {
    price = totalMatch[0].replace(/\s+/g, " ").trim();
  } else {
    const firstDollar = text.match(/\$\s*\d+/);
    if (firstDollar) {
      price = firstDollar[0].replace(/\s+/g, " ").trim();
    }
  }

  // 标题（车类别）
  const titleEl =
    card.querySelector("h3") ||
    card.querySelector("[data-stid*='car-type']") ||
    card.querySelector("h2");
  const title = titleEl ? titleEl.innerText.trim() : "";

  // 公司：优先 logo alt
  let company = "";
  const logoImg = card.querySelector("img[alt]");
  if (logoImg && logoImg.alt && logoImg.alt.length > 1) {
    company = logoImg.alt.trim();
  } else {
    const supplierCandidates = Array.from(
      card.querySelectorAll("span, div")
    )
      .map(el => el.innerText.trim())
      .filter(t => t && t.length < 40);

    const knownSuppliers = [
      "east coast",
      "hertz",
      "avis",
      "budget",
      "sixt",
      "thrifty",
      "europcar"
    ];

    for (const t of supplierCandidates) {
      const l = t.toLowerCase();
      if (knownSuppliers.some(s => l.includes(s))) {
        company = t;
        break;
      }
    }
  }

  const key = `${model} | ${price} | ${company} | ${title}`;
  if (seenKeys.has(key)) return null;
  seenKeys.add(key);

  return { title, model, price, company };
}

function scanPageOnce() {
  const selectors = [
    "[data-stid='car-result']",
    "[data-stid='car-result-item']",
    "section[data-stid*='car']",
    "li[data-stid*='car']",
    "article"
  ];

  let cards = [];
  for (const sel of selectors) {
    const found = Array.from(document.querySelectorAll(sel));
    if (found.length > 5) {
      cards = found;
      break;
    }
    if (found.length > 0 && cards.length === 0) {
      cards = found;
    }
  }

  if (!cards.length) return;

  let added = 0;
  for (const card of cards) {
    const info = parseCarCard(card);
    if (info) {
      scrapedCars.push(info);
      added++;
    }
  }

  if (added > 0) {
    console.log(`[CarScraper] 新增 ${added} 条记录，当前总数 ${scrapedCars.length}`);
  }
}

function startScanning() {
  if (scanIntervalId) return;
  scanIntervalId = setInterval(scanPageOnce, SCAN_INTERVAL_MS);
  console.log("[CarScraper] 开始扫描，你可以正常往下滚页面。");
}

function stopScanning() {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
    console.log("[CarScraper] 已停止扫描。");
  }
}

function buildCSV() {
  const header = ["title", "model", "price", "company"];
  const lines = [header.map(csvEscape).join(",")];

  for (const car of scrapedCars) {
    lines.push([
      csvEscape(car.title),
      csvEscape(car.model),
      csvEscape(car.price),
      csvEscape(car.company)
    ].join(","));
  }
  return lines.join("\n");
}

function downloadCSV() {
  if (!scrapedCars.length) {
    alert("还没有采集到数据，先往下滚一滚页面。");
    return;
  }
  const csvContent = buildCSV();
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cars.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 监听 popup 发来的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START") {
    if (msg.models && Array.isArray(msg.models) && msg.models.length) {
      TARGET_MODELS = msg.models;
    }
    startScanning();
    sendResponse({ ok: true });
  } else if (msg.type === "STOP") {
    stopScanning();
    sendResponse({ ok: true });
  } else if (msg.type === "DOWNLOAD") {
    downloadCSV();
    sendResponse({ ok: true, count: scrapedCars.length });
  }
});
