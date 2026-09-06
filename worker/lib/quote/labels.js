/**
 * Etiquetas legibles de servicios y complejidad, para el lado del servidor.
 *
 * El motor trabaja con identificadores (`web`, `infra_externa`, `active_directory`)
 * porque son estables y no dependen del idioma. Pero un correo al cliente que
 * dice "Servicio: infra_externa" parece un volcado de base de datos, no una
 * comunicación comercial.
 *
 * Las etiquetas se leen del MISMO catálogo que consume el frontend
 * (frontend/src/config/quote-catalog.json), así que no hay una segunda lista que
 * se quede desfasada: añadir un servicio al catálogo le da nombre en el correo,
 * en el aviso de Telegram y en el panel a la vez.
 */

import catalog from '../../../frontend/src/config/quote-catalog.json';

const LABELS = new Map(catalog.services.map((service) => [service.id, service.labels]));

const COMPLEXITY = {
  es: { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' },
  en: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' },
};

/** Nombre de un servicio. Si el identificador no está en el catálogo se devuelve tal cual. */
export function serviceLabel(id, lang = 'es') {
  const labels = LABELS.get(id);
  if (!labels) return String(id);
  return labels[lang] || labels.es || String(id);
}

/** "Pentesting Web + Pentesting de API". */
export function serviceList(ids, lang = 'es') {
  if (!Array.isArray(ids) || ids.length === 0) return '—';
  return ids.map((id) => serviceLabel(id, lang)).join(' + ');
}

/** Etiqueta de complejidad. Devuelve el código si no se reconoce. */
export function complexityLabel(value, lang = 'es') {
  return COMPLEXITY[lang]?.[value] || COMPLEXITY.es[value] || String(value ?? '—');
}
