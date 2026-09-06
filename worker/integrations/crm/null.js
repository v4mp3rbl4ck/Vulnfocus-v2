import { logEvent } from '../../lib/http.js';

/**
 * CRM inerte, activo por defecto.
 *
 * No se elige un CRM por el propietario: HubSpot, Zoho y Odoo tienen modelos de
 * datos y autenticaciones distintas, y comprometerse con uno sin decisión
 * expresa sería atarle las manos. Este adaptador define el contrato y registra
 * la intención; el día que haya CRM, se implementa `createHubspotAdapter()` (o
 * el que sea) contra esta misma interfaz y se cambia `vars.CRM_PROVIDER`.
 */
export function createNullCrmAdapter() {
  const noop = (action) => async (payload) => {
    logEvent('crm_noop', { action, quote_number: payload?.quoteNumber || null });
    return { ok: false, reason: 'provider-null' };
  };

  return {
    name: 'null',
    configured: false,
    createLead: noop('createLead'),
    updateLead: noop('updateLead'),
    markWon: noop('markWon'),
    markLost: noop('markLost'),
  };
}

export default createNullCrmAdapter;
