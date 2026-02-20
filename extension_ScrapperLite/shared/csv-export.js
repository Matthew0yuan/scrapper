/**
 * CSV Export Utility
 * Shared CSV generation and download functionality
 */

const CsvExport = {
  /**
   * Standard CSV headers for car rental data
   */
  headers: [
    'car_name_full',
    'car_name_base',
    'company',
    'price_value',
    'avg_daily_price',
    'pickup_date',
    'dropoff_date',
    'rental_days',
    'category_code',
    'category_group',
    'pay_now',
    'pay_at_pickup',
    'offer_url'
  ],

  /**
   * Convert car object to CSV row array
   * @param {Object} car - Car data object
   * @returns {Array}
   */
  carToRow(car) {
    return [
      car.car_name_full,
      car.car_name_base,
      car.company,
      car.price_value,
      car.avg_daily_price,
      car.pickup_date,
      car.dropoff_date,
      car.rental_days,
      car.category_code,
      car.category_group,
      car.pay_now,
      car.pay_at_pickup,
      car.view_deal_url
    ];
  },

  /**
   * Generate CSV content from car data
   * @param {Array} cars - Array of car objects
   * @returns {string} CSV content
   */
  generateCSV(cars) {
    const headerRow = this.headers.map(h => SharedUtils.csvEscape(h)).join(',');
    const dataRows = cars.map(car => {
      return this.carToRow(car).map(cell => SharedUtils.csvEscape(cell)).join(',');
    });

    return [headerRow, ...dataRows].join('\n');
  },

  /**
   * Download CSV file
   * @param {Array} cars - Array of car objects
   * @param {string} siteName - Site name for filename
   * @param {Function} log - Logger function
   */
  downloadCSV(cars, siteName, log) {
    const csvContent = this.generateCSV(cars);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `cars_${siteName}_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    if (log) {
      log(`CSV downloaded. Total rows: ${cars.length}`);
    }
  }
};

// Export for use in content scripts
if (typeof window !== 'undefined') {
  window.CsvExport = CsvExport;
}
