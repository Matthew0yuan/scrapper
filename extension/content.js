// Content script that receives messages from popup and runs the scraper

// Check if we're on an offer page when script loads (for new tab extraction)
// OR if we need to resume scraping after pagination
(async () => {
  console.log('[CONTENT] Content script loaded on:', window.location.href);

  // Check if we need to resume scraping (after pagination)
  try {
    const bgState = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    console.log('[CONTENT] Background state on load:', bgState);

    if (bgState && bgState.active && window.location.href.includes('/search')) {
      console.log('[CONTENT] 🔄 Scraping is active and we\'re on search results page');
      console.log('[CONTENT] 🔄 This might be after pagination - RESUMING SCRAPER');
      console.log('[CONTENT] 🔄 Previously scraped:', bgState.scrapedCars?.length, 'cars');

      // Resume scraping with the existing state from background
      const config = bgState.config || {};
      const location = config.location || "Perth (all locations), Australia";
      const durations = config.durations || [1];
      const targetModels = config.targetModels || [];

      console.log('[CONTENT] 🔄 Resuming with config:', { location, durations, targetModels });
      console.log('[CONTENT] 🔄 Existing scraped cars:', bgState.scrapedCars?.length);
      console.log('[CONTENT] 🔄 Existing seen keys:', bgState.seenKeys?.length);

      // Resume the scraper with existing state
      runScraper(location, durations, targetModels, bgState.scrapedCars || [], bgState.seenKeys || []);

      // Don't continue to offer page extraction logic below
      return;
    }
  } catch (e) {
    console.log('[CONTENT] Could not check background state:', e);
  }

  // Check if this looks like an offer page URL
  if (!window.location.href.includes('/offer/')) {
    console.log('[CONTENT] Not an offer page URL, skipping auto-extraction');
    return;
  }

  console.log('[CONTENT] 🔍 This appears to be an offer page, waiting for content to load...');

  // Wait for the price breakdown element to appear (retry for up to 10 seconds)
  let breakdown = null;
  let attempts = 0;
  const maxAttempts = 20; // 20 attempts * 500ms = 10 seconds max wait

  while (attempts < maxAttempts && !breakdown) {
    breakdown = document.querySelector(".OfferPriceBreakdown");
    if (breakdown) {
      console.log(`[CONTENT] ✅ Found OfferPriceBreakdown element after ${attempts * 0.5}s`);
      break;
    }
    await new Promise(r => setTimeout(r, 500));
    attempts++;
    if (attempts % 4 === 0) { // Log every 2 seconds
      console.log(`[CONTENT] ⏳ Still waiting for OfferPriceBreakdown... (${attempts * 0.5}s)`);
    }
  }

  if (!breakdown) {
    console.log('[CONTENT] ❌ OfferPriceBreakdown not found after 10 seconds');
    console.log('[CONTENT] Page might still be loading, will wait for EXTRACT_OFFER_PAGE message from background...');
    return;
  }

  console.log('[CONTENT] ✅ Detected offer page on load:', window.location.href);

  // This is an offer page, check if scraping is active
  try {
    console.log('[CONTENT] 📡 Sending GET_STATE request to background...');
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    console.log('[CONTENT] 📡 Background state response received:', JSON.stringify(response));
    console.log('[CONTENT] Background state - active:', response?.active);
    console.log('[CONTENT] Background state - config:', response?.config);
    console.log('[CONTENT] Background state - scraped cars count:', response?.scrapedCars?.length);

    if (response && response.active) {
      console.log('[CONTENT] 🚀 Scraping is active, auto-extracting payment data...');
      console.log('[CONTENT] 🔍 Calling extractOfferPageAndReturn()...');
      await extractOfferPageAndReturn();
      console.log('[CONTENT] ✅ Extraction completed');
    } else {
      console.log('[CONTENT] ⚠️ Scraping not active (response.active = false or undefined)');
      console.log('[CONTENT] 💡 Will wait for EXTRACT_OFFER_PAGE message from background...');
    }
  } catch (e) {
    console.log('[CONTENT] ❌ Error with background communication:', e);
    console.log('[CONTENT] ❌ Error name:', e.name);
    console.log('[CONTENT] ❌ Error message:', e.message);
    console.log('[CONTENT] ❌ Error stack:', e.stack);
  }
})();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "RUN_SCRAPER") {
    const { cfg } = msg;

    // Parse configuration
    const location = cfg.location || "Perth (all locations), Australia";
    const durationsStr = cfg.durations || "1,2,3,4,5,6,7,8";
    const modelsStr = cfg.models || "";

    const durations = durationsStr.split(",").map(d => parseInt(d.trim())).filter(n => !isNaN(n));
    // Normalize target models: lowercase + remove spaces
    const targetModels = modelsStr
      ? modelsStr.split(",").map(m => m.trim().toLowerCase().replace(/\s+/g, '')).filter(m => m)
      : [];

    // Tell background worker scraping is starting
    chrome.runtime.sendMessage({
      type: 'START_SCRAPING',
      config: { location, durations, targetModels }
    });

    // Inject and run the scraper with configuration
    runScraper(location, durations, targetModels);

    sendResponse({ ok: true });
    return true;

  } else if (msg.type === "EXTRACT_OFFER_PAGE") {
    // Background worker told us to extract offer page data
    console.log('[CONTENT] Extracting offer page data...');
    // Call the async function and let it complete
    extractOfferPageAndReturn().then(() => {
      console.log('[CONTENT] Extraction complete');
    }).catch(err => {
      console.log('[CONTENT] Extraction error:', err);
    });
    sendResponse({ ok: true });
    return true;

  } else if (msg.type === "CONTINUE_SCRAPING") {
    // Background worker told us to continue scraping after returning from offer page
    console.log('[CONTENT] Back on search page after extraction');
    console.log('[CONTENT] Scraping session completed - payment data has been collected');

    // Get the final state and download CSV
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response && response.scrapedCars && response.scrapedCars.length > 0) {
        console.log(`[CONTENT] Downloaded CSV with ${response.scrapedCars.length} car(s)`);
        downloadCSV(response.scrapedCars);
      }
    });

    sendResponse({ ok: true });
    return true;
  }
});

