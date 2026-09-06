/**
 * ADAPTADOR SysReptor — preparado, deshabilitado.
 *
 * Objetivo futuro:
 *
 *     Cotización aceptada → Cliente → Proyecto → SysReptor
 *
 * Estado actual: DESHABILITADO mediante `vars.SYSREPTOR_ENABLED`. No se
 * inventan endpoints ni formato de autenticación: la API de SysReptor no se ha
 * verificado desde este repositorio y escribir llamadas a ciegas produciría
 * código que parece funcionar y no funciona.
 *
 * Lo que este adaptador SÍ deja resuelto:
 *
 *  · La forma del dato que habría que enviar (`buildProjectDraft`), derivada de
 *    lo que ya tenemos en D1.
 *  · El punto exacto del flujo donde se invocaría.
 *  · El interruptor para activarlo.
 *
 * REQUIERE CONFIGURACIÓN DEL PROPIETARIO antes de poder implementarlo:
 *
 *   1. URL de la instancia (¿autoalojada?, ¿accesible desde Internet?).
 *   2. Método de autenticación y ámbito del token.
 *   3. Identificador de la plantilla de proyecto a usar.
 *   4. Decisión explícita sobre qué datos del cliente pueden salir de D1.
 *
 * IMPORTANTE: nunca se enviará nada automáticamente. Aunque se active el flag,
 * la creación de un proyecto debe seguir siendo una acción deliberada; por eso
 * `createProjectFromQuote` no se llama desde el flujo de creación de
 * cotizaciones.
 */

import { logEvent } from '../lib/http.js';

/**
 * Traduce una cotización al borrador de proyecto que necesitaría SysReptor.
 * Es información propia, sin secretos y sin datos de terceros.
 */
export function buildProjectDraft(quoteRow) {
  return {
    name: `${quoteRow.company} — ${quoteRow.quote_number}`,
    reference: quoteRow.quote_number,
    client: quoteRow.company,
    services: safeParse(quoteRow.services_json, []),
    scope: safeParse(quoteRow.scope_json, {}),
    estimatedHours: quoteRow.estimated_hours,
    createdAt: quoteRow.created_at,
  };
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createSysReptorAdapter(env = {}) {
  const enabled = String(env.SYSREPTOR_ENABLED || '').toLowerCase() === 'true';

  return {
    name: 'sysreptor',
    enabled,
    configured: false,

    async createProjectFromQuote(quoteRow) {
      if (!enabled) {
        logEvent('sysreptor_skipped', { reason: 'disabled', quote_number: quoteRow?.quote_number });
        return { ok: false, reason: 'disabled' };
      }
      // El flag está activo pero la integración no está implementada: se
      // registra y se devuelve el borrador para poder crearlo a mano, en vez de
      // fingir un envío.
      logEvent('sysreptor_pending_implementation', { quote_number: quoteRow?.quote_number });
      return { ok: false, reason: 'not-implemented', draft: buildProjectDraft(quoteRow) };
    },
  };
}

export default createSysReptorAdapter;
