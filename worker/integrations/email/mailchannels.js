import { logEvent } from '../../lib/http.js';

const MAILCHANNELS_ENDPOINT = 'https://api.mailchannels.net/tx/v1/send';
const TIMEOUT_MS = 5000;

/**
 * Adaptador MailChannels.
 *
 * AVISO: MailChannels retiró en 2024 el envío gratuito desde Cloudflare
 * Workers. Hoy requiere cuenta de pago y clave de API, además de los registros
 * DNS de autenticación del dominio. Se deja implementado porque sigue siendo
 * una opción válida para quien ya tenga cuenta, pero NO es la recomendación
 * por defecto.
 *
 * REQUIERE CONFIGURACIÓN DEL PROPIETARIO:
 *   vars.EMAIL_PROVIDER = "mailchannels"
 *   vars.EMAIL_FROM     = "no-reply@vulnfocus.com"
 *   secret MAILCHANNELS_API_KEY
 *   Registros SPF/DKIM y Domain Lockdown del dominio remitente.
 */
export function createMailChannelsAdapter(env) {
  const apiKey = env.MAILCHANNELS_API_KEY || '';
  const from = env.EMAIL_FROM || '';
  const configured = Boolean(apiKey && from);

  return {
    name: 'mailchannels',
    configured,

    async send(message) {
      if (!configured) {
        logEvent('email_skipped', { reason: 'mailchannels-not-configured', kind: message.kind });
        return { ok: false, reason: 'not-configured' };
      }

      try {
        const res = await fetch(MAILCHANNELS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: message.to }] }],
            from: { email: from, name: 'VulnFocus' },
            subject: message.subject,
            content: [
              { type: 'text/plain', value: message.text },
              ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.ok) {
          logEvent('email_sent', { provider: 'mailchannels', kind: message.kind });
          return { ok: true };
        }
        logEvent('email_failed', {
          provider: 'mailchannels',
          kind: message.kind,
          http_status: res.status,
        });
        return { ok: false, reason: `http-${res.status}` };
      } catch {
        logEvent('email_failed', {
          provider: 'mailchannels',
          kind: message.kind,
          http_status: 'network-error',
        });
        return { ok: false, reason: 'network-error' };
      }
    },
  };
}

export default createMailChannelsAdapter;
