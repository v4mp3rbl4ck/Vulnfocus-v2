import { logEvent } from "./http.js";
import { complexityLabel, serviceList } from "./quote/labels.js";

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
 * Resumen comercial de una cotización. Igual que el de contacto: texto plano,
 * sin parse_mode, y sin datos que no hagan falta para decidir si llamar.
 *
 * Deliberadamente NO se envían las notas libres del cliente ni el desglose
 * interno del cálculo: la fuente de verdad es D1 y el canal de Telegram es solo
 * un aviso.
 */
export function buildQuoteTelegramText(quote) {
  const price = quote.pricing?.available
    ? `${formatAmount(quote.pricing.min)} - ${formatAmount(quote.pricing.max)} ${quote.pricing.currency}`
    : "(sin precio: tarifa no configurada)";

  const lines = [
    "Nueva oportunidad VulnFocus",
    "",
    `ID: ${quote.quoteNumber}`,
    `Empresa: ${quote.company}`,
    `Contacto: ${quote.contactName}`,
    `Email: ${quote.email}`,
    `Telefono: ${quote.phone || "(no indicado)"}`,
    "",
    // Etiquetas del catálogo, no identificadores internos: el aviso se lee en un
    // móvil para decidir si hay que llamar, no para depurar el motor.
    `Servicio: ${serviceList(quote.services)}`,
    `Complejidad: ${complexityLabel(quote.complexity)}`,
    `Esfuerzo: ${quote.minDays}-${quote.maxDays} dias (${quote.minHours}-${quote.maxHours} h)`,
    `Estimacion: ${price}`,
    "",
    `Fecha: ${quote.createdAt}`,
  ];

  const text = lines.join("\n");
  return text.length > TELEGRAM_MAX_MESSAGE
    ? `${text.slice(0, TELEGRAM_MAX_MESSAGE)}\n[...truncado]`
    : text;
}

/**
 * Solicitud de propuesta formal sobre una cotización que YA existe.
 *
 * Mismo criterio que el resto del fichero: texto plano, sin parse_mode, y sin
 * texto libre del cliente. Los comentarios, la fecha objetivo en detalle y las
 * notas de alcance van al correo interno y a D1; aquí solo se indica que
 * existen, porque Telegram es un canal de terceros y este aviso solo sirve para
 * decidir si hay que ponerse con ello ahora.
 *
 * El precio aparece únicamente si el motor lo calculó y el precio sigue
 * habilitado: quien decide eso es el llamante (visiblePricing en el handler),
 * aquí solo se refleja.
 */
export function buildProposalRequestTelegramText(request, links = {}) {
  const price = request.pricing?.available
    ? `${formatAmount(request.pricing.min)} - ${formatAmount(request.pricing.max)} ${request.pricing.currency}`
    : null;

  const lines = [
    "Nueva solicitud de propuesta formal",
    "",
    `Cotizacion: ${request.quoteNumber}`,
    `Cliente: ${request.contactName}`,
    `Empresa: ${request.company}`,
    `Email: ${request.email}`,
    `Telefono: ${request.phone || "(no indicado)"}`,
    "",
    `Servicio(s): ${serviceList(request.services)}`,
    `Alcance resumido: ${request.scopeSummary || "—"}`,
    `Complejidad: ${complexityLabel(request.complexity)}`,
    `Horas estimadas: ${request.minHours}-${request.maxHours} h (${request.minDays}-${request.maxDays} dias)`,
  ];

  // Sin tarifa configurada NO se escribe la linea: un "Precio: -" invita a
  // pensar que hubo un fallo, cuando lo que pasa es que no hay precio que dar.
  if (price) lines.push(`Precio: ${price}`);

  if (request.targetDate) lines.push(`Fecha objetivo: ${request.targetDate}`);
  if (request.notes || request.scopeNotes) {
    lines.push("Incluye comentarios del cliente: ver la ficha");
  }

  lines.push("");
  if (links.estimate) lines.push(`Estimacion: ${links.estimate}`);
  lines.push(`Fecha: ${request.requestedAt}`);

  const text = lines.join("\n");
  return text.length > TELEGRAM_MAX_MESSAGE
    ? `${text.slice(0, TELEGRAM_MAX_MESSAGE)}\n[...truncado]`
    : text;
}

/** Separador de miles sin depender de Intl ni de la moneda. */
function formatAmount(value) {
  return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Envía un texto ya construido. Nunca lanza: se invoca desde ctx.waitUntil() y
 * un fallo NO debe afectar a la respuesta ya devuelta al usuario ni al dato ya
 * guardado en D1.
 */
export async function sendTelegramText(text, env, id) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    logEvent("telegram_skipped", { reason: "not-configured", id });
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
          text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      },
    );
    // Solo se registra el código HTTP. El cuerpo de error de Telegram puede
    // reflejar la URL (y con ella el token), así que no se loguea nunca.
    if (res.ok) {
      logEvent("telegram_sent", { id });
      return { ok: true };
    }
    logEvent("telegram_failed", { id, http_status: res.status });
    return { ok: false, reason: `http-${res.status}` };
  } catch {
    logEvent("telegram_failed", { id, http_status: "network-error" });
    return { ok: false, reason: "network-error" };
  }
}

/** Notificación de un contacto del formulario. */
export async function sendTelegramNotification(contact, env) {
  return sendTelegramText(buildTelegramText(contact), env, contact.id);
}
