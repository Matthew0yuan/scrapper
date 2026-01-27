// DiscoveryCars-specific content script
// This file contains ONLY DiscoveryCars scraping logic

(function() {
  'use strict';

  const SITE_NAME = 'discoverycars';

  console.log(`[${SITE_NAME.toUpperCase()}] Content script loaded`);

  // ===========================
  // Message Listener
  // ===========================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "RUN_SCRAPER" && msg.site === SITE_NAME) {
      const { cfg } = msg;

      const location = cfg.location || "Perth (all locations), Australia";
      const durationsStr = cfg.durations || "1,2,3,4,5,6,7,8";
      const modelsStr = cfg.models || "";
      const maxPerDate = parseInt(cfg.maxPerDate) || 30;

      const durations = durationsStr.split(",").map(d => parseInt(d.trim())).filter(n => !isNaN(n));
      const targetModels = modelsStr
        ? modelsStr.split(",").map(m => m.trim().toLowerCase().replace(/\s+/g, '')).filter(m => m)
        : [];

      // Tell background worker scraping is starting
      chrome.runtime.sendMessage({
        type: 'START_SCRAPING',
        config: {
          site: SITE_NAME,
          location,
          durations,
          targetModels,
          maxPerDate
        }
      }, () => {
        console.log(`[${SITE_NAME.toUpperCase()}] Background worker notified of scraping start`);
      });

      // Run the scraper
      runScraper(location, durations, targetModels, [], [], maxPerDate);

      sendResponse({ ok: true });
      return true;
    }
  });

  // ===========================
  // Offer Page Auto-Extraction
  // ===========================
  (async () => {
    // Check if we're on an offer page
    if (!window.location.href.includes('/offer/')) {
      console.log(`[${SITE_NAME.toUpperCase()}] Not an offer page, skipping auto-extraction`);
      return;
    }

    console.log(`[${SITE_NAME.toUpperCase()}] Detected offer page, waiting for content...`);

    // Wait for the price breakdown element
    let breakdown = null;
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts && !breakdown) {
      breakdown = document.querySelector(".OfferPriceBreakdown");
      if (breakdown) break;
      await new Promise(r => setTimeout(r, 500));
      attempts++;
    }

    if (!breakdown) {
      console.log(`[${SITE_NAME.toUpperCase()}] Price breakdown not found`);
      return;
    }

    // Check if scraping is active
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (response && response.active) {
      console.log(`[${SITE_NAME.toUpperCase()}] Auto-extracting payment data...`);
      await extractOfferPageAndReturn();
    }
  })();

  // ===========================
  // Offer Page Extraction
  // ===========================
  async function extractOfferPageAndReturn() {
    const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
    const log = (...a) => console.log(`[${SITE_NAME.toUpperCase()}]`, ...a);

    log("📄 Extracting offer page payment details...");

    let attempts = 0;
    let breakdown = null;
    while (attempts < 10) {
      breakdown = document.querySelector(".OfferPriceBreakdown");
      if (breakdown) break;
      await new Promise(r => setTimeout(r, 800));
      attempts++;
    }

    if (!breakdown) {
      log("❌ OfferPriceBreakdown not found");
      return;
    }

    log("✅ Found OfferPriceBreakdown");

    const mainPayment = breakdown.querySelector(".OfferPriceBreakdown-Main");
    const payNowLabel = Array.from(breakdown.querySelectorAll(".Typography-size_2sm"))
      .find(el => /pay\s*now/i.test(norm(el.textContent)));
    let payNow = "";
    if (payNowLabel && mainPayment) {
      const allPrices = Array.from(mainPayment.querySelectorAll(".Typography-size_2sm"));
      const idx = allPrices.indexOf(payNowLabel);
      if (idx >= 0 && idx + 1 < allPrices.length) {
        payNow = norm(allPrices[idx + 1].textContent);
        log(`✅ Found "Pay now": ${payNow}`);
      }
    }

    const payAtPickupLabel = Array.from(breakdown.querySelectorAll(".Typography-size_2sm"))
      .find(el => /pay\s*at\s*pick/i.test(norm(el.textContent)));
    let payAtPickup = "";
    if (payAtPickupLabel) {
      const parent = payAtPickupLabel.closest("tr, div");
      if (parent) {
        const prices = Array.from(parent.querySelectorAll(".Typography-size_2sm"));
        const idx = prices.indexOf(payAtPickupLabel);
        if (idx >= 0 && idx + 1 < prices.length) {
          payAtPickup = norm(prices[idx + 1].textContent);
          log(`✅ Found "Pay at pickup": ${payAtPickup}`);
        }
      }
    }

    log(`Payment data extracted: Pay now=${payNow}, Pay at pickup=${payAtPickup}`);

    // Store in background
    chrome.runtime.sendMessage({
      type: 'STORE_PAYMENT_DATA',
      url: window.location.href,
      paymentData: { payNow, payAtPickup }
    }, (response) => {
      if (response && response.success) {
        log("✅ Data stored in background");
      }
    });
  }

  // ===========================
  // Main Scraper Function
  // ===========================
  async function runScraper(LOCATION_TEXT, DURATIONS, TARGET_MODELS, existingCars, existingKeys, MAX_PER_DATE) {
    const log = (...a) => console.log(`[${SITE_NAME.toUpperCase()}]`, ...a);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
    const round2 = (n) => Math.round(n * 100) / 100;

    // Configuration constants
    const SCROLL_STEP = 600;
    const SCAN_INTERVAL_MS = 800;
    const MAX_IDLE_ROUNDS = 5;
    const PANEL_WAIT_TIMEOUT_MS = 8000;
    const RESULT_EXTRA_WAIT_MS = 3000;

    // Initialize state
    const scrapedCars = existingCars.length > 0 ? [...existingCars] : [];
    const seenKeys = new Set(existingKeys.length > 0 ? existingKeys : []);

    // ===========================
    // Utility Functions
    // ===========================
    function toYMDLocal(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }

    function addDays(d, n) {
      const out = new Date(d);
      out.setDate(out.getDate() + n);
      return out;
    }

    function classifyModel(baseName, fullName) {
      const lowerBase = baseName.toLowerCase();
      const lowerFull = fullName.toLowerCase();

      if (/(picanto|rio|mg3)/i.test(lowerFull)) {
        return { category_code: "EDAR", category_group: "Picanto, Rio & MG3" };
      }
      if (/(cerato|corolla|i30)/i.test(lowerFull)) {
        return { category_code: "SEDAN", category_group: "Cerato, Corolla & i30" };
      }
      if (/(camry|mazda6|accord)/i.test(lowerFull)) {
        return { category_code: "IDAR", category_group: "Camry, Mazda6 & Accord" };
      }
      if (/(seltos|qashqai|cx-5)/i.test(lowerFull)) {
        return { category_code: "IFAR", category_group: "Seltos, Qashqai & CX-5" };
      }
      if (/(sorento|santa\s*fe|cx-9)/i.test(lowerFull)) {
        return { category_code: "SFAR", category_group: "Sorento, Santa Fe & CX-9" };
      }

      return { category_code: "OTHER", category_group: "Other" };
    }

    function inViewport(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.left >= 0 &&
             rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
             rect.right <= (window.innerWidth || document.documentElement.clientWidth);
    }

    function isButtonDisabled(btn) {
      if (!btn) return true;
      return btn.disabled || btn.classList.contains("disabled") ||
             btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true";
    }

    function strongClick(el) {
      if (!el) return;
      const events = ["mousedown", "mouseup", "click"];
      events.forEach(evtName => {
        el.dispatchEvent(new MouseEvent(evtName, { view: window, bubbles: true, cancelable: true }));
      });
    }

    function findByText(txt) {
      const lowerTxt = txt.toLowerCase();
      return Array.from(document.querySelectorAll("button, input, label, [class*='field' i], [class*='input' i]"))
        .find(el => {
          const text = (el.textContent || el.placeholder || "").toLowerCase();
          return text.includes(lowerTxt);
        });
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
    // Search Form Interaction
    // ===========================
    async function fillLocation() {
      log("Filling location...");
      const form = document.querySelector("form.SearchModifier-Form");
      if (!form) {
        log("❌ Form not found");
        return false;
      }

      const locationInput = form.querySelector("input[name='address'], input[type='text'], input[placeholder*='location' i]")
        || form.querySelector(".SearchModifierLocation-Input input");

      if (!locationInput) {
        log("❌ Location input not found");
        return false;
      }

      locationInput.focus();
      await sleep(200);
      locationInput.value = "";
      locationInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(200);

      for (const ch of LOCATION_TEXT) {
        locationInput.value += ch;
        locationInput.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(50);
      }

      await sleep(1000);
      log(`✅ Location filled: ${LOCATION_TEXT}`);
      return true;
    }

    async function clickSearchNow() {
      const searchBtn = Array.from(document.querySelectorAll("button"))
        .find(b => /search\s*now/i.test(norm(b.textContent)));

      if (!searchBtn || isButtonDisabled(searchBtn)) {
        log("❌ Search Now button not found or disabled");
        return false;
      }

      strongClick(searchBtn);
      await sleep(800);
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

    async function clickDate(panel, date) {
      const dayButtons = Array.from(panel.querySelectorAll(".rdrDayNumber button"));
      const targetDay = date.getDate();

      for (const btn of dayButtons) {
        if (isButtonDisabled(btn) || !inViewport(btn)) continue;
        const numSpan = btn.querySelector(".rdrDayNumber span");
        if (numSpan && parseInt(numSpan.textContent.trim()) === targetDay) {
          strongClick(btn);
          await sleep(400);
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

      strongClick(buttons[0]);
      await sleep(500);
      log('✅ Clicked "Select Dates" button');
      return true;
    }

    async function waitForPanelClose(timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
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
      }

      let panel = await waitPanel();
      if (!panel) {
        log("❌ Calendar panel not found");
        return false;
      }

      log("✅ Calendar panel found");

      const ok1 = await clickDate(panel, pickupDate);
      await sleep(300);

      panel = getPanel() || panel;
      const ok2 = await clickDate(panel, dropoffDate);

      if (ok1 && ok2) {
        await sleep(300);
        await clickApplySelectDatesIfPresent(panel);
        await sleep(500);
        await waitForPanelClose();
        log(`✅ Dates selected: ${toYMDLocal(pickupDate)} → ${toYMDLocal(dropoffDate)}`);
      }

      return ok1 && ok2;
    }

    // ===========================
    // Car Extraction
    // ===========================
    function extractNames(card) {
      let nameEl = card.querySelector(".SearchCar-CarName h4") ||
                   card.querySelector(".CarTitle-Name") ||
                   card.querySelector(".SearchCar-CarName") ||
                   card.querySelector("[class*='CarName']");

      if (!nameEl) {
        return { fullName: null, baseName: null };
      }

      let fullName = norm(nameEl.textContent);
      let baseName = fullName.split(" or ")[0];
      baseName = baseName.replace(/\(.*?\)/g, "");

      const similarMatch = baseName.match(/(.+?)\s+similar/i);
      if (similarMatch) {
        baseName = similarMatch[1].trim();
      }

      const excludeWords = ["Automatic", "Manual", "Petrol", "Diesel", "Hybrid"];
      excludeWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, "gi");
        baseName = baseName.replace(regex, "").trim();
      });
      baseName = norm(baseName) || fullName;

      log(`Found car: ${fullName}`);
      return { fullName, baseName };
    }

    function parseCarCard(card, meta) {
      const { fullName, baseName } = extractNames(card);
      if (!fullName) return null;

      let matchedModel = null;
      if (TARGET_MODELS.length > 0) {
        const normalizedName = fullName.toLowerCase().replace(/\s+/g, '');
        const hit = TARGET_MODELS.find(m => {
          const normalizedModel = m.toLowerCase().replace(/\s+/g, '');
          return normalizedName.includes(normalizedModel);
        });
        if (!hit) {
          log(`  ⏭️ Skipping ${fullName} (not in target models)`);
          return null;
        }
        matchedModel = hit;
        log(`  ✅ Match found! ${fullName} matches target: ${hit}`);
      }

      const priceEl = card.querySelector(".SearchCar-Price strong") ||
                      card.querySelector(".Price-Value") ||
                      card.querySelector("[class*='Price' i] strong");

      if (!priceEl) return null;

      const priceText = norm(priceEl.textContent).replace(/[^\d.]/g, "");
      const priceValue = parseFloat(priceText);
      if (isNaN(priceValue)) return null;

      const companyEl = card.querySelector(".SearchCar-SupplierName") ||
                        card.querySelector(".SupplierName") ||
                        card.querySelector("[class*='Supplier' i]");
      const company = companyEl ? norm(companyEl.textContent) : "Unknown";

      const avgDaily = meta.rental_days > 0 ? round2(priceValue / meta.rental_days) : "";
      const { category_code, category_group } = classifyModel(baseName, fullName);

      const viewDealBtn = card.querySelector(".SearchCar-CtaBtn, a[href*='/offer/']");
      const viewDealUrl = viewDealBtn?.href || "";
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
        _uniqueKey: key,
        _matchedModel: matchedModel
      };
    }

    function getVisibleCards() {
      const container =
        document.querySelector("[data-test-id='virtuoso-list']") ||
        document.querySelector(".SearchList-Wrapper") ||
        document.body;
      return Array.from(container.querySelectorAll(".SearchCar-Wrapper"));
    }

    // ===========================
    // Scraping Loop
    // ===========================
    async function autoScrollAndScrape(meta) {
      const vehiclesPerModel = {};
      TARGET_MODELS.forEach(model => {
        vehiclesPerModel[model] = 0;
      });

      let idle = 0;
      let lastHeight = document.body.scrollHeight;
      let lastCount = scrapedCars.length;

      while (idle < MAX_IDLE_ROUNDS) {
        log(`  🔄 Scroll iteration: idle=${idle}/${MAX_IDLE_ROUNDS}, cars so far=${scrapedCars.length}`);

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

            if (seenKeys.has(info._uniqueKey)) {
              log(`  ⏭️ Already seen: ${info.car_name_base}`);
              continue;
            }

            if (TARGET_MODELS.length > 0) {
              const targetModel = info._matchedModel;
              if (vehiclesPerModel[targetModel] >= MAX_PER_DATE) {
                log(`  🛑 Reached max (${MAX_PER_DATE}) for model: ${targetModel}`);
                continue;
              }
            }

            seenKeys.add(info._uniqueKey);

            const viewDealBtn = c.querySelector(".SearchCar-CtaBtn, a[href*='/offer/']");
            const offerUrl = viewDealBtn?.href || '';

            if (viewDealBtn && offerUrl) {
              log(`🎯 Target vehicle found: ${info.car_name_base}, opening in new tab...`);

              try {
                const newTab = window.open(offerUrl, '_blank');

                await new Promise(resolve => {
                  chrome.runtime.sendMessage({
                    type: 'TRACK_NEW_TAB',
                    offerUrl: offerUrl
                  }, (response) => {
                    resolve(response);
                  });
                });

                const waitTime = 5000 + Math.random() * 2000;
                log(`  ⏳ Waiting ${(waitTime / 1000).toFixed(1)}s for new tab to load...`);
                await sleep(waitTime);

                let paymentData = null;
                let attempts = 0;
                const maxAttempts = 10;
                let gotData = false;

                while (attempts < maxAttempts && !gotData) {
                  await sleep(2000);

                  paymentData = await new Promise(resolve => {
                    chrome.runtime.sendMessage({
                      type: 'GET_PAYMENT_DATA',
                      url: offerUrl
                    }, response => resolve(response));
                  });

                  if (paymentData && (paymentData.payNow || paymentData.payAtPickup)) {
                    info.pay_now = paymentData.payNow || "";
                    info.pay_at_pickup = paymentData.payAtPickup || "";
                    gotData = true;
                    log(`  💰 Payment data retrieved: pay_now=${info.pay_now}, pay_at_pickup=${info.pay_at_pickup}`);
                  } else {
                    attempts++;
                    log(`  ⏳ Waiting for payment data... (attempt ${attempts}/${maxAttempts})`);
                  }
                }

                if (!gotData) {
                  log(`  ⚠️ Payment data not retrieved after ${maxAttempts} attempts`);
                }

                if (newTab && !newTab.closed) {
                  try {
                    newTab.close();
                    log(`  🗑️ Closed offer tab`);
                  } catch (e) {
                    log(`  ⚠️ Could not close tab: ${e.message}`);
                  }
                }

              } catch (e) {
                log(`  ❌ Error opening/processing offer page: ${e.message}`);
              }
            }

            scrapedCars.push(info);

            if (TARGET_MODELS.length > 0) {
              const targetModel = info._matchedModel;
              vehiclesPerModel[targetModel]++;
              log(`  📊 Model counts: ${JSON.stringify(vehiclesPerModel)}`);

              const allModelsReachedMax = TARGET_MODELS.every(model => vehiclesPerModel[model] >= MAX_PER_DATE);
              if (allModelsReachedMax) {
                log(`  🎉 All target models reached max (${MAX_PER_DATE}), stopping this round`);
                return scrapedCars.length - lastCount;
              }
            }
          }
        }

        const h = document.body.scrollHeight;
        const count = scrapedCars.length;

        if (h > lastHeight || count > lastCount) {
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

      chrome.runtime.sendMessage({
        type: 'UPDATE_STATE',
        scrapedCars,
        seenKeys: Array.from(seenKeys)
      });

      return scrapedCars.length - lastCount;
    }

    // ===========================
    // CSV Export
    // ===========================
    function downloadCSV() {
      const headers = [
        "car_name_full", "car_name_base", "company", "price_value", "avg_daily_price",
        "pickup_date", "dropoff_date", "rental_days", "category_code", "category_group",
        "pay_now", "pay_at_pickup", "offer_url"
      ];

      const rows = scrapedCars.map(car => [
        car.car_name_full,
        car.car_name_base,
        car.company,
        car.price_value,
        car.avg_daily_price,
        car.pickup_date,
        car.dropoff_date,
        car.rental_days,
        car.category_code,
        car.category_group,
        car.pay_now,
        car.pay_at_pickup,
        car.view_deal_url
      ]);

      const csvContent = [
        headers.map(h => `"${h}"`).join(","),
        ...rows.map(r => r.map(cell => `"${String(cell || "")}"`).join(","))
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cars_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      log("✅ CSV downloaded. Total rows:", scrapedCars.length);
    }

    // ===========================
    // Main Flow
    // ===========================
    (async () => {
      log("START durations:", DURATIONS);
      log("TARGET_MODELS:", TARGET_MODELS);
      log("LOCATION:", LOCATION_TEXT);

      // Round 1: Home page flow
      if (!isResultsPage()) {
        if (!isHomeSearchPage()) {
          log("❌ Not on home search page or results page");
          return;
        }

        const now = new Date();
        const days = DURATIONS[0];
        const pickupDate = addDays(now, 1);
        const dropoffDate = addDays(pickupDate, days);

        await fillLocation();
        await sleep(500);

        const okDates = await setDatesOnResults(pickupDate, dropoffDate);
        if (!okDates) {
          log("⚠️ Date selection failed");
        }

        await sleep(500);
        await clickSearchNow();

        const okRes = await waitForResults();
        if (!okRes) {
          log("⚠️ Results page not loaded");
          return;
        }

        log(`Waiting ${RESULT_EXTRA_WAIT_MS/1000}s...`);
        await sleep(RESULT_EXTRA_WAIT_MS);

        const pickupStr = toYMDLocal(pickupDate);
        const dropoffStr = toYMDLocal(dropoffDate);

        log(`Round1 HOME | ${pickupStr} -> ${dropoffStr} | days=${days}`);
        log("Round1 scrape...");
        const round1Count = await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });
        log(`Round1 done. Collected ${round1Count} vehicles for this date. Total rows: ${scrapedCars.length}`);
      }

      // Subsequent rounds
      for (let i = (isResultsPage() ? 0 : 1); i < DURATIONS.length; i++) {
        const days = DURATIONS[i];
        const now = new Date();
        const pickupDate = addDays(now, 1);
        const dropoffDate = addDays(pickupDate, days);
        const pickupStr = toYMDLocal(pickupDate);
        const dropoffStr = toYMDLocal(dropoffDate);

        log(`Round${i + 1} | ${pickupStr} -> ${dropoffStr} | days=${days}`);

        const okDates = await setDatesOnResults(pickupDate, dropoffDate);
        if (!okDates) {
          log("⚠️ Skipping: date change failed.");
          continue;
        }

        await sleep(500);
        await clickSearchNow();

        const okRes = await waitForResults();
        if (!okRes) {
          log("⚠️ Skipping: results not loaded after Search Now.");
          continue;
        }

        log(`Waiting ${RESULT_EXTRA_WAIT_MS/1000}s...`);
        await sleep(RESULT_EXTRA_WAIT_MS);

        log("Scraping...");
        const roundCount = await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });
        log(`Round${i + 1} done. Collected ${roundCount} vehicles for this date. Total rows: ${scrapedCars.length}`);
      }

      chrome.runtime.sendMessage({ type: 'STOP_SCRAPING' }, () => {
        log("Background worker notified of completion");
      });

      log("All rounds complete.");
      downloadCSV();
    })();
  }

})();
