import { logEvent } from '../../lib/http.js';

/**
 * Adaptador de correo inerte. Es el que está activo por defecto.
 *
 * No envía nada y no falla nunca: registra que habría enviado un correo, con
 * el tipo de mensaje y nada más. Así el resto del sistema puede llamar a la
 * capa de notificaciones desde el primer día, sin proveedor contratado y sin
 * credenciales inventadas.
 */
export function createNullEmailAdapter() {
  return {
    name: 'null',
    configured: false,
    async send(message) {
      logEvent('email_skipped', { reason: 'provider-null', kind: message.kind });
      return { ok: false, reason: 'provider-null' };
    },
  };
}

export default createNullEmailAdapter;
