(async () => {
  // ===========================
  // 配置区
  // ===========================
  const LOCATION_TEXT = "Perth (all locations), Australia";

  const TARGET_MODELS = [
    "picanto", "rio", "mg3",
    "cerato hatch", "cerato", "mg5", "i30",
    "jolion", "zs",
    "xtrail", "x-trail", "outlander",
    "carnival"
  ];

  const DURATIONS = [1,2,3,4,5,6,7,8];

  const RESULT_EXTRA_WAIT_MS = 15000;
  const SCROLL_STEP = 650;
  const SCAN_INTERVAL_MS = 500;
  const MAX_IDLE_ROUNDS = 15;

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
  // 工具
  // ===========================
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm  = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const log   = (...a) => console.log("[AUTO]", ...a);
  function pad2(n){ return String(n).padStart(2,"0"); }
  function toYMDLocal(d){
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  }

  function isButtonDisabled(btn) {
    if (!btn) return true;
    if (btn.disabled) return true;
    const aria = (btn.getAttribute("aria-disabled") || "").toLowerCase();
    if (aria === "true") return true;
    const cls = (btn.className || "").toLowerCase();
    if (cls.includes("disabled") || cls.includes("loading")) return true;
    return false;
  }

  async function clickSearchNowOnResults() {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const norm  = (t) => String(t || "").replace(/\s+/g, " ").trim();
    const log   = (...a) => console.log("[AUTO]", ...a);

    const btn =
      document.querySelector("button.SearchModifier-SubmitBtn") ||
      document.querySelector("button.Button.Button_Search.SearchModifier-SubmitBtn") ||
      Array.from(document.querySelectorAll("button"))
        .find(b => /search now/i.test(norm(b.textContent)));

    if (!btn) {
      log("❌ Search Now button not found (button.SearchModifier-SubmitBtn)");
      return false;
    }

    // 等它变成可点（有时候刚选完日期会短暂 disabled）
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const disabled =
        btn.disabled ||
        (btn.getAttribute("aria-disabled") || "").toLowerCase() === "true" ||
        /disabled|loading/i.test((btn.className || "").toString());

      if (!disabled) break;
      await sleep(200);
    }

    // 强制点击：pointer+mouse+click（三连）
    btn.scrollIntoView({ block: "center" });
    const r = btn.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;

    try {
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles:true, cancelable:true, pointerType:"mouse", clientX:x, clientY:y, button:0, isPrimary:true }));
      btn.dispatchEvent(new PointerEvent("pointerup",   { bubbles:true, cancelable:true, pointerType:"mouse", clientX:x, clientY:y, button:0, isPrimary:true }));
    } catch(e) {}

    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0 }));
    btn.dispatchEvent(new MouseEvent("mouseup",   { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0 }));
    btn.click();

    log("✅ Clicked Search Now (button.SearchModifier-SubmitBtn)");
    return true;
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

  function parsePriceNumber(raw) {
    const s = norm(raw);
    if (!s) return NaN;

    let m = s.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (m) return parseFloat(m[1].replace(/,/g, ""));

    m = s.match(/\bAUD\b\s*([\d,]+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1].replace(/,/g, ""));

    m = s.match(/\bA\$\s*([\d,]+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1].replace(/,/g, ""));

    m = s.match(/([\d,]+(?:\.\d+)?)/);
    if (m) return parseFloat(m[1].replace(/,/g, ""));

    return NaN;
  }

  function round2(n) {
    if (!Number.isFinite(n)) return "";
    return Math.round(n * 100) / 100;
  }

  function findByText(textIncludes, scope=document) {
    const want = String(textIncludes || "").toLowerCase();
    const nodes = Array.from(scope.querySelectorAll("button,a,[role='button'],div,span,label"));
    return nodes.find(el => norm(el.textContent).toLowerCase().includes(want)) || null;
  }

  // ===========================
  // 页面状态
  // ===========================
  function isHomeSearchPage() {
    return !!document.querySelector("form.SearchModifier-Form");
  }

  function isResultsPage() {
    return !!(
      document.querySelector("[data-test-id='virtuoso-list']") ||
      document.querySelector(".SearchList-Wrapper") ||
      document.querySelector(".SearchCar-Wrapper")
    );
  }

  async function waitForResults(timeoutMs = 45000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isResultsPage()) return true;
      await sleep(400);
    }
    return false;
  }

  // ===========================
  // Home: location + submit search
  // ===========================
  function getLocationInput() {
    return document.querySelector("input.Autocomplete-EnterLocation[name='PickupLocation']")
        || document.querySelector("input.Autocomplete-EnterLocation")
        || document.querySelector("input[name='PickupLocation']")
        || document.querySelector("input[placeholder*='location' i]");
  }

  async function setLocation(text) {
    const input = getLocationInput();
    if (!input) return false;

    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(120);

    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    try {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup",   { key: "Enter", code: "Enter", bubbles: true }));
    } catch (e) {}

    await sleep(700);
    return true;
  }

  function getHomeSearchButton() {
    const form = document.querySelector("form.SearchModifier-Form") || document.querySelector("form");
    if (!form) return null;
    return form.querySelector("button[type='submit']")
      || form.querySelector("button.Button")
      || form.querySelector("button");
  }

  // ===========================
  // Results: Search Now button
  // ===========================
  function getSearchNowButton() {
    const dialog = document.querySelector("[role='dialog']") || document;
    return findByText("search now", dialog) || findByText("search now", document);
  }

  // ===========================
  // ✅ RDR_STRONG：结果页改日期（强力点 + 跨月修复 + 需要时点底部 Select dates 应用）
  // ===========================
  function dispatchMouse(el, type, x, y) {
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0
    }));
  }

  function dispatchPointer(el, type, x, y) {
    try {
      el.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        button: 0,
        isPrimary: true
      }));
    } catch (e) {}
  }

  function strongClick(el) {
    if (!el) return false;
    el.scrollIntoView({ block: "center" });

    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;

    const top = document.elementFromPoint(x, y);
    if (top && !(top === el || el.contains(top))) {
      const btn = top.closest("button");
      if (btn) el = btn;
    }

    dispatchPointer(el, "pointerdown", x, y);
    dispatchMouse(el, "mousedown", x, y);
    dispatchPointer(el, "pointerup", x, y);
    dispatchMouse(el, "mouseup", x, y);
    el.click();
    return true;
  }

  function getDateBtn_results() {
    // 按你脚本：CalendarField 或包含 date 的按钮/入口
    return document.querySelector(".DatePicker-CalendarField")
      || document.querySelector("[class*='CalendarField' i]")
      || findByText("date");
  }

  function getSelectDatesBtn_results() {
    return findByText("select dates") || findByText("select date");
  }

  function getPanel() {
    return document.querySelector(".rdrCalendarWrapper.rdrDateRangeWrapper")
      || document.querySelector(".rdrDateRangeWrapper")
      || document.querySelector(".rdrDateRangePickerWrapper")
      || document.querySelector(".rdrMonths");
  }

  async function waitPanel(timeoutMs=15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = getPanel();
      if (p) return p;
      await sleep(200);
    }
    return null;
  }

  function getDisplayValues(panel) {
    const inputs = Array.from(panel.querySelectorAll(".rdrDateDisplayItem input"));
    const vals = inputs.map(i => i.value);
    return { inputs, vals };
  }

  function isDisabled(btn) {
    if (!btn) return true;
    if (btn.disabled) return true;
    const aria = (btn.getAttribute("aria-disabled") || "").toLowerCase();
    if (aria === "true") return true;
    const cls = (btn.className || "").toString().toLowerCase();
    if (cls.includes("rdrdaydisabled")) return true;
    return false;
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return r.width > 5 && r.height > 5 && r.bottom > 0 && r.right > 0 && r.left < vw && r.top < vh;
  }

  function distToPanelCenter(el, panel) {
    const pr = panel.getBoundingClientRect();
    const cx = pr.left + pr.width / 2;
    const cy = pr.top + pr.height / 2;

    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - cx, dy = y - cy;
    return Math.sqrt(dx*dx + dy*dy);
  }

  // ===========================
  // ✅ 修复：跨月份选择日期（锁定目标月份 + 必要时翻月） + 本地日期字符串
  // ===========================
  const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

  function parseMonthYear(text){
    const t = norm(text).toLowerCase();
    const mName = MONTHS.find(m => t.includes(m));
    const yMatch = t.match(/\b(20\d{2})\b/);
    if (!mName || !yMatch) return null;
    return { y: Number(yMatch[1]), m: MONTHS.indexOf(mName) }; // m: 0-11
  }

  function cmpYM(a, b){
    if (a.y !== b.y) return a.y - b.y;
    return a.m - b.m;
  }

  function getNavButtons(panel){
    // react-date-range 常见按钮类名
    const root = panel.closest(".rdrDateRangeWrapper") || panel || document;
    const next =
      root.querySelector("button.rdrNextButton") ||
      root.querySelector("button.rdrNextPrevButton.rdrNextButton") ||
      root.querySelector("button[class*='rdrNext' i]") ||
      root.querySelector("button[aria-label*='next' i]");
    const prev =
      root.querySelector("button.rdrPrevButton") ||
      root.querySelector("button.rdrNextPrevButton.rdrPrevButton") ||
      root.querySelector("button[class*='rdrPrev' i]") ||
      root.querySelector("button[aria-label*='prev' i]");
    return { next, prev };
  }

  function getMonthEls(panel){
    return Array.from(panel.querySelectorAll(".rdrMonth"));
  }

  function getMonthNameEl(monthEl){
    return monthEl.querySelector(".rdrMonthName")
      || monthEl.querySelector("[class*='MonthName' i]")
      || monthEl.querySelector("[class*='month' i]");
  }

  function findMonthElForDate(panel, date){
    const target = { y: date.getFullYear(), m: date.getMonth() };
    const months = getMonthEls(panel);
    for (const me of months){
      const nameEl = getMonthNameEl(me);
      const info = nameEl ? parseMonthYear(nameEl.textContent) : null;
      if (info && info.y === target.y && info.m === target.m) return me;
    }
    return null;
  }

  async function ensureMonthVisible(panel, date, maxTurns=14){
    const target = { y: date.getFullYear(), m: date.getMonth() };

    for (let k=0; k<maxTurns; k++){
      const hit = findMonthElForDate(panel, date);
      if (hit) return hit;

      const months = getMonthEls(panel);
      const firstNameEl = months[0] ? getMonthNameEl(months[0]) : null;
      const firstInfo = firstNameEl ? parseMonthYear(firstNameEl.textContent) : null;

      const { next, prev } = getNavButtons(panel);

      // 能比较就按方向翻；比较不了就默认 next
      let goNext = true;
      if (firstInfo){
        goNext = cmpYM(firstInfo, target) < 0; // first < target => next
      }

      const btn = goNext ? next : prev;
      if (!btn){
        log("[RDR_STRONG] ❌ Cannot find month navigation buttons");
        return null;
      }

      strongClick(btn);
      await sleep(350);
      panel = getPanel() || panel;
    }

    log("[RDR_STRONG] ❌ Month not visible after turning pages");
    return null;
  }

  function getDayButtonsForDate(panel, monthEl, date){
    const dayNum = date.getDate();
    const all = Array.from(monthEl.querySelectorAll("button.rdrDay"));
    const candidates = all.filter(b => norm(b.textContent) === String(dayNum));

    const scored = candidates.map(b => ({
      b,
      visible: inViewport(b),
      disabled: isDisabled(b),
      dist: distToPanelCenter(b, panel)
    }));

    scored.sort((a, c) => {
      if (a.visible !== c.visible) return a.visible ? -1 : 1;
      if (a.disabled !== c.disabled) return a.disabled ? 1 : -1;
      return a.dist - c.dist;
    });

    return scored.map(x => x.b);
  }

  async function clickDateWithVerification(panel, date){
    const monthEl = await ensureMonthVisible(panel, date);
    if (!monthEl) return false;

    const before = getDisplayValues(getPanel() || panel).vals.join(" | ");
    const buttons = getDayButtonsForDate(panel, monthEl, date);

    log(`[RDR_STRONG] Try date=${toYMDLocal(date)} candidates=${buttons.length} before="${before}"`);

    for (let i = 0; i < Math.min(buttons.length, 12); i++){
      const btn = buttons[i];
      if (isDisabled(btn)) continue;

      btn.style.outline = "3px solid yellow";
      btn.style.outlineOffset = "2px";

      strongClick(btn);
      await sleep(350);

      const p2 = getPanel() || panel;
      const after = getDisplayValues(p2).vals.join(" | ");
      if (after && after !== before){
        log(`[RDR_STRONG] ✅ click ok date=${toYMDLocal(date)} (idx=${i}) after="${after}"`);
        return true;
      }
    }

    log(`[RDR_STRONG] ❌ date=${toYMDLocal(date)} click but display not changed`);
    return false;
  }

  async function clickApplySelectDatesIfPresent(panel){
    // 很多页面选完区间后需要点底部大按钮 “Select dates” 才会应用
    const dialog = panel.closest("[role='dialog']") || document;

    const buttons = Array.from(dialog.querySelectorAll("button"))
      .filter(b => /select\s*dates?/i.test(norm(b.textContent)))
      .filter(b => !isButtonDisabled(b) && inViewport(b));

    if (!buttons.length) return false;

    // 选择最像“底部大按钮”的：y 最大 + 宽度最大
    buttons.sort((a, c) => {
      const ra = a.getBoundingClientRect();
      const rc = c.getBoundingClientRect();
      const sa = ra.top * 10 + ra.width;  // 更偏向靠下 + 更宽
      const sc = rc.top * 10 + rc.width;
      return sc - sa; // 倒序
    });

    const btn = buttons[0];
    log("[RDR_STRONG] Click APPLY 'Select dates'...");
    strongClick(btn);

    // 等日历面板消失
    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (!getPanel()) return true;
      await sleep(200);
    }
    return true; // 就算没消失，也算点了
  }

  async function setDatesOnResults(pickupDate, dropoffDate) {
    // ===== 0) 尝试打开日历（与你脚本一致）=====
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key:"Escape", code:"Escape", bubbles:true }));
      document.dispatchEvent(new KeyboardEvent("keyup",   { key:"Escape", code:"Escape", bubbles:true }));
    } catch(e) {}
    await sleep(200);

    const dateBtn = getDateBtn_results();
    if (dateBtn) {
      log("[RDR_STRONG] Click Date entry...");
      strongClick(dateBtn);
      await sleep(600);

      const sel = getSelectDatesBtn_results();
      if (sel) {
        log("[RDR_STRONG] Click Select dates...");
        strongClick(sel);
        await sleep(800);
      }
    }

    let panel = await waitPanel(15000);
    if (!panel) {
      log("[RDR_STRONG] ❌ Calendar panel not found");
      return false;
    }

    log("[RDR_STRONG] ✅ Calendar panel found:", panel.className || panel.tagName);

    // ===== 1) 先点 pickup，再点 dropoff（跨月会自动翻月）=====
    const ok1 = await clickDateWithVerification(panel, pickupDate);
    await sleep(400);

    panel = getPanel() || panel;
    const ok2 = await clickDateWithVerification(panel, dropoffDate);

    log("[RDR_STRONG] DONE:", {
      pickup: pickupDate.toDateString(),
      dropoff: dropoffDate.toDateString(),
      pickup_clicked: ok1,
      dropoff_clicked: ok2
    });

    const finalPanel = getPanel() || panel;
    log("[RDR_STRONG] Final display inputs:", getDisplayValues(finalPanel).vals);

    // ===== 2) 应用日期（如果需要）=====
    if (finalPanel) {
      await clickApplySelectDatesIfPresent(finalPanel);
    }

    return ok1 && ok2;
  }

  // ===========================
  // 抓车（含 avg/day）
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
      price_value: round2(priceValue),
      avg_daily_price: avgDaily,
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
      const showMore =
        document.querySelector(".SearchList-ShowMoreWrapper .SearchList-ShowMore") ||
        document.querySelector(".SearchList-ShowMoreWrapper button");
      if (showMore && !showMore.disabled) {
        showMore.click();
        await sleep(1200);
      }

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
  // 流程：Home(一次) -> Results(循环改日期)
  // ===========================
  log("START durations:", DURATIONS);

  // ---- Round 1：home 流程（location + date + submit）----
  if (!isResultsPage()) {
    if (!isHomeSearchPage()) {
      log("❌ 你现在既不在 home 搜索页，也不在结果页。请先打开 home 搜索页再跑。");
      return;
    }

    // home 也用同样的日历组件，逻辑一样能点（如果 home 的 Date 入口也叫 CalendarField/date）
    // 若 home 真的是“完全不同”的 date 入口，你再告诉我 home 的按钮文案/选择器，我再分离 home 的 openCalendar。
    const now = new Date();
    const days = DURATIONS[0];
    const pickupDate = addDays(now, 1);
    const dropoffDate = addDays(pickupDate, days);
    const pickupStr = toYMDLocal(pickupDate);
    const dropoffStr = toYMDLocal(dropoffDate);

    log(`Round1 HOME | ${pickupStr} -> ${dropoffStr} | days=${days}`);

    const okLoc = await setLocation(LOCATION_TEXT);
    if (!okLoc) { log("❌ Home: location input not found."); return; }

    // 用同一套强力点（如果 home 的 dateBtn 能被 getDateBtn_results 找到）
    const okDates = await setDatesOnResults(pickupDate, dropoffDate);
    if (!okDates) { log("❌ Home: date select failed."); return; }

    const btn = getHomeSearchButton();
    if (!btn) { log("❌ Home: submit search button not found."); return; }

    log("Click HOME submit search...");
    btn.click();

    const okRes = await waitForResults();
    if (!okRes) { log("❌ Round1: results not loaded."); return; }

    log(`Round1 results loaded. Wait ${RESULT_EXTRA_WAIT_MS/1000}s...`);
    await sleep(RESULT_EXTRA_WAIT_MS);

    log("Round1 scrape...");
    await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });
    log(`Round1 done. rows=${scrapedCars.length}`);
  } else {
    log("Already on results page; will treat current state as round1 done and start loop from day2.");
  }

  // ---- Round 2..N：结果页循环改日期 -> Search Now -> 等15s -> 抓 ----
  for (let i = 1; i < DURATIONS.length; i++) {
    const days = DURATIONS[i];
    if (!isResultsPage()) {
      log("❌ Not on results page; stop loop.");
      break;
    }

    const now = new Date();
    const pickupDate = addDays(now, 1);
    const dropoffDate = addDays(pickupDate, days);
    const pickupStr = toYMDLocal(pickupDate);
    const dropoffStr = toYMDLocal(dropoffDate);

    log(`Round ${i+1}/${DURATIONS.length} RESULTS | ${pickupStr} -> ${dropoffStr} | days=${days}`);

    const okDates = await setDatesOnResults(pickupDate, dropoffDate);
    if (!okDates) { log("Skip: results date select failed."); continue; }

    const okClick = await clickSearchNowOnResults();
    if (!okClick) {
      log("Skip round: cannot click Search Now");
      continue;
    }

    const okRes = await waitForResults();
    if (!okRes) { log("Skip: results not loaded after Search Now."); continue; }

    log(`Wait ${RESULT_EXTRA_WAIT_MS/1000}s...`);
    await sleep(RESULT_EXTRA_WAIT_MS);

    log("Scrape + show more + scroll...");
    await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });

    log(`Round done. total rows=${scrapedCars.length}`);
    window.scrollTo(0, 0);
    await sleep(300);
  }

  // ===========================
  // 导出 CSV
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

  const csv = lines.join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cars_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  log("✅ CSV downloaded. rows=", scrapedCars.length);
})();
