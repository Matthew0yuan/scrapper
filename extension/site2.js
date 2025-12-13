(async () => {
  // ===========================
  // 配置区
  // ===========================
  const LOCATION_TEXT = "Perth (all locations), Australia";

  // 你的目标车型关键字（大小写不敏感，包含匹配）
  const TARGET_MODELS = [
    "picanto", "rio", "mg3",
    "cerato hatch", "cerato", "mg5", "i30",
    "jolion", "zs",
    "xtrail", "x-trail", "outlander",
    "carnival"
  ];

  // 租期：1~8天
  const DURATIONS = [1, 2, 3, 4, 5, 6, 7, 8];

  // 自动滚动 & 结果加载
  const SCROLL_STEP = 650;
  const SCAN_INTERVAL_MS = 500;
  const MAX_IDLE_ROUNDS = 15;
  const RESULT_EXTRA_WAIT_MS = 15000;

  // 车型分类规则
  const CATEGORY_RULES = [
    { code: "EDAR",  group: "Picanto, Rio & MG3",                  keywords: ["picanto", "rio", "mg3"] },
    { code: "IDAR",  group: "Cerato Hatch",                        keywords: ["cerato hatch"] },
    { code: "SEDAN", group: "Cerato, MG5, i30",                    keywords: ["cerato", "mg5", "i30"] },
    { code: "CFAR",  group: "Jolion & ZS",                         keywords: ["jolion", "zs"] },
    { code: "IFAR",  group: "Tuscon & Sportage & CX5",             keywords: ["tuscon", "tucson", "sportage", "cx5"] },
    { code: "FFAR",  group: "Xtrail & Outlander",                  keywords: ["xtrail", "x-trail", "outlander"] },
    { code: "SVAR",  group: "Carnival",                            keywords: ["carnival"] },
  ];

  // ===========================
  // 工具函数
  // ===========================
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm  = (t) => String(t || "").replace(/\s+/g, " ").trim();

  function log(...args) {
    console.log("[AUTO]", ...args);
  }

  function csvEscape(value) {
    if (value == null) return '""';
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  function addDays(d, n) {
    const d2 = new Date(d.getTime());
    d2.setDate(d2.getDate() + n);
    return d2;
  }

  function classifyModel(baseName, fullName) {
    const text = (baseName || fullName || "").toLowerCase();
    for (const rule of CATEGORY_RULES) {
      if (rule.keywords.some(k => text.includes(k))) {
        return { category_code: rule.code, category_group: rule.group };
      }
    }
    return { category_code: "", category_group: "" };
  }

  // 价格提取：A$355.15 -> 355.15（数字）
  function parsePriceNumber(raw) {
    const s = norm(raw);
    if (!s) return NaN;

    // $xxx.xx
    let m = s.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (m) return parseFloat(m[1].replace(/,/g, ""));

    // AUD xxx.xx
    m = s.match(/\bAUD\b\s*([\d,]+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1].replace(/,/g, ""));

    // A$xxx.xx (有些站点会写 A$)
    m = s.match(/\bA\$\s*([\d,]+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1].replace(/,/g, ""));

    // fallback: first number
    m = s.match(/([\d,]+(?:\.\d+)?)/);
    if (m) return parseFloat(m[1].replace(/,/g, ""));

    return NaN;
  }

  function round2(n) {
    if (!Number.isFinite(n)) return "";
    return Math.round(n * 100) / 100;
  }

  // ===========================
  // 搜索页识别 & 强制回主页
  // ===========================
  function isSearchPage() {
    return !!document.querySelector("form.SearchModifier-Form");
  }

  async function waitForSearchPage(timeoutMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isSearchPage()) {
        await sleep(600);
        return true;
      }
      await sleep(500);
    }
    return false;
  }

  function findModifyButton() {
    // 更稳：优先找特定容器/类名，其次用文本猜
    const byClass =
      document.querySelector("button.SearchModifier-Modify") ||
      document.querySelector("button[class*='Modify' i]") ||
      document.querySelector("a[class*='Modify' i]");

    if (byClass) return byClass;

    // 文本兜底
    const candidates = Array.from(document.querySelectorAll("a,button"));
    for (const el of candidates) {
      const t = norm(el.textContent).toLowerCase();
      if (
        t === "modify" ||
        t.includes("modify search") ||
        t.includes("change search") ||
        t.includes("edit search") ||
        (t === "back" || t.includes("back to search"))
      ) return el;
    }
    return null;
  }

  // 关键：记录主页 URL，回去直接 location.href = HOME_URL
  let HOME_URL = null;

  async function navigateToHome(forceReload = false) {
    if (isSearchPage() && !forceReload) return true;

    // 先尝试点“Modify/Back”
    const modBtn = findModifyButton();
    if (modBtn) {
      log("Click modify/back button to return search form...");
      modBtn.click();
      const ok = await waitForSearchPage(20000);
      if (ok) return true;
    }

    // 再尝试 history.back()
    try {
      log("Try history.back()...");
      history.back();
      const ok = await waitForSearchPage(15000);
      if (ok) return true;
    } catch (e) {}

    // 最稳：强制跳回 HOME_URL
    if (HOME_URL) {
      log("Force navigate to HOME_URL:", HOME_URL);
      location.href = HOME_URL;
      const ok = await waitForSearchPage(30000);
      return ok;
    }

    log("❌ No HOME_URL recorded. Cannot force back.");
    return false;
  }

  // ===========================
  // 输入框/按钮定位（更宽松）
  // ===========================
  function getLocationInput() {
    return document.querySelector("input.Autocomplete-EnterLocation[name='PickupLocation']")
        || document.querySelector("input.Autocomplete-EnterLocation")
        || document.querySelector("input[name='PickupLocation']")
        || document.querySelector("input[placeholder*='location' i]");
  }

  function getPickupClickable() {
    const label = document.querySelector("label[for='PickupDate']");
    if (label) return label.closest("div")?.querySelector(".DatePicker-CalendarField") || label;
    return document.querySelectorAll(".DatePicker-CalendarField")[0] || null;
  }

  function getDropoffClickable() {
    const label = document.querySelector("label[for='DropoffDate']");
    if (label) return label.closest("div")?.querySelector(".DatePicker-CalendarField") || label;
    const all = document.querySelectorAll(".DatePicker-CalendarField");
    return all[1] || null;
  }

  function getSearchButton() {
    const form = document.querySelector("form.SearchModifier-Form") || document.querySelector("form");
    if (!form) return null;
    return form.querySelector("button[type='submit']")
        || form.querySelector("button.Button")
        || form.querySelector("button");
  }

  async function setLocation(text) {
    const input = getLocationInput();
    if (!input) return false;

    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(150);

    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // 自动补全确认
    try {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup",   { key: "Enter", code: "Enter", bubbles: true }));
    } catch (e) {}
    await sleep(500);
    return true;
  }

  // ===========================
  // 日期选择
  // ===========================
  function findCalendarDayElement(targetDate) {
    const dayNum = String(targetDate.getDate());
    const monthShort = targetDate.toLocaleString("en-US", { month: "short" }).toLowerCase();

    const labelStr1 = targetDate.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric"
    });
    const labelStr2 = targetDate.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });

    const candidates = Array.from(document.querySelectorAll(
      ".DatePicker-Day button, .DatePicker-Day, .CalendarDay button, .CalendarDay, [aria-label], button, td"
    ));

    let el = candidates.find(e => {
      const a = (e.getAttribute("aria-label") || "").trim();
      return a === labelStr1 || a === labelStr2;
    });
    if (el) return el;

    el = candidates.find(e => {
      const a = (e.getAttribute("aria-label") || "").toLowerCase();
      return a.includes(monthShort) && a.includes(dayNum);
    });
    if (el) return el;

    return candidates.find(e => norm(e.textContent) === dayNum) || null;
  }

  async function setDates(pickupDate, dropoffDate) {
    const pick = getPickupClickable();
    const drop = getDropoffClickable();
    if (!pick || !drop) {
      log("❌ Date fields not found:", { pickup: !!pick, dropoff: !!drop });
      return false;
    }

    pick.click();
    await sleep(500);

    const el1 = findCalendarDayElement(pickupDate);
    if (!el1) { log("❌ pickup day not found"); return false; }
    el1.click();
    await sleep(350);

    // 尝试同一弹窗直接选 dropoff
    let el2 = findCalendarDayElement(dropoffDate);
    if (el2) {
      el2.click();
      await sleep(500);
      return true;
    }

    // 不行就点 dropoff 再选
    drop.click();
    await sleep(400);
    el2 = findCalendarDayElement(dropoffDate);
    if (!el2) { log("❌ dropoff day not found"); return false; }
    el2.click();
    await sleep(500);
    return true;
  }

  // ===========================
  // 结果页等待
  // ===========================
  async function waitForResults(timeoutMs = 35000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok =
        document.querySelector("[data-test-id='virtuoso-list']") ||
        document.querySelector(".SearchList-Wrapper") ||
        document.querySelector(".SearchCar-Wrapper");
      if (ok) return true;
      await sleep(500);
    }
    return false;
  }

  // ===========================
  // 抓车逻辑（含 avg daily）
  // ===========================
  const scrapedCars = [];
  const seenKeys = new Set();

  function extractNames(card) {
    const h4 = card.querySelector(".SearchCar-CarName h4");
    if (!h4) return { fullName: "", baseName: "" };

    const fullName = norm(h4.textContent);
    let baseName = "";
    h4.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) baseName += n.textContent; });
    baseName = norm(baseName) || fullName;
    return { fullName, baseName };
  }

  function parseCarCard(card, meta) {
    const { fullName, baseName } = extractNames(card);
    if (!fullName) return null;

    const lower = fullName.toLowerCase();
    if (TARGET_MODELS.length > 0) {
      const hit = TARGET_MODELS.find(m => lower.includes(m.toLowerCase()));
      if (!hit) return null;
    }

    const { category_code, category_group } = classifyModel(baseName, fullName);

    let company = "";
    const logo = card.querySelector(".SupplierInfo-Wrapper img[alt]");
    if (logo?.alt) company = norm(logo.alt);

    const priceEl = card.querySelector(".SearchCar-Price");
    const priceRaw = priceEl ? norm(priceEl.textContent) : "";
    const priceValue = parsePriceNumber(priceRaw);

    if (!Number.isFinite(priceValue)) return null;

    const avgDaily = meta.rental_days > 0 ? round2(priceValue / meta.rental_days) : "";

    const key = `${baseName}|${company}|${priceValue}|${meta.pickup_date}|${meta.dropoff_date}|${category_code}`;
    if (seenKeys.has(key)) return null;
    seenKeys.add(key);

    return {
      car_name_full: fullName,
      car_name_base: baseName,
      company,
      price_value: round2(priceValue),      // 数字
      avg_daily_price: avgDaily,            // 数字
      pickup_date: meta.pickup_date,
      dropoff_date: meta.dropoff_date,
      rental_days: meta.rental_days,
      category_code,
      category_group
    };
  }

  function getVisibleCards() {
    const container =
      document.querySelector("[data-test-id='virtuoso-list']") ||
      document.querySelector(".SearchList-Wrapper") ||
      document.body;
    return Array.from(container.querySelectorAll(".SearchCar-Wrapper"));
  }

  async function autoScrollAndScrape(meta) {
    let lastHeight = 0;
    let lastCount = scrapedCars.length;
    let idle = 0;

    while (idle < MAX_IDLE_ROUNDS) {
      // 点 Show more 加载更多
      const showMore =
        document.querySelector(".SearchList-ShowMoreWrapper .SearchList-ShowMore") ||
        document.querySelector(".SearchList-ShowMoreWrapper button");
      if (showMore && !showMore.disabled) {
        showMore.click();
        await sleep(1200);
      }

      // 抓当前可见卡片
      const cards = getVisibleCards();
      for (const c of cards) {
        const info = parseCarCard(c, meta);
        if (info) scrapedCars.push(info);
      }

      const h = document.body.scrollHeight;
      const c = scrapedCars.length;

      if (h > lastHeight || c > lastCount) {
        idle = 0;
        lastHeight = h;
        lastCount = c;
      } else {
        idle++;
      }

      window.scrollBy(0, SCROLL_STEP);
      await sleep(SCAN_INTERVAL_MS);
    }
  }

  // ===========================
  // 启动前：确保在主页并记录 HOME_URL
  // ===========================
  if (!isSearchPage()) {
    log("Not on search page now. Trying to navigate back to search form...");
    const ok = await navigateToHome();
    if (!ok) {
      log("❌ Cannot reach search page. Please run this script on the search form page.");
      return;
    }
  }

  // 记录主页 URL（用于每轮强制回主页）
  HOME_URL = location.href;
  log("Recorded HOME_URL:", HOME_URL);

  // ===========================
  // 主流程：每轮都强制回主页->填地点->选日期->搜->等15s->抓->回主页
  // ===========================
  log("START. Will run durations:", DURATIONS);

  for (let i = 0; i < DURATIONS.length; i++) {
    const days = DURATIONS[i];

    try {
      // 强制回主页（防止卡在结果页）
      const okHome = await navigateToHome(i === 0 ? false : true);
      if (!okHome) {
        log("Skip: cannot get back to search page.");
        continue;
      }

      window.scrollTo(0, 0);
      await sleep(300);

      // 每轮重新按“当前日期”计算：明天起租
      const today = new Date();
      const pickupDate = addDays(today, 1);
      const dropoffDate = addDays(pickupDate, days);

      const pickupStr = pickupDate.toISOString().slice(0, 10);
      const dropoffStr = dropoffDate.toISOString().slice(0, 10);

      log(`Round ${i + 1}/${DURATIONS.length} | ${pickupStr} -> ${dropoffStr} | days=${days}`);

      // 设置地点 & 日期
      const okLoc = await setLocation(LOCATION_TEXT);
      if (!okLoc) { log("Skip: location input not found."); continue; }

      const okDates = await setDates(pickupDate, dropoffDate);
      if (!okDates) { log("Skip: date picker failed."); continue; }

      // 点击搜索
      const btn = getSearchButton();
      if (!btn) { log("Skip: search button not found."); continue; }

      log("Click search...");
      btn.click();

      // 等结果页
      const okRes = await waitForResults();
      if (!okRes) { log("Skip: results not loaded."); continue; }

      // 额外等待 15s 再开始抓（你要求的）
      log(`Results loaded. Wait ${RESULT_EXTRA_WAIT_MS / 1000}s before scraping...`);
      await sleep(RESULT_EXTRA_WAIT_MS);

      // 抓取
      log("Scraping + show more + auto scroll...");
      await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });

      log(`Round done. Total records so far: ${scrapedCars.length}`);

      // ✅ 关键：本轮结束后强制回主页（下一轮重设日期/地点）
      if (HOME_URL) {
        log("Return to HOME_URL for next round...");
        location.href = HOME_URL;
        await waitForSearchPage(30000);
        await sleep(600);
      }

    } catch (err) {
      console.error("[AUTO] Round crashed but will continue:", err);
      // 尝试回主页后继续
      if (HOME_URL) {
        try {
          location.href = HOME_URL;
          await waitForSearchPage(30000);
          await sleep(600);
        } catch (e) {}
      }
      continue;
    }
  }

  // ===========================
  // 导出 CSV（price_value 数字 + avg_daily_price 数字）
  // ===========================
  if (!scrapedCars.length) {
    log("No data collected. Stop.");
    return;
  }

  const header = [
    "car_name_full",
    "car_name_base",
    "company",
    "price_value",
    "avg_daily_price",
    "pickup_date",
    "dropoff_date",
    "rental_days",
    "category_code",
    "category_group"
  ];

  const lines = [header.map(csvEscape).join(",")];
  for (const r of scrapedCars) {
    lines.push([
      csvEscape(r.car_name_full),
      csvEscape(r.car_name_base),
      csvEscape(r.company),
      csvEscape(r.price_value),
      csvEscape(r.avg_daily_price),
      csvEscape(r.pickup_date),
      csvEscape(r.dropoff_date),
      csvEscape(r.rental_days),
      csvEscape(r.category_code),
      csvEscape(r.category_group),
    ].join(","));
  }

  const csvContent = lines.join("\n");

  try {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = "cars_site2.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log(`EXPORT OK: cars_site2.csv | rows=${scrapedCars.length}`);
  } catch (e) {
    console.warn("[AUTO] Blob download failed, opening new tab fallback:", e);
    const dataUrl = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    window.open(dataUrl, "_blank");
  }
})();

