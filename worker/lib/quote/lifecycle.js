/**
 * CICLO DE VIDA COMERCIAL DE UNA COTIZACIÓN.
 *
 * Los estados y las transiciones viven aquí, en un solo sitio, y son los mismos
 * que valida el CHECK de la columna `status` en D1 (migrations/0002_quotes.sql).
 * Si se añade un estado hay que tocar los dos, y el test de coherencia lo exige.
 *
 *     NEW ──► CONTACTED ──► PROPOSAL_SENT ──► ACCEPTED   (terminal)
 *      │          │               │
 *      └──────────┴───────────────┴─────────► REJECTED   (terminal)
 *      │          │               │
 *      └──────────┴───────────────┴─────────► EXPIRED
 *                                                 │
 *                                                 └────► CONTACTED  (se retoma)
 *
 * Por qué se restringe:
 *
 *  · Una cotización no puede "des-aceptarse" ni volver a NEW. Si hiciera falta
 *    corregir un error, se deja constancia: el histórico de `quote_status_events`
 *    es la fuente para auditar, no una vuelta atrás silenciosa.
 *  · ACCEPTED es el disparador previsto de SysReptor (docs/INTEGRATIONS.md). Un
 *    estado que pudiera entrar y salir de ACCEPTED podría crear proyectos
 *    duplicados el día que esa integración se active.
 *  · EXPIRED sí admite volver a CONTACTED: una oportunidad caducada que el
 *    cliente reabre es un caso real, y obligar a crear una cotización nueva
 *    perdería la trazabilidad de la anterior.
 *
 * NO existe ninguna ruta pública que cambie el estado. Solo la API de
 * administración, detrás de Cloudflare Access.
 */

export const QUOTE_STATUSES = Object.freeze([
  'NEW',
  'CONTACTED',
  'PROPOSAL_SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
]);

export const INITIAL_STATUS = 'NEW';

/** Estados que no admiten salida. */
export const TERMINAL_STATUSES = Object.freeze(['ACCEPTED', 'REJECTED']);

const TRANSITIONS = Object.freeze({
  NEW: Object.freeze(['CONTACTED', 'PROPOSAL_SENT', 'REJECTED', 'EXPIRED']),
  CONTACTED: Object.freeze(['PROPOSAL_SENT', 'REJECTED', 'EXPIRED']),
  PROPOSAL_SENT: Object.freeze(['ACCEPTED', 'REJECTED', 'EXPIRED']),
  ACCEPTED: Object.freeze([]),
  REJECTED: Object.freeze([]),
  EXPIRED: Object.freeze(['CONTACTED']),
});

export function isQuoteStatus(value) {
  return typeof value === 'string' && QUOTE_STATUSES.includes(value);
}

/** Transiciones posibles desde un estado. Array vacío si es terminal o desconocido. */
export function allowedTransitions(from) {
  return TRANSITIONS[from] ? [...TRANSITIONS[from]] : [];
}

/**
 * ¿Se puede pasar de `from` a `to`?
 *
 * Quedarse en el mismo estado NO es una transición válida: se responde con un
 * error explícito en lugar de escribir una fila de auditoría que no dice nada.
 */
export function canTransition(from, to) {
  if (!isQuoteStatus(from) || !isQuoteStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export function validateTransition(from, to) {
  if (!isQuoteStatus(to)) return { ok: false, reason: 'unknown-target-status' };
  if (!isQuoteStatus(from)) return { ok: false, reason: 'unknown-current-status' };
  if (from === to) return { ok: false, reason: 'same-status' };
  if (TERMINAL_STATUSES.includes(from)) return { ok: false, reason: 'terminal-status' };
  if (!canTransition(from, to)) return { ok: false, reason: 'transition-not-allowed' };
  return { ok: true };
}
