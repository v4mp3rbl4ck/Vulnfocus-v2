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
const CATALOG_SERVICES = new Map(catalog.services.map((service) => [service.id, service]));

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

/**
 * Nombre corto de una pregunta numérica, para resúmenes de una línea.
 *
 * Las etiquetas del catálogo son preguntas completas ("¿Cuántas aplicaciones web
 * entran en el alcance?") porque es lo que se le muestra a quien rellena el
 * formulario. En un aviso que se lee en un móvil no caben, y recortarlas a
 * ciegas parte palabras. Se extrae el sujeto —"aplicaciones web"— con una regla
 * explícita, y si la etiqueta no encaja se devuelve entera: preferible larga que
 * incorrecta.
 *
 * NO se añade una segunda lista de nombres cortos al catálogo: dos listas para
 * lo mismo terminan divergiendo, que es justo lo que evita este módulo.
 */
const SUBJECT_RE = {
  es: /^¿cu[áa]nt[oa]s?\s+(.+?)(?:\s+(?:entran|hay|tiene|tienen|distint\w+|deber[íi]a|se\s|unidos|consumen|u\s|y\s|o\s)|[,?])/i,
  en: /^how many\s+(.+?)(?:\s+(?:are|is|do|does|must|should|have|has|will)\b|[,?])/i,
};

function shortQuestionLabel(question, lang = 'es') {
  const label = question.labels?.[lang] || question.labels?.es || String(question.id);
  const match = (SUBJECT_RE[lang] || SUBJECT_RE.es).exec(label);
  return match ? match[1] : label.replace(/^¿/, '').replace(/\?$/, '');
}

/**
 * Alcance declarado en una línea: "Pentesting Web (3 aplicaciones web, 2 roles)".
 *
 * Solo entran las magnitudes numéricas, que son las que dimensionan el trabajo.
 * Las opciones de contexto (autenticación, WAF, entorno…) ya están reflejadas en
 * la complejidad y en las horas, y listarlas aquí convertiría el resumen en el
 * formulario entero.
 *
 * @param {string[]} services  Identificadores de servicio, en su orden.
 * @param {object} scope       scope_json ya parseado: { <servicio>: { <pregunta>: valor } }
 */
export function scopeSummary(services, scope, lang = 'es') {
  if (!Array.isArray(services) || services.length === 0) return '—';
  const parts = [];

  for (const id of services) {
    const service = CATALOG_SERVICES.get(id);
    const answers = scope && typeof scope === 'object' ? scope[id] : null;
    if (!service) {
      parts.push(serviceLabel(id, lang));
      continue;
    }

    const magnitudes = service.questions
      .filter((question) => question.type === 'number')
      .map((question) => {
        const value = answers?.[question.id];
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        return `${value} ${shortQuestionLabel(question, lang)}`;
      })
      .filter(Boolean);

    parts.push(
      magnitudes.length > 0
        ? `${serviceLabel(id, lang)} (${magnitudes.join(', ')})`
        : serviceLabel(id, lang),
    );
  }

  return parts.join(' + ');
}
