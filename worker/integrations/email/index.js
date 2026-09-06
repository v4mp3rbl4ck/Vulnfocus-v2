/**
 * Selección del adaptador de correo.
 *
 * El proveedor se decide por configuración (`vars.EMAIL_PROVIDER`), nunca en el
 * código que envía. Cambiar de Resend a otro proveedor es cambiar una variable
 * y desplegar; ningún fichero de negocio menciona un proveedor concreto.
 *
 * Un valor desconocido cae en el adaptador inerte en lugar de fallar: es
 * preferible no enviar un correo a tumbar la creación de una cotización.
 */

import { createNullEmailAdapter } from './null.js';
import { createResendAdapter } from './resend.js';
import { createMailChannelsAdapter } from './mailchannels.js';
import { logEvent } from '../../lib/http.js';

export function createEmailAdapter(env = {}) {
  const provider = String(env.EMAIL_PROVIDER || 'null').toLowerCase();

  switch (provider) {
    case 'resend':
      return createResendAdapter(env);
    case 'mailchannels':
      return createMailChannelsAdapter(env);
    case 'null':
    case '':
      return createNullEmailAdapter();
    default:
      logEvent('email_provider_unknown', { provider });
      return createNullEmailAdapter();
  }
}

export default createEmailAdapter;
