# Localization Guide

This project uses **i18next** for internationalization (i18n) support. Currently supported languages:
- 🇺🇸 English (en)
- 🇪🇸 Spanish (es)  
- 🇩🇪 German (de)

## File Structure

```
src/
  locales/
    en/
      translation.json
    es/
      translation.json
    de/
      translation.json
  i18n.js              # i18next configuration
  localeHelper.js      # Helper functions for localization
```

## How It Works

### 1. Translation Files
All translations are stored in JSON files under `src/locales/{language}/translation.json`. Each file follows a nested structure:

```json
{
  "nav": {
    "features": "Features",
    "pricing": "Pricing"
  },
  "hero": {
    "title": "MASKY",
    "subtitle": "Create AI-powered stream alerts..."
  }
}
```

### 2. HTML Integration
Add the `data-i18n` attribute to any element you want to translate:

```html
<h1 data-i18n="hero.title">MASKY</h1>
<button data-i18n="nav.signIn">Sign In</button>
```

For input placeholders:
```html
<input data-i18n-placeholder="auth.emailPlaceholder" placeholder="your@email.com">
```

### 3. JavaScript Integration
Use the `t()` function for dynamic content:

```javascript
import { t } from './localeHelper.js';

// Simple translation
const text = t('dashboard.emptyStateText');

// With interpolation
const welcome = t('dashboard.welcome', { username: 'John' });
```

### 4. Changing Languages
The language selector is automatically integrated in the navigation bar. Users can switch languages, and their preference is saved to `localStorage`.

Programmatically change language:
```javascript
changeLanguage('es'); // Switch to Spanish
changeLanguage('de'); // Switch to German
```

## Adding a New Language

1. **Create translation file:**
   ```bash
   mkdir src/locales/fr
   touch src/locales/fr/translation.json
   ```

2. **Add translations:**
   Copy the structure from `en/translation.json` and translate all values.

3. **Update i18n.js:**
   ```javascript
   supportedLngs: ['en', 'es', 'de', 'fr']
   ```

4. **Update language selector in index.html:**
   ```html
   <option value="fr">🇫🇷 Français</option>
   ```

## Adding New Translatable Text

1. **Add to all translation files:**
   Add the new key-value pair to `en/translation.json`, `es/translation.json`, and `de/translation.json`.

2. **Add to HTML:**
   ```html
   <p data-i18n="your.new.key">Default text</p>
   ```

3. **Or use in JavaScript:**
   ```javascript
   const text = t('your.new.key');
   ```

## Variable Interpolation

Use `{{variableName}}` in translation strings:

**translation.json:**
```json
{
  "welcome": "Welcome, {{username}}!"
}
```

**JavaScript:**
```javascript
t('welcome', { username: 'Sarah' }); // "Welcome, Sarah!"
```

**HTML:**
```html
<h1 data-i18n="welcome" data-i18n-options='{"username":"Sarah"}'>Welcome!</h1>
```

## Best Practices

1. **Use descriptive keys:** `auth.welcomeBack` instead of `msg1`
2. **Group related translations:** Use nested objects for organization
3. **Keep fallback text:** Always provide English text as fallback in HTML
4. **Test all languages:** Verify translations display correctly in all supported languages
5. **Consistent terminology:** Use the same terms across the application

## Language Detection

The system automatically detects the user's language preference in this order:
1. Previously selected language (from `localStorage`)
2. Browser language setting
3. Falls back to English if unsupported

## Resources

- [i18next Documentation](https://www.i18next.com/)
- [i18next Browser Language Detector](https://github.com/i18next/i18next-browser-languageDetector)

