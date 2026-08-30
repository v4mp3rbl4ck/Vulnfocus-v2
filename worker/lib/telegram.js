import { logEvent } from "./http.js";

export const TELEGRAM_MAX_MESSAGE = 3500; // límite real de Telegram: 4096; margen de seguridad
export const TELEGRAM_TIMEOUT_MS = 5000;

/**
 * Notificación en texto plano. No se usa parse_mode a propósito: sin Markdown ni
 * HTML no existe superficie de inyección de formato desde el contenido del
 * formulario, que es entrada no confiable.
 */
export function buildTelegramText(contact) {
  const lines = [
    "Nuevo contacto VulnFocus",
    "",
    `Nombre: ${contact.name}`,
    `Empresa: ${contact.company || "(no indicada)"}`,
    `Email: ${contact.email}`,
    `Fecha: ${contact.created_at}`,
    `ID: ${contact.id}`,
    "",
    "Mensaje:",
    contact.message,
  ];
  const text = lines.join("\n");
  return text.length > TELEGRAM_MAX_MESSAGE
    ? `${text.slice(0, TELEGRAM_MAX_MESSAGE)}\n[...truncado]`
    : text;
}

/**
 * Envía la notificación. Nunca lanza: se invoca desde ctx.waitUntil() y un fallo
 * NO debe afectar a la respuesta ya devuelta al usuario ni al dato ya guardado.
 */
export async function sendTelegramNotification(contact, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    logEvent("telegram_skipped", { reason: "not-configured", id: contact.id });
    return { ok: false, reason: "not-configured" };
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: buildTelegramText(contact),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      },
    );
    // Solo se registra el código HTTP. El cuerpo de error de Telegram puede
    // reflejar la URL (y con ella el token), así que no se loguea nunca.
    if (res.ok) {
      logEvent("telegram_sent", { id: contact.id });
      return { ok: true };
    }
    logEvent("telegram_failed", { id: contact.id, http_status: res.status });
    return { ok: false, reason: `http-${res.status}` };
  } catch {
    logEvent("telegram_failed", { id: contact.id, http_status: "network-error" });
    return { ok: false, reason: "network-error" };
  }
}
