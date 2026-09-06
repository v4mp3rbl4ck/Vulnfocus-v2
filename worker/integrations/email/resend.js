import { logEvent } from '../../lib/http.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 5000;

/**
 * Adaptador Resend.
 *
 * REQUIERE CONFIGURACIÓN DEL PROPIETARIO:
 *   vars.EMAIL_PROVIDER = "resend"
 *   vars.EMAIL_FROM     = "VulnFocus <no-reply@vulnfocus.com>"   (dominio verificado en Resend)
 *   secret RESEND_API_KEY
 *
 * Nunca lanza: se invoca desde ctx.waitUntil() y un fallo de correo no puede
 * afectar a una cotización que ya está guardada en D1.
 */
export function createResendAdapter(env) {
  const apiKey = env.RESEND_API_KEY || '';
  const from = env.EMAIL_FROM || '';
  const configured = Boolean(apiKey && from);

  return {
    name: 'resend',
    configured,

    async send(message) {
      if (!configured) {
        logEvent('email_skipped', { reason: 'resend-not-configured', kind: message.kind });
        return { ok: false, reason: 'not-configured' };
      }

      try {
        const res = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        // Solo el código HTTP. El cuerpo de error del proveedor puede reflejar
        // cabeceras de la petición, y con ellas la clave.
        if (res.ok) {
          logEvent('email_sent', { provider: 'resend', kind: message.kind });
          return { ok: true };
        }
        logEvent('email_failed', { provider: 'resend', kind: message.kind, http_status: res.status });
        return { ok: false, reason: `http-${res.status}` };
      } catch {
        logEvent('email_failed', { provider: 'resend', kind: message.kind, http_status: 'network-error' });
        return { ok: false, reason: 'network-error' };
      }
    },
  };
}

export default createResendAdapter;
