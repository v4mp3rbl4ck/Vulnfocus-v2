/**
 * VulnFocus — Cloudflare Worker API
 *
 * Superficie pública (deny by default):
 *   POST /api/contact  -> valida, verifica Turnstile, guarda en D1, notifica Telegram
 *   GET  /api/health   -> liveness sin dependencias ni datos internos
 *   *                  -> 404 JSON genérico
 *
 * Routing: wrangler.jsonc declara assets.run_worker_first = ["/api/*"], de modo
 * que SOLO las rutas /api/* invocan este Worker. Todo lo demás lo sirve Static
 * Assets directamente (no facturable, y aplicando el fichero _headers).
 */

import { errorResponse, json, logEvent, successResponse } from "./lib/http.js";
import { asTrimmedString, validateContact } from "./lib/validate.js";
import { parseAllowedHostnames, verifyTurnstile } from "./lib/turnstile.js";
import { sendTelegramNotification } from "./lib/telegram.js";

const MAX_BODY_BYTES = 16 * 1024; // 5000 chars de mensaje + resto de campos + overhead JSON
const MAX_UA_LENGTH = 256;

async function handleContact(request, env, ctx) {
  const clientIp = request.headers.get("CF-Connecting-IP") || "";

  // 1) Rate limiting nativo de Workers, antes de tocar D1 o Siteverify.
  //    Ver README > Rate limiting para su alcance real (por PoP, eventualmente consistente).
  if (env.CONTACT_RATE_LIMITER) {
    const { success } = await env.CONTACT_RATE_LIMITER.limit({ key: clientIp || "sin-ip" });
    if (!success) {
      logEvent("rate_limited", { path: "/api/contact" });
      return errorResponse(429, "Demasiadas solicitudes. Inténtalo en unos minutos.", {
        "Retry-After": "60",
      });
    }
  }

  // 2) Content-Type obligatorio.
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().split(";")[0].trim().startsWith("application/json")) {
    return errorResponse(415, "Formato de contenido no soportado");
  }

  // 3) Límite de tamaño. Se comprueba la cabecera y además los bytes reales,
  //    porque Content-Length lo controla el cliente y puede mentir.
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "La solicitud es demasiado grande");
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return errorResponse(400, "No fue posible procesar la solicitud");
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return errorResponse(413, "La solicitud es demasiado grande");
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return errorResponse(400, "No fue posible procesar la solicitud");
  }

  // 4) Honeypot. Si viene relleno: no se guarda, no se notifica, no se revela nada.
  //    El id devuelto es sintético y no corresponde a ninguna fila.
  if (asTrimmedString(payload?.website).length > 0) {
    logEvent("honeypot_triggered", { path: "/api/contact" });
    return successResponse(crypto.randomUUID());
  }

  // 5) Validación de campos.
  const validation = validateContact(payload);
  if (!validation.ok) {
    logEvent("validation_failed", { field: validation.field });
    return errorResponse(400, "Revisa los datos del formulario e inténtalo de nuevo");
  }

  // 6) Turnstile (fail closed).
  const turnstile = await verifyTurnstile(
    payload?.turnstileToken ?? payload?.["cf-turnstile-response"],
    clientIp,
    env,
    parseAllowedHostnames(env),
  );
  if (!turnstile.ok) {
    logEvent("turnstile_rejected", { reason: turnstile.reason });
    if (turnstile.reason === "not-configured") {
      return errorResponse(503, "El formulario no está disponible temporalmente");
    }
    return errorResponse(
      403,
      "No fue posible verificar la solicitud. Recarga la página e inténtalo de nuevo.",
    );
  }

  // 7) Persistencia en D1 (prepared statement; nunca concatenación de SQL).
  const contact = {
    id: crypto.randomUUID(),
    name: validation.data.name,
    email: validation.data.email,
    company: validation.data.company || null,
    message: validation.data.message,
    // Minimización de datos: la IP solo se guarda si STORE_IP === "true".
    ip_address: env.STORE_IP === "true" ? clientIp || null : null,
    user_agent: (request.headers.get("User-Agent") || "").slice(0, MAX_UA_LENGTH) || null,
    status: "new",
    created_at: new Date().toISOString(),
  };

  try {
    await env.DB.prepare(
      `INSERT INTO contact_submissions
         (id, name, email, company, message, ip_address, user_agent, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        contact.id,
        contact.name,
        contact.email,
        contact.company,
        contact.message,
        contact.ip_address,
        contact.user_agent,
        contact.status,
        contact.created_at,
      )
      .run();
  } catch (err) {
    // El detalle del error de D1 se queda en los logs; al cliente, mensaje genérico.
    // Si D1 falla NO se devuelve 201: el usuario debe poder reintentar.
    logEvent("d1_insert_failed", { id: contact.id, error: String(err?.message || err) });
    return errorResponse(500, "No fue posible enviar el mensaje");
  }

  logEvent("contact_saved", { id: contact.id });

  // 8) Telegram fuera de la ruta crítica. El contacto ya está persistido, así que
  //    un fallo de Telegram no puede provocar su pérdida ni un reenvío del usuario.
  ctx.waitUntil(sendTelegramNotification(contact, env));

  return successResponse(contact.id);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/contact") {
      if (request.method === "POST") return handleContact(request, env, ctx);
      return errorResponse(405, "Método no permitido", { Allow: "POST" });
    }

    if (path === "/api/health") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json({ status: "ok" }, 200);
      }
      return errorResponse(405, "Método no permitido", { Allow: "GET" });
    }

    // Deny by default para cualquier otra ruta bajo /api/*.
    return errorResponse(404, "Recurso no encontrado");
  },
};