// Standalone function to extract offer page data and send to background
async function extractOfferPageAndReturn() {
  const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const log = (...a) => console.log("[AUTO]", ...a);

  log("📄 On offer page, extracting payment details...");

  // Wait for the price breakdown element to appear
  let attempts = 0;
  let breakdown = null;
  while (attempts < 10) {
    breakdown = document.querySelector(".OfferPriceBreakdown");
    if (breakdown) break;
    await new Promise(r => setTimeout(r, 800));
    attempts++;
  }

  if (!breakdown) {
    log("  ⚠️ OfferPriceBreakdown element not found after waiting");
    chrome.runtime.sendMessage({
      type: 'STORE_PAYMENT_DATA',
      url: window.location.href,
      paymentData: { payNow: "", payAtPickup: "" }
    });
    return;
  }

  log(`  ✅ Found OfferPriceBreakdown element`);

  let payNow = "";
  let payAtPickup = "";

  // Look for sections within the breakdown
  const payNowSections = Array.from(breakdown.querySelectorAll(".OfferPriceBreakdown-Main"));
  log(`  Found ${payNowSections.length} OfferPriceBreakdown-Main sections`);

  // Debug: log all section headers
  payNowSections.forEach((section, idx) => {
    const header = section.querySelector("p.Typography-weight_bold");
    if (header) {
      log(`  Section ${idx}: "${norm(header.textContent)}"`);
    }
  });

  // Find "Pay now" section
  const payNowSection = payNowSections.find(section => {
    const header = section.querySelector("p.Typography-weight_bold");
    return header && norm(header.textContent).toLowerCase() === "pay now";
  });

  if (payNowSection) {
    // Look for price in the Extra section
    const extraSection = payNowSection.querySelector(".OfferPriceBreakdown-Extra");
    if (extraSection) {
      const priceElements = Array.from(extraSection.querySelectorAll("p.Typography-size_2sm"));
      log(`  Found ${priceElements.length} price elements in Pay now section`);

      // The last p.Typography-size_2sm should be the price
      if (priceElements.length > 0) {
        payNow = norm(priceElements[priceElements.length - 1].textContent);
        log(`  ✅ Found "Pay now": ${payNow}`);
      }
    } else {
      log(`  ⚠️ No Extra section found in Pay now section`);
    }
  } else {
    log(`  ⚠️ Could not find "Pay now" section`);
  }

  // Find "To pay at pick up" section
  const payAtPickupSection = payNowSections.find(section => {
    const header = section.querySelector("p.Typography-weight_bold");
    return header && norm(header.textContent).toLowerCase().includes("to pay at pick");
  });

  if (payAtPickupSection) {
    // Look for price in the Extra section
    const extraSection = payAtPickupSection.querySelector(".OfferPriceBreakdown-Extra");
    if (extraSection) {
      const priceElements = Array.from(extraSection.querySelectorAll("p.Typography-size_2sm"));
      log(`  Found ${priceElements.length} price elements in Pay at pickup section`);

      // The last p.Typography-size_2sm should be the price
      if (priceElements.length > 0) {
        payAtPickup = norm(priceElements[priceElements.length - 1].textContent);
        log(`  ✅ Found "To pay at pick up": ${payAtPickup}`);
      }
    } else {
      log(`  ⚠️ No Extra section found in Pay at pickup section`);
    }
  } else {
    log(`  ⚠️ Could not find "To pay at pick up" section`);
  }

  log(`✅ Extracted: Pay now=${payNow}, Pay at pickup=${payAtPickup}`);

  // Store data in background worker with current URL as key
  log(`📤 Sending data to background for URL: ${window.location.href}`);
  chrome.runtime.sendMessage({
    type: 'STORE_PAYMENT_DATA',
    url: window.location.href,
    paymentData: { payNow, payAtPickup }
  }, (response) => {
    if (response && response.success) {
      log(`✅ Data successfully stored in background!`);
    } else {
      log(`⚠️ Failed to store data in background`);
    }
  });
}

