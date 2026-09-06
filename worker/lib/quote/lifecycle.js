/**
 * CICLO DE VIDA COMERCIAL DE UNA COTIZACIÓN.
 *
 * Los estados y las transiciones viven aquí, en un solo sitio, y son los mismos
 * que valida el CHECK de la columna `status` en D1 (la definición vigente es la
 * de migrations/0004_proposal_requests.sql, que reconstruye la tabla creada en
 * 0002 precisamente para ampliar ese CHECK). Si se añade un estado hay que tocar
 * los dos, y el test de coherencia lo exige.
 *
 *     NEW ──► CONTACTED ──► PROPOSAL_REQUESTED ──► PROPOSAL_SENT ──► ACCEPTED
 *      │          │  ▲                 │                  │          (terminal)
 *      │          └──┘ (se retoma)     │                  │
 *      ├──────────┴──────────────┬─────┴──────────────────┴──► REJECTED (terminal)
 *      │                         │
 *      └─────────────────────────┴──────────────────────────► EXPIRED
 *                                                                 │
 *                                                                 └──► CONTACTED
 *
 * PROPOSAL_REQUESTED es el único estado que puede fijar el propio cliente, desde
 * /estimacion, y solo en esa dirección: significa "ha pedido la propuesta
 * formal", no "se le ha enviado". Quién puede hacerlo está en
 * PUBLIC_PROPOSAL_ORIGINS, no en la máquina: la máquina dice qué transiciones
 * son coherentes; el endpoint público dice cuáles de ellas puede provocar un
 * visitante. Son dos preguntas distintas y mezclarlas es como se acaba con una
 * ruta pública capaz de mover una oportunidad a ACCEPTED.
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
 *  · PROPOSAL_REQUESTED ↔ CONTACTED en los dos sentidos: el cliente puede pedir
 *    la propuesta antes o después de que se le llame, y llamarle después de que
 *    la pida no debe obligar a inventar un estado intermedio.
 *
 * La ÚNICA ruta pública que cambia el estado es
 * POST /api/quotes/:public_id/request-proposal, acotada a esta transición. Todo
 * lo demás sigue siendo exclusivo de la API de administración, detrás de
 * Cloudflare Access.
 */

export const QUOTE_STATUSES = Object.freeze([
  'NEW',
  'CONTACTED',
  'PROPOSAL_REQUESTED',
  'PROPOSAL_SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
]);

export const INITIAL_STATUS = 'NEW';

/** Estado que fija la solicitud de propuesta formal del cliente. */
export const PROPOSAL_REQUESTED_STATUS = 'PROPOSAL_REQUESTED';

/**
 * Estados desde los que el endpoint público admite la solicitud.
 *
 * Es más estrecho que lo que permite la máquina a propósito: una cotización que
 * ya está en PROPOSAL_SENT, ACCEPTED, REJECTED o EXPIRED la lleva una persona, y
 * un clic en un enlace antiguo no puede devolverla a un estado anterior.
 */
export const PUBLIC_PROPOSAL_ORIGINS = Object.freeze(['NEW', 'CONTACTED']);

/** Estados que no admiten salida. */
export const TERMINAL_STATUSES = Object.freeze(['ACCEPTED', 'REJECTED']);

const TRANSITIONS = Object.freeze({
  NEW: Object.freeze(['CONTACTED', 'PROPOSAL_REQUESTED', 'PROPOSAL_SENT', 'REJECTED', 'EXPIRED']),
  CONTACTED: Object.freeze(['PROPOSAL_REQUESTED', 'PROPOSAL_SENT', 'REJECTED', 'EXPIRED']),
  PROPOSAL_REQUESTED: Object.freeze(['CONTACTED', 'PROPOSAL_SENT', 'REJECTED', 'EXPIRED']),
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
