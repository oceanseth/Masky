# Localization Examples

## Quick Usage Examples

### 1. In HTML - Basic Translation
```html
<!-- Before -->
<button>Sign In</button>

<!-- After -->
<button data-i18n="nav.signIn">Sign In</button>
```

### 2. In HTML - Input Placeholders
```html
<!-- Before -->
<input type="email" placeholder="your@email.com">

<!-- After -->
<input type="email" 
       data-i18n-placeholder="auth.emailPlaceholder" 
       placeholder="your@email.com">
```

### 3. In JavaScript - Simple Translation
```javascript
import { t } from './localeHelper.js';

// Get translated text
const buttonText = t('nav.signIn');
console.log(buttonText); // "Sign In" or "Iniciar Sesión" or "Anmelden"
```

### 4. In JavaScript - With Variables
```javascript
import { t } from './localeHelper.js';

// Translation with interpolation
const welcomeMessage = t('dashboard.welcome', { username: 'Sarah' });
console.log(welcomeMessage); 
// English: "Welcome, Sarah"
// Spanish: "Bienvenido, Sarah"
// German: "Willkommen, Sarah"
```

### 5. Changing Language Programmatically
```javascript
import { changeLanguage } from './localeHelper.js';

// Change to Spanish
changeLanguage('es');

// Change to German
changeLanguage('de');

// Change to English
changeLanguage('en');
```

### 6. Dynamic Content Updates
```javascript
import { updateContent } from './localeHelper.js';

// After dynamically adding content to the DOM
const newDiv = document.createElement('div');
newDiv.setAttribute('data-i18n', 'dashboard.yourAlerts');
newDiv.textContent = 'Your Alerts';
document.body.appendChild(newDiv);

// Update all translations
updateContent();
```

### 7. Get Current Language
```javascript
import { getCurrentLanguage } from './localeHelper.js';

const currentLang = getCurrentLanguage();
console.log(currentLang); // "en", "es", or "de"
```

## Adding Translation Keys

### translation.json Structure
```json
{
  "section": {
    "subsection": {
      "key": "Translated text"
    }
  }
}
```

### Example: Adding a New Feature Section
```json
{
  "pricing": {
    "title": "Pricing Plans",
    "subtitle": "Choose the perfect plan for your stream",
    "free": {
      "name": "Free",
      "price": "$0/month",
      "features": "Basic alerts, 100 events/month"
    },
    "pro": {
      "name": "Pro",
      "price": "$9.99/month",
      "features": "Unlimited alerts, Custom avatars"
    }
  }
}
```

### Using in HTML
```html
<section id="pricing">
  <h2 data-i18n="pricing.title">Pricing Plans</h2>
  <p data-i18n="pricing.subtitle">Choose the perfect plan for your stream</p>
  
  <div class="plan">
    <h3 data-i18n="pricing.free.name">Free</h3>
    <p data-i18n="pricing.free.price">$0/month</p>
    <p data-i18n="pricing.free.features">Basic alerts, 100 events/month</p>
  </div>
</section>
```

## Common Patterns

### Modal/Dialog Content
```html
<div class="modal">
  <h2 data-i18n="modal.confirmDelete.title">Confirm Deletion</h2>
  <p data-i18n="modal.confirmDelete.message">Are you sure?</p>
  <button data-i18n="modal.confirmDelete.confirm">Delete</button>
  <button data-i18n="modal.confirmDelete.cancel">Cancel</button>
</div>
```

### Error Messages
```javascript
import { t } from './localeHelper.js';

try {
  // some operation
} catch (error) {
  const errorMsg = t('errors.connectionFailed');
  alert(errorMsg);
}
```

### Dynamically Generated Lists
```javascript
import { t } from './localeHelper.js';

const alerts = [
  { id: 1, type: 'subscription' },
  { id: 2, type: 'donation' }
];

const html = alerts.map(alert => `
  <div class="alert">
    <span>${t(`alertTypes.${alert.type}`)}</span>
  </div>
`).join('');
```

## Testing Translations

### Test Different Languages
```javascript
// In browser console
changeLanguage('es'); // Switch to Spanish
changeLanguage('de'); // Switch to German
changeLanguage('en'); // Switch back to English
```

### Check If Key Exists
```javascript
import { t } from './localeHelper.js';

// If key doesn't exist, it returns the key itself
const result = t('nonexistent.key');
console.log(result); // "nonexistent.key"
```

## Best Practices

1. **Use semantic keys:**
   ```json
   // Good
   { "auth.welcomeBack": "Welcome Back" }
   
   // Bad
   { "msg1": "Welcome Back" }
   ```

2. **Group by feature:**
   ```json
   {
     "auth": { ... },
     "dashboard": { ... },
     "alerts": { ... }
   }
   ```

3. **Keep text in translations, not in code:**
   ```javascript
   // Good
   alert(t('errors.invalidEmail'));
   
   // Bad
   alert('Invalid email address');
   ```

4. **Use interpolation for dynamic content:**
   ```json
   { "greeting": "Hello, {{name}}!" }
   ```
   ```javascript
   t('greeting', { name: userName });
   ```

