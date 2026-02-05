/**
 * Expedia Car Rental Scraper - Content Script
 * Extracts car rental pricing data from Expedia search results
 * Uses shared modules for common functionality
 */

(function () {
  'use strict';

  // ============================================================================
  // CONSTANTS & CONFIGURATION
  // ============================================================================

  const SITE_NAME = 'expedia';
  const log = SharedUtils.createLogger(SITE_NAME);
  const S = Selectors.expedia;
  const T = TimingConfig.expedia;

  const DEFAULT_CONFIG = {
    location: 'Perth (all locations), Australia',
    durations: '1,2,3,4,5,6,7,8',
    models: '',
    maxPerDate: 30
  };

  // ============================================================================
  // DATE PICKER HANDLING
  // ============================================================================

  function getCalendarPanel() {
    return document.querySelector(S.calendar);
  }

  async function waitForCalendar(timeoutMs = T.calendarWait) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const panel = getCalendarPanel();
      if (panel) return panel;
      await SharedUtils.sleep(T.calendarPollInterval);
    }
    return null;
  }

  async function openDatePicker() {
    const dateBtn = document.querySelector(S.datePickerButton);
    if (!dateBtn) {
      log('Date picker button not found');
      return false;
    }

    log('Opening date picker...');
    dateBtn.click();
    await SharedUtils.sleep(500);

    const calendar = await waitForCalendar();
    if (!calendar) {
      log('Calendar did not open');
      return false;
    }

    log('Calendar opened');
    return true;
  }

  function formatDateForAriaLabel(date) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];

    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  async function clickDateInCalendar(date) {
    const calendar = getCalendarPanel();
    if (!calendar) {
      log('Calendar not found');
      return false;
    }

    const targetLabel = formatDateForAriaLabel(date);
    log(`Looking for date: ${targetLabel}`);

    const dayButtons = calendar.querySelectorAll(S.dayButton);

    for (const btn of dayButtons) {
      const ariaLabelEl = btn.querySelector(S.dayAriaLabel);
      if (ariaLabelEl) {
        const ariaLabel = ariaLabelEl.getAttribute('aria-label') || '';
        if (ariaLabel.startsWith(targetLabel)) {
          log(`Clicking date: ${ariaLabel}`);
          btn.click();
          await SharedUtils.sleep(300);
          return true;
        }
      }
    }

    log(`Date not found in current view: ${targetLabel}`);
    return false;
  }

  async function clickDoneButton() {
    const doneBtn = document.querySelector(S.doneButton);
    if (!doneBtn) {
      log('Done button not found');
      return false;
    }

    log('Clicking Done button...');
    doneBtn.click();
    await SharedUtils.sleep(500);
    return true;
  }

  async function clickSearchButton() {
    const searchBtn = document.querySelector(S.searchButton);
    if (!searchBtn) {
      log('Search button not found');
      return false;
    }

    log('Clicking Search button...');
    searchBtn.click();
    await SharedUtils.sleep(500);
    return true;
  }

  async function setDates(pickupDate, dropoffDate) {
    log(`Setting dates: ${SharedUtils.formatDateLocal(pickupDate)} to ${SharedUtils.formatDateLocal(dropoffDate)}`);

    if (!await openDatePicker()) return false;
    await SharedUtils.sleep(300);

    if (!await clickDateInCalendar(pickupDate)) {
      log('Failed to click pickup date');
      return false;
    }

    await SharedUtils.sleep(300);

    if (!await clickDateInCalendar(dropoffDate)) {
      log('Failed to click dropoff date');
      return false;
    }

    await SharedUtils.sleep(300);

    if (!await clickDoneButton()) {
      log('Failed to click Done button');
      return false;
    }

    await SharedUtils.sleep(500);

    // Click Search button to submit the new dates
    if (!await clickSearchButton()) {
      log('Failed to click Search button');
      return false;
    }

    log(`Dates set and search submitted: ${SharedUtils.formatDateLocal(pickupDate)} to ${SharedUtils.formatDateLocal(dropoffDate)}`);
    return true;
  }

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  function parseScraperConfig(cfg) {
    return {
      location: cfg.location || DEFAULT_CONFIG.location,
      durations: SharedUtils.parseIntList(cfg.durations || DEFAULT_CONFIG.durations),
      targetModels: ModelClassifier.parseTargetModels(cfg.models || DEFAULT_CONFIG.models),
      maxPerDate: parseInt(cfg.maxPerDate, 10) || DEFAULT_CONFIG.maxPerDate
    };
  }

  function sendMessage(type, data = {}) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type, ...data }, resolve);
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'RUN_SCRAPER' || msg.cfg?.site !== SITE_NAME) return;

    log('Received config:', JSON.stringify(msg.cfg));
    const config = parseScraperConfig(msg.cfg);
    log('Parsed durations array:', config.durations, 'length:', config.durations.length);

    sendMessage('START_SCRAPING', {
      config: { site: SITE_NAME, ...config }
    }).then(() => log('Background worker notified of scraping start'));

    runScraper(config);
    sendResponse({ ok: true });
    return true;
  });

  log('Content script loaded');

  // ============================================================================
  // OFFER PAGE AUTO-EXTRACTION
  // ============================================================================

  (async () => {
    log('Content script loaded on:', window.location.href);

    if (!window.location.href.includes('/carsearch/details')) {
      log('Not an offer page, skipping auto-extraction');
      return;
    }

    log('Detected offer page! Waiting for content...');

    const priceDetails = await DomUtils.waitForElement(S.priceDetails, 10000);
    if (!priceDetails) {
      log('Price details section not found');
      return;
    }

    log('Found .price-details element');

    const response = await sendMessage('GET_STATE');
    log('Scraping active:', response?.active);

    if (response?.active) {
      log('Auto-extracting payment data...');
      await extractOfferPagePayment();
    } else {
      log('Scraping not active, skipping extraction');
    }
  })();

  // ============================================================================
  // PAYMENT DATA EXTRACTION
  // ============================================================================

  async function extractOfferPagePayment() {
    log('========================================');
    log('EXTRACTING OFFER PAGE PAYMENT DETAILS');
    log('========================================');

    const totalBreakup = await DomUtils.waitForElement(S.totalBreakup, 8000, 800);
    if (!totalBreakup) {
      log('total-breakup not found');
      return;
    }

    log('Found total-breakup');

    const paymentData = parsePaymentBreakdown(totalBreakup);
    log(`Payment data extracted: Pay now=${paymentData.payNow}, Pay at pickup=${paymentData.payAtPickup}`);

    const response = await sendMessage('STORE_PAYMENT_DATA', {
      url: window.location.href,
      paymentData
    });

    if (response?.success) {
      log('Successfully stored payment data');
      log(`  URL: ${window.location.href}`);
      log(`  Pay now: ${paymentData.payNow}`);
      log(`  Pay at pickup: ${paymentData.payAtPickup}`);
    } else {
      log('Failed to store payment data');
    }
  }

  function parsePaymentBreakdown(container) {
    const items = container.querySelectorAll(S.typelistItem);
    const result = { payNow: '', payAtPickup: '' };

    items.forEach(item => {
      const flexDiv = item.querySelector(S.layoutFlex);
      if (!flexDiv) return;

      const textElements = flexDiv.querySelectorAll(S.textElement);
      if (textElements.length < 2) return;

      const label = SharedUtils.normalize(textElements[0].textContent).toLowerCase();
      const value = SharedUtils.normalize(textElements[1].textContent);

      if (label.includes('pay at pick-up') || label.includes('pay at pickup')) {
        result.payAtPickup = value;
        log(`Found "Pay at pickup": ${value}`);
      } else if (label.includes('pay now')) {
        result.payNow = value;
        log(`Found "Pay now": ${value}`);
      }
    });

    return result;
  }

  // ============================================================================
  // CAR CARD PARSING
  // ============================================================================

  function parseExpediaCard(button, meta, targetModels) {
    const ariaLabel = button.getAttribute('aria-label') || '';

    const match = ariaLabel.match(/Reserve\s+.+?\s+from\s+(.+?)\s+(?:for|at)\s+\$(\d+(?:\.\d{2})?)\s+total/);
    if (!match) {
      log(`Could not parse aria-label: ${ariaLabel}`);
      return null;
    }

    const company = match[1].trim();
    const priceValue = parseFloat(match[2]);

    const fullName = findCarName(button);
    if (!fullName) {
      log(`Could not find car name for ${company}`);
      return null;
    }

    const baseName = fullName.split(' or ')[0].trim();
    log(`Found car: "${baseName}" from ${company} at $${priceValue}`);

    const matchedModel = ModelClassifier.findMatchingModel(fullName, targetModels);
    if (targetModels.length > 0 && !matchedModel) {
      log(`Skipping ${fullName} (not in target models)`);
      return null;
    }

    if (matchedModel) {
      log(`Match found! ${fullName} matches target: ${matchedModel}`);
    }

    const { category_code, category_group } = ModelClassifier.classifyModel(fullName);
    const avgDaily = meta.rental_days > 0 ? SharedUtils.round2(priceValue / meta.rental_days) : '';
    const uniqueKey = `${baseName}|${company}|${priceValue}|${meta.pickup_date}|${meta.dropoff_date}|${category_code}`;

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
      view_deal_url: button.getAttribute('href') || '',
      pay_now: '',
      pay_at_pickup: '',
      _uniqueKey: uniqueKey,
      _matchedModel: matchedModel
    };
  }

  function findCarName(button) {
    let cardRoot = button.parentElement;
    let maxLevels = 10;

    while (cardRoot && maxLevels > 0) {
      const iconSection = cardRoot.querySelector(S.carNameSection);
      if (iconSection) {
        const carNameEl = iconSection.querySelector(S.carNameText);
        if (carNameEl) return SharedUtils.normalize(carNameEl.textContent);
      }
      cardRoot = cardRoot.parentElement;
      maxLevels--;
    }

    return '';
  }

  // ============================================================================
  // OFFER PAGE PROCESSING
  // ============================================================================

  async function processOfferPage(carInfo) {
    const offerTabInfo = await sendMessage('GET_MOST_RECENT_OFFER_TAB');

    if (!offerTabInfo?.url) {
      log('Could not get offer tab URL from background');
      return false;
    }

    log(`Offer tab URL: ${offerTabInfo.url}`);

    const waitTime = SharedUtils.randomInRange(T.offerExtractWait.min, T.offerExtractWait.max);
    log(`Waiting ${(waitTime / 1000).toFixed(1)}s for extraction...`);
    await SharedUtils.sleep(waitTime);

    log('Starting to poll for payment data...');

    for (let attempt = 1; attempt <= T.maxPollAttempts; attempt++) {
      await SharedUtils.sleep(T.pollInterval);
      log(`Poll attempt ${attempt}/${T.maxPollAttempts}`);

      const paymentData = await sendMessage('GET_PAYMENT_DATA', { offerUrl: offerTabInfo.url });

      if (paymentData?.payNow || paymentData?.payAtPickup) {
        carInfo.pay_now = paymentData.payNow || '';
        carInfo.pay_at_pickup = paymentData.payAtPickup || '';
        carInfo.view_deal_url = offerTabInfo.url;
        log('Successfully retrieved payment data!');
        log(`  Pay now: ${carInfo.pay_now}`);
        log(`  Pay at pickup: ${carInfo.pay_at_pickup}`);
        return true;
      }
    }

    log(`Payment data not retrieved after ${T.maxPollAttempts} attempts`);
    return false;
  }

  async function closeOfferTabs() {
    try {
      const response = await sendMessage('CLOSE_OFFER_TABS');
      if (response?.closedTabs > 0) {
        log(`Closed ${response.closedTabs} offer page tab(s)`);
      }
    } catch (err) {
      log(`Error closing tabs: ${err.message}`);
    }
  }

  // ============================================================================
  // PAGE STATE
  // ============================================================================

  function isResultsPage() {
    return !!document.querySelector(S.reserveButton);
  }

  // ============================================================================
  // SCRAPING LOOP
  // ============================================================================

  async function scrapeCurrentPage(meta, state, config) {
    const { scrapedCars, seenKeys } = state;
    const { targetModels, maxPerDate } = config;

    const vehiclesPerModel = {};
    targetModels.forEach(model => { vehiclesPerModel[model] = 0; });

    let idle = 0;
    let lastCount = scrapedCars.length;

    while (idle < T.maxIdleRounds) {
      log(`Scan iteration: idle=${idle}/${T.maxIdleRounds}, cars so far=${scrapedCars.length}`);

      const allCards = Array.from(document.querySelectorAll(S.reserveButton));
      log(`Found ${allCards.length} reserve buttons on page`);

      let processedAny = false;

      for (const card of allCards) {
        const carInfo = parseExpediaCard(card, meta, targetModels);
        if (!carInfo) continue;

        if (seenKeys.has(carInfo._uniqueKey)) continue;

        if (targetModels.length > 0) {
          const model = carInfo._matchedModel;
          if (vehiclesPerModel[model] >= maxPerDate) continue;
        }

        if (!DomUtils.isElementInViewport(card)) {
          log(`Scrolling to card: ${carInfo.car_name_base}...`);
          await DomUtils.smoothScrollToElement(card, T, log);

          if (!DomUtils.isElementPartiallyVisible(card)) {
            log(`Card not visible after scroll, skipping...`);
            continue;
          }
        }

        seenKeys.add(carInfo._uniqueKey);
        log(`Target vehicle found (visible): ${carInfo.car_name_base}`);

        const beforeClickWait = SharedUtils.randomInRange(T.beforeClick.min, T.beforeClick.max);
        log(`Pausing ${(beforeClickWait / 1000).toFixed(1)}s before clicking...`);
        await SharedUtils.sleep(beforeClickWait);

        await closeOfferTabs();
        await SharedUtils.sleep(500);

        const savedAriaLabel = card.getAttribute('aria-label') || '';
        const freshButton = Array.from(document.querySelectorAll(S.reserveButton))
          .find(btn => (btn.getAttribute('aria-label') || '') === savedAriaLabel);

        if (!freshButton) {
          log(`Could not find button, skipping...`);
          continue;
        }

        if (!DomUtils.isElementInViewport(freshButton)) {
          log(`Button moved out of viewport, scrolling...`);
          await DomUtils.smoothScrollToElement(freshButton, T, log);
          await SharedUtils.sleep(500);
        }

        log(`Clicking Reserve button...`);
        freshButton.click();

        const afterClickWait = SharedUtils.randomInRange(T.afterClick.min, T.afterClick.max);
        log(`Waiting ${(afterClickWait / 1000).toFixed(1)}s after click...`);
        await SharedUtils.sleep(afterClickWait);

        const tabInfo = await sendMessage('GET_MOST_RECENT_OFFER_TAB');

        if (tabInfo?.url && tabInfo.url.includes('/carsearch/details')) {
          log(`New offer tab detected: ${tabInfo.url}`);
          await SharedUtils.sleep(SharedUtils.randomInRange(2000, 3500));
          await processOfferPage(carInfo);
        } else {
          log(`No new tab detected`);
        }

        await closeOfferTabs();
        await SharedUtils.sleep(SharedUtils.randomInRange(1000, 1500));
        window.focus();

        scrapedCars.push(carInfo);
        processedAny = true;

        if (targetModels.length > 0) {
          vehiclesPerModel[carInfo._matchedModel]++;
          log(`Model counts: ${JSON.stringify(vehiclesPerModel)}`);

          if (targetModels.every(model => vehiclesPerModel[model] >= maxPerDate)) {
            log(`All target models reached max (${maxPerDate}), stopping`);
            return scrapedCars.length - lastCount;
          }
        }

        break;
      }

      if (!processedAny) {
        const loadMoreBtn = document.getElementById('paginationShowMoreBtn');
        if (loadMoreBtn && !loadMoreBtn.disabled) {
          log('Clicking "Show More" button...');
          await DomUtils.smoothScrollToElement(loadMoreBtn, T, log);
          await SharedUtils.sleep(SharedUtils.randomInRange(T.beforeClick.min, T.beforeClick.max));
          loadMoreBtn.click();

          const waitTime = SharedUtils.randomInRange(T.paginationWait.min, T.paginationWait.max);
          log(`Waiting ${(waitTime / 1000).toFixed(1)}s for more results...`);
          await SharedUtils.sleep(waitTime);
        } else {
          const currentScroll = window.scrollY;
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

          if (currentScroll < maxScroll - 100) {
            log('No visible unprocessed cards, scrolling down...');
            await DomUtils.scrollDownPage(SharedUtils.randomInRange(300, 600), T);
          }
        }
      }

      const count = scrapedCars.length;
      if (count > lastCount) {
        idle = 0;
        lastCount = count;
      } else {
        idle++;
        log(`No progress: idle=${idle}/${T.maxIdleRounds}`);
      }

      const scanWait = SharedUtils.randomInRange(T.scanInterval.min, T.scanInterval.max);
      await SharedUtils.sleep(scanWait);
    }

    log(`Scraping loop completed after ${idle} idle rounds`);
    log(`scrapeCurrentPage returning. Cars found this round: ${scrapedCars.length - lastCount}`);

    sendMessage('UPDATE_STATE', {
      scrapedCars,
      seenKeys: Array.from(seenKeys)
    });

    return scrapedCars.length - lastCount;
  }

  // ============================================================================
  // MAIN SCRAPER
  // ============================================================================

  async function runScraper(config) {
    const { location, durations, targetModels, maxPerDate } = config;

    log('START durations:', durations, '(length:', durations.length, ')');
    log('TARGET_MODELS:', targetModels);
    log('LOCATION:', location);
    log('Will run', durations.length, 'rounds for durations:', durations.join(', '));

    if (!isResultsPage()) {
      log('Not on results page. Please navigate to Expedia search results first.');
      return;
    }

    const state = {
      scrapedCars: [],
      seenKeys: new Set()
    };

    const now = new Date();

    log(`About to start loop. durations.length = ${durations.length}`);
    for (let i = 0; i < durations.length; i++) {
      log(`FOR LOOP: Entering iteration i=${i}`);
      try {
        const days = durations[i];
        const pickupDate = SharedUtils.addDays(now, 1);
        const dropoffDate = SharedUtils.addDays(pickupDate, days);

        const meta = {
          pickup_date: SharedUtils.formatDateLocal(pickupDate),
          dropoff_date: SharedUtils.formatDateLocal(dropoffDate),
          rental_days: days
        };

        log(`\n========== Round ${i + 1}/${durations.length} ==========`);
        log(`Dates: ${meta.pickup_date} -> ${meta.dropoff_date} | days=${days}`);

        if (i > 0) {
          log('Changing dates for next round...');
          const datesSet = await setDates(pickupDate, dropoffDate);
          if (!datesSet) {
            log('Failed to set dates, skipping this round');
            continue;
          }

          log('Waiting for results to reload...');
          await SharedUtils.sleep(SharedUtils.randomInRange(T.dateChangeWait.min, T.dateChangeWait.max));

          let attempts = 0;
          while (!isResultsPage() && attempts < 10) {
            await SharedUtils.sleep(1000);
            attempts++;
          }

          if (!isResultsPage()) {
            log('Results page not ready after date change, skipping');
            continue;
          }
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
        await SharedUtils.sleep(1000);

        log(`Starting scrapeCurrentPage for round ${i + 1}...`);
        const count = await scrapeCurrentPage(meta, state, { targetModels, maxPerDate });
        log(`Round ${i + 1} complete. Collected ${count} vehicles. Total: ${state.scrapedCars.length}`);
        log(`Loop iteration ${i} finished, moving to next...`);

        if (i < durations.length - 1) {
          const pauseTime = SharedUtils.randomInRange(2000, 4000);
          log(`Pausing ${(pauseTime / 1000).toFixed(1)}s before next round...`);
          await SharedUtils.sleep(pauseTime);
        }
        log(`FOR LOOP: End of try block for i=${i}`);
      } catch (err) {
        log(`Error in round ${i + 1}: ${err.message}`);
        console.error(err);
      }
      log(`FOR LOOP: Exiting iteration i=${i}, about to increment`);
    }
    log(`FOR LOOP: Exited. All iterations done.`);

    sendMessage('STOP_SCRAPING').then(() => log('Background worker notified of completion'));

    log('All rounds complete. Total cars scraped:', state.scrapedCars.length);
    log('Downloading CSV...');
    CsvExport.downloadCSV(state.scrapedCars, SITE_NAME, log);
    log('CSV download triggered.');
  }

})();
