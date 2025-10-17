import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

// Initialize i18next
i18next
  .use(HttpBackend) // Load translations from files
  .use(LanguageDetector) // Detect user language
  .init({
    fallbackLng: 'en',
    debug: false,
    supportedLngs: ['en', 'es', 'de'],
    
    backend: {
      loadPath: '/src/locales/{{lng}}/{{ns}}.json'
    },
    
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage']
    },
    
    interpolation: {
      escapeValue: false // Not needed for vanilla JS
    }
  });

export default i18next;

