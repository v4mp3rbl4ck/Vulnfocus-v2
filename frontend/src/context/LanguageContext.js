import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { translations } from '../utils/translations';

const LanguageContext = createContext();

const SUPPORTED = ['es', 'en'];
const DEFAULT_LANGUAGE = 'es';

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};

/**
 * Idioma inicial a partir de `?lang=`.
 *
 * El HTML prerenderizado declara <link rel="alternate" hreflang="en"
 * href="…?lang=en">. Si el parámetro no cambiara realmente el idioma, esas
 * etiquetas describirían una página que no existe. Aquí se hace verdad.
 */
function readInitialLanguage() {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  try {
    const value = new URLSearchParams(window.location.search).get('lang');
    return SUPPORTED.includes(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(readInitialLanguage);

  const setLanguage = useCallback((next) => {
    if (!SUPPORTED.includes(next)) return;
    setLanguageState(next);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => (prev === 'es' ? 'en' : 'es'));
  }, []);

  // La URL refleja el idioma para que se pueda compartir y para que coincida con
  // el hreflang del HTML servido. replaceState y no push: cambiar de idioma no
  // es un paso de navegación que deba acumularse en el historial.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    document.documentElement.lang = language;
    try {
      const url = new URL(window.location.href);
      if (language === DEFAULT_LANGUAGE) url.searchParams.delete('lang');
      else url.searchParams.set('lang', language);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      /* URL no manipulable: el idioma sigue funcionando en memoria. */
    }
  }, [language]);

  const value = useMemo(
    () => ({ language, setLanguage, toggleLanguage, t: translations[language] || translations.es }),
    [language, setLanguage, toggleLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};
