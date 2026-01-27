# Car Price Scraper - Chrome Extension

A Chrome extension that automates comprehensive car rental price scraping across multiple durations and exports the results to CSV format with detailed payment breakdowns.

**✅ Supported Sites:**
- **DiscoveryCars.com** (fully tested)
- **Expedia.com / Expedia.cn** (newly added)

**🔄 Auto-Detection**: The extension automatically detects which site you're on and uses the appropriate scraping logic.

**How It Works**: The extension detects the current website automatically and uses site-specific logic:
- **DiscoveryCars**: DOM-based extraction with scroll pagination
- **Expedia**: Aria-label parsing with button-only pagination

**Implementation**: Minimal, loosely-coupled design with site detection at runtime (see [content.js:3-12](content.js#L3-L12))

## Quick Summary

This extension automates the entire car rental price comparison workflow:

1. **Configures search parameters** (location, rental durations, car models, max results per date)
2. **Automates search form** (fills location, selects dates, submits)
3. **Scrapes search results** (scrolls, paginate, extracts car details)
4. **Extracts payment details** (opens offer pages in new tabs, extracts payment breakdown)
5. **Exports comprehensive data** (generates CSV with pricing, categories, and payment terms)

The extension uses a three-component architecture:
- **Popup**: User interface for configuration
- **Content Script**: Injected scraper that automates browser actions
- **Background Worker**: Maintains state across page navigations and coordinates data extraction

## Features

- 🌐 **Multi-Site Support**: Auto-detects and adapts to DiscoveryCars and Expedia
- 🚗 **Multi-duration Search**: Automatically searches for car rentals across multiple day durations (e.g., 1-8 days)
- 🎯 **Model Filtering**: Filter results by specific car models (Picanto, Rio, MG3, Cerato, etc.)
- 📍 **Location-based**: Configurable pickup location
- 🔄 **Smart Pagination**:
  - DiscoveryCars: Scroll + "Show More" button
  - Expedia: Button-only (`#paginationShowMoreBtn`)
- 💰 **Payment Breakdown Extraction**: Opens offer pages in new tabs to extract payment details (pay now vs. pay at pickup)
- 🔢 **Rate Limiting**: Configurable max cars per date to control scraping volume
- 📊 **CSV Export**: Downloads comprehensive data with pricing, categories, payment terms, and average daily rates
- 🗓️ **Smart Date Picker**: Handles complex date selection including cross-month date ranges
- 💪 **Robust Clicking**: Uses advanced event dispatch to handle tricky UI interactions
- 🔄 **State Persistence**: Maintains scraping state across page navigations and tab switches
- 🎯 **Intelligent Deduplication**: Prevents duplicate entries using composite keys

## Installation

### Option 1: Load Unpacked Extension (Developer Mode)

1. **Download/Clone this repository** to your local machine

2. **Open Chrome Extensions page**:
   - Navigate to `chrome://extensions/`
   - Or click the three dots menu → More Tools → Extensions

3. **Enable Developer Mode**:
   - Toggle the "Developer mode" switch in the top-right corner

4. **Load the extension**:
   - Click "Load unpacked"
   - Navigate to and select the `scrapper/extension` folder

5. **Verify installation**:
   - You should see "Car Price Scraper" in your extensions list
   - The extension icon should appear in your Chrome toolbar

## Usage

### Step 1: Navigate to DiscoveryCars Search Page

1. Go to [https://www.discoverycars.com/](https://www.discoverycars.com/)
2. Make sure you're on the home search page (the one with the location and date selection form)

### Step 2: Configure the Extension

1. Click the extension icon in your Chrome toolbar
2. Configure the following settings:

   - **Location**: The pickup location (e.g., "Perth (all locations), Australia")
   - **Durations**: Comma-separated list of rental durations in days (e.g., "1,2,3,4,5,6,7,8")
   - **Target Models** (optional): Comma-separated car models to filter (e.g., "mg3,rio,picanto")
     - Leave empty to scrape all car models
   - **Max Per Date**: Maximum number of cars to scrape per duration (default: 30)
     - Controls how many offer pages will be opened for payment extraction
     - Lower values = faster scraping, higher values = more comprehensive data

3. Your settings are automatically saved for future use

### Step 3: Run the Scraper

1. Click the **"Run on this tab"** button
2. The extension will automatically:
   - Fill in the location
   - Select dates for the first duration
   - Submit the search
   - Wait for results to load
   - Scroll and scrape car listings (up to max per date)
   - Open offer pages in new tabs to extract payment breakdown
   - Extract "Pay now" and "Pay at pickup" amounts
   - Close offer tabs after extraction
   - Change dates for the next duration
   - Repeat for all configured durations
   - Download a CSV file with all results including payment details

**Note**: You will see new tabs briefly open and close automatically - this is the extension extracting payment information from offer pages.

### Step 4: Monitor Progress

- Open the DevTools Console (F12 → Console tab) to see detailed logs
- Look for `[AUTO]` prefixed messages showing progress:
  - `START durations: [1,2,3,4,5,6,7,8]`
  - `Round1 HOME | 2026-01-09 -> 2026-01-10 | days=1`
  - `Round1 scrape...`
  - `✅ CSV downloaded. rows= 150`

## CSV Output Format

The exported CSV contains the following columns:

| Column | Description |
|--------|-------------|
| `car_name_full` | Full car name with variant details |
| `car_name_base` | Base car model name |
| `company` | Rental company/supplier name |
| `price_value` | Total rental price |
| `avg_daily_price` | Average price per day |
| `pickup_date` | Pickup date (YYYY-MM-DD) |
| `dropoff_date` | Dropoff date (YYYY-MM-DD) |
| `rental_days` | Number of rental days |
| `category_code` | Car category code (EDAR, SEDAN, etc.) |
| `category_group` | Car category group description |
| `pay_now` | Amount to pay upfront (extracted from offer page) |
| `pay_at_pickup` | Amount to pay at pickup location (extracted from offer page) |
| `offer_url` | Direct link to the car offer page |

### Example Output:

```csv
"car_name_full","car_name_base","company","price_value","avg_daily_price","pickup_date","dropoff_date","rental_days","category_code","category_group","pay_now","pay_at_pickup","offer_url"
"Kia Picanto or similar","Kia Picanto","East Coast Car Rentals","45.00","45.00","2026-01-09","2026-01-10","1","EDAR","Picanto, Rio & MG3","$40.00","$5.00","https://www.discoverycars.com/offer/abc123"
"Kia Rio or similar","Kia Rio","Budget","52.00","26.00","2026-01-09","2026-01-11","2","EDAR","Picanto, Rio & MG3","$48.00","$4.00","https://www.discoverycars.com/offer/def456"
```

## Configuration Details

### Category Rules

The scraper automatically categorizes cars based on these rules:

- **EDAR**: Picanto, Rio & MG3
- **IDAR**: Cerato Hatch
- **SEDAN**: Cerato, MG5, i30
- **CFAR**: Jolion & ZS
- **IFAR**: Tuscon, Sportage & CX5
- **FFAR**: Xtrail & Outlander
- **SVAR**: Carnival

### Advanced Settings (Code Configuration)

You can modify these constants in [content.js](content.js) for advanced tuning:

```javascript
const RESULT_EXTRA_WAIT_MS = 15000;  // Wait time after results load
const SCROLL_STEP = 650;              // Pixels to scroll per step
const SCAN_INTERVAL_MS = 500;         // Interval between scans
const MAX_IDLE_ROUNDS = 15;           // Stop after N idle rounds
```

## Troubleshooting

### Extension doesn't start

- **Check console**: Open DevTools (F12) and check for error messages
- **Refresh the page**: Sometimes the content script needs a page reload
- **Check page type**: Make sure you're on DiscoveryCars.com search page
- **Verify URL**: Extension only works on discoverycars.com domain

### "Cannot reach page" error

- Refresh the page and try again
- Make sure you're on DiscoveryCars.com
- Check that the extension has permission for the website

### "❌ Home: date select failed" error

This means the date picker couldn't be found or clicked. Try:
- Make sure you're on the **home search page**, not results page
- Refresh the page and wait for it to fully load
- Check DevTools console for `[RDR_STRONG]` messages to see what's happening
- Both home and results pages use the same react-date-range calendar

### Dates not selecting properly

- DiscoveryCars uses react-date-range calendar on **both** home and results pages
- Check console for `[RDR_STRONG]` messages to see detailed date selection logs
- Cross-month date selection is supported and should work automatically
- If dates don't select, the calendar panel might not have opened - check for `.rdrDateRangeWrapper` element

### No data collected

- Check if your model filters are too restrictive
- Verify the page actually has car listings
- Check console for specific error messages

### CSV not downloading

- Check your browser's download settings
- Some browsers may block automatic downloads - allow them in settings
- Check if pop-ups are blocked for the site

## File Structure

```
scrapper/extension/
├── manifest.json              # Chrome extension configuration
├── popup.html                # Extension popup UI
├── popup.js                  # Popup logic and message passing
├── background.js             # Background service worker (state management)
├── content.js                # Main scraper logic (injected into page)
├── scrapper.js               # Original standalone scraper (reference)
├── calenderButtonPress.js    # Date picker utilities (if used)
├── site2.js                  # Alternative scraper (if used)
└── README.md                 # This file
```

### Message Flow Diagram

```
┌─────────────┐                    ┌──────────────┐                   ┌────────────────┐
│   Popup     │                    │  Background  │                   │  Content       │
│  (popup.js) │                    │  Worker      │                   │  Script        │
└─────────────┘                    └──────────────┘                   └────────────────┘
      │                                    │                                  │
      │ 1. RUN_SCRAPER                    │                                  │
      │ (config)                           │                                  │
      ├────────────────────────────────────────────────────────────────────> │
      │                                    │                                  │
      │                                    │ 2. START_SCRAPING                │
      │                                    │ <────────────────────────────────┤
      │                                    │                                  │
      │                                    │                                  │ 3. Scrape results
      │                                    │                                  │    Open offer tabs
      │                                    │                                  │
      │                                    │ 4. TRACK_NEW_TAB                 │
      │                                    │ <────────────────────────────────┤
      │                                    │                                  │
      │                                    │ 5. Tab loads                     │
      │                                    │ EXTRACT_OFFER_PAGE               │
      │                                    ├─────────────────────────────────>│
      │                                    │                                  │
      │                                    │ 6. STORE_PAYMENT_DATA            │
      │                                    │ <────────────────────────────────┤
      │                                    │                                  │
      │                                    │ 7. GET_PAYMENT_DATA              │
      │                                    │ <────────────────────────────────┤
      │                                    │                                  │
      │                                    │ 8. STOP_SCRAPING                 │
      │                                    │ <────────────────────────────────┤
      │                                    │                                  │
      │                                    │                                  │ 9. Download CSV
```

## Workflow Overview

This extension uses a three-component architecture to automate car rental price scraping:

### Architecture Components

1. **Popup Interface** ([popup.js](popup.js))
   - Provides user configuration UI
   - Collects settings: location, durations, model filters, max per date
   - Saves configuration to Chrome storage
   - Sends `RUN_SCRAPER` message to content script

2. **Content Script** ([content.js](content.js))
   - Injected into all pages automatically
   - Receives scraper commands from popup
   - Handles search form automation and date selection
   - Scrapes car listings from search results
   - Extracts payment data from offer pages
   - Generates and downloads CSV files

3. **Background Service Worker** ([background.js](background.js))
   - Maintains scraping state across page navigations
   - Manages data cache for payment information
   - Coordinates extraction from offer pages opened in new tabs
   - Persists state to Chrome storage for reliability

### Execution Workflow

1. **Configuration Phase**
   - User opens extension popup and configures settings
   - Settings saved to Chrome sync storage for persistence
   - User clicks "Run on this tab" button

2. **Initialization Phase**
   - Popup sends `RUN_SCRAPER` message to active tab
   - Content script receives configuration
   - Background worker initializes scraping state with `START_SCRAPING`

3. **Search Automation Phase**
   - Content script fills in pickup location
   - Automatically selects pickup/dropoff dates for first duration
   - Submits search form and waits for results to load

4. **Results Scraping Phase**
   - Scrolls through search results page
   - Clicks "Show More" button to load additional results
   - Extracts car data: name, company, price, category
   - Deduplicates entries using composite keys
   - Limits collection to `maxPerDate` cars per duration

5. **Payment Extraction Phase**
   - Opens car offer pages in new tabs (Ctrl+Click)
   - Background worker tracks pending extraction tabs
   - Content script auto-detects offer pages on load
   - Extracts payment breakdown (pay now / pay at pickup)
   - Stores payment data in background cache
   - Closes offer tabs after extraction

6. **Multi-Duration Loop**
   - Changes search dates for next duration
   - Repeats scraping and extraction for each configured duration
   - Updates background state with accumulated data

7. **Export Phase**
   - Collects all scraped data with payment details
   - Generates CSV file with comprehensive car rental information
   - Triggers browser download
   - Logs completion with row count

### State Management

The background service worker maintains:
- `active`: Scraping session status
- `scrapedCars`: Accumulated car data array
- `seenKeys`: Deduplication keys set
- `config`: User configuration object
- `paymentDataCache`: Payment data indexed by offer URL/ID

State persists across:
- Page navigations
- Tab switches
- New tab opens/closes
- Service worker restarts

## Technical Details

### Smart Date Selection

The extension includes sophisticated date picker handling:
- Automatically navigates across months
- Verifies date selection by checking input values
- Handles disabled dates and multiple date button candidates
- Applies "Select dates" confirmation when needed

### Robust Event Dispatch

Uses multiple event types to ensure clicks work:
- `PointerEvent` (pointerdown/pointerup)
- `MouseEvent` (mousedown/mouseup)
- Direct `.click()` call

### Deduplication

Uses composite keys to prevent duplicate entries:
```
key = baseName|company|priceValue|pickupDate|dropoffDate|categoryCode
```

## Privacy & Security

- **No data transmission**: All scraping happens locally in your browser
- **No external servers**: Data is never sent to any external server
- **Local storage only**: Settings are saved in Chrome's local storage
- **Open source**: Full source code is available for inspection

## Limitations

- **Site-specific**: Works on DiscoveryCars and Expedia only (other sites require code additions)
- **DOM dependency**: Relies on specific CSS selectors that may break if sites update their UI
- **UI changes**: May require selector updates when websites redesign
- **Chrome only**: Not tested on Firefox, Edge, or other browsers
- **Expedia limitations**: Payment extraction selectors not yet verified (live testing needed)

## Adapting to Other Websites

This extension can be adapted to work with other car rental websites like **Expedia**, **Kayak**, **Rentalcars.com**, etc. The workflow architecture remains the same, but you'll need to update the site-specific selectors and logic.

### What Stays the Same (Reusable Architecture)

The three-component architecture works universally:
- **Popup Interface** ([popup.js](popup.js)) - No changes needed
- **Background Worker** ([background.js](background.js)) - No changes needed
- **Extension Manifest** ([manifest.json](manifest.json)) - No changes needed

The workflow phases remain identical:
1. Configuration Phase
2. Initialization Phase
3. Search Automation Phase
4. Results Scraping Phase
5. Payment Extraction Phase
6. Multi-Duration Loop
7. Export Phase

### What Needs Customization ([content.js](content.js))

You'll need to update the following site-specific elements:

#### 1. **URL Detection**
```javascript
// Current (DiscoveryCars)
if (window.location.href.includes('discoverycars.com'))

// Example (Expedia)
if (window.location.href.includes('expedia.com'))
```

#### 2. **Search Form Selectors**
Update the selectors for location input and date pickers:

| Element | DiscoveryCars | Expedia (Verified) |
|---------|--------------|-------------------|
| Date button trigger | `.rdrDateRangeWrapper` button | `button[data-testid="uitk-date-selector-input1-default"]` |
| Calendar container | `.rdrDateRangeWrapper` | `.uitk-month-table` |
| Day cells | `.rdrDayNumber button` | `.uitk-day-button.uitk-day-selectable` |
| Day number element | `.rdrDayNumber span` | `.uitk-date-number` |
| Day aria label | N/A | `.uitk-day-aria-label` (contains "2026年1月19日星期一") |
| Search button | `button[type="submit"]` | `button[name="submit-btn"]` (text: "搜索") |

#### 3. **Results Page Selectors**
Update the selectors for car listings:

| Element | DiscoveryCars | Expedia (Verified) |
|---------|--------------|-------------------|
| Car card/offer | `.SearchCar-Wrapper` | `button.offer-reserve-button` |
| Car info source | Multiple DOM elements | **aria-label attribute only** |
| Company + category + price | Separate elements | Aria-label: "预订车辆：[Co]，[Cat]，总价 [Price]" |
| Price container | `.price-amount` | `.cars-offer-price.right-align` |
| Per day price | `.daily-price` | `.per-day-price` |
| Total price | `.total-price` | `.total-price` |
| **Load More button** | `.show-more-button` | `button#paginationShowMoreBtn` (text: "显示更多") |

**CRITICAL**: Expedia uses button-based pagination (`#paginationShowMoreBtn`) instead of scroll-based infinite loading!

#### 4. **Offer Page Selectors**
Update the selectors for payment breakdown (requires verification on live site):

| Element | DiscoveryCars | Expedia (To Be Verified) |
|---------|--------------|-------------------|
| Breakdown container | `.OfferPriceBreakdown` | `.price-details-section` ⚠️ |
| Pay now section | `.OfferPriceBreakdown-Main` | `.prepay-amount` ⚠️ |
| Pay at pickup section | Contains "pay at pick" | `.pay-later-amount` ⚠️ |
| Price elements | `.Typography-size_2sm` | `.uitk-text` ⚠️ |

⚠️ = Needs verification on actual Expedia offer/checkout pages

### Complete Expedia Implementation Plan

Based on analysis of [expedia.html](expedia.html) and [expediaImortant.html](expediaImortant.html), here's the complete adaptation guide for Expedia.

#### Workflow Comparison: DiscoveryCars vs Expedia

| Workflow Phase | DiscoveryCars | Expedia | Modification Required |
|----------------|---------------|---------|----------------------|
| **1. URL Detection** | `discoverycars.com` | `expedia.com` or `expedia.cn` | ✅ Simple string change |
| **2. Date Picker** | React-date-range (`.rdrDateRangeWrapper`) | UITK calendar (`.uitk-month-table`) | ⚠️ Different structure & selectors |
| **3. Search Submit** | `button[type="submit"]` | `button[name="submit-btn"]` | ✅ Simple selector change |
| **4. Results Detection** | DOM elements (`.SearchCar-Wrapper`) | Aria-labels (`button.offer-reserve-button`) | ⚠️ **Parse aria-label strings** |
| **5. Data Extraction** | Parse DOM children | **Regex on aria-label** | ⚠️ **Complete rewrite** |
| **6. Pagination** | Scroll + click button | **Button-only** (`#paginationShowMoreBtn`) | ⚠️ **Remove scrolling logic** |
| **7. Category Mapping** | English names | **Chinese names** | ⚠️ Add translation map |
| **8. Offer Pages** | `.OfferPriceBreakdown` | TBD (needs verification) | ⚠️ Requires live testing |

**Legend**: ✅ = Minor change | ⚠️ = Significant change requiring new logic

#### Expedia Selector Reference (VERIFIED from expediaImortant.html)

**Date Picker:**
- Date button: `button[data-testid="uitk-date-selector-input1-default"]`
  - **Text format (ENGLISH)**: "Jan 19 - Jan 20" (Month Day - Month Day)
  - **NOT Chinese** as previously documented!
- Calendar container: `.uitk-calendar`
- Calendar table: `.uitk-month-table`
- **Double month display**: `.uitk-month-double-left` and `.uitk-month-double-right` (shows 2 months side-by-side)
- Day cells: `.uitk-day`
- Clickable days: `.uitk-day-button.uitk-day-selectable.uitk-day-clickable`
- Day number: `.uitk-date-number`
- Selected range start: `.uitk-calendar-day-selection-range-start`
- Selected range end: `.uitk-calendar-day-selection-range-end`
- Same-day selection: `.uitk-day-selection-same-day`
- **Aria labels (ENGLISH)**: `.uitk-day-aria-label`
  - Format: "Monday, January 19, 2026" or "Monday, January 19, 2026, Selected start date"
  - **NOT Chinese** - actual format is English!

**Car Offer Card (Single car view):**
- Car name: `.uitk-text.uitk-type-300` (e.g., "Renault Clio or similar")
- Features list: `.uitk-typelist` (passengers, transmission, mileage icons)
- Location: `#location-text` (e.g., "Shuttle to counter and car")
- Confidence messages: `.confidence-messages li` (Free cancellation, Pay at pick-up, etc.)
- Vendor logo: `.vendor-logo` (company logo image)
- Price container: `.cars-offer-price.right-align`
  - Per day price: `.per-day-price` (e.g., "$25")
  - Total price: `.total-price` (e.g., "$34")
  - Price qualifier: `.total-price-qualifier` (text: "total")
- **Reserve button**: `button.offer-reserve-button`
  - **Aria label format**: "Reserve Item, from [Company] at $[Price] total"
  - **Example**: "Reserve Item, from Firefly at $34 total"
  - **Pattern**: `/Reserve Item,\s+from\s+(.+?)\s+at\s+\$(\d+(?:\.\d{2})?)\s+total/`

**Search Form (NOT in this HTML sample):**
- Submit button: `button[name="submit-btn"]` ⚠️ (Not found in highlighted HTML - verify on live site)
- Location input: ⚠️ (Not in sample - needs verification)

**Results Page (NOT in this HTML sample):**
- Multiple car list: ⚠️ (Sample shows single car only)
- **Load More button**: `button#paginationShowMoreBtn` ⚠️ (Not in this sample - verify on full results page)

#### Key Differences from DiscoveryCars

| Aspect | DiscoveryCars | Expedia |
|--------|---------------|---------|
| Date picker | React-date-range (`.rdrDateRangeWrapper`) | UITK calendar (`.uitk-month-table`) |
| Show More | Scrolling + button clicks | **Button-based only** (`#paginationShowMoreBtn`) |
| Car card structure | Dedicated cards (`.SearchCar-Wrapper`) | Reserve buttons with aria-labels |
| Data extraction | DOM parsing from cards | **Aria-label parsing** from buttons |
| Company/car info | Separate elements | **Single aria-label** string |
| Price location | Card price section | `.cars-offer-price` container |

### Adaptation Workflow for Expedia (Step-by-Step)

Based on the verified HTML structure, here's how to adapt the extension for Expedia:

#### Step 1: Update URL Detection in content.js

```javascript
// CURRENT (DiscoveryCars)
if (window.location.href.includes('discoverycars.com'))

// NEW (Expedia)
if (window.location.href.includes('expedia.com') || window.location.href.includes('expedia.cn'))
```

#### Step 2: Update Date Picker Logic

Expedia uses UITK calendar instead of react-date-range:

```javascript
// CURRENT (DiscoveryCars) - React-date-range
const dateButton = document.querySelector('.rdrDateRangeWrapper');
const dayButtons = document.querySelectorAll('.rdrDayNumber button');

// NEW (Expedia) - UITK calendar
const dateButton = document.querySelector('button[data-testid="uitk-date-selector-input1-default"]');
const calendar = document.querySelector('.uitk-month-table');
const dayButtons = document.querySelectorAll('.uitk-day-button.uitk-day-selectable.uitk-day-clickable');

// Click on date button to open calendar
dateButton.click();
await wait(1000);

// Find the target day number (e.g., 19)
const targetDay = dayButtons.find(btn => {
  const ariaLabel = btn.querySelector('.uitk-day-aria-label')?.getAttribute('aria-label');
  // ariaLabel format: "2026年1月19日星期一"
  return ariaLabel && ariaLabel.includes(`${year}年${month}月${day}日`);
});
```

#### Step 3: Update Search Button Selector

```javascript
// CURRENT (DiscoveryCars)
const searchButton = document.querySelector('button[type="submit"]');

// NEW (Expedia)
const searchButton = document.querySelector('button[name="submit-btn"]');
// Verify button text is "搜索" (Search)
```

#### Step 4: Update Results Scraping Logic

**CRITICAL DIFFERENCE**: Expedia uses aria-labels instead of DOM elements for car data:

```javascript
// CURRENT (DiscoveryCars) - Parse DOM elements
const carCards = document.querySelectorAll('.SearchCar-Wrapper');
carCards.forEach(card => {
  const carName = card.querySelector('.car-name').textContent;
  const company = card.querySelector('.supplier-name').textContent;
  const price = card.querySelector('.price-amount').textContent;
});

// NEW (Expedia) - Parse aria-labels
const reserveButtons = document.querySelectorAll('button.offer-reserve-button');
reserveButtons.forEach(button => {
  const ariaLabel = button.getAttribute('aria-label');
  // Format: "预订车辆：Alamo Rent A Car，中型，总价 $43"
  // Pattern: "预订车辆：[Company]，[Category]，总价 [Price]"

  const match = ariaLabel.match(/预订车辆：(.+?)，(.+?)，总价 \$(\d+)/);
  if (match) {
    const [_, company, category, price] = match;
    console.log({ company, category, price });
    // company: "Alamo Rent A Car"
    // category: "中型" (Mid-size)
    // price: "43"
  }

  // Also extract from visible price elements as backup
  const priceContainer = button.closest('.uitk-layout-flex')?.querySelector('.cars-offer-price');
  const totalPrice = priceContainer?.querySelector('.total-price')?.textContent;
  const perDayPrice = priceContainer?.querySelector('.per-day-price')?.textContent;
});
```

#### Step 5: Update Pagination Logic - CRITICAL CHANGE

**IMPORTANT**: Expedia uses a "Load More" **button** instead of infinite scroll:

```javascript
// CURRENT (DiscoveryCars) - Scroll + click "Show More"
window.scrollTo(0, document.body.scrollHeight);
await wait(500);
const showMoreBtn = document.querySelector('.show-more-button');
if (showMoreBtn) showMoreBtn.click();

// NEW (Expedia) - Click "Load More" button ONLY
const loadMoreBtn = document.getElementById('paginationShowMoreBtn');
// Button text: "显示更多" (Show More)

if (loadMoreBtn && !loadMoreBtn.disabled) {
  console.log('[EXPEDIA] Clicking Load More button');
  loadMoreBtn.click();
  await wait(2000); // Wait for new results to load

  // Check if more results were added
  const newCount = document.querySelectorAll('button.offer-reserve-button').length;
  console.log(`[EXPEDIA] Now showing ${newCount} results`);
} else {
  console.log('[EXPEDIA] No more results to load (button disabled or missing)');
}
```

**Pagination Loop:**
```javascript
async function scrapeAllExpediaResults(maxResults = 30) {
  const scrapedCars = [];
  let previousCount = 0;
  let idleRounds = 0;

  while (scrapedCars.length < maxResults) {
    // Scrape current visible results
    const buttons = document.querySelectorAll('button.offer-reserve-button');
    console.log(`[EXPEDIA] Found ${buttons.length} car offers on page`);

    // Extract data from new buttons only
    for (let i = previousCount; i < buttons.length && scrapedCars.length < maxResults; i++) {
      const carData = extractCarDataFromButton(buttons[i]);
      if (carData) scrapedCars.push(carData);
    }

    previousCount = buttons.length;

    // Try to load more
    const loadMoreBtn = document.getElementById('paginationShowMoreBtn');
    if (!loadMoreBtn || loadMoreBtn.disabled) {
      console.log('[EXPEDIA] No more results available');
      break;
    }

    const beforeCount = buttons.length;
    loadMoreBtn.click();
    await wait(2000);

    const afterCount = document.querySelectorAll('button.offer-reserve-button').length;
    if (afterCount === beforeCount) {
      idleRounds++;
      if (idleRounds >= 3) {
        console.log('[EXPEDIA] No new results after 3 attempts, stopping');
        break;
      }
    } else {
      idleRounds = 0;
    }
  }

  return scrapedCars;
}
```

#### Step 6: Update Category Mapping

Expedia uses Chinese category names:

```javascript
// CURRENT (DiscoveryCars) - English names
const categoryMap = {
  'picanto': 'EDAR',
  'rio': 'EDAR',
  'mg3': 'EDAR',
  // ...
};

// NEW (Expedia) - Chinese names
const expediaCategoryMap = {
  '小型': 'COMPACT',        // Compact
  '中型': 'MIDSIZE',        // Mid-size
  '大型': 'FULLSIZE',       // Full-size
  '小型 SUV': 'COMPACT_SUV', // Compact SUV
  '中型 SUV': 'MIDSIZE_SUV', // Mid-size SUV
  '全尺寸 SUV': 'FULLSIZE_SUV', // Full-size SUV
  '跑车': 'SPORTS',         // Sports car
  '敞篷车': 'CONVERTIBLE',   // Convertible
  '皮卡': 'PICKUP',         // Pickup truck
  // Add more as needed
};

function mapExpediaCategory(chineseCategory) {
  return expediaCategoryMap[chineseCategory] || 'UNKNOWN';
}
```

#### Step 7: Update Offer Page Extraction

Research Expedia's offer/checkout page structure (requires live testing):

```javascript
// TODO: Inspect Expedia offer pages to find:
// - Payment breakdown container
// - "Pay now" vs "Pay later" sections
// - Price elements

// Example structure (to be verified):
const offerPage = {
  priceBreakdown: '.price-details-section',  // To be confirmed
  payNow: '.prepay-amount',                   // To be confirmed
  payLater: '.pay-later-amount',              // To be confirmed
};
```

#### Step 8: Test and Iterate

**Testing checklist specific to Expedia:**
- [ ] Date picker opens and dates select correctly
- [ ] Search button triggers search successfully
- [ ] Aria-label parsing extracts company, category, and price
- [ ] Load More button is detected (`#paginationShowMoreBtn`)
- [ ] Clicking Load More loads additional results
- [ ] Pagination stops when button is disabled or missing
- [ ] Chinese category names map to English codes
- [ ] CSV exports with all fields populated
- [ ] Multi-duration loop works correctly

### Implementation Strategy: Multi-Site Support

For supporting both DiscoveryCars and Expedia (or more sites) in the same extension:

#### Option 1: Site Detection with Conditional Logic (Recommended)

Create site-specific modules in [content.js](content.js):

```javascript
// Detect current site
function detectSite() {
  const url = window.location.href;
  if (url.includes('discoverycars.com')) return 'discoverycars';
  if (url.includes('expedia.com') || url.includes('expedia.cn')) return 'expedia';
  return null;
}

// Site-specific configurations
const SITE_CONFIGS = {
  discoverycars: {
    selectors: {
      dateButton: '.rdrDateRangeWrapper button',
      searchButton: 'button[type="submit"]',
      carCard: '.SearchCar-Wrapper',
      loadMore: '.show-more-button',
    },
    pagination: 'scroll',
    dataExtraction: 'dom',
  },
  expedia: {
    selectors: {
      dateButton: 'button[data-testid="uitk-date-selector-input1-default"]',
      searchButton: 'button[name="submit-btn"]',
      carCard: 'button.offer-reserve-button',
      loadMore: 'button#paginationShowMoreBtn',
    },
    pagination: 'button',
    dataExtraction: 'aria-label',
    ariaPattern: /预订车辆：(.+?)，(.+?)，总价 \$(\d+)/,
  },
};

// Main scraper function
async function runScraper(config) {
  const site = detectSite();
  if (!site) {
    console.error('[SCRAPER] Unsupported website');
    return;
  }

  const siteConfig = SITE_CONFIGS[site];
  console.log(`[SCRAPER] Running on ${site}`);

  // Use site-specific logic
  if (siteConfig.dataExtraction === 'dom') {
    await scrapeWithDOM(siteConfig);
  } else if (siteConfig.dataExtraction === 'aria-label') {
    await scrapeWithAriaLabel(siteConfig);
  }
}
```

#### Option 2: Separate Extension Versions

Maintain separate branches or folders:
- `extension-discoverycars/`
- `extension-expedia/`

**Pros**: Cleaner code, easier to maintain
**Cons**: Code duplication, harder to share improvements

#### Option 3: User-Selectable Site in Popup

Add a dropdown in [popup.html](popup.html):

```html
<select id="targetSite">
  <option value="discoverycars">DiscoveryCars</option>
  <option value="expedia">Expedia</option>
</select>
```

Then use the selected site to load the appropriate configuration.

**Recommended**: Option 1 (auto-detection) for seamless user experience.

### Testing Checklist

When adapting to a new site:
- [ ] Location input fills correctly
- [ ] Dates select properly across month boundaries
- [ ] Search form submits successfully
- [ ] Results page loads and scrolls
- [ ] Car cards are detected and scraped
- [ ] Offer pages open in new tabs
- [ ] Payment breakdown extracts correctly
- [ ] CSV downloads with all expected columns
- [ ] Deduplication works (no duplicate entries)
- [ ] Multi-duration loop completes

### Key Files to Examine

When adapting to a new site, save a sample HTML page (like [expedia.html](expedia.html)) and:
1. Open it in a text editor or browser DevTools
2. Search for car-related classes and IDs
3. Document the structure in a mapping table
4. Update [content.js](content.js) with new selectors
5. Test incrementally (search → scrape → extract → export)

### Quick Reference: Expedia Selector Map (Verified)

**SITE**: Expedia
**URL Pattern**: `expedia.com/Cars-Search` or `expedia.cn/Cars-Search`
**Based on**: [expediaImortant.html](expediaImortant.html)

```javascript
// SEARCH PAGE
const EXPEDIA_SELECTORS = {
  // Date picker
  dateButton: 'button[data-testid="uitk-date-selector-input1-default"]',
  calendar: '.uitk-month-table',
  dayCell: '.uitk-day',
  dayButton: '.uitk-day-button.uitk-day-selectable.uitk-day-clickable',
  dayAriaLabel: '.uitk-day-aria-label',  // Format: "2026年1月19日星期一"
  dayNumber: '.uitk-date-number',

  // Search
  submitButton: 'button[name="submit-btn"]',  // Text: "搜索"

  // RESULTS PAGE
  reserveButton: 'button.offer-reserve-button',
  // Aria-label format: "预订车辆：Alamo Rent A Car，中型，总价 $43"
  priceContainer: '.cars-offer-price.right-align',
  perDayPrice: '.per-day-price',
  totalPrice: '.total-price',

  // Pagination - BUTTON BASED (not scroll)
  loadMoreButton: 'button#paginationShowMoreBtn',  // Text: "显示更多"

  // OFFER PAGE (to be verified)
  offerBreakdown: '.price-details-section',  // ⚠️ TBD
  payNow: '.prepay-amount',                   // ⚠️ TBD
  payLater: '.pay-later-amount',              // ⚠️ TBD
};

// Data extraction pattern
const ariaLabelPattern = /预订车辆：(.+?)，(.+?)，总价 \$(\d+)/;
// Groups: [full match, company, category, price]
// Example: "预订车辆：Alamo Rent A Car，中型，总价 $43"
// => company: "Alamo Rent A Car", category: "中型", price: "43"

// Category mapping (Chinese to English)
const EXPEDIA_CATEGORIES = {
  '小型': 'COMPACT',
  '中型': 'MIDSIZE',
  '大型': 'FULLSIZE',
  '小型 SUV': 'COMPACT_SUV',
  '中型 SUV': 'MIDSIZE_SUV',
  '中型 SUV AWD': 'MIDSIZE_SUV_AWD',
  '全尺寸 SUV': 'FULLSIZE_SUV',
  '全尺寸 SUV 4X4': 'FULLSIZE_SUV_4X4',
  '跑车': 'SPORTS',
  '中型跑车': 'MIDSIZE_SPORTS',
  '敞篷车': 'CONVERTIBLE',
  '中型敞篷车': 'MIDSIZE_CONVERTIBLE',
  '皮卡': 'PICKUP',
  '高档加长皮卡 4X4': 'PREMIUM_PICKUP_4X4',
};
```

### Quick Reference: Generic Selector Mapping Template

Create a mapping document before modifying code for other sites:

```
SITE: [Website Name]
URL Pattern: [e.g., kayak.com/cars]

SEARCH PAGE:
- Location input: [selector]
- Date picker: [selector]
- Pickup date: [selector]
- Dropoff date: [selector]
- Submit button: [selector]

RESULTS PAGE:
- Car card: [selector]
- Car name: [selector]
- Company: [selector]
- Price: [selector]
- Category: [selector]
- Offer link: [selector]
- Show more: [selector]
- Pagination type: [scroll/button/infinite]

OFFER PAGE:
- Price breakdown: [selector]
- Pay now: [selector]
- Pay at pickup: [selector]
```

## Support

If you encounter issues:
1. Check the [Troubleshooting](#troubleshooting) section
2. Open DevTools Console (F12) and look for error messages
3. Check that you're using the latest version of Chrome

## License

This is a personal scraping tool for research and price comparison purposes. Use responsibly and in accordance with the target website's terms of service.

## Version History

### v0.1.0 (Current)
- Initial release
- Multi-duration scraping
- CSV export with categorization
- Configurable location and model filters
- Smart date picker handling
