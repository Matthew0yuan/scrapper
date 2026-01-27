/**
 * Expedia Car Rental Scraper - Content Script
 * Extracts car rental pricing data from Expedia search results
 */

(function () {
  'use strict';

  // ============================================================================
  // CONSTANTS & CONFIGURATION
  // ============================================================================

  const SITE_NAME = 'expedia';
  const LOG_PREFIX = `[${SITE_NAME.toUpperCase()}]`;

  const DEFAULT_CONFIG = {
    location: 'Perth (all locations), Australia',
    durations: '1,2,3,4,5,6,7,8',
    models: '',
    maxPerDate: 30
  };

  const TIMING = {
    // Slower, more human-like timing
    scanInterval: { min: 2000, max: 4000 },
    maxIdleRounds: 8,
    paginationWait: { min: 6000, max: 10000 },
    offerExtractWait: { min: 10000, max: 14000 },
    pollInterval: 3000,
    maxPollAttempts: 12,
    // Scrolling behavior
    scrollStep: { min: 200, max: 400 },
    scrollPause: { min: 800, max: 1500 },
    beforeClick: { min: 1000, max: 2000 },
    afterClick: { min: 2000, max: 3500 }
  };

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  const log = (...args) => console.log(LOG_PREFIX, ...args);
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
  const round2 = (n) => Math.round(n * 100) / 100;
  const randomInRange = (min, max) => min + Math.random() * (max - min);

  function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function parseCommaSeparatedList(str, transform = (x) => x) {
    if (!str) return [];
    return str.split(',').map(item => transform(item.trim())).filter(Boolean);
  }

  function parseIntList(str) {
    return parseCommaSeparatedList(str, item => {
      const num = parseInt(item, 10);
      return isNaN(num) ? null : num;
    }).filter(n => n !== null);
  }

  // ============================================================================
  // DOM UTILITIES
  // ============================================================================

  async function waitForElement(selector, timeoutMs = 10000, intervalMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const element = document.querySelector(selector);
      if (element) return element;
      await sleep(intervalMs);
    }
    return null;
  }

  function isResultsPage() {
    return !!document.querySelector('button.offer-reserve-button');
  }

  function isElementInViewport(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    // Check if element is fully visible in viewport
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= windowHeight &&
      rect.right <= windowWidth
    );
  }

  function isElementPartiallyVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    // Check if at least part of the element is visible
    return rect.top < windowHeight && rect.bottom > 0;
  }

  async function smoothScrollToElement(el) {
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    // Calculate target position (element centered in viewport)
    const targetScrollY = window.scrollY + rect.top - (windowHeight / 2) + (rect.height / 2);
    const currentScrollY = window.scrollY;
    const distance = targetScrollY - currentScrollY;

    if (Math.abs(distance) < 50) return; // Already close enough

    // Scroll in small increments for human-like behavior
    const steps = Math.ceil(Math.abs(distance) / randomInRange(TIMING.scrollStep.min, TIMING.scrollStep.max));
    const stepSize = distance / steps;

    log(`Scrolling to element (${steps} steps, ${Math.round(distance)}px)...`);

    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, stepSize);
      await sleep(randomInRange(30, 80)); // Small delay between scroll steps
    }

    // Pause after scrolling like a human would
    await sleep(randomInRange(TIMING.scrollPause.min, TIMING.scrollPause.max));
  }

  async function scrollDownPage(pixels) {
    const steps = Math.ceil(pixels / randomInRange(TIMING.scrollStep.min, TIMING.scrollStep.max));
    const stepSize = pixels / steps;

    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, stepSize);
      await sleep(randomInRange(30, 80));
    }

    await sleep(randomInRange(TIMING.scrollPause.min, TIMING.scrollPause.max));
  }

  // ============================================================================
  // DATE PICKER HANDLING
  // ============================================================================

  function getCalendarPanel() {
    return document.querySelector('.uitk-calendar');
  }

  async function waitForCalendar(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const panel = getCalendarPanel();
      if (panel) return panel;
      await sleep(200);
    }
    return null;
  }

  async function openDatePicker() {
    const dateBtn = document.querySelector('button[data-testid="uitk-date-selector-input1-default"]');
    if (!dateBtn) {
      log('Date picker button not found');
      return false;
    }

    log('Opening date picker...');
    dateBtn.click();
    await sleep(500);

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

    const dayName = days[date.getDay()];
    const monthName = months[date.getMonth()];
    const dayNum = date.getDate();
    const year = date.getFullYear();

    return `${dayName}, ${monthName} ${dayNum}, ${year}`;
  }

  async function clickDateInCalendar(date) {
    const calendar = getCalendarPanel();
    if (!calendar) {
      log('Calendar not found');
      return false;
    }

    const targetLabel = formatDateForAriaLabel(date);
    log(`Looking for date: ${targetLabel}`);

    // Find all clickable day buttons
    const dayButtons = calendar.querySelectorAll('.uitk-day-button.uitk-day-clickable');

    for (const btn of dayButtons) {
      const ariaLabelEl = btn.querySelector('.uitk-day-aria-label');
      if (ariaLabelEl) {
        const ariaLabel = ariaLabelEl.getAttribute('aria-label') || '';
        if (ariaLabel.startsWith(targetLabel)) {
          log(`Clicking date: ${ariaLabel}`);
          btn.click();
          await sleep(300);
          return true;
        }
      }
    }

    log(`Date not found in current view: ${targetLabel}`);
    return false;
  }

  async function clickDoneButton() {
    const doneBtn = document.querySelector('button[data-stid="apply-date-selector"]');
    if (!doneBtn) {
      log('Done button not found');
      return false;
    }

    log('Clicking Done button...');
    doneBtn.click();
    await sleep(500);
    return true;
  }

  async function setDates(pickupDate, dropoffDate) {
    log(`Setting dates: ${formatDateLocal(pickupDate)} to ${formatDateLocal(dropoffDate)}`);

    // Open date picker
    const opened = await openDatePicker();
    if (!opened) return false;

    await sleep(300);

    // Click pickup date
    const clickedPickup = await clickDateInCalendar(pickupDate);
    if (!clickedPickup) {
      log('Failed to click pickup date');
      return false;
    }

    await sleep(300);

    // Click dropoff date
    const clickedDropoff = await clickDateInCalendar(dropoffDate);
    if (!clickedDropoff) {
      log('Failed to click dropoff date');
      return false;
    }

    await sleep(300);

    // Click Done
    const clicked = await clickDoneButton();
    if (!clicked) {
      log('Failed to click Done button');
      return false;
    }

    // Wait for calendar to close
    await sleep(500);

    log(`Dates set successfully: ${formatDateLocal(pickupDate)} to ${formatDateLocal(dropoffDate)}`);
    return true;
  }

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  function parseScraperConfig(cfg) {
    return {
      location: cfg.location || DEFAULT_CONFIG.location,
      durations: parseIntList(cfg.durations || DEFAULT_CONFIG.durations),
      targetModels: parseCommaSeparatedList(
        cfg.models || DEFAULT_CONFIG.models,
        m => m.toLowerCase().replace(/\s+/g, '')
      ),
      maxPerDate: parseInt(cfg.maxPerDate, 10) || DEFAULT_CONFIG.maxPerDate
    };
  }

  function sendMessage(type, data = {}) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type, ...data }, resolve);
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'RUN_SCRAPER') return;

    // Log the received config for debugging
    log('Received config:', JSON.stringify(msg.cfg));
    log('Durations from popup:', msg.cfg?.durations);

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

    const priceDetails = await waitForElement('.price-details', 10000);
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

    const totalBreakup = await waitForElement('.total-breakup', 8000, 800);
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
    const items = container.querySelectorAll('.uitk-typelist-item');
    const result = { payNow: '', payAtPickup: '' };

    items.forEach(item => {
      const flexDiv = item.querySelector('.uitk-layout-flex');
      if (!flexDiv) return;

      const textElements = flexDiv.querySelectorAll('.uitk-text');
      if (textElements.length < 2) return;

      const label = normalize(textElements[0].textContent).toLowerCase();
      const value = normalize(textElements[1].textContent);

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
  // CAR MODEL CLASSIFICATION
  // ============================================================================

  const MODEL_CATEGORIES = [
    { pattern: /(picanto|rio|mg3)/i, code: 'EDAR', group: 'Picanto, Rio & MG3' },
    { pattern: /(cerato|corolla|i30)/i, code: 'SEDAN', group: 'Cerato, Corolla & i30' },
    { pattern: /(camry|mazda6|accord)/i, code: 'IDAR', group: 'Camry, Mazda6 & Accord' },
    { pattern: /(seltos|qashqai|cx-5)/i, code: 'IFAR', group: 'Seltos, Qashqai & CX-5' },
    { pattern: /(sorento|santa\s*fe|cx-9)/i, code: 'SFAR', group: 'Sorento, Santa Fe & CX-9' }
  ];

  function classifyModel(fullName) {
    const category = MODEL_CATEGORIES.find(cat => cat.pattern.test(fullName));
    return category
      ? { category_code: category.code, category_group: category.group }
      : { category_code: 'OTHER', category_group: 'Other' };
  }

  // ============================================================================
  // CAR CARD PARSING
  // ============================================================================

  function parseExpediaCard(button, meta, targetModels) {
    const ariaLabel = button.getAttribute('aria-label') || '';

    // Pattern: Reserve ... from [Company] (for|at) $[Price] total
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

    // Check target models filter
    const matchedModel = findMatchingModel(fullName, targetModels);
    if (targetModels.length > 0 && !matchedModel) {
      log(`Skipping ${fullName} (not in target models)`);
      return null;
    }

    if (matchedModel) {
      log(`Match found! ${fullName} matches target: ${matchedModel}`);
    }

    const { category_code, category_group } = classifyModel(fullName);
    const avgDaily = meta.rental_days > 0 ? round2(priceValue / meta.rental_days) : '';
    const uniqueKey = `${baseName}|${company}|${priceValue}|${meta.pickup_date}|${meta.dropoff_date}|${category_code}`;

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
      const iconSection = cardRoot.querySelector('.icon-s');
      if (iconSection) {
        const carNameEl = iconSection.querySelector('.uitk-text.uitk-type-300.uitk-spacing-margin-blockend-one');
        if (carNameEl) return normalize(carNameEl.textContent);
      }
      cardRoot = cardRoot.parentElement;
      maxLevels--;
    }

    return '';
  }

  function findMatchingModel(fullName, targetModels) {
    if (targetModels.length === 0) return null;
    const normalizedName = fullName.toLowerCase().replace(/\s+/g, '');
    return targetModels.find(m => normalizedName.includes(m.toLowerCase().replace(/\s+/g, '')));
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

    const waitTime = randomInRange(TIMING.offerExtractWait.min, TIMING.offerExtractWait.max);
    log(`Waiting ${(waitTime / 1000).toFixed(1)}s for extraction...`);
    await sleep(waitTime);

    log('Starting to poll for payment data...');

    for (let attempt = 1; attempt <= TIMING.maxPollAttempts; attempt++) {
      await sleep(TIMING.pollInterval);
      log(`Poll attempt ${attempt}/${TIMING.maxPollAttempts}`);

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

    log(`Payment data not retrieved after ${TIMING.maxPollAttempts} attempts`);
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
  // SCRAPING LOOP
  // ============================================================================

  async function scrapeCurrentPage(meta, state, config) {
    const { scrapedCars, seenKeys } = state;
    const { targetModels, maxPerDate } = config;

    const vehiclesPerModel = {};
    targetModels.forEach(model => { vehiclesPerModel[model] = 0; });

    let idle = 0;
    let lastCount = scrapedCars.length;

    while (idle < TIMING.maxIdleRounds) {
      log(`Scan iteration: idle=${idle}/${TIMING.maxIdleRounds}, cars so far=${scrapedCars.length}`);

      // Get all cards and find ones we haven't processed yet
      const allCards = Array.from(document.querySelectorAll('button.offer-reserve-button'));
      log(`Found ${allCards.length} reserve buttons on page`);

      // Find the next unprocessed card that is visible or can be scrolled to
      let processedAny = false;

      for (const card of allCards) {
        const carInfo = parseExpediaCard(card, meta, targetModels);
        if (!carInfo) continue;

        if (seenKeys.has(carInfo._uniqueKey)) continue;

        if (targetModels.length > 0) {
          const model = carInfo._matchedModel;
          if (vehiclesPerModel[model] >= maxPerDate) continue;
        }

        // Found a card to process - scroll it into view first
        if (!isElementInViewport(card)) {
          log(`Scrolling to card: ${carInfo.car_name_base}...`);
          await smoothScrollToElement(card);

          // Verify it's now visible
          if (!isElementPartiallyVisible(card)) {
            log(`Card not visible after scroll, skipping...`);
            continue;
          }
        }

        // Card is now visible - mark as seen and process
        seenKeys.add(carInfo._uniqueKey);
        log(`Target vehicle found (visible): ${carInfo.car_name_base}`);

        // Human-like pause before clicking
        const beforeClickWait = randomInRange(TIMING.beforeClick.min, TIMING.beforeClick.max);
        log(`Pausing ${(beforeClickWait / 1000).toFixed(1)}s before clicking...`);
        await sleep(beforeClickWait);

        // Close any existing offer tabs first to get clean state
        await closeOfferTabs();
        await sleep(500);

        // Re-query the button fresh before clicking (DOM may have changed)
        const savedAriaLabel = card.getAttribute('aria-label') || '';
        const freshButton = Array.from(document.querySelectorAll('button.offer-reserve-button'))
          .find(btn => (btn.getAttribute('aria-label') || '') === savedAriaLabel);

        if (!freshButton) {
          log(`Could not find button, skipping...`);
          continue;
        }

        // Ensure button is still in viewport
        if (!isElementInViewport(freshButton)) {
          log(`Button moved out of viewport, scrolling...`);
          await smoothScrollToElement(freshButton);
          await sleep(500);
        }

        // Simple click - complex mouse events not needed
        log(`Clicking Reserve button...`);
        freshButton.click();

        const afterClickWait = randomInRange(TIMING.afterClick.min, TIMING.afterClick.max);
        log(`Waiting ${(afterClickWait / 1000).toFixed(1)}s after click...`);
        await sleep(afterClickWait);

        // Check if new tab was opened
        const tabInfo = await sendMessage('GET_MOST_RECENT_OFFER_TAB');

        if (tabInfo?.url && tabInfo.url.includes('/carsearch/details')) {
          log(`New offer tab detected: ${tabInfo.url}`);
          await sleep(randomInRange(2000, 3500));
          await processOfferPage(carInfo);
        } else {
          log(`No new tab detected`);
        }

        // Close offer tabs and refocus
        await closeOfferTabs();
        await sleep(randomInRange(1000, 1500));
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

        // Break to restart with fresh DOM query after processing each vehicle
        break;
      }

      // If no cards were processed, try scrolling down or clicking "Show More"
      if (!processedAny) {
        // First check if "Show More" button exists and click it
        const loadMoreBtn = document.getElementById('paginationShowMoreBtn');
        if (loadMoreBtn && !loadMoreBtn.disabled) {
          log('Clicking "Show More" button...');
          await smoothScrollToElement(loadMoreBtn);
          await sleep(randomInRange(TIMING.beforeClick.min, TIMING.beforeClick.max));
          loadMoreBtn.click();

          const waitTime = randomInRange(TIMING.paginationWait.min, TIMING.paginationWait.max);
          log(`Waiting ${(waitTime / 1000).toFixed(1)}s for more results...`);
          await sleep(waitTime);
        } else {
          // No "Show More" button, try scrolling down
          const currentScroll = window.scrollY;
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

          if (currentScroll < maxScroll - 100) {
            log('No visible unprocessed cards, scrolling down...');
            await scrollDownPage(randomInRange(300, 600));
          }
        }
      }

      const count = scrapedCars.length;
      if (count > lastCount) {
        idle = 0;
        lastCount = count;
      } else {
        idle++;
        log(`No progress: idle=${idle}/${TIMING.maxIdleRounds}`);
      }

      // Human-like pause between scan iterations
      const scanWait = randomInRange(TIMING.scanInterval.min, TIMING.scanInterval.max);
      await sleep(scanWait);
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
  // CSV EXPORT
  // ============================================================================

  function downloadCSV(cars) {
    const headers = [
      'car_name_full', 'car_name_base', 'company', 'price_value', 'avg_daily_price',
      'pickup_date', 'dropoff_date', 'rental_days', 'category_code', 'category_group',
      'pay_now', 'pay_at_pickup', 'offer_url'
    ];

    const rows = cars.map(car => [
      car.car_name_full, car.car_name_base, car.company, car.price_value, car.avg_daily_price,
      car.pickup_date, car.dropoff_date, car.rental_days, car.category_code, car.category_group,
      car.pay_now, car.pay_at_pickup, car.view_deal_url
    ]);

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(r => r.map(cell => `"${String(cell || '')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cars_expedia_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    log('CSV downloaded. Total rows:', cars.length);
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

    // Loop through all durations
    log(`About to start loop. durations.length = ${durations.length}`);
    for (let i = 0; i < durations.length; i++) {
      log(`FOR LOOP: Entering iteration i=${i}`);
      try {
        const days = durations[i];
        const pickupDate = addDays(now, 1);
        const dropoffDate = addDays(pickupDate, days);

        const meta = {
          pickup_date: formatDateLocal(pickupDate),
          dropoff_date: formatDateLocal(dropoffDate),
          rental_days: days
        };

        log(`\n========== Round ${i + 1}/${durations.length} ==========`);
        log(`Dates: ${meta.pickup_date} -> ${meta.dropoff_date} | days=${days}`);

      // Set dates (skip for first round if dates already match)
      if (i > 0) {
        log('Changing dates for next round...');
        const datesSet = await setDates(pickupDate, dropoffDate);
        if (!datesSet) {
          log('Failed to set dates, skipping this round');
          continue;
        }

        // Wait for results to reload after date change
        log('Waiting for results to reload...');
        await sleep(randomInRange(3000, 5000));

        // Wait for results page to be ready
        let attempts = 0;
        while (!isResultsPage() && attempts < 10) {
          await sleep(1000);
          attempts++;
        }

        if (!isResultsPage()) {
          log('Results page not ready after date change, skipping');
          continue;
        }
      }

      // Scroll to top before scraping
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await sleep(1000);

      log(`Starting scrapeCurrentPage for round ${i + 1}...`);
      const count = await scrapeCurrentPage(meta, state, { targetModels, maxPerDate });
      log(`Round ${i + 1} complete. Collected ${count} vehicles. Total: ${state.scrapedCars.length}`);
      log(`Loop iteration ${i} finished, moving to next...`);

      // Pause between rounds
      if (i < durations.length - 1) {
        const pauseTime = randomInRange(2000, 4000);
        log(`Pausing ${(pauseTime / 1000).toFixed(1)}s before next round...`);
        await sleep(pauseTime);
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
    downloadCSV(state.scrapedCars);
    log('CSV download triggered.');
  }

})();
