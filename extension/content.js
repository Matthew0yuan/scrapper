// Content script dispatcher/router
// Site-specific scripts (content-discoverycars.js, content-expedia.js) handle messages directly
// This file is kept for potential shared initialization logic

(function() {
  'use strict';

  console.log('[ROUTER] Content scripts loaded on:', window.location.href);

  // No message handling here - each site script checks msg.cfg?.site directly

})();
