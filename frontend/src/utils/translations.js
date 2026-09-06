/**
 * Diccionario de la interfaz.
 *
 * El contenido vive en ./i18n/. Este fichero se mantiene como punto de entrada
 * porque es el que importan LanguageContext y el resto de componentes desde
 * antes de la reestructuración.
 */
import { es } from './i18n/es';
import { en } from './i18n/en';
import { quoteEs } from './i18n/quote-es';
import { quoteEn } from './i18n/quote-en';

export const translations = {
  es: { ...es, quote: quoteEs },
  en: { ...en, quote: quoteEn },
};

export default translations;
