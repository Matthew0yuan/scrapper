# Multi-Site Content Script Architecture

## Overview

The extension now uses a **decoupled, multi-file architecture** to support multiple car rental websites (DiscoveryCars and Expedia) without mixing site-specific logic.

## Architecture Components

### 1. **content.js** (Router/Dispatcher)
- **Role**: Site detection and message routing
- **Responsibilities**:
  - Detects which website the user is on
  - Receives `RUN_SCRAPER` messages from popup
  - Adds `site` field to messages
  - Forwards messages to site-specific handlers
- **Size**: ~50 lines (minimal)
- **Coupling**: Zero coupling to site-specific logic

### 2. **content-discoverycars.js** (DiscoveryCars Handler)
- **Role**: Complete DiscoveryCars scraping implementation
- **Responsibilities**:
  - Listens for `RUN_SCRAPER` messages where `msg.site === 'discoverycars'`
  - Handles DiscoveryCars-specific DOM selectors
  - Implements scroll + button pagination
  - Extracts payment data from `.OfferPriceBreakdown`
  - Manages DiscoveryCars date picker (React-date-range)
- **Size**: ~650 lines
- **Coupling**: Zero coupling to Expedia logic

### 3. **content-expedia.js** (Expedia Handler)
- **Role**: Complete Expedia scraping implementation
- **Responsibilities**:
  - Listens for `RUN_SCRAPER` messages where `msg.site === 'expedia'`
  - Handles Expedia-specific aria-label parsing
  - Implements button-only pagination (no scrolling)
  - Extracts payment data from UITK elements
  - Manages Expedia date picker (UITK calendar)
  - Skips home page setup (starts directly on results page)
  - Uses longer wait times (5-7s for pagination, 7-10s for offer pages, 15s after date changes)
- **Size**: ~550 lines
- **Coupling**: Zero coupling to DiscoveryCars logic

## Message Flow

```
┌─────────────┐                 ┌──────────────┐                 ┌────────────────────────┐
│   Popup     │                 │  content.js  │                 │  content-{site}.js     │
│  (popup.js) │                 │   (Router)   │                 │  (Site Handler)        │
└─────────────┘                 └──────────────┘                 └────────────────────────┘
      │                                │                                     │
      │ 1. RUN_SCRAPER                 │                                     │
      │ (cfg)                          │                                     │
      ├───────────────────────────────>│                                     │
      │                                │                                     │
      │                                │ 2. Detect site                      │
      │                                │    Add msg.site = 'expedia'         │
      │                                │                                     │
      │                                │ 3. RUN_SCRAPER                      │
      │                                │    (cfg, site='expedia')            │
      │                                ├────────────────────────────────────>│
      │                                │                                     │
      │                                │                                     │ 4. Check msg.site
      │                                │                                     │    Run if matched
      │                                │                                     │
      │ 5. Response { ok: true }       │                                     │
      │ <──────────────────────────────┤                                     │
      │                                │                                     │
```

## File Loading

All three content scripts are loaded by `manifest.json`:

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["content.js", "content-discoverycars.js", "content-expedia.js"],
    "run_at": "document_idle"
  }
]
```

**Important**:
- All scripts load on every page
- Only the router (`content.js`) responds initially
- Site-specific handlers only activate when `msg.site` matches their `SITE_NAME`

## Benefits of This Architecture

### 1. **Zero Coupling**
- No `if (SITE === 'expedia')` branches in shared code
- Each site has its own complete implementation
- Easy to read and understand site-specific logic

### 2. **Easy Maintenance**
- Update DiscoveryCars logic without touching Expedia code
- Update Expedia logic without touching DiscoveryCars code
- Router remains stable and rarely needs changes

### 3. **Easy Extension**
- To add a new site (e.g., Kayak):
  1. Create `content-kayak.js` with `SITE_NAME = 'kayak'`
  2. Add to `manifest.json`: `"content-kayak.js"`
  3. Update router to detect `kayak.com`
  4. Done!

### 4. **Clear Separation of Concerns**
- **Router**: Site detection only
- **DiscoveryCars**: DiscoveryCars scraping only
- **Expedia**: Expedia scraping only

### 5. **Independent Testing**
- Test DiscoveryCars scraper in isolation
- Test Expedia scraper in isolation
- No interference between sites

## Site-Specific Differences

| Feature | DiscoveryCars | Expedia |
|---------|--------------|---------|
| **Home page setup** | ✅ Yes (fills location, dates) | ❌ No (starts on results) |
| **Results page selector** | `.SearchCar-Wrapper` | `button.offer-reserve-button` |
| **Data extraction** | DOM parsing | Aria-label regex |
| **Pagination** | Scroll + button | Button only |
| **Pagination wait** | 1.2s | 5-7s random |
| **Offer page wait** | 5-7s random | 7-10s random |
| **Date change delay** | 3s | 15s |
| **Date picker** | React-date-range | UITK calendar |
| **Offer page selector** | `.OfferPriceBreakdown` | `.uitk-text` |

## Adding a New Site

To add support for a new car rental website:

1. **Create new handler file**: `content-newsite.js`

```javascript
(function() {
  'use strict';

  const SITE_NAME = 'newsite';

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "RUN_SCRAPER" && msg.site === SITE_NAME) {
      // Your site-specific implementation here
      runScraper(msg.cfg);
      sendResponse({ ok: true });
      return true;
    }
  });

  function runScraper(cfg) {
    // Implement your scraping logic here
  }

})();
```

2. **Update manifest.json**:

```json
"js": ["content.js", "content-discoverycars.js", "content-expedia.js", "content-newsite.js"]
```

3. **Update router** (`content.js`):

```javascript
function detectSite() {
  const url = window.location.href.toLowerCase();
  if (url.includes('discoverycars.com')) return 'discoverycars';
  if (url.includes('expedia.com') || url.includes('expedia.cn')) return 'expedia';
  if (url.includes('newsite.com')) return 'newsite'; // Add this line
  return null;
}
```

4. **Done!** No changes needed to existing site handlers.

## Code Reuse vs. Duplication

**Trade-off**: Some utility functions (like `toYMDLocal`, `classifyModel`) are duplicated across site files.

**Why this is acceptable**:
- Each site file is **fully self-contained** and can be understood independently
- Prevents coupling through shared utilities
- Easier to customize per-site (e.g., Expedia might need different category mapping)
- Only ~50 lines of duplication per site
- Clearer than a complex shared utilities system

**Alternative considered**: Shared utilities file
- Would add coupling (all sites depend on one file)
- Harder to customize site-specific behavior
- More complex architecture
- Not worth it for ~50 lines of simple utilities

## Performance

**Question**: Won't loading all scripts on every page be slow?

**Answer**: No, because:
1. Content scripts are small (50-650 lines)
2. Only one site handler actually runs (others remain idle)
3. Chrome V8 is extremely fast at parsing JS
4. Scripts are cached after first load
5. Total overhead: < 5ms

## Summary

This architecture prioritizes **simplicity, maintainability, and separation of concerns** over minimal code duplication. Each site gets its own clean, self-contained implementation that can be developed, tested, and updated independently.
