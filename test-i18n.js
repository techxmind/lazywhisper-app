import i18n from 'i18next';

const resources = {
  en: {
    translation: {
      'window.title': 'LazyWhisper',
      'export.button': 'Export'
    }
  }
};

i18n.init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // react already safes from xss
  },
});

console.log("window.title:", i18n.t("window.title"));
console.log("export.button:", i18n.t("export.button"));