// Function to download CSV with scraped car data
function downloadCSV(scrapedCars) {
  function csvEscape(value) {
    const str = String(value == null ? "" : value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  if (!scrapedCars || scrapedCars.length === 0) {
    console.log("[AUTO] No data to download");
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
    "category_group",
    "view_deal_url",
    "pay_now",
    "pay_at_pickup"
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
      csvEscape(r.view_deal_url),
      csvEscape(r.pay_now),
      csvEscape(r.pay_at_pickup)
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

  console.log("[AUTO] ✅ CSV downloaded. Total rows:", scrapedCars.length);
}

function runScraper(LOCATION_TEXT, DURATIONS, TARGET_MODELS, existingCars = [], existingKeys = []) {
  (async () => {
    // ===========================
    // Configuration
    // ===========================
    const RESULT_EXTRA_WAIT_MS = 15000;
    const SCROLL_STEP = 650;
    const SCAN_INTERVAL_MS = 500;
    const MAX_IDLE_ROUNDS = 20;
    const BUTTON_WAIT_TIMEOUT_MS = 15000;
    const PANEL_WAIT_TIMEOUT_MS = 15000;

    const CATEGORY_RULES = [
      { code: "EDAR",  group: "Picanto, Rio & MG3",                  keywords: ["picanto", "rio", "mg3"] },
      { code: "IDAR",  group: "Cerato Hatch",                        keywords: ["cerato hatch"] },
      { code: "SEDAN", group: "Cerato, MG5, i30",                    keywords: ["cerato", "mg5", "i30"] },
      { code: "CFAR",  group: "Jolion & ZS",                         keywords: ["jolion", "zs"] },
      { code: "IFAR",  group: "Tuscon & Sportage & CX5",             keywords: ["tuscon", "tucson", "sportage", "cx5"] },
      { code: "FFAR",  group: "Xtrail & Outlander",                  keywords: ["xtrail", "x-trail", "outlander"] },
      { code: "SVAR",  group: "Carnival",                            keywords: ["carnival"] },
    ];

    const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

    // ===========================
    // Utilities
    // ===========================
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
    const log = (...a) => console.log("[AUTO]", ...a);

    function pad2(n) {
      return String(n).padStart(2, "0");
    }

    function toYMDLocal(d) {
      return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    }

    function addDays(d, n) {
      const d2 = new Date(d.getTime());
      d2.setDate(d2.getDate() + n);
      return d2;
    }

    function csvEscape(value) {
      if (value == null) return '""';
      return `"${String(value).replace(/"/g, '""')}"`;
    }

    function round2(n) {
      if (!Number.isFinite(n)) return "";
      return Math.round(n * 100) / 100;
    }

    function findByText(textIncludes, scope = document) {
      const want = String(textIncludes || "").toLowerCase();
      const nodes = Array.from(scope.querySelectorAll("button,a,[role='button'],div,span,label"));
      return nodes.find(el => norm(el.textContent).toLowerCase().includes(want)) || null;
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

    function inViewport(el) {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      return r.width > 5 && r.height > 5 && r.bottom > 0 && r.right > 0 && r.left < vw && r.top < vh;
    }

    // ===========================
    // Page State Detection
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
    // Price & Model Classification
    // ===========================
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

    function classifyModel(baseName, fullName) {
      const text = (baseName || fullName || "").toLowerCase();
      for (const rule of CATEGORY_RULES) {
        if (rule.keywords.some(k => text.includes(k))) {
          return { category_code: rule.code, category_group: rule.group };
        }
      }
      return { category_code: "", category_group: "" };
    }

    // ===========================
    // Click Helpers
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
      } catch (e) {
        log(`⚠️ PointerEvent error: ${e.message}`);
      }
    }

    async function humanClick(el) {
      if (!el) return false;

      // Scroll into view smoothly
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      await sleep(300 + Math.random() * 200); // Random delay 300-500ms

      const r = el.getBoundingClientRect();
      // Add slight randomness to click position (not exactly center)
      const x = r.left + r.width / 2 + (Math.random() - 0.5) * 10;
      const y = r.top + r.height / 2 + (Math.random() - 0.5) * 10;

      const top = document.elementFromPoint(x, y);
      if (top && !(top === el || el.contains(top))) {
        const btn = top.closest("button");
        if (btn) el = btn;
      }

      // Simulate mouse movement (mouseover)
      dispatchMouse(el, "mouseover", x, y);
      dispatchMouse(el, "mouseenter", x, y);
      await sleep(50 + Math.random() * 100); // Random 50-150ms

      // Mouse down
      dispatchPointer(el, "pointerdown", x, y);
      dispatchMouse(el, "mousedown", x, y);
      await sleep(80 + Math.random() * 70); // Random 80-150ms (human click duration)

      // Mouse up
      dispatchPointer(el, "pointerup", x, y);
      dispatchMouse(el, "mouseup", x, y);

      // Final click
      el.click();

      return true;
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

    async function waitForButtonEnabled(btn, timeoutMs = BUTTON_WAIT_TIMEOUT_MS) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (!isButtonDisabled(btn)) return true;
        await sleep(200);
      }
      return false;
    }

    // ===========================
    // Home Page Actions
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
        input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      } catch (e) {
        log(`⚠️ Keyboard event error: ${e.message}`);
      }

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
    // Results Page - Search Now Button
    // ===========================
    async function clickSearchNowOnResults() {
      const btn =
        document.querySelector("button.SearchModifier-SubmitBtn") ||
        document.querySelector("button.Button.Button_Search.SearchModifier-SubmitBtn") ||
        Array.from(document.querySelectorAll("button"))
          .find(b => /search now/i.test(norm(b.textContent)));

      if (!btn) {
        log("❌ Search Now button not found");
        return false;
      }

      const enabled = await waitForButtonEnabled(btn);
      if (!enabled) {
        log("⚠️ Search Now button still disabled after waiting");
      }

      strongClick(btn);
      log("✅ Clicked Search Now");
      return true;
    }

    // ===========================
    // Date Picker Handling
    // ===========================
    function getPanel() {
      return document.querySelector(".rdrCalendarWrapper.rdrDateRangeWrapper")
        || document.querySelector(".rdrDateRangeWrapper")
        || document.querySelector(".rdrDateRangePickerWrapper")
        || document.querySelector(".rdrMonths");
    }

    async function waitPanel(timeoutMs = PANEL_WAIT_TIMEOUT_MS) {
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

    function distToPanelCenter(el, panel) {
      const pr = panel.getBoundingClientRect();
      const cx = pr.left + pr.width / 2;
      const cy = pr.top + pr.height / 2;

      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function parseMonthYear(text) {
      const t = norm(text).toLowerCase();
      const mName = MONTHS.find(m => t.includes(m));
      const yMatch = t.match(/\b(20\d{2})\b/);
      if (!mName || !yMatch) return null;
      return { y: Number(yMatch[1]), m: MONTHS.indexOf(mName) };
    }

    function cmpYM(a, b) {
      if (a.y !== b.y) return a.y - b.y;
      return a.m - b.m;
    }

    function getNavButtons(panel) {
      const root = panel.closest(".rdrDateRangeWrapper") || panel || document;

      // Debug: log all buttons found in the panel
      const allButtons = Array.from(root.querySelectorAll("button"));
      log(`  🔍 DEBUG: Found ${allButtons.length} total buttons in calendar panel`);
      allButtons.slice(0, 10).forEach((btn, i) => {
        log(`  🔍 Button ${i}: class="${btn.className}" aria-label="${btn.getAttribute('aria-label')}" text="${norm(btn.textContent).substring(0, 20)}"`);
      });

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

      log(`  🔍 DEBUG: Next button found: ${!!next}, Prev button found: ${!!prev}`);

      return { next, prev };
    }

    function getMonthEls(panel) {
      return Array.from(panel.querySelectorAll(".rdrMonth"));
    }

    function getMonthNameEl(monthEl) {
      return monthEl.querySelector(".rdrMonthName")
        || monthEl.querySelector("[class*='MonthName' i]")
        || monthEl.querySelector("[class*='month' i]");
    }

    function findMonthElForDate(panel, date) {
      const target = { y: date.getFullYear(), m: date.getMonth() };
      const months = getMonthEls(panel);
      for (const me of months) {
        const nameEl = getMonthNameEl(me);
        const info = nameEl ? parseMonthYear(nameEl.textContent) : null;
        if (info && info.y === target.y && info.m === target.m) return me;
      }
      return null;
    }

    async function ensureMonthVisible(panel, date, maxTurns = 14) {
      const target = { y: date.getFullYear(), m: date.getMonth() };

      for (let k = 0; k < maxTurns; k++) {
        const hit = findMonthElForDate(panel, date);
        if (hit) return hit;

        const months = getMonthEls(panel);
        const firstNameEl = months[0] ? getMonthNameEl(months[0]) : null;
        const firstInfo = firstNameEl ? parseMonthYear(firstNameEl.textContent) : null;

        const { next, prev } = getNavButtons(panel);

        let goNext = true;
        if (firstInfo) {
          goNext = cmpYM(firstInfo, target) < 0;
        }

        const btn = goNext ? next : prev;
        if (!btn) {
          log("❌ Cannot find month navigation buttons");
          return null;
        }

        strongClick(btn);
        await sleep(350);
        panel = getPanel() || panel;
      }

      log("❌ Month not visible after turning pages");
      return null;
    }

    function getDayButtonsForDate(panel, monthEl, date) {
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

    async function clickDateWithVerification(panel, date) {
      const monthEl = await ensureMonthVisible(panel, date);
      if (!monthEl) return false;

      const before = getDisplayValues(getPanel() || panel).vals.join(" | ");
      const buttons = getDayButtonsForDate(panel, monthEl, date);

      log(`Try date=${toYMDLocal(date)} candidates=${buttons.length}`);

      for (let i = 0; i < Math.min(buttons.length, 12); i++) {
        const btn = buttons[i];
        if (isDisabled(btn)) continue;

        strongClick(btn);
        await sleep(350);

        const p2 = getPanel() || panel;
        const after = getDisplayValues(p2).vals.join(" | ");
        if (after && after !== before) {
          log(`✅ Clicked date=${toYMDLocal(date)}`);
          return true;
        }
      }

      log(`❌ Date click failed: ${toYMDLocal(date)}`);
      return false;
    }

    async function clickApplySelectDatesIfPresent(panel) {
      const dialog = panel.closest("[role='dialog']") || document;

      const buttons = Array.from(dialog.querySelectorAll("button"))
        .filter(b => /select\s*dates?/i.test(norm(b.textContent)))
        .filter(b => !isButtonDisabled(b) && inViewport(b));

      if (!buttons.length) return false;

      buttons.sort((a, c) => {
        const ra = a.getBoundingClientRect();
        const rc = c.getBoundingClientRect();
        const sa = ra.top * 10 + ra.width;
        const sc = rc.top * 10 + rc.width;
        return sc - sa;
      });

      const btn = buttons[0];
      log("Clicking 'Select dates'...");
      strongClick(btn);

      const start = Date.now();
      while (Date.now() - start < 8000) {
        if (!getPanel()) return true;
        await sleep(200);
      }
      return true;
    }

    async function setDatesOnResults(pickupDate, dropoffDate) {
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true }));
      } catch (e) {
        log(`⚠️ Escape key error: ${e.message}`);
      }
      await sleep(200);

      const dateBtn = document.querySelector(".DatePicker-CalendarField")
        || document.querySelector("[class*='CalendarField' i]")
        || findByText("date");

      if (dateBtn) {
        log("Opening date picker...");
        strongClick(dateBtn);
        await sleep(600);

        const sel = findByText("select dates") || findByText("select date");
        if (sel) {
          strongClick(sel);
          await sleep(800);
        }
      }

      let panel = await waitPanel();
      if (!panel) {
        log("❌ Calendar panel not found");
        return false;
      }

      log("✅ Calendar panel found");

      const ok1 = await clickDateWithVerification(panel, pickupDate);
      await sleep(400);

      panel = getPanel() || panel;
      const ok2 = await clickDateWithVerification(panel, dropoffDate);

      const finalPanel = getPanel() || panel;
      if (finalPanel) {
        await clickApplySelectDatesIfPresent(finalPanel);
      }

      return ok1 && ok2;
    }

    // ===========================
    // Car Scraping
    // ===========================
    // Initialize with existing state if resuming, otherwise start fresh
    const scrapedCars = existingCars.length > 0 ? [...existingCars] : [];
    const seenKeys = new Set(existingKeys.length > 0 ? existingKeys : []);

    // Flag to stop all scraping when navigating to offer page
    let shouldStop = false;

    function extractNames(card) {
      // Try multiple selectors for car name
      let nameEl = card.querySelector(".SearchCar-CarName h4") ||
                   card.querySelector(".CarTitle-Name") ||
                   card.querySelector(".SearchCar-CarName") ||
                   card.querySelector("[class*='CarName']");

      if (!nameEl) {
        log("⚠️ Could not find car name element in card");
        return { fullName: "", baseName: "" };
      }

      const fullName = norm(nameEl.textContent);
      let baseName = "";
      nameEl.childNodes.forEach(n => {
        if (n.nodeType === Node.TEXT_NODE) baseName += n.textContent;
      });
      baseName = norm(baseName) || fullName;

      log(`Found car: ${fullName}`);
      return { fullName, baseName };
    }

    function parseCarCard(card, meta) {
      const { fullName, baseName } = extractNames(card);
      if (!fullName) return null;

      if (TARGET_MODELS.length > 0) {
        // Normalize: lowercase + remove all spaces
        const normalizedName = fullName.toLowerCase().replace(/\s+/g, '');
        const hit = TARGET_MODELS.find(m => {
          const normalizedModel = m.toLowerCase().replace(/\s+/g, '');
          return normalizedName.includes(normalizedModel);
        });
        if (!hit) {
          log(`  ⏭️ Skipping ${fullName} (not in target models: ${TARGET_MODELS.join(', ')})`);
          return null;
        }
        log(`  ✅ Match found! ${fullName} matches target: ${hit}`);
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

      const viewDealLink = card.querySelector(".SearchCar-CtaBtn, a[href*='/offer/']");
      const viewDealUrl = viewDealLink ? viewDealLink.getAttribute("href") : "";

      // Create unique key to check for duplicates BEFORE adding
      const key = `${baseName}|${company}|${priceValue}|${meta.pickup_date}|${meta.dropoff_date}|${category_code}`;

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
        category_group,
        view_deal_url: viewDealUrl,
        pay_now: "",
        pay_at_pickup: "",
        _uniqueKey: key // Store key for deduplication
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
      // Detect current page number from URL or pagination buttons
      let pageNumber = 1;
      try {
        const urlObj = new URL(window.location.href);
        const pageParam = urlObj.searchParams.get('page');
        if (pageParam) {
          pageNumber = parseInt(pageParam);
          log(`📍 Detected page number from URL: ${pageNumber}`);
        } else {
          // Try to detect from active pagination button
          const activeBtn = document.querySelector(".Pagination-Button_isActive");
          if (activeBtn) {
            const activePage = parseInt(activeBtn.textContent.trim());
            if (!isNaN(activePage)) {
              pageNumber = activePage;
              log(`📍 Detected page number from pagination button: ${pageNumber}`);
            }
          }
        }
      } catch (e) {
        log(`⚠️ Could not detect page number: ${e.message}`);
      }

      while (true) {
        log(`Scraping page ${pageNumber}...`);
        let lastHeight = 0;
        let lastCount = scrapedCars.length;
        let idle = 0;

        while (idle < MAX_IDLE_ROUNDS) {
          log(`  🔄 Scroll iteration: idle=${idle}/${MAX_IDLE_ROUNDS}, cars so far=${scrapedCars.length}`);

          // Check if we should stop (navigating to offer page)
          if (shouldStop) {
            log("🛑 Stopping scraping - navigating to offer page");
            return;
          }

          const showMore =
            document.querySelector(".SearchList-ShowMoreWrapper .SearchList-ShowMore") ||
            document.querySelector(".SearchList-ShowMoreWrapper button");
          if (showMore && !showMore.disabled) {
            log(`  🔘 Clicking "Show More" button`);
            showMore.click();
            await sleep(1200);
          }

          const cards = getVisibleCards();
          log(`  📋 Found ${cards.length} car cards on page`);
          for (const c of cards) {
            const info = parseCarCard(c, meta);
            if (info) {
              log(`  ✅ Parsed target vehicle: ${info.car_name_base}`);
              // Check if already processed (by company + price + dates)
              if (seenKeys.has(info._uniqueKey)) {
                log(`  🔁 Already processed: ${info.car_name_base} (${info.company} - $${info.price_value})`);
                continue; // Skip this car entirely
              }

              // Mark as seen BEFORE clicking to avoid reprocessing on page reload
              seenKeys.add(info._uniqueKey);

              // If info exists, it's already a target vehicle (filtered by parseCarCard)
              // Open offer page in new tab to extract payment details
              const viewDealBtn = c.querySelector(".SearchCar-CtaBtn, a[href*='/offer/']");
              if (viewDealBtn) {
                const offerUrl = viewDealBtn.href;
                log(`🎯 Target vehicle found: ${info.car_name_base}, opening in new tab...`);
                log(`  🔗 Offer URL: ${offerUrl}`);
                log(`  🔍 View Deal Button element:`, viewDealBtn);

                try {
                  // Open in new tab
                  log(`  🚀 Attempting to open new tab with window.open()...`);
                  const newTab = window.open(offerUrl, '_blank');
                  log(`  🔍 window.open() returned:`, newTab);

                  if (newTab) {
                    log(`  ✅ New tab opened successfully!`);
                    log(`  📋 Offer URL: ${offerUrl}`);
                    log(`  📄 Current page number: ${pageNumber}`);
                    log(`  🔔 Telling background to track this tab...`);

                    // Tell background to track this tab for extraction
                    await new Promise((resolve) => {
                      chrome.runtime.sendMessage({
                        type: 'TRACK_NEW_TAB',
                        offerUrl: offerUrl
                      }, (response) => {
                        log(`  ✅ Background acknowledged tracking`);
                        resolve(response);
                      });
                    });

                    // Wait 5-7 seconds for new tab to load and extract (random for human-like behavior)
                    const waitTime = 5000 + Math.random() * 2000; // 5000ms to 7000ms
                    log(`  ⏳ Waiting ${(waitTime / 1000).toFixed(1)}s for new tab to load and extract...`);
                    await sleep(waitTime);

                    // Poll for payment data with retries (check every 2s for up to 20s)
                    let paymentData = null;
                    let attempts = 0;
                    const maxAttempts = 10; // 10 attempts * 2s = 20s max wait
                    let gotData = false; // Track if we actually got meaningful data

                    log(`  ⏳ Starting to poll for payment data...`);
                    log(`  🔍 Looking for URL: ${offerUrl}`);

                    while (attempts < maxAttempts && !gotData) {
                      await sleep(2000);
                      attempts++;

                      log(`  📡 Attempt ${attempts}/${maxAttempts}: Checking background cache...`);

                      paymentData = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({ type: 'GET_PAYMENT_DATA', offerUrl }, (response) => {
                          if (response && (response.payNow || response.payAtPickup)) {
                            log(`  🎉 Background returned data: ${JSON.stringify(response)}`);
                          } else {
                            log(`  ⏸️ No data yet in background cache`);
                          }
                          resolve(response);
                        });
                      });

                      // Check if we got meaningful data (not just empty strings)
                      if (paymentData && (paymentData.payNow || paymentData.payAtPickup)) {
                        gotData = true; // Mark that we got real data
                        info.pay_now = paymentData.payNow;
                        info.pay_at_pickup = paymentData.payAtPickup;
                        log(`  ✅✅✅ SUCCESS! Got payment data:`);
                        log(`      💰 Pay now: ${paymentData.payNow}`);
                        log(`      💰 Pay at pickup: ${paymentData.payAtPickup}`);
                        break;
                      } else {
                        log(`  ⏳ No data yet, will retry... (${maxAttempts - attempts} attempts remaining)`);
                      }
                    }

                    if (!paymentData || (!paymentData.payNow && !paymentData.payAtPickup)) {
                      log(`  ❌ FAILED: No payment data received after ${attempts} attempts`);
                      log(`  ❌ The new tab may not have extracted or stored the data`);
                    }

                    log(`  ⏳ Keeping tab open for 10 seconds for debugging...`);
                    await sleep(10000);

                    // Close the new tab
                    try {
                      newTab.close();
                      log(`  ✅ Tab closed, continuing scraping...`);
                    } catch (e) {
                      log(`  ⚠️ Could not close tab: ${e.message}`);
                    }

                    await sleep(2000);
                  } else {
                    log(`  ⚠️ Failed to open new tab (popup blocked?)`);
                  }
                } catch (e) {
                  log(`  ⚠️ Error opening/processing new tab: ${e.message}`);
                }

              } else {
                log(`  ⚠️ View Deal button not found for ${info.car_name_base}`);
              }

              // If no offer page, just add what we have
              scrapedCars.push(info);

              // Update background state with new car and seen key
              chrome.runtime.sendMessage({
                type: 'UPDATE_STATE',
                scrapedCars: scrapedCars,
                seenKeys: Array.from(seenKeys)
              });
            }
          }

          const h = document.body.scrollHeight;
          const count = scrapedCars.length;

          if (h > lastHeight || count > lastCount) {
            log(`  📊 Progress detected: height ${lastHeight}→${h}, cars ${lastCount}→${count}, resetting idle counter`);
            idle = 0;
            lastHeight = h;
            lastCount = count;
          } else {
            idle++;
            log(`  ⏸️ No progress: idle=${idle}/${MAX_IDLE_ROUNDS}`);
          }

          window.scrollBy(0, SCROLL_STEP);
          await sleep(SCAN_INTERVAL_MS);
        }

        log(`🏁 Scroll loop completed after ${idle} idle rounds`);

        // Check if we should stop before pagination
        if (shouldStop) {
          log("🛑 Stopping scraping - navigating to offer page");
          return;
        }

        log(`Page ${pageNumber} done. Total cars: ${scrapedCars.length}`);

        // Scroll to bottom to ensure pagination buttons are visible
        log(`📜 Scrolling to bottom to find pagination buttons...`);
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(1000); // Wait for pagination to render

        // Find the next arrow button using the selector that works
        log(`🔍 Looking for next page arrow button...`);
        const selector =
          'button[aria-label="Next page"].Pagination-NavigationButton_next, ' +
          'button[aria-label="Next page"]';

        let targetPageBtn = document.querySelector(selector);

        if (!targetPageBtn) {
          log("⚠️ Next arrow button not found at bottom, trying to scroll to pagination container...");
          // Try to find and scroll to pagination container
          const paginationContainer = document.querySelector(".Pagination");
          if (paginationContainer) {
            paginationContainer.scrollIntoView({ block: "center", behavior: "smooth" });
            await sleep(1000);
            targetPageBtn = document.querySelector(selector);
          }
        }

        if (!targetPageBtn) {
          log("❌ Next arrow button not found after scrolling!");
          break;
        }

        log(`  ✅ Found next arrow button`);
        log(`  Button element:`, targetPageBtn);
        log(`  Button HTML: ${targetPageBtn.outerHTML.substring(0, 200)}`);
        log(`  Button disabled: ${targetPageBtn.disabled}`);
        log(`  Button aria-disabled: ${targetPageBtn.getAttribute('aria-disabled')}`);

        if (targetPageBtn.disabled || targetPageBtn.getAttribute('aria-disabled') === 'true') {
          log("✅ No more pages. Next button is disabled.");
          break;
        }

        const targetPageNumber = pageNumber + 1;
        log(`➡️ Clicking next arrow button to go to page ${targetPageNumber}...`);

        // Store current page state before clicking
        const beforeUrl = window.location.href;
        const currentActiveBtn = document.querySelector(".Pagination-Button_isActive");
        const currentActivePage = currentActiveBtn ? currentActiveBtn.textContent.trim() : "unknown";
        const currentCardsHTML = document.querySelector(".SearchResultsContainer")?.innerHTML || "";

        log(`  📊 Current page state:`);
        log(`    URL: ${beforeUrl}`);
        log(`    Active page button: ${currentActivePage}`);
        log(`    Cards HTML length: ${currentCardsHTML.length}`);

        window.scrollTo(0, 0);
        await sleep(500);

        // Try multiple click strategies
        log(`  Attempting to navigate to next page...`);
        log(`  💡 TIP: Look away from the tab or switch to another tab - site may block clicks when tab is visible!`);

        // Strategy 1: Check if URL has page parameter we can increment
        const urlObj = new URL(beforeUrl);
        const pageParam = urlObj.searchParams.get('page');

        if (pageParam) {
          // URL has a page parameter, we can increment it directly
          const nextPageNum = parseInt(pageParam) + 1;
          urlObj.searchParams.set('page', nextPageNum.toString());
          const nextPageUrl = urlObj.toString();
          log(`  📍 Strategy: URL manipulation (page param ${pageParam} -> ${nextPageNum})`);
          log(`  📍 Navigating to: ${nextPageUrl}`);
          window.location.href = nextPageUrl;

          // Wait for navigation to complete
          await sleep(3000);
        } else {
          // No page parameter, try clicking the button
          log(`  📍 Strategy: Click button (no page param in URL)`);

          // ANTI-BOT WORKAROUND: Site blocks clicks when tab is visible
          // Wait a bit to let user naturally look away or switch tabs
          log(`  ⏸️ Waiting 2 seconds (website blocks clicks when you're looking at the tab)...`);
          await sleep(2000);

          log(`  🖱️ Clicking now (look away from tab!)...`);

          // Scroll button into view first - use instant behavior like working script
          targetPageBtn.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
          await sleep(500);

          // Try focus first
          try {
            targetPageBtn.focus();
            await sleep(100);
          } catch (e) {
            log(`  ⚠️ Focus failed: ${e.message}`);
          }

          // Use strongClick
          strongClick(targetPageBtn);

          // Also try native click as backup
          await sleep(200);
          try {
            targetPageBtn.click();
            log(`  ✅ Native .click() called`);
          } catch (e) {
            log(`  ⚠️ Native click failed: ${e.message}`);
          }
        }

        log(`  Waiting for page change...`);

        // Wait for actual page change with timeout
        let pageChanged = false;
        let attempts = 0;
        const maxAttempts = 10; // 10 attempts * 1 second = 10 seconds max wait

        while (attempts < maxAttempts && !pageChanged) {
          await sleep(1000);
          attempts++;

          const newUrl = window.location.href;
          const newActiveBtn = document.querySelector(".Pagination-Button_isActive");
          const newActivePage = newActiveBtn ? newActiveBtn.textContent.trim() : "unknown";
          const newCardsHTML = document.querySelector(".SearchResultsContainer")?.innerHTML || "";

          // Check if page actually changed
          if (newUrl !== beforeUrl ||
              newActivePage !== currentActivePage ||
              newCardsHTML !== currentCardsHTML) {
            pageChanged = true;
            log(`  ✅ Page changed detected after ${attempts} seconds!`);
            log(`    New URL: ${newUrl}`);
            log(`    New active page: ${newActivePage}`);
            log(`    Cards HTML length: ${newCardsHTML.length}`);
          } else {
            log(`  ⏳ Attempt ${attempts}/${maxAttempts}: No change yet...`);
          }
        }

        if (!pageChanged) {
          log(`  ❌ WARNING: No page change detected after ${maxAttempts} seconds!`);
          log(`  ⚠️ This might indicate pagination isn't working. Trying to continue anyway...`);
        }

        // Extra wait for content to fully load
        await sleep(2000);

        pageNumber++;
        log(`📄 Now on page ${pageNumber}`);
      }
    }

    // ===========================
    // Main Flow
    // ===========================
    log("START durations:", DURATIONS);
    log("TARGET_MODELS:", TARGET_MODELS);
    log("LOCATION:", LOCATION_TEXT);

    // Round 1: Home page flow
    if (!isResultsPage()) {
      if (!isHomeSearchPage()) {
        log("❌ Not on home search page or results page. Please navigate to the search page first.");
        return;
      }

      const now = new Date();
      const days = DURATIONS[0];
      const pickupDate = addDays(now, 1);
      const dropoffDate = addDays(pickupDate, days);
      const pickupStr = toYMDLocal(pickupDate);
      const dropoffStr = toYMDLocal(dropoffDate);

      log(`Round 1 HOME | ${pickupStr} -> ${dropoffStr} | days=${days}`);

      const okLoc = await setLocation(LOCATION_TEXT);
      if (!okLoc) {
        log("❌ Home: location input not found.");
        return;
      }

      const okDates = await setDatesOnResults(pickupDate, dropoffDate);
      if (!okDates) {
        log("❌ Home: date select failed.");
        return;
      }

      const btn = getHomeSearchButton();
      if (!btn) {
        log("❌ Home: submit search button not found.");
        return;
      }

      log("Waiting for search button to be enabled...");
      await waitForButtonEnabled(btn, 10000);

      log("Click HOME submit search...");
      strongClick(btn);

      const okRes = await waitForResults();
      if (!okRes) {
        log("❌ Round 1: results not loaded.");
        return;
      }

      log(`Round 1 results loaded. Waiting ${RESULT_EXTRA_WAIT_MS/1000}s...`);
      await sleep(RESULT_EXTRA_WAIT_MS);

      log("Round 1 scraping...");
      await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });

      // Check if we should stop after Round 1
      if (shouldStop) {
        log("🛑 Stopping all rounds - navigating to offer page");
        return;
      }

      log(`Round 1 done. Total rows: ${scrapedCars.length}`);
    } else {
      log("Already on results page; starting from round 2.");
    }

    // Rounds 2..N: Results page date changes
    for (let i = 1; i < DURATIONS.length; i++) {
      // Check if we should stop before starting new round
      if (shouldStop) {
        log("🛑 Stopping all rounds - navigating to offer page");
        return;
      }

      const days = DURATIONS[i];
      if (!isResultsPage()) {
        log("❌ Not on results page; stopping loop.");
        break;
      }

      const now = new Date();
      const pickupDate = addDays(now, 1);
      const dropoffDate = addDays(pickupDate, days);
      const pickupStr = toYMDLocal(pickupDate);
      const dropoffStr = toYMDLocal(dropoffDate);

      log(`Round ${i+1}/${DURATIONS.length} RESULTS | ${pickupStr} -> ${dropoffStr} | days=${days}`);

      const okDates = await setDatesOnResults(pickupDate, dropoffDate);
      if (!okDates) {
        log("⚠️ Skipping: date select failed.");
        continue;
      }

      const okClick = await clickSearchNowOnResults();
      if (!okClick) {
        log("⚠️ Skipping: cannot click Search Now");
        continue;
      }

      const okRes = await waitForResults();
      if (!okRes) {
        log("⚠️ Skipping: results not loaded after Search Now.");
        continue;
      }

      log(`Waiting ${RESULT_EXTRA_WAIT_MS/1000}s...`);
      await sleep(RESULT_EXTRA_WAIT_MS);

      log("Scraping...");
      await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });

      // Check if we should stop after this round
      if (shouldStop) {
        log("🛑 Stopping all rounds - navigating to offer page");
        return;
      }

      log(`Round ${i+1} done. Total rows: ${scrapedCars.length}`);
      window.scrollTo(0, 0);
      await sleep(300);
    }

    // ===========================
    // Export CSV
    // ===========================
    if (!scrapedCars.length) {
      log("No data collected. Stopping.");
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
      "category_group",
      "view_deal_url",
      "pay_now",
      "pay_at_pickup"
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
        csvEscape(r.view_deal_url),
        csvEscape(r.pay_now),
        csvEscape(r.pay_at_pickup)
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

    log("✅ CSV downloaded. Total rows:", scrapedCars.length);
  })();
}
