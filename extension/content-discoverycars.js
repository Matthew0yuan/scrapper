/**
 * DiscoveryCars Car Rental Scraper - Content Script
 * Extracts car rental pricing data from DiscoveryCars search results
 * Uses shared modules for common functionality
 */

(function() {
  'use strict';

  const SITE_NAME = 'discoverycars';
  const log = SharedUtils.createLogger(SITE_NAME);
  const S = Selectors.discoverycars;
  const T = TimingConfig.discoverycars;

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "RUN_SCRAPER" && msg.site === SITE_NAME) {
      const { cfg } = msg;

      const location = cfg.location || "Perth (all locations), Australia";
      const durations = SharedUtils.parseIntList(cfg.durations || "1,2,3,4,5,6,7,8");
      const targetModels = ModelClassifier.parseTargetModels(cfg.models || "");
      const maxPerDate = parseInt(cfg.maxPerDate) || 30;

      chrome.runtime.sendMessage({
        type: 'START_SCRAPING',
        config: { site: SITE_NAME, location, durations, targetModels, maxPerDate }
      }, () => {
        log('Background worker notified of scraping start');
      });

      runScraper(location, durations, targetModels, [], [], maxPerDate);

      sendResponse({ ok: true });
      return true;
    }
  });

  log('Content script loaded');

  // ============================================================================
  // OFFER PAGE AUTO-EXTRACTION
  // ============================================================================

  (async () => {
    if (!window.location.href.includes('/offer/')) {
      log('Not an offer page, skipping auto-extraction');
      return;
    }

    log('Detected offer page, waiting for content...');

    const breakdown = await DomUtils.waitForElement(S.priceBreakdown, 10000, 500);

    if (!breakdown) {
      log('Price breakdown not found');
      return;
    }

    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, resolve);
    });

    if (response && response.active) {
      log('Auto-extracting payment data...');
      await extractOfferPageAndReturn();
    }
  })();

  // ============================================================================
  // OFFER PAGE EXTRACTION
  // ============================================================================

  async function extractOfferPageAndReturn() {
    log('Extracting offer page payment details...');

    const breakdown = await DomUtils.waitForElement(S.priceBreakdown, 8000, 800);

    if (!breakdown) {
      log('OfferPriceBreakdown not found');
      return;
    }

    log('Found OfferPriceBreakdown');

    const mainPayment = breakdown.querySelector(S.priceBreakdownMain);
    const payNowLabel = Array.from(breakdown.querySelectorAll(S.priceText))
      .find(el => /pay\s*now/i.test(SharedUtils.normalize(el.textContent)));

    let payNow = "";
    if (payNowLabel && mainPayment) {
      const allPrices = Array.from(mainPayment.querySelectorAll(S.priceText));
      const idx = allPrices.indexOf(payNowLabel);
      if (idx >= 0 && idx + 1 < allPrices.length) {
        payNow = SharedUtils.normalize(allPrices[idx + 1].textContent);
        log(`Found "Pay now": ${payNow}`);
      }
    }

    const payAtPickupLabel = Array.from(breakdown.querySelectorAll(S.priceText))
      .find(el => /pay\s*at\s*pick/i.test(SharedUtils.normalize(el.textContent)));

    let payAtPickup = "";
    if (payAtPickupLabel) {
      const parent = payAtPickupLabel.closest("tr, div");
      if (parent) {
        const prices = Array.from(parent.querySelectorAll(S.priceText));
        const idx = prices.indexOf(payAtPickupLabel);
        if (idx >= 0 && idx + 1 < prices.length) {
          payAtPickup = SharedUtils.normalize(prices[idx + 1].textContent);
          log(`Found "Pay at pickup": ${payAtPickup}`);
        }
      }
    }

    log(`Payment data extracted: Pay now=${payNow}, Pay at pickup=${payAtPickup}`);

    chrome.runtime.sendMessage({
      type: 'STORE_PAYMENT_DATA',
      url: window.location.href,
      paymentData: { payNow, payAtPickup }
    }, (response) => {
      if (response && response.success) {
        log('Data stored in background');
      }
    });
  }

  // ============================================================================
  // MAIN SCRAPER
  // ============================================================================

  async function runScraper(LOCATION_TEXT, DURATIONS, TARGET_MODELS, existingCars, existingKeys, MAX_PER_DATE) {
    const scrapedCars = existingCars.length > 0 ? [...existingCars] : [];
    const seenKeys = new Set(existingKeys.length > 0 ? existingKeys : []);

    // ============================================================================
    // PAGE STATE DETECTION
    // ============================================================================

    function isHomeSearchPage() {
      return !!document.querySelector(S.searchForm);
    }

    function isResultsPage() {
      return !!(
        document.querySelector(S.virtuosoList) ||
        document.querySelector(S.searchListWrapper) ||
        document.querySelector(S.searchCarWrapper)
      );
    }

    async function waitForResults(timeoutMs = 45000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (isResultsPage()) return true;
        await SharedUtils.sleep(400);
      }
      return false;
    }

    // ============================================================================
    // SEARCH FORM INTERACTION
    // ============================================================================

    async function fillLocation() {
      log("Filling location...");
      const form = document.querySelector(S.searchForm);
      if (!form) {
        log("Form not found");
        return false;
      }

      const locationInput = form.querySelector(S.locationInput) ||
                           form.querySelector(S.locationInputAlt);

      if (!locationInput) {
        log("Location input not found");
        return false;
      }

      locationInput.focus();
      await SharedUtils.sleep(200);
      locationInput.value = "";
      locationInput.dispatchEvent(new Event("input", { bubbles: true }));
      await SharedUtils.sleep(200);

      for (const ch of LOCATION_TEXT) {
        locationInput.value += ch;
        locationInput.dispatchEvent(new Event("input", { bubbles: true }));
        await SharedUtils.sleep(T.inputDelay);
      }

      await SharedUtils.sleep(T.locationWait);
      log(`Location filled: ${LOCATION_TEXT}`);
      return true;
    }

    async function clickSearchNow() {
      const searchBtn = Array.from(document.querySelectorAll("button"))
        .find(b => /search\s*now/i.test(SharedUtils.normalize(b.textContent)));

      if (!searchBtn || DomUtils.isButtonDisabled(searchBtn)) {
        log("Search Now button not found or disabled");
        return false;
      }

      DomUtils.strongClick(searchBtn);
      await SharedUtils.sleep(T.searchClickWait);
      log("Clicked Search Now");
      return true;
    }

    // ============================================================================
    // DATE PICKER HANDLING
    // ============================================================================

    function getPanel() {
      return document.querySelector(S.calendarWrapper) ||
             document.querySelector(S.calendarWrapperAlt) ||
             document.querySelector(S.calendarPicker) ||
             document.querySelector(S.calendarMonths);
    }

    async function waitPanel(timeoutMs = T.panelWaitTimeout) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const p = getPanel();
        if (p) return p;
        await SharedUtils.sleep(200);
      }
      return null;
    }

    async function clickDate(panel, date) {
      const dayButtons = Array.from(panel.querySelectorAll(S.dayNumber));
      const targetDay = date.getDate();

      for (const btn of dayButtons) {
        if (DomUtils.isButtonDisabled(btn) || !DomUtils.isElementInViewport(btn)) continue;
        const numSpan = btn.querySelector(S.dayNumberSpan);
        if (numSpan && parseInt(numSpan.textContent.trim()) === targetDay) {
          DomUtils.strongClick(btn);
          await SharedUtils.sleep(T.calendarClickWait);
          return true;
        }
      }

      log(`Date click failed: ${SharedUtils.formatDateLocal(date)}`);
      return false;
    }

    async function clickApplySelectDatesIfPresent(panel) {
      const dialog = panel.closest("[role='dialog']") || document;
      const buttons = Array.from(dialog.querySelectorAll("button"))
        .filter(b => /select\s*dates?/i.test(SharedUtils.normalize(b.textContent)))
        .filter(b => !DomUtils.isButtonDisabled(b) && DomUtils.isElementInViewport(b));

      if (!buttons.length) return false;

      DomUtils.strongClick(buttons[0]);
      await SharedUtils.sleep(T.dateSelectWait);
      log('Clicked "Select Dates" button');
      return true;
    }

    async function waitForPanelClose(timeoutMs = T.panelCloseWait) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (!getPanel()) return true;
        await SharedUtils.sleep(200);
      }
      return true;
    }

    async function setDatesOnResults(pickupDate, dropoffDate) {
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true }));
      } catch (e) {
        log(`Escape key error: ${e.message}`);
      }
      await SharedUtils.sleep(200);

      const dateBtn = document.querySelector(S.datePickerField) ||
                     document.querySelector(S.datePickerFieldAlt) ||
                     DomUtils.findByText("date");

      if (dateBtn) {
        log("Opening date picker...");
        DomUtils.strongClick(dateBtn);
        await SharedUtils.sleep(600);
      }

      let panel = await waitPanel();
      if (!panel) {
        log("Calendar panel not found");
        return false;
      }

      log("Calendar panel found");

      const ok1 = await clickDate(panel, pickupDate);
      await SharedUtils.sleep(300);

      panel = getPanel() || panel;
      const ok2 = await clickDate(panel, dropoffDate);

      if (ok1 && ok2) {
        await SharedUtils.sleep(300);
        await clickApplySelectDatesIfPresent(panel);
        await SharedUtils.sleep(T.dateSelectWait);
        await waitForPanelClose();
        log(`Dates selected: ${SharedUtils.formatDateLocal(pickupDate)} -> ${SharedUtils.formatDateLocal(dropoffDate)}`);
      }

      return ok1 && ok2;
    }

    // ============================================================================
    // CAR EXTRACTION
    // ============================================================================

    function extractNames(card) {
      let nameEl = card.querySelector(S.carName) ||
                   card.querySelector(S.carNameAlt1) ||
                   card.querySelector(S.carNameAlt2) ||
                   card.querySelector(S.carNameAlt3);

      if (!nameEl) {
        return { fullName: null, baseName: null };
      }

      let fullName = SharedUtils.normalize(nameEl.textContent);
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
      baseName = SharedUtils.normalize(baseName) || fullName;

      log(`Found car: ${fullName}`);
      return { fullName, baseName };
    }

    function parseCarCard(card, meta) {
      const { fullName, baseName } = extractNames(card);
      if (!fullName) return null;

      let matchedModel = null;
      if (TARGET_MODELS.length > 0) {
        matchedModel = ModelClassifier.findMatchingModel(fullName, TARGET_MODELS);
        if (!matchedModel) {
          log(`  Skipping ${fullName} (not in target models)`);
          return null;
        }
        log(`  Match found! ${fullName} matches target: ${matchedModel}`);
      }

      const priceEl = card.querySelector(S.carPrice) ||
                      card.querySelector(S.carPriceAlt1) ||
                      card.querySelector(S.carPriceAlt2);

      if (!priceEl) return null;

      const priceText = SharedUtils.normalize(priceEl.textContent).replace(/[^\d.]/g, "");
      const priceValue = parseFloat(priceText);
      if (isNaN(priceValue)) return null;

      const companyEl = card.querySelector(S.supplierName) ||
                        card.querySelector(S.supplierNameAlt1) ||
                        card.querySelector(S.supplierNameAlt2);
      const company = companyEl ? SharedUtils.normalize(companyEl.textContent) : "Unknown";

      const avgDaily = meta.rental_days > 0 ? SharedUtils.round2(priceValue / meta.rental_days) : "";
      const { category_code, category_group } = ModelClassifier.classifyModel(fullName, baseName);

      const viewDealBtn = card.querySelector(S.viewDealButton);
      const viewDealUrl = viewDealBtn?.href || "";
      const key = `${baseName}|${company}|${priceValue}|${meta.pickup_date}|${meta.dropoff_date}|${category_code}`;

      return {
        car_name_full: fullName,
        car_name_base: baseName,
        company,
        price_value: SharedUtils.round2(priceValue),
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
      const container = document.querySelector(S.virtuosoList) ||
                       document.querySelector(S.searchListWrapper) ||
                       document.body;
      return Array.from(container.querySelectorAll(S.searchCarWrapper));
    }

    // ============================================================================
    // SCRAPING LOOP
    // ============================================================================

    async function autoScrollAndScrape(meta) {
      const vehiclesPerModel = {};
      TARGET_MODELS.forEach(model => {
        vehiclesPerModel[model] = 0;
      });

      let idle = 0;
      let lastHeight = document.body.scrollHeight;
      let lastCount = scrapedCars.length;

      while (idle < T.maxIdleRounds) {
        log(`  Scroll iteration: idle=${idle}/${T.maxIdleRounds}, cars so far=${scrapedCars.length}`);

        const showMore = document.querySelector(S.showMoreWrapper) ||
                        document.querySelector(S.showMoreButton);
        if (showMore && !showMore.disabled) {
          log(`  Clicking "Show More" button`);
          showMore.click();
          await SharedUtils.sleep(1200);
        }

        const cards = getVisibleCards();
        log(`  Found ${cards.length} car cards on page`);

        for (const c of cards) {
          const info = parseCarCard(c, meta);
          if (info) {
            log(`  Parsed target vehicle: ${info.car_name_base}`);

            if (seenKeys.has(info._uniqueKey)) {
              log(`  Already seen: ${info.car_name_base}`);
              continue;
            }

            if (TARGET_MODELS.length > 0) {
              const targetModel = info._matchedModel;
              if (vehiclesPerModel[targetModel] >= MAX_PER_DATE) {
                log(`  Reached max (${MAX_PER_DATE}) for model: ${targetModel}`);
                continue;
              }
            }

            seenKeys.add(info._uniqueKey);

            const viewDealBtn = c.querySelector(S.viewDealButton);
            const offerUrl = viewDealBtn?.href || '';

            if (viewDealBtn && offerUrl) {
              log(`Target vehicle found: ${info.car_name_base}, opening in new tab...`);

              try {
                const newTab = window.open(offerUrl, '_blank');

                await new Promise(resolve => {
                  chrome.runtime.sendMessage({
                    type: 'TRACK_NEW_TAB',
                    offerUrl: offerUrl
                  }, resolve);
                });

                const waitTime = SharedUtils.randomInRange(T.offerWait.min, T.offerWait.max);
                log(`  Waiting ${(waitTime / 1000).toFixed(1)}s for new tab to load...`);
                await SharedUtils.sleep(waitTime);

                let paymentData = null;
                let attempts = 0;
                let gotData = false;

                while (attempts < T.maxPollAttempts && !gotData) {
                  await SharedUtils.sleep(T.pollInterval);

                  paymentData = await new Promise(resolve => {
                    chrome.runtime.sendMessage({
                      type: 'GET_PAYMENT_DATA',
                      url: offerUrl
                    }, resolve);
                  });

                  if (paymentData && (paymentData.payNow || paymentData.payAtPickup)) {
                    info.pay_now = paymentData.payNow || "";
                    info.pay_at_pickup = paymentData.payAtPickup || "";
                    gotData = true;
                    log(`  Payment data retrieved: pay_now=${info.pay_now}, pay_at_pickup=${info.pay_at_pickup}`);
                  } else {
                    attempts++;
                    log(`  Waiting for payment data... (attempt ${attempts}/${T.maxPollAttempts})`);
                  }
                }

                if (!gotData) {
                  log(`  Payment data not retrieved after ${T.maxPollAttempts} attempts`);
                }

                if (newTab && !newTab.closed) {
                  try {
                    newTab.close();
                    log(`  Closed offer tab`);
                  } catch (e) {
                    log(`  Could not close tab: ${e.message}`);
                  }
                }

              } catch (e) {
                log(`  Error opening/processing offer page: ${e.message}`);
              }
            }

            scrapedCars.push(info);

            if (TARGET_MODELS.length > 0) {
              const targetModel = info._matchedModel;
              vehiclesPerModel[targetModel]++;
              log(`  Model counts: ${JSON.stringify(vehiclesPerModel)}`);

              const allModelsReachedMax = TARGET_MODELS.every(model => vehiclesPerModel[model] >= MAX_PER_DATE);
              if (allModelsReachedMax) {
                log(`  All target models reached max (${MAX_PER_DATE}), stopping this round`);
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
          log(`  No progress: idle=${idle}/${T.maxIdleRounds}`);
        }

        window.scrollBy(0, T.scrollStep);
        await SharedUtils.sleep(T.scanInterval);
      }

      log(`Scroll loop completed after ${idle} idle rounds`);

      chrome.runtime.sendMessage({
        type: 'UPDATE_STATE',
        scrapedCars,
        seenKeys: Array.from(seenKeys)
      });

      return scrapedCars.length - lastCount;
    }

    // ============================================================================
    // MAIN FLOW
    // ============================================================================

    (async () => {
      log("START durations:", DURATIONS);
      log("TARGET_MODELS:", TARGET_MODELS);
      log("LOCATION:", LOCATION_TEXT);

      // Round 1: Home page flow
      if (!isResultsPage()) {
        if (!isHomeSearchPage()) {
          log("Not on home search page or results page");
          return;
        }

        const now = new Date();
        const days = DURATIONS[0];
        const pickupDate = SharedUtils.addDays(now, 1);
        const dropoffDate = SharedUtils.addDays(pickupDate, days);

        await fillLocation();
        await SharedUtils.sleep(500);

        const okDates = await setDatesOnResults(pickupDate, dropoffDate);
        if (!okDates) {
          log("Date selection failed");
        }

        await SharedUtils.sleep(500);
        await clickSearchNow();

        const okRes = await waitForResults();
        if (!okRes) {
          log("Results page not loaded");
          return;
        }

        log(`Waiting ${T.resultExtraWait/1000}s...`);
        await SharedUtils.sleep(T.resultExtraWait);

        const pickupStr = SharedUtils.formatDateLocal(pickupDate);
        const dropoffStr = SharedUtils.formatDateLocal(dropoffDate);

        log(`Round1 HOME | ${pickupStr} -> ${dropoffStr} | days=${days}`);
        log("Round1 scrape...");
        const round1Count = await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });
        log(`Round1 done. Collected ${round1Count} vehicles for this date. Total rows: ${scrapedCars.length}`);
      }

      // Subsequent rounds
      for (let i = (isResultsPage() ? 0 : 1); i < DURATIONS.length; i++) {
        const days = DURATIONS[i];
        const now = new Date();
        const pickupDate = SharedUtils.addDays(now, 1);
        const dropoffDate = SharedUtils.addDays(pickupDate, days);
        const pickupStr = SharedUtils.formatDateLocal(pickupDate);
        const dropoffStr = SharedUtils.formatDateLocal(dropoffDate);

        log(`Round${i + 1} | ${pickupStr} -> ${dropoffStr} | days=${days}`);

        const okDates = await setDatesOnResults(pickupDate, dropoffDate);
        if (!okDates) {
          log("Skipping: date change failed.");
          continue;
        }

        await SharedUtils.sleep(500);
        await clickSearchNow();

        const okRes = await waitForResults();
        if (!okRes) {
          log("Skipping: results not loaded after Search Now.");
          continue;
        }

        log(`Waiting ${T.resultExtraWait/1000}s...`);
        await SharedUtils.sleep(T.resultExtraWait);

        log("Scraping...");
        const roundCount = await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });
        log(`Round${i + 1} done. Collected ${roundCount} vehicles for this date. Total rows: ${scrapedCars.length}`);
      }

      chrome.runtime.sendMessage({ type: 'STOP_SCRAPING' }, () => {
        log("Background worker notified of completion");
      });

      log("All rounds complete.");
      CsvExport.downloadCSV(scrapedCars, SITE_NAME, log);
    })();
  }

})();
