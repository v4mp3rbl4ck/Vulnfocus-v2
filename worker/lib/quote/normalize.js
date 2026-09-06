/**
 * NORMALIZACIÓN Y VALIDACIÓN DE LA ENTRADA DEL COTIZADOR.
 *
 * Primera etapa del motor. Su contrato es estricto a propósito:
 *
 *  · Solo se leen claves declaradas en el catálogo público. Cualquier campo
 *    adicional del cuerpo se IGNORA, no se mezcla: es la defensa estructural
 *    contra mass assignment. Ni `estimated_hours`, ni `price`, ni `status`, ni
 *    `discount` pueden entrar por aquí porque el normalizador no los mira.
 *  · Los valores fuera de rango o de tipo incorrecto se rechazan; no se
 *    "arreglan" en silencio.
 *  · Las respuestas ausentes toman el valor por defecto del catálogo, así el
 *    motor siempre recibe el conjunto completo de respuestas.
 */

import catalog from '../../../frontend/src/config/quote-catalog.json';

export { catalog };

// Mismo criterio pragmático que el formulario de contacto: rechaza lo
// obviamente inválido sin intentar implementar el RFC 5322 completo.
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;

const CONTACT_LIMITS = { company: 100, name: 100, email: 254, phone: 30, notes: 1000 };

function asTrimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const SERVICE_BY_ID = new Map(catalog.services.map((s) => [s.id, s]));

/** Servicio del catálogo, o null. */
export function getCatalogService(id) {
  return SERVICE_BY_ID.get(id) || null;
}

/** Valor por defecto declarado para una pregunta. */
function defaultFor(question) {
  if (question.default !== undefined) {
    return Array.isArray(question.default) ? [...question.default] : question.default;
  }
  if (question.type === 'boolean') return false;
  if (question.type === 'multiselect') return [];
  if (question.type === 'number') return question.min ?? 0;
  if (question.type === 'select') return question.options?.[0]?.value ?? null;
  return null;
}

/**
 * Normaliza una respuesta contra su pregunta.
 * @returns {{ok: true, value: *}|{ok: false}}
 */
function normalizeAnswer(question, raw) {
  if (raw === undefined || raw === null) return { ok: true, value: defaultFor(question) };

  switch (question.type) {
    case 'number': {
      // Se acepta la cadena numérica porque un <input type="number"> puede
      // enviarla, pero nunca un booleano ni un objeto disfrazado de número.
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false };
      if (question.min !== undefined && n < question.min) return { ok: false };
      if (question.max !== undefined && n > question.max) return { ok: false };
      return { ok: true, value: n };
    }

    case 'boolean':
      if (typeof raw !== 'boolean') return { ok: false };
      return { ok: true, value: raw };

    case 'select': {
      const allowed = (question.options || []).map((o) => o.value);
      if (typeof raw !== 'string' || !allowed.includes(raw)) return { ok: false };
      return { ok: true, value: raw };
    }

    case 'multiselect': {
      if (!Array.isArray(raw)) return { ok: false };
      const allowed = new Set((question.options || []).map((o) => o.value));
      const seen = new Set();
      for (const item of raw) {
        if (typeof item !== 'string' || !allowed.has(item) || seen.has(item)) return { ok: false };
        seen.add(item);
      }
      if (question.minSelected && seen.size < question.minSelected) return { ok: false };
      // Orden estable por el catálogo: la misma selección produce siempre el
      // mismo JSON almacenado, sin depender del orden de clic.
      const value = (question.options || []).map((o) => o.value).filter((v) => seen.has(v));
      return { ok: true, value };
    }

    default:
      return { ok: false };
  }
}

/**
 * @param {*} payload  Cuerpo JSON ya parseado.
 * @param {string[]} allowedCurrencies  Monedas admitidas por la configuración.
 * @returns {{ok: true, data: object}|{ok: false, field: string}}
 */
