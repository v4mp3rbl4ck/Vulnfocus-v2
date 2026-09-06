import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import site from '../config/site.json';
import { useLanguage } from '../context/LanguageContext';

/**
 * SEO en cliente.
 *
 * El HTML que sirve Cloudflare YA llega con title, description, canonical,
 * Open Graph y JSON-LD correctos: los genera scripts/build-site.mjs desde
 * frontend/src/config/site.json, así que un rastreador que no ejecuta
 * JavaScript ve los metadatos buenos.
 *
 * Este componente cubre lo que aquel no puede: las navegaciones dentro de la
 * SPA (donde el documento no se recarga) y el cambio de idioma. Lee el MISMO
 * manifiesto, de modo que no existe una segunda fuente de verdad que pueda
 * desincronizarse.
 */
const ROUTES = site.routes;
const BASE = site.baseUrl.replace(/\/+$/, '');

/** Ruta del manifiesto que corresponde a un pathname, o null. */
export function findRoute(pathname) {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return ROUTES.find((r) => r.path === clean) || null;
}

function upsertMeta(selector, attrName, attrValue, content) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

const Seo = ({ title, description }) => {
  const { pathname } = useLocation();
  const { language } = useLanguage();

  useEffect(() => {
    const route = findRoute(pathname);
    const seo = route ? route.seo[language] || route.seo.es : null;

    const finalTitle = title || seo?.title || 'VulnFocus';
    const finalDescription = description || seo?.description || '';
    const canonical = route
      ? route.path === '/'
        ? `${BASE}/`
        : `${BASE}${route.path}`
      : `${BASE}${pathname}`;

    document.title = finalTitle;
    upsertMeta('meta[name="description"]', 'name', 'description', finalDescription);
    upsertMeta('meta[property="og:title"]', 'property', 'og:title', finalTitle);
    upsertMeta('meta[property="og:description"]', 'property', 'og:description', finalDescription);
    upsertMeta('meta[property="og:url"]', 'property', 'og:url', canonical);
    upsertMeta('meta[property="og:locale"]', 'property', 'og:locale', language === 'en' ? 'en_US' : 'es_CL');
    upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', finalTitle);
    upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', finalDescription);

    // Una página fuera del manifiesto (404) no debe declararse indexable.
    upsertMeta(
      'meta[name="robots"]',
      'name',
      'robots',
      !route || route.noindex ? 'noindex, nofollow' : 'index, follow',
    );

    let link = document.head.querySelector('link[rel="canonical"]');
    if (!route) {
      if (link) link.remove();
    } else {
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', canonical);
    }
  }, [pathname, language, title, description]);

  return null;
};

export default Seo;
