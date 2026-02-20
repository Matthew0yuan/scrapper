/**
 * Timing Configuration
 * Centralized timing constants for human-like behavior
 */

const TimingConfig = {
  // ============================================================================
  // EXPEDIA TIMING
  // Slower, more human-like timing for Expedia
  // ============================================================================
  expedia: {
    // Scan/scrape intervals
    scanInterval: { min: 2000, max: 4000 },
    maxIdleRounds: 8,

    // Pagination
    paginationWait: { min: 6000, max: 10000 },

    // Offer page extraction
    offerExtractWait: { min: 10000, max: 14000 },
    pollInterval: 3000,
    maxPollAttempts: 12,

    // Scrolling behavior
    scrollStep: { min: 200, max: 400 },
    scrollPause: { min: 800, max: 1500 },

    // Click timing
    beforeClick: { min: 1000, max: 2000 },
    afterClick: { min: 2000, max: 3500 },

    // Date change
    dateChangeWait: { min: 3000, max: 5000 },

    // Calendar
    calendarWait: 8000,
    calendarPollInterval: 200
  },

  // ============================================================================
  // DISCOVERYCARS TIMING
  // Faster timing for DiscoveryCars (less strict bot detection)
  // ============================================================================
  discoverycars: {
    // Scan/scrape intervals
    scanInterval: 800,
    maxIdleRounds: 5,

    // Scrolling
    scrollStep: 600,

    // Wait times
    panelWaitTimeout: 8000,
    resultExtraWait: 3000,

    // Offer page
    offerWait: { min: 5000, max: 7000 },
    pollInterval: 2000,
    maxPollAttempts: 10,

    // Form interaction
    inputDelay: 50,
    locationWait: 1000,
    searchClickWait: 800,

    // Calendar
    calendarClickWait: 400,
    dateSelectWait: 500,
    panelCloseWait: 8000
  },

  // ============================================================================
  // COMMON TIMING
  // Shared timing constants
  // ============================================================================
  common: {
    shortPause: 200,
    mediumPause: 500,
    longPause: 1000,

    // DOM polling
    elementPollInterval: 500,
    defaultTimeout: 10000
  }
};

// Export for use in content scripts
if (typeof window !== 'undefined') {
  window.TimingConfig = TimingConfig;
}
