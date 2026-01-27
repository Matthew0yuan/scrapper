// Content script dispatcher/router
// Detects which site we're on and forwards messages to the appropriate handler

(function() {
  'use strict';

  console.log('[ROUTER] Content dispatcher loaded on:', window.location.href);

  // ===========================
  // Site Detection
  // ===========================
  function detectSite() {
    const url = window.location.href.toLowerCase();
    if (url.includes('discoverycars.com')) return 'discoverycars';
    if (url.includes('expedia.com') || url.includes('expedia.cn')) return 'expedia';
    return null;
  }

  const SITE = detectSite();

  if (!SITE) {
    console.log('[ROUTER] Not on a supported site (DiscoveryCars or Expedia)');
    console.log('[ROUTER] No scraper will be loaded');
    return;
  }

  console.log(`[ROUTER] ✅ Detected site: ${SITE}`);

  // ===========================
  // Message Listener - Forward to Site-Specific Handler
  // ===========================
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "RUN_SCRAPER") {
      console.log(`[ROUTER] Received RUN_SCRAPER message`);
      console.log(`[ROUTER] Detected site: ${SITE}`);
      console.log(`[ROUTER] Forwarding to ${SITE}-specific handler...`);

      // Forward message to site-specific handler with site info
      msg.site = SITE;

      // The site-specific content scripts are listening for this message
      // They will only respond if msg.site matches their SITE_NAME
      sendResponse({ ok: true });
      return true;
    }
  });

  console.log(`[ROUTER] Ready to route messages to content-${SITE}.js`);

})();
