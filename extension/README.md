# Car Price Scraper - Chrome Extension (DiscoveryCars)

A Chrome extension that automates car rental price scraping on **DiscoveryCars** across multiple durations and exports the results to CSV format.

**⚠️ Important: This extension is specifically designed for DiscoveryCars.com and may not work on other car rental websites.**

## Features

- 🚗 **Multi-duration Search**: Automatically searches for car rentals across multiple day durations (e.g., 1-8 days)
- 🎯 **Model Filtering**: Filter results by specific car models (Picanto, Rio, MG3, Cerato, etc.)
- 📍 **Location-based**: Configurable pickup location
- 🔄 **Auto-pagination**: Automatically scrolls and clicks "Show More" to load all results
- 📊 **CSV Export**: Downloads scraped data with pricing, categories, and average daily rates
- 🗓️ **Smart Date Picker**: Handles complex date selection including cross-month date ranges
- 💪 **Robust Clicking**: Uses advanced event dispatch to handle tricky UI interactions

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

3. Your settings are automatically saved for future use

### Step 3: Run the Scraper

1. Click the **"Run on this tab"** button
2. The extension will:
   - Fill in the location
   - Select dates for the first duration
   - Submit the search
   - Wait for results to load
   - Scroll and scrape all car listings
   - Change dates for the next duration
   - Repeat for all configured durations
   - Download a CSV file with all results

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

### Example Output:

```csv
"car_name_full","car_name_base","company","price_value","avg_daily_price","pickup_date","dropoff_date","rental_days","category_code","category_group"
"Kia Picanto or similar","Kia Picanto","East Coast Car Rentals","45.00","45.00","2026-01-09","2026-01-10","1","EDAR","Picanto, Rio & MG3"
"Kia Rio or similar","Kia Rio","Budget","52.00","26.00","2026-01-09","2026-01-11","2","EDAR","Picanto, Rio & MG3"
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
├── manifest.json       # Chrome extension configuration
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic and message passing
├── content.js         # Main scraper logic (injected into page)
├── scrapper.js        # Original standalone scraper (reference)
└── README.md          # This file
```

## How It Works

1. **Content Script Injection**: [content.js](content.js) is automatically injected into all pages
2. **User Configuration**: [popup.js](popup.js) collects user settings and sends them via message
3. **Scraper Execution**: The content script receives the message and runs the scraper
4. **Date Automation**: Automatically navigates date pickers and changes dates
5. **Data Collection**: Scrolls through results, extracts car data, deduplicates
6. **Export**: Generates CSV and triggers download

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

- **DiscoveryCars only**: Specifically designed for DiscoveryCars.com
- **DOM dependency**: Relies on specific CSS selectors (`.SearchCar-Wrapper`, `.rdrDateRangeWrapper`, etc.)
- **UI changes**: May break if DiscoveryCars updates their website structure
- **Chrome only**: Not tested on other browsers (Firefox, Edge, etc.)
- **Date picker**: Both home and results pages use react-date-range calendar (`.rdrDateRangeWrapper`)

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
