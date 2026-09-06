/**
 * VulnFocus — Cloudflare Worker API
 *
 * Superficie pública COMPLETA (deny by default: todo lo demás es 404):
 *
 *   POST /api/contact            valida, Turnstile, D1, notificaciones
 *   POST /api/quotes             cotizador: valida, Turnstile, calcula, D1, notificaciones
 *   GET  /api/quotes/:public_id  recupera una estimación por identificador no predecible
 *   GET  /api/health             healthcheck
 *
 * Superficie PRIVADA, deshabilitada por defecto (`ADMIN_ENABLED="false"`):
 *
 *   GET   /admin                              panel del mini CRM
 *   GET   /api/admin/session|stats|quotes     lectura
 *   GET   /api/admin/quotes/:public_id        ficha + histórico
 *   PATCH /api/admin/quotes/:public_id/status transición de estado
 *
 * Con el interruptor apagado —su estado en el repositorio— TODAS esas rutas
 * devuelven exactamente el mismo 404 que cualquier ruta inexistente: ni un 403,
 * ni un 401, ni una cabecera distinta. Con el interruptor encendido siguen
 * devolviendo 404 mientras no llegue una aserción de identidad válida de
 * Cloudflare Access, verificada criptográficamente en worker/lib/access.js.
 * Nunca se sirve nada administrativo apoyándose en que la ruta sea poco conocida.
 *
 * El tráfico estático NO pasa por aquí: `assets.run_worker_first` está acotado a
 * "/api/*" y a "/admin*", así que las páginas y los assets los sirve Cloudflare
 * sin invocar el Worker. "/admin*" entra en esa lista precisamente para que no
 * pueda existir como asset estático servido con 200 a cualquiera.
 */

import { errorResponse, json, logEvent, successResponse } from "./lib/http.js";
import { readJsonPayload, truncate } from "./lib/request.js";
import { asTrimmedString, validateContact } from "./lib/validate.js";
import { parseAllowedHostnames, verifyTurnstile } from "./lib/turnstile.js";
import { createNotificationService } from "./integrations/notifications.js";
import { handleQuoteCreate, handleQuoteRead } from "./lib/quotes-handler.js";
import { adminEnabled, handleAdmin } from "./lib/admin/handler.js";
import { adminPageResponse } from "./lib/admin/ui.js";
import { authorizeAdmin } from "./lib/access.js";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_UA_LENGTH = 256;

/**
 * POST /api/contact
 *
 * Orden de controles, deliberado: lo barato y lo que corta antes va primero, y
 * Turnstile va después de la validación para no gastar una verificación en un
 * cuerpo que ya sabemos que es inválido.
 */
async function handleContact(request, env, ctx) {
  const clientIp = request.headers.get("CF-Connecting-IP") || "";

  // 1. Rate limiting.
  if (env.CONTACT_RATE_LIMITER) {
    const { success } = await env.CONTACT_RATE_LIMITER.limit({ key: clientIp || "sin-ip" });
    if (!success) {
      logEvent("rate_limited", { path: "/api/contact" });
      return errorResponse(429, "Demasiadas solicitudes. Inténtalo en unos minutos.", {
        "Retry-After": "60",
      });
    }
  }

  // 2. Content-Type, tamaño declarado, tamaño real y sintaxis JSON.
  const body = await readJsonPayload(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const payload = body.payload;

  // 3. Honeypot: respuesta indistinguible de un envío correcto, con un id
  //    sintético. Ni toca D1 ni gasta una verificación de Turnstile.
  if (asTrimmedString(payload?.website).length > 0) {
    logEvent("honeypot_triggered", { path: "/api/contact" });
    return successResponse(crypto.randomUUID());
  }

  // 4. Validación de campos. El error no revela cuál falló.
  const validation = validateContact(payload);
  if (!validation.ok) {
    logEvent("validation_failed", { field: validation.field });
    return errorResponse(400, "Revisa los datos del formulario e inténtalo de nuevo");
  }

  // 5. Turnstile, fail closed.
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

  const contact = {
    id: crypto.randomUUID(),
    name: validation.data.name,
    email: validation.data.email,
    company: validation.data.company || null,
    message: validation.data.message,
    // Minimización: con STORE_IP="false" (por defecto) la IP se usa en memoria
    // para el rate limit y Siteverify, pero no se persiste.
    ip_address: env.STORE_IP === "true" ? clientIp || null : null,
    user_agent: truncate(request.headers.get("User-Agent") || "", MAX_UA_LENGTH),
    status: "new",
    created_at: new Date().toISOString(),
  };

  if (!env.DB) {
    logEvent("d1_not_configured", { id: contact.id });
    return errorResponse(500, "No fue posible enviar el mensaje");
  }

  // 6. D1 es la fuente de verdad: si falla, 500 y no se notifica a nadie.
  try {
    await env.DB.prepare(
      `
      INSERT INTO contact_submissions
      (id, name, email, company, message, ip_address, user_agent, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
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
    logEvent("d1_insert_failed", { id: contact.id, error: String(err?.message || err) });
    return errorResponse(500, "No fue posible enviar el mensaje");
  }

  logEvent("contact_saved", { id: contact.id });

  // 7. Avisos en segundo plano (Telegram y, si hay proveedor, acuse por correo).
  //    Su fallo no afecta al 201 ni al dato ya guardado.
  ctx.waitUntil(createNotificationService(env).contactReceived(contact).catch(() => {}));

  return successResponse(contact.id);
}

/** Respuesta 405 uniforme. */
function methodNotAllowed(allow) {
  return errorResponse(405, "Método no permitido", { Allow: allow });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/contact") {
      if (request.method === "POST") return handleContact(request, env, ctx);
      return methodNotAllowed("POST");
    }

    if (path === "/api/quotes") {
      if (request.method === "POST") return handleQuoteCreate(request, env, ctx);
      return methodNotAllowed("POST");
    }

    // GET /api/quotes/<public_id>. Un único segmento: nada de rutas anidadas
    // que pudieran convertirse en superficie administrativa por accidente.
    if (path.startsWith("/api/quotes/")) {
      const rest = path.slice("/api/quotes/".length);
      if (rest.length === 0 || rest.includes("/")) {
        return errorResponse(404, "Recurso no encontrado");
      }
      if (request.method === "GET" || request.method === "HEAD") {
        return handleQuoteRead(request, env, rest);
      }
      return methodNotAllowed("GET");
    }

    // --- Administración ---------------------------------------------------
    // Se resuelve ANTES de /api/health por claridad de lectura, no por
    // precedencia: los prefijos no se solapan.
    if (path === "/api/admin" || path.startsWith("/api/admin/")) {
      return handleAdmin(request, env, path, ctx);
    }

    // El panel HTML. Mismos candados que la API, en el mismo orden.
    if (path === "/admin") {
      if (!adminEnabled(env)) return errorResponse(404, "Recurso no encontrado");
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed("GET");
      }
      const auth = await authorizeAdmin(request, env);
      if (!auth.ok) {
        logEvent("admin_unauthorized", { reason: auth.reason, path });
        return errorResponse(404, "Recurso no encontrado");
      }
      return adminPageResponse();
    }

    if (path === "/api/health") {
      if (request.method === "GET" || request.method === "HEAD") {
        return json({ status: "ok" }, 200);
      }
      return methodNotAllowed("GET");
    }

    // Deny by default.
    return errorResponse(404, "Recurso no encontrado");
  },
};
