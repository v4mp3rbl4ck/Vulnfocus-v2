/**
 * Analytics orientado a conversión, privacy-first.
 *
 * Reglas de diseño, en este orden:
 *
 * 1. **Allowlist de eventos.** Solo se emite lo que está en EVENTS. Un nombre no
 *    declarado se descarta: así ningún componente puede inventar un evento con
 *    datos que nadie ha revisado.
 * 2. **Allowlist de propiedades.** Solo se admiten claves de PROPS y valores
 *    escalares cortos (identificadores de servicio, número de paso, moneda).
 *    Mensajes, correos, nombres, alcances completos e identificadores de
 *    cotización NO pueden salir de aquí, aunque alguien los pase por error.
 * 3. **Sin proveedor por defecto.** Mientras no exista uno configurado esto no
 *    hace ninguna petición de red. La integración se activa con
 *    REACT_APP_ANALYTICS y se documenta en docs/ARCHITECTURE.md.
 *
 * Cloudflare Web Analytics (la opción recomendada por ser sin cookies y sin
 * datos personales) se activa desde el panel de Cloudflare y mide páginas vistas
 * sin necesitar este módulo. Estos eventos son la capa de conversión que aquel
 * no cubre.
 */

export const EVENTS = Object.freeze([
  'quote_started',
  'quote_service_selected',
  'quote_scope_completed',
  'quote_completed',
  'quote_pdf_downloaded',
  'formal_proposal_requested',
  // Abrir el formulario y enviarlo son dos cosas distintas: el primero mide
  // interés, el segundo conversión. Con un solo evento no se puede saber
  // cuántos abandonan el formulario.
  'formal_proposal_submitted',
  'contact_submitted',
]);

// Propiedades permitidas. Todas son enumeraciones o números pequeños; ninguna
// puede contener datos personales ni texto libre del usuario.
const PROPS = Object.freeze(['service', 'services_count', 'step', 'currency', 'complexity']);

const MAX_VALUE_LENGTH = 32;

/** Deja pasar solo claves de la allowlist con valores escalares y cortos. */
function sanitize(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const key of PROPS) {
    const value = props[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH) {
      // Solo identificadores: letras, dígitos, guiones y guiones bajos.
      if (/^[A-Za-z0-9_-]+$/.test(value)) out[key] = value;
    }
  }
  return out;
}

/**
 * Registra un evento de conversión.
 * @param {string} event  Nombre de EVENTS.
 * @param {object} [props] Propiedades de PROPS.
 */
export function track(event, props) {
  if (!EVENTS.includes(event)) return;
  if (typeof window === 'undefined') return;

  const payload = { event, ...sanitize(props) };

  // Punto de integración único: cualquier proveedor futuro se engancha aquí o
  // escucha el evento del DOM, sin tocar los componentes.
  try {
    if (typeof window.vulnfocusAnalytics === 'function') {
      window.vulnfocusAnalytics(payload);
    }
    window.dispatchEvent(new CustomEvent('vulnfocus:analytics', { detail: payload }));
  } catch {
    /* Analytics nunca debe romper la interfaz. */
  }
}

export default track;
