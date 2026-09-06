/**
 * Máquina de estados del cotizador.
 *
 * Funciones puras, sin React y sin DOM: toda la lógica de pasos, validación y
 * construcción del cuerpo de la petición vive aquí, de modo que se puede probar
 * sin montar la interfaz.
 *
 * La validación de este fichero es de EXPERIENCIA DE USUARIO, no un control de
 * seguridad: el Worker vuelve a validarlo todo contra el mismo catálogo. Si las
 * dos discrepan, manda el servidor.
 */

import catalog from '../../config/quote-catalog.json';

export const STEPS = catalog.steps;
export const MAX_SERVICES = catalog.maxServices || 1;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-.\s]{6,30}$/;

export function getService(id) {
  return catalog.services.find((s) => s.id === id) || null;
}

/** Respuestas por defecto de un servicio, tomadas del catálogo. */
export function defaultScopeFor(serviceId) {
  const service = getService(serviceId);
  if (!service) return {};
  const answers = {};
  for (const q of service.questions) {
    answers[q.id] = Array.isArray(q.default) ? [...q.default] : q.default;
  }
  return answers;
}

/** Respuestas por defecto del paso de contexto. */
export function defaultContext() {
  const answers = {};
  for (const q of catalog.context.questions) {
    answers[q.id] = Array.isArray(q.default) ? [...q.default] : q.default;
  }
  return answers;
}

export function initialState(preselectedService) {
  const services = getService(preselectedService) ? [preselectedService] : [];
  const scope = {};
  for (const id of services) scope[id] = defaultScopeFor(id);

  return {
    step: 0,
    services,
    scope,
    context: defaultContext(),
    contact: { company: '', name: '', email: '', phone: '', notes: '' },
  };
}

/** Añade o quita un servicio, creando o descartando su alcance. */
export function toggleService(state, serviceId) {
  if (!getService(serviceId)) return state;

  if (state.services.includes(serviceId)) {
    const services = state.services.filter((id) => id !== serviceId);
    const scope = { ...state.scope };
    delete scope[serviceId];
    return { ...state, services, scope };
  }

  if (state.services.length >= MAX_SERVICES) return state;

  return {
    ...state,
    services: [...state.services, serviceId],
    scope: { ...state.scope, [serviceId]: defaultScopeFor(serviceId) },
  };
}

export function setScopeAnswer(state, serviceId, questionId, value) {
  if (!state.scope[serviceId]) return state;
  return {
    ...state,
    scope: {
      ...state.scope,
      [serviceId]: { ...state.scope[serviceId], [questionId]: value },
    },
  };
}

export function setContextAnswer(state, questionId, value) {
  return { ...state, context: { ...state.context, [questionId]: value } };
}

export function setContactField(state, field, value) {
  return { ...state, contact: { ...state.contact, [field]: value } };
}

/** Validación por paso. Devuelve un mapa de errores por clave de campo. */
export function validateStep(state, stepIndex, messages) {
  const step = STEPS[stepIndex];
  const errors = {};

  if (step === 'service' && state.services.length === 0) {
    errors.services = messages.serviceEmpty;
  }

  if (step === 'scope') {
    for (const serviceId of state.services) {
      const service = getService(serviceId);
      for (const q of service.questions) {
        const value = state.scope[serviceId]?.[q.id];
        if (q.type === 'number') {
          const n = Number(value);
          if (!Number.isInteger(n) || n < q.min || n > q.max) {
            errors[`${serviceId}.${q.id}`] = messages.numberRange
              .replace('{min}', q.min)
              .replace('{max}', q.max);
          }
        }
        if (q.type === 'multiselect' && q.minSelected && (value || []).length < q.minSelected) {
          errors[`${serviceId}.${q.id}`] = messages.required;
        }
      }
    }
  }

  if (step === 'contact') {
    const { company, name, email, phone, notes } = state.contact;
    if (company.trim().length < 2) errors.company = messages.required;
    if (name.trim().length < 2) errors.name = messages.required;
    if (!EMAIL_RE.test(email.trim())) errors.email = messages.invalidEmail;
    if (phone.trim() && !PHONE_RE.test(phone.trim())) errors.phone = messages.invalidPhone;
    if (notes.length > 1000) errors.notes = messages.tooLong;
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

export function nextStep(state) {
  return { ...state, step: Math.min(state.step + 1, STEPS.length - 1) };
}

export function prevStep(state) {
  return { ...state, step: Math.max(state.step - 1, 0) };
}

export function goToStep(state, index) {
  return { ...state, step: Math.min(Math.max(index, 0), STEPS.length - 1) };
}

/**
 * Cuerpo de la petición a POST /api/quotes.
 *
 * Solo viajan respuestas: ni horas, ni precios, ni estado. Aunque se enviaran,
 * el Worker no los leería, pero tampoco tiene sentido mandarlos.
 */
export function buildPayload(state, { turnstileToken, currency }) {
  const scope = {};
  for (const id of state.services) scope[id] = state.scope[id];

  return {
    services: state.services,
    scope,
    context: state.context,
    contact: {
      company: state.contact.company.trim(),
      name: state.contact.name.trim(),
      email: state.contact.email.trim(),
      phone: state.contact.phone.trim(),
      notes: state.contact.notes.trim(),
    },
    currency,
    turnstileToken,
    // Honeypot: siempre vacío desde la interfaz real.
    website: '',
  };
}

export { catalog };
