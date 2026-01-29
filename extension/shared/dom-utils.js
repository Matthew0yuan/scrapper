/**
 * Shared DOM Utility Functions
 * Common DOM manipulation utilities used across all site scrapers
 */

const DomUtils = {
  /**
   * Wait for an element to appear in DOM
   * @param {string} selector - CSS selector
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {number} intervalMs - Poll interval in milliseconds
   * @returns {Promise<Element|null>}
   */
  async waitForElement(selector, timeoutMs = 10000, intervalMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const element = document.querySelector(selector);
      if (element) return element;
      await SharedUtils.sleep(intervalMs);
    }
    return null;
  },

  /**
   * Check if element is fully visible in viewport
   * @param {Element} el - Element to check
   * @returns {boolean}
   */
  isElementInViewport(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= windowHeight &&
      rect.right <= windowWidth
    );
  },

  /**
   * Check if element is partially visible in viewport
   * @param {Element} el - Element to check
   * @returns {boolean}
   */
  isElementPartiallyVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    return rect.top < windowHeight && rect.bottom > 0;
  },

  /**
   * Smooth scroll to an element
   * @param {Element} el - Element to scroll to
   * @param {Object} timing - Timing configuration
   * @param {Function} log - Logger function
   */
  async smoothScrollToElement(el, timing, log) {
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    const targetScrollY = window.scrollY + rect.top - (windowHeight / 2) + (rect.height / 2);
    const currentScrollY = window.scrollY;
    const distance = targetScrollY - currentScrollY;

    if (Math.abs(distance) < 50) return;

    const scrollStep = timing.scrollStep || { min: 200, max: 400 };
    const steps = Math.ceil(Math.abs(distance) / SharedUtils.randomInRange(scrollStep.min, scrollStep.max));
    const stepSize = distance / steps;

    if (log) log(`Scrolling to element (${steps} steps, ${Math.round(distance)}px)...`);

    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, stepSize);
      await SharedUtils.sleep(SharedUtils.randomInRange(30, 80));
    }

    const scrollPause = timing.scrollPause || { min: 800, max: 1500 };
    await SharedUtils.sleep(SharedUtils.randomInRange(scrollPause.min, scrollPause.max));
  },

  /**
   * Scroll down page by specified pixels
   * @param {number} pixels - Pixels to scroll
   * @param {Object} timing - Timing configuration
   */
  async scrollDownPage(pixels, timing) {
    const scrollStep = timing.scrollStep || { min: 200, max: 400 };
    const steps = Math.ceil(pixels / SharedUtils.randomInRange(scrollStep.min, scrollStep.max));
    const stepSize = pixels / steps;

    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, stepSize);
      await SharedUtils.sleep(SharedUtils.randomInRange(30, 80));
    }

    const scrollPause = timing.scrollPause || { min: 800, max: 1500 };
    await SharedUtils.sleep(SharedUtils.randomInRange(scrollPause.min, scrollPause.max));
  },

  /**
   * Check if button is disabled
   * @param {Element} btn - Button element
   * @returns {boolean}
   */
  isButtonDisabled(btn) {
    if (!btn) return true;
    return btn.disabled ||
           btn.classList.contains('disabled') ||
           btn.hasAttribute('disabled') ||
           btn.getAttribute('aria-disabled') === 'true';
  },

  /**
   * Dispatch mouse events for robust clicking
   * @param {Element} el - Element to click
   */
  strongClick(el) {
    if (!el) return;
    const events = ['mousedown', 'mouseup', 'click'];
    events.forEach(evtName => {
      el.dispatchEvent(new MouseEvent(evtName, {
        view: window,
        bubbles: true,
        cancelable: true
      }));
    });
  },

  /**
   * Find element by text content
   * @param {string} text - Text to search for
   * @param {string} selectors - CSS selectors to search within
   * @returns {Element|null}
   */
  findByText(text, selectors = 'button, input, label, [class*="field" i], [class*="input" i]') {
    const lowerText = text.toLowerCase();
    return Array.from(document.querySelectorAll(selectors))
      .find(el => {
        const content = (el.textContent || el.placeholder || '').toLowerCase();
        return content.includes(lowerText);
      });
  }
};

// Export for use in content scripts
if (typeof window !== 'undefined') {
  window.DomUtils = DomUtils;
}
