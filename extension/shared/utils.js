/**
 * Shared Utility Functions
 * Common utilities used across all site scrapers
 */

const SharedUtils = {
  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Normalize text by collapsing whitespace and trimming
   * @param {string} text - Text to normalize
   * @returns {string}
   */
  normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  },

  /**
   * Round number to 2 decimal places
   * @param {number} n - Number to round
   * @returns {number}
   */
  round2(n) {
    return Math.round(n * 100) / 100;
  },

  /**
   * Format date as YYYY-MM-DD in local timezone
   * @param {Date} date - Date to format
   * @returns {string}
   */
  formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * Add days to a date
   * @param {Date} date - Base date
   * @param {number} days - Days to add
   * @returns {Date}
   */
  addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  },

  /**
   * Get random number in range
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number}
   */
  randomInRange(min, max) {
    return min + Math.random() * (max - min);
  },

  /**
   * Parse comma-separated string into array
   * @param {string} str - Comma-separated string
   * @param {Function} transform - Transform function for each item
   * @returns {Array}
   */
  parseCommaSeparatedList(str, transform = x => x) {
    if (!str) return [];
    return str.split(',').map(item => transform(item.trim())).filter(Boolean);
  },

  /**
   * Parse comma-separated integers
   * @param {string} str - Comma-separated string of integers
   * @returns {number[]}
   */
  parseIntList(str) {
    return this.parseCommaSeparatedList(str, item => {
      const num = parseInt(item, 10);
      return isNaN(num) ? null : num;
    }).filter(n => n !== null);
  },

  /**
   * Escape string for CSV
   * @param {*} value - Value to escape
   * @returns {string}
   */
  csvEscape(value) {
    const str = String(value || '');
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  },

  /**
   * Create a logger with prefix
   * @param {string} siteName - Site name for prefix
   * @returns {Function}
   */
  createLogger(siteName) {
    const prefix = `[${siteName.toUpperCase()}]`;
    return (...args) => console.log(prefix, ...args);
  }
};

// Export for use in content scripts
if (typeof window !== 'undefined') {
  window.SharedUtils = SharedUtils;
}
