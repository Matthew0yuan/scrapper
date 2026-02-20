/**
 * DiscoveryCars Car Rental Scraper - Content Script
 * Extracts car rental pricing data from DiscoveryCars search results
 * Uses shared modules for common functionality
 */

(function () {
  'use strict';

  const SITE_NAME = 'discoverycars';
  const log = SharedUtils.createLogger(SITE_NAME);
  const S = Selectors.discoverycars;
  const T = TimingConfig.discoverycars;

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "RUN_SCRAPER") {
      log(`Received RUN_SCRAPER command. Config site: ${msg.cfg?.site}, Current script: ${SITE_NAME}`);

      if (msg.cfg?.site !== SITE_NAME) {
        log(`Ignoring command intended for ${msg.cfg?.site}`);
        return;
      }

      // Safety check: am I running on the wrong domain?
      if (SITE_NAME === 'discoverycars' && window.location.host.includes('expedia')) {
        log('WARNING: Running DiscoveryCars script on Expedia domain! Check popup selection.');
      }

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

    if (msg.type === "EXTRACT_OFFER_PAGE") {
      log('Received EXTRACT_OFFER_PAGE command');
      extractOfferPageAndReturn().then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  });

  log('Content script loaded');

  // ============================================================================
  // OFFER PAGE AUTO-EXTRACTION
  // ============================================================================

  (async () => {
    if (!window.location.href.includes('/offer/')) {
      // Not an offer page
      return;
    }

    log('Offer page detected (IIFE). URL:', window.location.href);

    // Wait for content regardless of state, effectively warming up the cache/DOM
    const breakdown = await DomUtils.waitForElement(S.priceBreakdown, 10000, 500);

    if (!breakdown) {
      log('Price breakdown not found (timeout)');
      return;
    }

    // Check state just to be polite, but we rely on the background script triggering us mostly.
    // However, if we are here, we might as well extract.
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, resolve);
    });

    log('State response:', response);

    if (response && (response.active || response.waitingForOfferPage)) {
      log('State active, extracting...');
      await extractOfferPageAndReturn();
    } else {
      log('State not active, skipping auto-extraction. Waiting for signal.');
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

    const sections = Array.from(breakdown.querySelectorAll(S.priceBreakdownMain));
    let payNow = "";
    let payAtPickup = "";

    for (const section of sections) {
      // Find the label text (typically the first text element in the section)
      const labelEl = section.querySelector(S.priceText);
      if (!labelEl) continue;

      const labelText = SharedUtils.normalize(labelEl.textContent);

      if (/pay\s*now/i.test(labelText)) {
        const extra = section.querySelector(S.priceExtra);
        if (extra) {
          // Find price elements that are NOT titles
          const prices = Array.from(extra.querySelectorAll(S.priceText))
            .filter(el => !el.matches(S.priceExtraTitle));

          if (prices.length > 0) {
            payNow = SharedUtils.normalize(prices[0].textContent);
            log(`Found "Pay now": ${payNow}`);
          }
        }
      } else if (/pay\s*at\s*pick/i.test(labelText)) {
        const extra = section.querySelector(S.priceExtra);
        if (extra) {
          // Find price elements that are NOT titles
          const prices = Array.from(extra.querySelectorAll(S.priceText))
            .filter(el => !el.matches(S.priceExtraTitle));

          if (prices.length > 0) {
            payAtPickup = SharedUtils.normalize(prices[0].textContent);
            log(`Found "Pay at pickup": ${payAtPickup}`);
          }
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



    function isResultsPage() {
      return !!(
        document.querySelector(S.virtuosoList) ||
        document.querySelector(S.searchListWrapper) ||
        document.querySelector(S.searchCarWrapper)
      );
    }



    // ============================================================================
    // SEARCH FORM INTERACTION REMOVED
    // ============================================================================

    // ============================================================================
    // DATE PICKER HANDLING REMOVED
    // ============================================================================

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

      if (!priceEl) {
        if (matchedModel) log(`  Warning: No price element for ${fullName}`);
        return null;
      }

      const priceText = SharedUtils.normalize(priceEl.textContent).replace(/[^\d.]/g, "");
      const priceValue = parseFloat(priceText);
      if (isNaN(priceValue)) {
        if (matchedModel) log(`  Warning: Invalid price "${priceText}" for ${fullName}`);
        return null;
      }

      let company = "Unknown";

      // Strategy: Only look for an image with alt text (e.g. logo)
      const imgEl = card.querySelector(S.supplierImage);
      if (imgEl && imgEl.alt) {
        company = SharedUtils.normalize(imgEl.alt);
        // log(`  Extracted supplier from image alt: ${company}`);
      } else {
        // Fallback or logging if needed, though instruction is to rely on this
        // Maybe try a broader image search if the specific class fails?
        // But for now, we stick to the selector.
        // If the selector is '.SearchCar-Supplier img', it should work.
        // Let's also try a direct img search in the card if the specific wrapper isn't found
        const allImgs = Array.from(card.querySelectorAll('img'));
        const logoImg = allImgs.find(img => img.alt && img.src.includes('logo'));
        if (logoImg) {
          company = SharedUtils.normalize(logoImg.alt);
        }
      }

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

      let idleAtBottom = 0;
      let lastScrollY = window.scrollY;
      const initialCount = scrapedCars.length;

      while (idleAtBottom < T.maxIdleRounds) {
        const scrollY = window.scrollY;
        const viewportHeight = window.innerHeight;
        const pageHeight = document.body.scrollHeight;
        const isNearBottom = (scrollY + viewportHeight) >= (pageHeight - 100);

        log(`  Scroll: y=${Math.round(scrollY)}, pageH=${pageHeight}, atBottom=${isNearBottom}, idle=${idleAtBottom}/${T.maxIdleRounds}, cars=${scrapedCars.length}`);

        const cards = getVisibleCards();

        for (const c of cards) {
          // Skip already processed DOM elements
          if (c.dataset.scraped) continue;
          c.dataset.scraped = '1';

          const info = parseCarCard(c, meta);
          if (info) {
            if (seenKeys.has(info._uniqueKey)) {
              continue;
            }

            if (TARGET_MODELS.length > 0) {
              const targetModel = info._matchedModel;
              if (vehiclesPerModel[targetModel] >= MAX_PER_DATE) {
                log(`  Reached max (${MAX_PER_DATE}) for model: ${targetModel}`);
                continue;
              }
            }

            log(`  New vehicle: ${info.car_name_base}`);
            seenKeys.add(info._uniqueKey);

            const viewDealBtn = c.querySelector(S.viewDealButton);
            const offerUrl = viewDealBtn?.href || '';

            if (viewDealBtn) {
              log(`  Clicking offer button for: ${info.car_name_base}`);

              // Clear previous offer tabs for cleanliness
              try {
                await new Promise(resolve => chrome.runtime.sendMessage({ type: 'CLOSE_OFFER_TABS' }, resolve));
              } catch (e) { }
              await SharedUtils.sleep(500);

              // Click the button/link naturallyjavascript
              if (viewDealBtn.tagName === 'A' && viewDealBtn.getAttribute('href')) {
                // If it's a link, we can still click it or open it, but let's click to mimic real user
                // and let the background track the new tab
                const href = viewDealBtn.getAttribute('href');
                // If target is not blank, force it
                viewDealBtn.target = "_blank";
              }

              DomUtils.strongClick(viewDealBtn);

              const waitTime = SharedUtils.randomInRange(T.offerWait.min, T.offerWait.max);
              log(`  Waiting ${(waitTime / 1000).toFixed(1)}s for new tab...`);
              await SharedUtils.sleep(waitTime);

              // Poll for tab info until we get it (tab might not be fully loaded yet)
              let tabInfo = null;
              for (let tabAttempt = 0; tabAttempt < 10; tabAttempt++) {
                tabInfo = await new Promise(resolve => {
                  chrome.runtime.sendMessage({ type: 'GET_MOST_RECENT_OFFER_TAB' }, resolve);
                });
                if (tabInfo && tabInfo.url) {
                  break;
                }
                log(`  Waiting for tab to load... (${tabAttempt + 1}/10)`);
                await SharedUtils.sleep(1000);
              }

              if (tabInfo && tabInfo.url) {
                log(`  Tracked offer tab URL: ${tabInfo.url}`);

                let paymentData = null;
                let attempts = 0;

                while (attempts < T.maxPollAttempts) {
                  await SharedUtils.sleep(T.pollInterval);

                  paymentData = await new Promise(resolve => {
                    chrome.runtime.sendMessage({
                      type: 'GET_PAYMENT_DATA',
                      offerUrl: tabInfo.url // Use the ACTUAL url from the tab
                    }, resolve);
                  });

                  if (paymentData && (paymentData.payNow || paymentData.payAtPickup)) {
                    info.pay_now = paymentData.payNow || "";
                    info.pay_at_pickup = paymentData.payAtPickup || "";
                    info.view_deal_url = tabInfo.url; // Update to real URL

                    log('==================================================');
                    log('  ✅ SUCCESS: PAYMENT DATA RECEIVED FROM OFFER PAGE');
                    log(`  URL: ${tabInfo.url}`);
                    log(`  Pay Now: ${info.pay_now}`);
                    log(`  Pay at Pickup: ${info.pay_at_pickup}`);
                    log('==================================================');

                    break;
                  }

                  attempts++;
                  log(`  Waiting for data... (${attempts}/${T.maxPollAttempts})`);
                }

                if (!info.pay_now && !info.pay_at_pickup) {
                  log(`  Failed to get payment data after ${T.maxPollAttempts} attempts`);
                }

                // Close tabs
                await new Promise(resolve => chrome.runtime.sendMessage({ type: 'CLOSE_OFFER_TABS' }, resolve));

              } else {
                log('  Could not detect new offer tab URL from background');
                // Fallback: try to close tabs just in case
                await new Promise(resolve => chrome.runtime.sendMessage({ type: 'CLOSE_OFFER_TABS' }, resolve));
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
                return scrapedCars.length - initialCount;
              }
            }
          }
        }

        // Only count as idle when we're truly at the bottom and can't scroll further
        if (isNearBottom && scrollY === lastScrollY) {
          idleAtBottom++;
          log(`  At bottom, cannot scroll further: idle=${idleAtBottom}/${T.maxIdleRounds}`);

          // Try next page button when idle at bottom
          if (idleAtBottom >= T.maxIdleRounds - 1) {
            const nextPageBtn = document.querySelector('button.Pagination-NavigationButton_next');
            if (nextPageBtn && !nextPageBtn.disabled) {
              log(`  Going to next page...`);
              nextPageBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await SharedUtils.sleep(1000);
              DomUtils.strongClick(nextPageBtn);
              await SharedUtils.sleep(3000);
              idleAtBottom = 0;
              window.scrollTo(0, 0);
              await SharedUtils.sleep(1000);
              lastScrollY = 0;
              continue;
            }
          }
        } else {
          // Reset idle if we can still scroll
          idleAtBottom = 0;
        }

        lastScrollY = scrollY;

        // Scroll down by one step
        window.scrollBy(0, T.scrollStep);
        await SharedUtils.sleep(T.scanInterval);
      }

      log(`Scroll loop completed after ${idleAtBottom} idle rounds`);

      chrome.runtime.sendMessage({
        type: 'UPDATE_STATE',
        scrapedCars,
        seenKeys: Array.from(seenKeys)
      });

      return scrapedCars.length - initialCount;
    }

    // ============================================================================
    // MAIN FLOW
    // ============================================================================

    (async () => {
      log("START durations:", DURATIONS);
      log("TARGET_MODELS:", TARGET_MODELS);
      log("LOCATION:", LOCATION_TEXT); // Note: Location filling logic disabled/removed

      if (!isResultsPage()) {
        log("Not on results page. Please navigate to the DiscoveryCars search results page.");
        return;
      }

      log("Results page detected. Starting scrape...");

      // Single Round: Current Page flow
      const now = new Date();
      const days = DURATIONS.length > 0 ? DURATIONS[0] : 1;

      // Dummy dates for metadata consistency
      const pickupDate = SharedUtils.addDays(now, 1);
      const dropoffDate = SharedUtils.addDays(pickupDate, days);

      const pickupStr = SharedUtils.formatDateLocal(pickupDate);
      const dropoffStr = SharedUtils.formatDateLocal(dropoffDate);

      // Wait a bit to ensure page is stable
      log(`Waiting ${T.resultExtraWait / 1000}s...`);
      await SharedUtils.sleep(T.resultExtraWait);

      log(`Scraping Current Page | Metadata: ${pickupStr} -> ${dropoffStr} | days=${days}`);

      const count = await autoScrollAndScrape({ pickup_date: pickupStr, dropoff_date: dropoffStr, rental_days: days });
      log(`Scrape done. Collected ${count} vehicles. Total rows: ${scrapedCars.length}`);

      if (DURATIONS.length > 1) {
        log('Note: Multiple durations were requested, but date modification logic is disabled. Only the first duration was processed.');
      }

      // Wait for any pending offer page extraction to complete
      log("Waiting 15s for final extraction to complete...");
      await SharedUtils.sleep(15000);

      chrome.runtime.sendMessage({ type: 'STOP_SCRAPING' }, () => {
        log("Background worker notified of completion");
      });

      log("Operation complete.");
      CsvExport.downloadCSV(scrapedCars, SITE_NAME, log);
    })();
  }

})();
