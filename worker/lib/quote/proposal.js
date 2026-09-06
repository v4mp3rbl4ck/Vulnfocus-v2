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
 *
 * LAS REGLAS NO VIVEN AQUÍ. Están en `frontend/src/config/proposal-request.js`,
 * que importan a la vez este validador y el formulario, igual que
 * `quote-catalog.json` alimenta al motor y al cotizador. Este módulo decide; el
 * navegador solo se adelanta a la respuesta. El servidor sigue siendo la
 * autoridad y revalida absolutamente todo.
 */

import {
  PROPOSAL_TEXT_LIMITS,
  TARGET_DATE_MAX_DAYS,
  TARGET_DATE_MIN_DAYS,
  targetDateBounds,
  validateOptionalText,
  validateTargetDate,
} from '../../../frontend/src/config/proposal-request.js';

export {
  PROPOSAL_TEXT_LIMITS,
  TARGET_DATE_MAX_DAYS,
  TARGET_DATE_MIN_DAYS,
  targetDateBounds,
};

function asTrimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * MENSAJES DE ERROR DE VALIDACIÓN.
 *
 * Catálogo cerrado, indexado por campo y motivo. Dos propiedades que no son
 * negociables:
 *
 *  · **Nunca se interpola entrada del usuario.** Lo único variable es la fecha
 *    límite, que la calcula el servidor. Un mensaje que devuelve lo que llegó es
 *    un reflector, y acaba incrustado en sitios que no controlamos.
 *  · **Nunca describen el interior.** Dicen qué corregir, no cómo está escrito
 *    el validador, ni qué hay en la base, ni por qué falló por dentro.
 *
 * A diferencia de /api/contact y /api/quotes, aquí SÍ se devuelve el campo. En
 * aquellos endpoints el validador cubre 49 preguntas de un catálogo y decir cuál
 * falló describiría su forma interna. Aquí los campos son exactamente los tres
 * que la persona tiene delante en el formulario: no hay nada que revelar, y
 * callarlo solo consigue que no sepa cuál corregir.
 */
function validationMessage(field, reason, bounds) {
  if (field === 'targetDate') {
    if (reason === 'past') return 'La fecha objetivo no puede ser anterior a hoy.';
    if (reason === 'too-far') return `La fecha objetivo no puede ir más allá del ${bounds.max}.`;
    return 'Indica la fecha objetivo con el formato AAAA-MM-DD.';
  }

  if (field === 'notes' || field === 'scopeNotes') {
    const label = field === 'notes' ? 'Los comentarios adicionales' : 'La información de alcance';
    if (reason === 'too-long') {
      return `${label} no pueden superar los ${PROPOSAL_TEXT_LIMITS[field]} caracteres.`;
    }
    return `${label} deben ser texto.`;
  }

  return 'Revisa los datos del formulario e inténtalo de nuevo.';
}

/**
 * Valida los campos adicionales de una solicitud de propuesta formal.
 *
 * @param {*} payload  Cuerpo JSON ya parseado.
 * @param {Date} [now] Inyectable para los tests.
 * @returns {{ok: true, data: {notes: string|null, targetDate: string|null, scopeNotes: string|null}}
 *          |{ok: false, field: string, reason: string, message: string}}
 */
export function normalizeProposalInput(payload, now = new Date()) {
  const bounds = targetDateBounds(now);
  const invalid = (field, reason) => ({
    ok: false,
    field,
    reason,
    message: validationMessage(field, reason, bounds),
  });

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('body', 'invalid');
  }

  const notes = validateOptionalText(payload.notes, PROPOSAL_TEXT_LIMITS.notes);
  if (!notes.ok) return invalid('notes', notes.reason);

  const scopeNotes = validateOptionalText(payload.scopeNotes, PROPOSAL_TEXT_LIMITS.scopeNotes);
  if (!scopeNotes.ok) return invalid('scopeNotes', scopeNotes.reason);

  const targetDate = validateTargetDate(payload.targetDate, now);
  if (!targetDate.ok) return invalid('targetDate', targetDate.reason);

  return {
    ok: true,
    data: { notes: notes.value, targetDate: targetDate.value, scopeNotes: scopeNotes.value },
  };
}

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
