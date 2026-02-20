// Background service worker for managing scraping across page navigations

let scrapingState = {
  active: false,
  scrapedCars: [],
  seenKeys: [],
  config: null,
  currentCar: null,
  waitingForOfferPage: false,
  waitingForSearchPage: false
};

// Cache for payment data from offer pages opened in new tabs
const paymentDataCache = new Map();

// Track tabs that we're waiting to extract from
const pendingExtractionTabs = new Map(); // tabId -> offerUrl

// Track the most recently created offer tab (for Expedia which can't get URL before opening)
let mostRecentOfferTab = null; // { tabId, url, timestamp }

// Restore state from storage when service worker starts
(async () => {
  const stored = await chrome.storage.local.get(['scrapingState']);
  if (stored.scrapingState) {
    scrapingState = stored.scrapingState;
    console.log('[BG] Restored scraping state from storage:', scrapingState);
  }
})();

// Helper to persist state to storage
function persistState() {
  chrome.storage.local.set({ scrapingState });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[BG] Received message:', message.type);

  if (message.type === 'START_SCRAPING') {
    // Initialize scraping
    scrapingState.active = true;
    scrapingState.config = message.config;
    scrapingState.scrapedCars = [];
    scrapingState.seenKeys = [];
    console.log('[BG] Scraping started with config:', message.config);
    persistState(); // Save to storage
    sendResponse({ success: true });

  } else if (message.type === 'UPDATE_STATE') {
    // Update scraping state (cars, seen keys)
    if (message.scrapedCars) {
      scrapingState.scrapedCars = message.scrapedCars;
    }
    if (message.seenKeys) {
      scrapingState.seenKeys = message.seenKeys;
    }
    persistState(); // Save to storage
    sendResponse({ success: true });

  } else if (message.type === 'GET_STATE') {
    // Return current scraping state
    console.log('[BG] ========================================');
    console.log('[BG] GET_STATE Request');
    console.log('[BG] Current state - active:', scrapingState.active);
    console.log('[BG] Current state - scraped cars:', scrapingState.scrapedCars.length);
    console.log('[BG] Current state - config:', scrapingState.config);
    sendResponse({
      active: scrapingState.active,
      config: scrapingState.config,
      scrapedCars: scrapingState.scrapedCars,
      seenKeys: scrapingState.seenKeys,
      waitingForOfferPage: scrapingState.waitingForOfferPage,
      waitingForSearchPage: scrapingState.waitingForSearchPage
    });

  } else if (message.type === 'NAVIGATE_TO_OFFER') {
    // Content script is clicking to navigate to offer page
    console.log('[BG] Preparing to extract from offer page:', message.url);
    scrapingState.waitingForOfferPage = true;
    scrapingState.currentCar = message.carInfo;
    // Don't navigate here - the content script is clicking the button
    sendResponse({ success: true });

  } else if (message.type === 'OFFER_EXTRACTED') {
    // Received payment data from offer page, go back to search
    console.log('[BG] Offer data extracted:', message.paymentData);
    scrapingState.currentCar.pay_now = message.paymentData.payNow;
    scrapingState.currentCar.pay_at_pickup = message.paymentData.payAtPickup;
    scrapingState.scrapedCars.push(scrapingState.currentCar);
    scrapingState.waitingForSearchPage = true;

    // Go back to search results
    chrome.tabs.goBack(sender.tab.id);
    sendResponse({ success: true });

  } else if (message.type === 'STORE_PAYMENT_DATA') {
    // Store payment data from offer page opened in new tab
    console.log('[BG] Storing payment data for:', message.url);
    console.log('[BG] Payment data:', message.paymentData);

    // Store with multiple keys to handle URL variations
    // Extract the core offer ID from the URL (e.g., /offer/xxx)
    const offerIdMatch = message.url.match(/\/offer\/([^/?#]+)/);
    const offerId = offerIdMatch ? offerIdMatch[1] : null;

    // Store with full URL
    paymentDataCache.set(message.url, message.paymentData);

    // Also store with offer ID if found (for easier matching)
    if (offerId) {
      paymentDataCache.set(offerId, message.paymentData);
      console.log('[BG] Also stored with offer ID:', offerId);
    }

    console.log('[BG] Cache now has', paymentDataCache.size, 'entries');
    sendResponse({ success: true });

  } else if (message.type === 'GET_PAYMENT_DATA') {
    // Retrieve payment data by offer URL
    console.log('[BG] ========================================');
    console.log('[BG] GET_PAYMENT_DATA Request');
    console.log('[BG] Looking for URL:', message.offerUrl);
    console.log('[BG] Cache has', paymentDataCache.size, 'entries:');
    Array.from(paymentDataCache.keys()).forEach(key => {
      console.log('[BG]   -', key);
    });

    let data = paymentDataCache.get(message.offerUrl);

    // If not found by full URL, try to extract offer ID and search by that
    if (!data) {
      const offerIdMatch = message.offerUrl.match(/\/offer\/([^/?#]+)/);
      const offerId = offerIdMatch ? offerIdMatch[1] : null;

      if (offerId) {
        console.log('[BG] Trying with offer ID:', offerId);
        data = paymentDataCache.get(offerId);
      }

      // If still not found, try fuzzy match (any key containing the offer ID)
      if (!data && offerId) {
        for (const [key, value] of paymentDataCache.entries()) {
          if (key.includes(offerId)) {
            console.log('[BG] Found fuzzy match with key:', key);
            data = value;
            break;
          }
        }
      }
    }

    if (data) {
      console.log('[BG] ✅ Retrieved payment data:', data);
      // Don't delete yet - keep it for retry attempts
      sendResponse(data);
    } else {
      console.log('[BG] ❌ No payment data found');
      sendResponse({ payNow: '', payAtPickup: '' });
    }

  } else if (message.type === 'TRACK_NEW_TAB') {
    // Track a new tab that should extract offer page data
    console.log('[BG] Tracking new tab for URL:', message.offerUrl);
    // We'll match this when tab loads
    if (sender.tab && sender.tab.id) {
      pendingExtractionTabs.set(message.offerUrl, true);
      console.log('[BG] Added to pending extraction:', message.offerUrl);
    }
    sendResponse({ success: true });

  } else if (message.type === 'GET_MOST_RECENT_OFFER_TAB') {
    // Get the most recently opened offer tab info
    console.log('[BG] GET_MOST_RECENT_OFFER_TAB Request');

    if (mostRecentOfferTab) {
      console.log('[BG] ✅ Most recent offer tab:', mostRecentOfferTab.url);
      sendResponse(mostRecentOfferTab);
    } else {
      console.log('[BG] ❌ No recent offer tab tracked');
      sendResponse(null);
    }

  } else if (message.type === 'GET_PAYMENT_DATA_FROM_RECENT_TAB') {
    // Get payment data from the most recently added cache entry
    console.log('[BG] ========================================');
    console.log('[BG] GET_PAYMENT_DATA_FROM_RECENT_TAB Request');
    console.log('[BG] Cache has', paymentDataCache.size, 'entries');

    if (paymentDataCache.size > 0) {
      // Get the most recent entry (last one added)
      const entries = Array.from(paymentDataCache.entries());
      const [url, data] = entries[entries.length - 1];
      console.log('[BG] ✅ Retrieved most recent payment data from:', url);
      console.log('[BG] Data:', data);
      sendResponse({ ...data, url });
    } else {
      console.log('[BG] ❌ No payment data in cache');
      sendResponse({ payNow: '', payAtPickup: '', url: '' });
    }

  } else if (message.type === 'CLOSE_SPECIFIC_OFFER_TAB') {
    // Close a specific offer tab by URL and remove its cache entry
    console.log('[BG] Closing specific offer tab:', message.offerUrl);

    chrome.tabs.query({}, (tabs) => {
      const matchingTab = tabs.find(tab => tab.url && tab.url === message.offerUrl);

      if (matchingTab) {
        console.log(`[BG] Found tab ${matchingTab.id}, closing...`);
        chrome.tabs.remove(matchingTab.id);

        // Remove this specific entry from cache
        if (paymentDataCache.has(message.offerUrl)) {
          paymentDataCache.delete(message.offerUrl);
          console.log('[BG] Removed from cache:', message.offerUrl);
        }

        // Also remove by offer ID if it exists
        const offerIdMatch = message.offerUrl.match(/\/offer\/([^/?#]+)/);
        if (offerIdMatch) {
          const offerId = offerIdMatch[1];
          if (paymentDataCache.has(offerId)) {
            paymentDataCache.delete(offerId);
            console.log('[BG] Also removed offer ID from cache:', offerId);
          }
        }

        sendResponse({ success: true, closed: true });
      } else {
        console.log('[BG] ⚠️ Tab not found for URL:', message.offerUrl);
        sendResponse({ success: false, closed: false });
      }
    });

  } else if (message.type === 'CLOSE_OFFER_TABS') {
    // Close all offer page tabs and clear cache
    console.log('[BG] Closing offer page tabs and clearing cache...');

    chrome.tabs.query({}, (tabs) => {
      const offerTabs = tabs.filter(tab =>
        tab.url && (tab.url.includes('/carsearch/details') || tab.url.includes('/offer/'))
      );

      console.log(`[BG] Found ${offerTabs.length} offer page tabs to close`);

      offerTabs.forEach(tab => {
        console.log(`[BG] Closing tab ${tab.id}: ${tab.url}`);
        chrome.tabs.remove(tab.id);
      });

      // Clear the payment data cache
      paymentDataCache.clear();
      console.log('[BG] ✅ Cache cleared');

      // Reset the most recent offer tab tracker
      mostRecentOfferTab = null;
      console.log('[BG] ✅ Reset most recent offer tab tracker');

      sendResponse({ success: true, closedTabs: offerTabs.length });
    });

  } else if (message.type === 'STOP_SCRAPING') {
    // Stop scraping and download CSV
    scrapingState.active = false;
    persistState(); // Save to storage
    sendResponse({ scrapedCars: scrapingState.scrapedCars });
  }

  return true; // Keep channel open for async response
});

// Listen for tab updates to detect page loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('[BG] Tab loaded:', tab.url);

    // Check if this is a pending extraction tab
    let shouldExtract = false;
    for (const [trackedUrl, _] of pendingExtractionTabs.entries()) {
      if (tab.url.includes(trackedUrl) || trackedUrl.includes(tab.url)) {
        console.log('[BG] ✅ Found pending extraction tab!');
        shouldExtract = true;
        // Don't remove yet - keep for retries
        break;
      }
    }

    // Also check for offer pages when scraping is active
    // DiscoveryCars uses '/offer/', Expedia uses '/carsearch/details'
    if (!shouldExtract && scrapingState.active &&
      (tab.url.includes('/offer/') || tab.url.includes('/carsearch/details'))) {
      console.log('[BG] Detected offer page while scraping is active');
      shouldExtract = true;

      // Track this as the most recent offer tab (for Expedia)
      mostRecentOfferTab = {
        tabId: tabId,
        url: tab.url,
        timestamp: Date.now()
      };
      console.log('[BG] Tracked as most recent offer tab:', mostRecentOfferTab.url);
    }

    if (shouldExtract) {
      console.log('[BG] Sending EXTRACT_OFFER_PAGE to tab', tabId);
      // Wait 7 seconds for page to fully load and render (Expedia is slower)
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          type: 'EXTRACT_OFFER_PAGE'
        }).then(() => {
          console.log('[BG] Successfully sent extract message');
        }).catch(err => {
          console.log('[BG] Failed to send extract message:', err);
        });
      }, 7000);
    }

    // OLD LOGIC - keep for backwards compatibility
    if (scrapingState.waitingForOfferPage) {
      console.log('[BG] (OLD) Offer page loaded, sending extract command');
      scrapingState.waitingForOfferPage = false;

      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          type: 'EXTRACT_OFFER_PAGE',
          carInfo: scrapingState.currentCar
        }).catch(err => console.log('[BG] Failed to send message:', err));
      }, 1000);

    } else if (scrapingState.waitingForSearchPage) {
      console.log('[BG] (OLD) Back on search page, continuing scraping');
      scrapingState.waitingForSearchPage = false;

      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          type: 'CONTINUE_SCRAPING'
        }).catch(err => console.log('[BG] Failed to send message:', err));
      }, 1000);
    }
  }
});

console.log('[BG] Background service worker loaded');
