import i18next from './i18n.js';

/**
 * Update all content on the page with translations
 */
export function updateContent() {
  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const translation = i18next.t(key);
    
    // Check if element contains HTML or just text
    if (element.children.length === 0 || element.getAttribute('data-i18n-html')) {
      element.textContent = translation;
    } else {
      // If element has children, try to find the text node
      const textNode = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
      if (textNode) {
        textNode.textContent = translation;
      }
    }
  });

  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    element.placeholder = i18next.t(key);
  });

  // Update elements with interpolation (e.g., {{username}})
  document.querySelectorAll('[data-i18n-options]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const options = JSON.parse(element.getAttribute('data-i18n-options'));
    element.textContent = i18next.t(key, options);
  });
}

/**
 * Change the current language and update all content
 * @param {string} lng - Language code (e.g., 'en', 'es', 'de')
 */
export function changeLanguage(lng) {
  i18next.changeLanguage(lng, (err) => {
    if (err) {
      console.error('Error changing language:', err);
      return;
    }
    updateContent();
    // Update language selector if it exists
    const selector = document.getElementById('languageSelector');
    if (selector) {
      selector.value = lng;
    }
  });
}

/**
 * Get translation for a key
 * @param {string} key - Translation key
 * @param {object} options - Interpolation options
 * @returns {string} Translated text
 */
export function t(key, options = {}) {
  return i18next.t(key, options);
}

/**
 * Get current language
 * @returns {string} Current language code
 */
export function getCurrentLanguage() {
  return i18next.language;
}

// Initialize content when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    i18next.on('initialized', () => {
      updateContent();
      // Set the language selector to match current language
      const selector = document.getElementById('languageSelector');
      if (selector) {
        selector.value = i18next.language;
      }
    });
  });
} else {
  i18next.on('initialized', () => {
    updateContent();
    // Set the language selector to match current language
    const selector = document.getElementById('languageSelector');
    if (selector) {
      selector.value = i18next.language;
    }
  });
}

