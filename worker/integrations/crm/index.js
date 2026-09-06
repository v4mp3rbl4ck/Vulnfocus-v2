/**
 * Selección del adaptador de CRM.
 *
 * Contrato que debe cumplir cualquier implementación futura:
 *
 *   createLead({ quoteNumber, publicId, company, contactName, email, phone,
 *                services, complexity, estimatedHours, currency, minPrice, maxPrice })
 *   updateLead({ quoteNumber, status })
 *   markWon({ quoteNumber })
 *   markLost({ quoteNumber, reason })
 *
 * Ninguna de ellas puede lanzar: se invocan desde ctx.waitUntil() y su fallo no
 * puede afectar a una cotización ya guardada.
 */

import { createNullCrmAdapter } from './null.js';
import { logEvent } from '../../lib/http.js';

export function createCrmAdapter(env = {}) {
  const provider = String(env.CRM_PROVIDER || 'null').toLowerCase();

  if (provider === 'null' || provider === '') return createNullCrmAdapter();

  // REQUIERE CONFIGURACIÓN DEL PROPIETARIO: no hay CRM elegido todavía.
  logEvent('crm_provider_unavailable', { provider });
  return createNullCrmAdapter();
}

export default createCrmAdapter;
