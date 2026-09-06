/**
 * NOTIFICATION SERVICE — punto único de salida de avisos.
 *
 * El código de negocio no sabe si detrás hay Telegram, correo o ambos: llama a
 * `quoteCreated()` o a `contactReceived()` y se acabó. Cambiar de proveedor de
 * correo, o añadir un canal nuevo, se hace aquí y en `integrations/email/`.
 *
 * Dos garantías que no se pueden romper:
 *
 *  1. **Nada lanza.** Todo se invoca desde ctx.waitUntil(). Un fallo de
 *     notificación no puede perder una cotización que ya está en D1.
 *  2. **Los canales son independientes.** Que Telegram falle no impide el
 *     correo, y al revés.
 */

import { logEvent } from '../lib/http.js';
import { buildQuoteTelegramText, sendTelegramNotification, sendTelegramText } from '../lib/telegram.js';
import { createEmailAdapter } from './email/index.js';
import { contactConfirmation, internalQuoteAlert, quoteConfirmation } from './email/templates.js';

/** Ejecuta un canal aislando su fallo. */
async function safely(label, id, fn) {
  try {
    return await fn();
  } catch (err) {
    logEvent('notification_channel_failed', {
      channel: label,
      id,
      error: String(err?.message || err),
    });
    return { ok: false, reason: 'exception' };
  }
}

export function createNotificationService(env = {}) {
  const email = createEmailAdapter(env);
  const internalTo = (env.EMAIL_INTERNAL_TO || '').trim();

  return {
    emailProvider: email.name,

    /** Nueva cotización: aviso interno por Telegram y por correo, y acuse al cliente. */
    async quoteCreated(quote, links = {}) {
      const results = await Promise.all([
        safely('telegram', quote.quoteNumber, () =>
          sendTelegramText(buildQuoteTelegramText(quote), env, quote.quoteNumber),
        ),
        safely('email_client', quote.quoteNumber, () =>
          email.send(quoteConfirmation(quote, links)),
        ),
        internalTo
          ? safely('email_internal', quote.quoteNumber, () =>
              email.send(internalQuoteAlert(quote, internalTo)),
            )
          : Promise.resolve({ ok: false, reason: 'internal-recipient-not-configured' }),
      ]);

      return { telegram: results[0], clientEmail: results[1], internalEmail: results[2] };
    },

    /** Contacto del formulario: se conserva el aviso de Telegram y se añade el acuse. */
    async contactReceived(contact) {
      const results = await Promise.all([
        safely('telegram', contact.id, () => sendTelegramNotification(contact, env)),
        safely('email_client', contact.id, () => email.send(contactConfirmation(contact))),
      ]);

      return { telegram: results[0], clientEmail: results[1] };
    },
  };
}

export default createNotificationService;
