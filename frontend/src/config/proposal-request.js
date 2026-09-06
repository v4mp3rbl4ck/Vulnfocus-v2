/**
 * REGLAS DE LA SOLICITUD DE PROPUESTA FORMAL — fuente ÚNICA.
 *
 * Este módulo lo importan **los dos lados**: el Worker
 * (`worker/lib/quote/proposal.js`) para decidir, y el formulario
 * (`features/quote/ProposalRequestForm.jsx`) para avisar antes de enviar. Es el
 * mismo patrón que ya usa `quote-catalog.json`, que alimenta a la vez al motor y
 * al cotizador.
 *
 * Por qué compartido y no duplicado: una ventana de fechas escrita dos veces se
 * separa a la primera vez que alguien ajusta una de las dos. El síntoma no es un
 * fallo evidente, es un formulario que deja elegir una fecha que el servidor
 * rechaza después, y una persona que no entiende por qué.
 *
 * ESTO NO ES UN CONTROL DE SEGURIDAD EN EL NAVEGADOR. El Worker vuelve a validar
 * todo lo que llega, exactamente igual que antes; la validación del formulario
 * solo evita un viaje de ida y vuelta y un mensaje tardío. Que las dos usen la
 * misma función es una comodidad, no una delegación.
 *
 * Sin dependencias de React ni de APIs de navegador: tiene que poder ejecutarse
 * dentro de workerd.
 */

/** Longitudes máximas del texto libre que el cliente puede aportar. */
export const PROPOSAL_TEXT_LIMITS = Object.freeze({
  notes: 1000,
  scopeNotes: 1000,
});

/**
 * Ventana admisible de la fecha objetivo, en días desde hoy.
 *
 *   mínimo  0    hoy vale: quien necesita empezar ya no debe chocar con un error
 *   máximo  730  dos años; más allá no es una fecha objetivo, es una intención
 */
export const TARGET_DATE_MIN_DAYS = 0;
export const TARGET_DATE_MAX_DAYS = 730;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86400000;

/** Medianoche UTC del día que representa `date`. El Worker no tiene zona horaria propia. */
function utcMidnight(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** `Date` → `AAAA-MM-DD`. */
function toIsoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Límites que se le pasan al `<input type="date">` y contra los que valida el
 * Worker. Una sola definición para los dos.
 *
 * @param {Date} [now]
 * @returns {{min: string, max: string}} en formato `AAAA-MM-DD`
 */
export function targetDateBounds(now = new Date()) {
  const today = utcMidnight(now);
  return {
    min: toIsoDay(today + TARGET_DATE_MIN_DAYS * MS_PER_DAY),
    max: toIsoDay(today + TARGET_DATE_MAX_DAYS * MS_PER_DAY),
  };
}

/**
 * Valida la fecha objetivo. Es opcional: vacío es una respuesta válida.
 *
 * @param {*} raw
 * @param {Date} [now]
 * @returns {{ok: true, value: string|null}|{ok: false, reason: 'format'|'past'|'too-far'}}
 */
export function validateTargetDate(raw, now = new Date()) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, reason: 'format' };

  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (!ISO_DATE_RE.test(value)) return { ok: false, reason: 'format' };

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { ok: false, reason: 'format' };
  // "2026-02-31" pasa el patrón y `Date` lo desplaza a marzo. Se compara la
  // fecha reconstruida con la recibida para descartar exactamente ese caso.
  if (parsed.toISOString().slice(0, 10) !== value) return { ok: false, reason: 'format' };

  const days = Math.round((parsed.getTime() - utcMidnight(now)) / MS_PER_DAY);
  if (days < TARGET_DATE_MIN_DAYS) return { ok: false, reason: 'past' };
  if (days > TARGET_DATE_MAX_DAYS) return { ok: false, reason: 'too-far' };

  return { ok: true, value };
}

/**
 * Texto libre opcional.
 *
 * Un número o un objeto donde se espera texto es un cliente roto o una prueba:
 * se rechaza, no se convierte a cadena.
 *
 * @returns {{ok: true, value: string|null}|{ok: false, reason: 'type'|'too-long'}}
 */
export function validateOptionalText(raw, max) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, reason: 'type' };

  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > max) return { ok: false, reason: 'too-long' };
  return { ok: true, value };
}