export function normalizeQuoteInput(payload, allowedCurrencies = ['CLP']) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, field: 'body' };
  }

  // --- Servicios ----------------------------------------------------------
  const rawServices = payload.services;
  if (!Array.isArray(rawServices) || rawServices.length === 0) {
    return { ok: false, field: 'services' };
  }
  if (rawServices.length > (catalog.maxServices || 1)) {
    return { ok: false, field: 'services' };
  }

  const services = [];
  for (const id of rawServices) {
    if (typeof id !== 'string' || !SERVICE_BY_ID.has(id) || services.includes(id)) {
      return { ok: false, field: 'services' };
    }
    services.push(id);
  }
  // Orden canónico por catálogo, no por el orden de clic del usuario.
  services.sort(
    (a, b) =>
      catalog.services.findIndex((s) => s.id === a) - catalog.services.findIndex((s) => s.id === b),
  );

  // --- Alcance por servicio ----------------------------------------------
  const rawScope = payload.scope && typeof payload.scope === 'object' && !Array.isArray(payload.scope)
    ? payload.scope
    : {};

  const scope = {};
  for (const serviceId of services) {
    const service = SERVICE_BY_ID.get(serviceId);
    const answers = rawScope[serviceId];
    const source = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
    scope[serviceId] = {};
    for (const question of service.questions) {
      const result = normalizeAnswer(question, source[question.id]);
      if (!result.ok) return { ok: false, field: `scope.${serviceId}.${question.id}` };
      scope[serviceId][question.id] = result.value;
    }
  }

  // --- Contexto -----------------------------------------------------------
  const rawContext =
    payload.context && typeof payload.context === 'object' && !Array.isArray(payload.context)
      ? payload.context
      : {};

  const context = {};
  for (const question of catalog.context.questions) {
    const result = normalizeAnswer(question, rawContext[question.id]);
    if (!result.ok) return { ok: false, field: `context.${question.id}` };
    context[question.id] = result.value;
  }

  // --- Contacto -----------------------------------------------------------
  const rawContact =
    payload.contact && typeof payload.contact === 'object' && !Array.isArray(payload.contact)
      ? payload.contact
      : {};

  const company = asTrimmed(rawContact.company);
  const name = asTrimmed(rawContact.name);
  const email = asTrimmed(rawContact.email).toLowerCase();
  const phone = asTrimmed(rawContact.phone);
  const notes = asTrimmed(rawContact.notes);

  if (company.length < 2 || company.length > CONTACT_LIMITS.company) {
    return { ok: false, field: 'contact.company' };
  }
  if (name.length < 2 || name.length > CONTACT_LIMITS.name || !/\p{L}/u.test(name)) {
    return { ok: false, field: 'contact.name' };
  }
  if (email.length < 5 || email.length > CONTACT_LIMITS.email || !EMAIL_RE.test(email)) {
    return { ok: false, field: 'contact.email' };
  }
  if (phone.length > CONTACT_LIMITS.phone) return { ok: false, field: 'contact.phone' };
  // Allowlist de caracteres de teléfono: nada de texto libre en un campo que
  // acabará en una notificación.
  if (phone.length > 0 && !/^[0-9+()\-.\s]{6,30}$/.test(phone)) {
    return { ok: false, field: 'contact.phone' };
  }
  if (notes.length > CONTACT_LIMITS.notes) return { ok: false, field: 'contact.notes' };

  // --- Moneda -------------------------------------------------------------
  // Ausente = moneda por defecto de la configuración. Presente pero de otro tipo
  // se RECHAZA, igual que cualquier otra respuesta con el tipo equivocado: un
  // `currency: 42` no debe convertirse en silencio en la moneda por defecto.
  if (payload.currency !== undefined && payload.currency !== null && typeof payload.currency !== 'string') {
    return { ok: false, field: 'currency' };
  }
  const currency = asTrimmed(payload.currency).toUpperCase() || allowedCurrencies[0];
  if (!allowedCurrencies.includes(currency)) return { ok: false, field: 'currency' };

  return {
    ok: true,
    data: {
      services,
      scope,
      context,
      contact: {
        company,
        name,
        email,
        phone: phone || null,
        notes: notes || null,
      },
      currency,
    },
  };
}
