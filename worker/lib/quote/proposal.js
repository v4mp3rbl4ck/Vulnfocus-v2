/**
 * SOLICITUD DE PROPUESTA FORMAL — validación de lo poco que aporta el cliente.
 *
 * La cotización ya existe. Alcance, complejidad, horas y precio los calculó el
 * motor y están en D1; volver a aceptarlos por el cuerpo de la petición sería
 * regalar un endpoint para reescribirlos. Por eso este módulo solo conoce TRES
 * campos, y ninguno alimenta el cálculo:
 *
 *   · `notes`       comentarios adicionales
 *   · `targetDate`  fecha objetivo de inicio
 *   · `scopeNotes`  información de alcance que no cabía en el formulario
 *
 * Cualquier otra clave del cuerpo —`hours`, `price`, `complexity`, `scope`,
 * `status`, `quoteNumber`— NO se lee. No se filtra ni se rechaza: sencillamente
 * no existe para este código, que es la única forma de defensa contra mass
 * assignment que no se rompe cuando alguien añade un campo nuevo.
 */

const LIMITS = { notes: 1000, scopeNotes: 1000 };

/** Ventana admisible de la fecha objetivo, en días desde hoy. */
const TARGET_DATE_WINDOW_DAYS = 730; // dos años

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asTrimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Texto libre opcional.
 * @returns {{ok: true, value: string|null}|{ok: false}}
 */
function optionalText(raw, max) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  // Un número o un objeto donde se espera texto es un cliente roto o una prueba:
  // se rechaza, no se convierte a cadena.
  if (typeof raw !== 'string') return { ok: false };
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > max) return { ok: false };
  return { ok: true, value };
}

/**
 * Fecha objetivo: `YYYY-MM-DD`, existente en el calendario y dentro de una
 * ventana razonable.
 *
 * Se compara contra la fecha UTC porque el Worker no tiene zona horaria propia.
 * Se admite el día de hoy: alguien que pide la propuesta "para ya" no debe
 * chocar con un error de validación.
 *
 * @returns {{ok: true, value: string|null}|{ok: false}}
 */
function optionalTargetDate(raw, now) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };

  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (!DATE_RE.test(value)) return { ok: false };

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { ok: false };
  // "2026-02-31" pasa el regex y Date lo desplaza a marzo. Se compara la fecha
  // reconstruida con la recibida para descartar exactamente ese caso.
  if (parsed.toISOString().slice(0, 10) !== value) return { ok: false };

  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const days = Math.round((parsed.getTime() - today.getTime()) / 86400000);
  if (days < 0 || days > TARGET_DATE_WINDOW_DAYS) return { ok: false };

  return { ok: true, value };
}

/**
 * Valida los campos adicionales de una solicitud de propuesta formal.
 *
 * @param {*} payload  Cuerpo JSON ya parseado.
 * @param {Date} [now] Inyectable para los tests.
 * @returns {{ok: true, data: {notes: string|null, targetDate: string|null, scopeNotes: string|null}}
 *          |{ok: false, field: string}}
 */
export function normalizeProposalInput(payload, now = new Date()) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, field: 'body' };
  }

  const notes = optionalText(payload.notes, LIMITS.notes);
  if (!notes.ok) return { ok: false, field: 'notes' };

  const scopeNotes = optionalText(payload.scopeNotes, LIMITS.scopeNotes);
  if (!scopeNotes.ok) return { ok: false, field: 'scopeNotes' };

  const targetDate = optionalTargetDate(payload.targetDate, now);
  if (!targetDate.ok) return { ok: false, field: 'targetDate' };

  return {
    ok: true,
    data: { notes: notes.value, targetDate: targetDate.value, scopeNotes: scopeNotes.value },
  };
}

export { LIMITS as PROPOSAL_LIMITS, TARGET_DATE_WINDOW_DAYS };

/**
 * ENMASCARADO DE LOS DATOS DE CONTACTO
 *
 * El formulario tiene que demostrarle al cliente que ya sabemos a quién y a
 * dónde va la propuesta —si no, volvería a teclear lo mismo—, pero el
 * `public_id` es un enlace que se comparte por correo y que la propia interfaz
 * invita a guardar. Devolver el correo y el teléfono completos convertiría ese
 * enlace en una ficha de contacto para cualquiera que lo reciba reenviado.
 *
 * Con la versión enmascarada el cliente reconoce sus datos (es lo único que
 * necesita) y quien no los conocía sigue sin conocerlos. Los datos reales no
 * salen nunca del Worker: la notificación los toma de D1.
 */

/** `ana@ejemplo.com` → `a•••@ejemplo.com`. Los puntos son fijos: la longitud tampoco se filtra. */
export function maskEmail(value) {
  const email = asTrimmed(value);
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain.length === 0) return null;
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** `+56 9 1234 5678` → `•••• 78`. Solo los dos últimos dígitos, para reconocerlo. */
export function maskPhone(value) {
  const digits = asTrimmed(value).replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length <= 2) return '••••';
  return `•••• ${digits.slice(-2)}`;
}
