/**
 * Model Classification
 * Unified car model classification across all sites
 */

const ModelClassifier = {
  /**
   * Model category definitions
   * Pattern-based classification for car rental categories
   */
  categories: [
    {
      pattern: /(picanto|rio|mg3|mirage|accent)/i,
      code: 'EDAR',
      group: 'Picanto, Rio & MG3'
    },
    {
      pattern: /(cerato|corolla|i30|civic|mazda3)/i,
      code: 'SEDAN',
      group: 'Cerato, Corolla & i30'
    },
    {
      pattern: /(camry|mazda6|accord|sonata)/i,
      code: 'IDAR',
      group: 'Camry, Mazda6 & Accord'
    },
    {
      pattern: /(seltos|qashqai|cx-5|tucson|rav4|sportage)/i,
      code: 'IFAR',
      group: 'Seltos, Qashqai & CX-5'
    },
    {
      pattern: /(sorento|santa\s*fe|cx-9|palisade|highlander)/i,
      code: 'SFAR',
      group: 'Sorento, Santa Fe & CX-9'
    }
  ],

  /**
   * Classify a car model based on its name
   * @param {string} fullName - Full car name
   * @param {string} baseName - Base car name (optional, for additional matching)
   * @returns {{ category_code: string, category_group: string }}
   */
  classifyModel(fullName, baseName = '') {
    const searchText = `${fullName} ${baseName}`.toLowerCase();

    const category = this.categories.find(cat => cat.pattern.test(searchText));

    return category
      ? { category_code: category.code, category_group: category.group }
      : { category_code: 'OTHER', category_group: 'Other' };
  },

  /**
   * Check if car name matches target models
   * @param {string} fullName - Full car name
   * @param {string[]} targetModels - Array of target model names
   * @returns {string|null} Matched model or null
   */
  findMatchingModel(fullName, targetModels) {
    if (!targetModels || targetModels.length === 0) return null;

    const normalizedName = fullName.toLowerCase().replace(/\s+/g, '');

    return targetModels.find(m => {
      const normalizedModel = m.toLowerCase().replace(/\s+/g, '');
      return normalizedName.includes(normalizedModel);
    }) || null;
  },

  /**
   * Parse target models from config string
   * @param {string} modelsStr - Comma-separated models string
   * @returns {string[]}
   */
  parseTargetModels(modelsStr) {
    if (!modelsStr) return [];
    return modelsStr
      .split(',')
      .map(m => m.trim().toLowerCase().replace(/\s+/g, ''))
      .filter(m => m);
  }
};

// Export for use in content scripts
if (typeof window !== 'undefined') {
  window.ModelClassifier = ModelClassifier;
}
