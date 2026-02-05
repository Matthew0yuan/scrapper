/**
 * Site-Specific DOM Selectors
 * Centralized selector constants for easy maintenance
 */

const Selectors = {
  // ============================================================================
  // EXPEDIA SELECTORS
  // ============================================================================
  expedia: {
    // Calendar / Date Picker
    calendar: '.uitk-calendar',
    datePickerButton: 'button[data-testid="uitk-date-selector-input1-default"]',
    dayButton: '.uitk-day-button.uitk-day-clickable',
    dayAriaLabel: '.uitk-day-aria-label',
    doneButton: 'button[data-stid="apply-date-selector"]',
    searchButton: 'button[name="submit-btn"].uitk-button-primary',

    // Results Page
    reserveButton: 'button.offer-reserve-button',
    showMoreButton: '#paginationShowMoreBtn',

    // Car Card
    carNameSection: '.icon-s',
    carNameText: '.uitk-text.uitk-type-300.uitk-spacing-margin-blockend-one',

    // Offer Page
    priceDetails: '.price-details',
    totalBreakup: '.total-breakup',
    typelistItem: '.uitk-typelist-item',
    layoutFlex: '.uitk-layout-flex',
    textElement: '.uitk-text'
  },

  // ============================================================================
  // DISCOVERYCARS SELECTORS
  // ============================================================================
  discoverycars: {
    // Search Form
    searchForm: 'form.SearchModifier-Form',
    locationInput: 'input[name="address"], input[type="text"], input[placeholder*="location" i]',
    locationInputAlt: '.SearchModifierLocation-Input input',

    // Calendar / Date Picker
    calendarWrapper: '.rdrCalendarWrapper.rdrDateRangeWrapper',
    calendarWrapperAlt: '.rdrDateRangeWrapper',
    calendarPicker: '.rdrDateRangePickerWrapper',
    calendarMonths: '.rdrMonths',
    dayNumber: '.rdrDayNumber button',
    dayNumberSpan: '.rdrDayNumber span',
    datePickerField: '.DatePicker-CalendarField',
    datePickerFieldAlt: '[class*="CalendarField" i]',

    // Results Page
    virtuosoList: '[data-test-id="virtuoso-list"]',
    searchListWrapper: '.SearchList-Wrapper',
    searchCarWrapper: '.SearchCar-Wrapper',
    showMoreWrapper: '.SearchList-ShowMoreWrapper .SearchList-ShowMore',
    showMoreButton: '.SearchList-ShowMoreWrapper button',

    // Car Card
    carName: '.SearchCar-CarName h4',
    carNameAlt1: '.CarTitle-Name',
    carNameAlt2: '.SearchCar-CarName',
    carNameAlt3: '[class*="CarName"]',
    carPrice: '.SearchCar-Price',
    carPriceAlt1: '.SearchCar-Price strong',
    carPriceAlt2: '.Price-Value',
    supplierName: '.SearchCar-SupplierName',
    supplierNameAlt1: '.SupplierName',
    supplierNameAlt2: '[class*="Supplier" i]',
    viewDealButton: '.SearchCar-CtaBtn, a[href*="/offer/"]',

    // Offer Page
    priceBreakdown: '.OfferPriceBreakdown',
    priceBreakdownMain: '.OfferPriceBreakdown-Main',
    priceExtra: '.OfferPriceBreakdown-Extra',
    priceExtraTitle: '.OfferPriceBreakdown-ExtraTitle',
    priceText: '.Typography-size_2sm'
  }
};

// Export for use in content scripts
if (typeof window !== 'undefined') {
  window.Selectors = Selectors;
}
