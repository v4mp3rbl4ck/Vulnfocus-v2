/**
 * IDENTIFICADORES DE COTIZACIÓN.
 *
 * Se usan dos, y son distintos a propósito:
 *
 *  · `quote_number` — VF-2026-000042. Correlativo por año, visible, cómodo para
 *    hablar por teléfono. Al ser predecible NO sirve como credencial.
 *  · `public_id`    — 32 hexadecimales (128 bits) de crypto.getRandomValues.
 *    Es el único identificador con el que se puede recuperar una estimación,
 *    justamente porque no se puede enumerar.
 *
 * El correlativo se genera en la base con una sola sentencia atómica; nunca
 * leyendo y escribiendo por separado, que es donde aparecerían las colisiones
 * al recibir dos cotizaciones a la vez.
 */

const PUBLIC_ID_BYTES = 16; // 128 bits
export const PUBLIC_ID_RE = /^[0-9a-f]{32}$/;

/** Identificador público no predecible. */
export function generatePublicId() {
  const bytes = new Uint8Array(PUBLIC_ID_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Formatea el correlativo: VF-<año>-<6 dígitos>. */
export function formatQuoteNumber(year, value) {
  return `VF-${year}-${String(value).padStart(6, '0')}`;
}

/**
 * Reserva el siguiente correlativo del año.
 *
 * UPSERT con RETURNING: una única sentencia, así que dos peticiones simultáneas
 * obtienen valores distintos sin transacción explícita ni lectura previa.
 *
 * @param {D1Database} db
 * @param {number} year
 * @returns {Promise<string>} p. ej. "VF-2026-000042"
 */
export async function nextQuoteNumber(db, year) {
  const row = await db
    .prepare(
      `INSERT INTO quote_counters (year, value)
       VALUES (?, 1)
       ON CONFLICT(year) DO UPDATE SET value = value + 1
       RETURNING value`,
    )
    .bind(year)
    .first();

  const value = Number(row?.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('quote-counter-failed');
  }
  return formatQuoteNumber(year, value);
}
