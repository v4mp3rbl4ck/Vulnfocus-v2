/**
 * VulnFocus — Cloudflare Worker API
 *
 * Superficie pública:
 *   POST /api/contact  -> valida, verifica Turnstile, guarda en D1, notifica Telegram
 *   GET  /api/health   -> healthcheck
 *   GET  /api/debug    -> diagnóstico temporal de bindings/runtime
 *   *                  -> 404 JSON genérico
 *
 * IMPORTANTE:
 * /api/debug es TEMPORAL y debe eliminarse cuando terminemos el diagnóstico.
 */

import {
  errorResponse,
  json,
  logEvent,
  successResponse,
} from "./lib/http.js";

import {
  asTrimmedString,
  validateContact,
} from "./lib/validate.js";

import {
  parseAllowedHostnames,
  verifyTurnstile,
} from "./lib/turnstile.js";

import {
  sendTelegramNotification,
} from "./lib/telegram.js";


const MAX_BODY_BYTES = 16 * 1024;
const MAX_UA_LENGTH = 256;


/**
 * Procesa POST /api/contact
 */
async function handleContact(request, env, ctx) {
  const clientIp =
    request.headers.get("CF-Connecting-IP") || "";

  /**
   * Rate limiting
   */
  if (env.CONTACT_RATE_LIMITER) {
    const { success } =
      await env.CONTACT_RATE_LIMITER.limit({
        key: clientIp || "sin-ip",
      });

    if (!success) {
      logEvent("rate_limited", {
        path: "/api/contact",
      });

      return errorResponse(
        429,
        "Demasiadas solicitudes. Inténtalo en unos minutos.",
        {
          "Retry-After": "60",
        },
      );
    }
  }


  /**
   * Validación Content-Type
   */
  const contentType =
    request.headers.get("Content-Type") || "";

  if (
    !contentType
      .toLowerCase()
      .split(";")[0]
      .trim()
      .startsWith("application/json")
  ) {
    return errorResponse(
      415,
      "Formato de contenido no soportado",
    );
  }


  /**
   * Validación Content-Length
   */
  const declaredLength = Number(
    request.headers.get("Content-Length") || "0",
  );

  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(
      413,
      "La solicitud es demasiado grande",
    );
  }


  /**
   * Leer body
   */
  let raw;

  try {
    raw = await request.text();
  } catch {
    return errorResponse(
      400,
      "No fue posible procesar la solicitud",
    );
  }


  /**
   * Validar tamaño real del body
   */
  if (
    new TextEncoder().encode(raw).length >
    MAX_BODY_BYTES
  ) {
    return errorResponse(
      413,
      "La solicitud es demasiado grande",
    );
  }


  /**
   * Parsear JSON
   */
  let payload;

  try {
    payload = JSON.parse(raw);
  } catch {
    return errorResponse(
      400,
      "No fue posible procesar la solicitud",
    );
  }


  /**
   * Honeypot
   */
  if (
    asTrimmedString(payload?.website).length > 0
  ) {
    logEvent("honeypot_triggered", {
      path: "/api/contact",
    });

    return successResponse(
      crypto.randomUUID(),
    );
  }


  /**
   * Validación formulario
   */
  const validation =
    validateContact(payload);

  if (!validation.ok) {
    logEvent("validation_failed", {
      field: validation.field,
    });

    return errorResponse(
      400,
      "Revisa los datos del formulario e inténtalo de nuevo",
    );
  }


  /**
   * Turnstile
   */
  const turnstile =
    await verifyTurnstile(
      payload?.turnstileToken ??
        payload?.["cf-turnstile-response"],
      clientIp,
      env,
      parseAllowedHostnames(env),
    );


  if (!turnstile.ok) {
    logEvent("turnstile_rejected", {
      reason: turnstile.reason,
    });


    /**
     * Secret inexistente
     */
    if (
      turnstile.reason ===
      "not-configured"
    ) {
      return errorResponse(
        503,
        "El formulario no está disponible temporalmente",
      );
    }


    /**
     * Otros errores Turnstile
     */
    return errorResponse(
      403,
      "No fue posible verificar la solicitud. Recarga la página e inténtalo de nuevo.",
    );
  }


  /**
   * Construir registro
   */
  const contact = {
    id: crypto.randomUUID(),

    name:
      validation.data.name,

    email:
      validation.data.email,

    company:
      validation.data.company || null,

    message:
      validation.data.message,

    ip_address:
      env.STORE_IP === "true"
        ? clientIp || null
        : null,

    user_agent:
      (
        request.headers.get(
          "User-Agent",
        ) || ""
      ).slice(
        0,
        MAX_UA_LENGTH,
      ) || null,

    status: "new",

    created_at:
      new Date().toISOString(),
  };


  /**
   * Comprobar binding D1
   *
   * Esto evita un error ambiguo si DB no existe.
   */
  if (!env.DB) {
    logEvent("d1_not_configured", {
      id: contact.id,
    });

    return errorResponse(
      500,
      "No fue posible enviar el mensaje",
    );
  }


  /**
   * Insertar en D1
   */
  try {
    await env.DB.prepare(
      `
      INSERT INTO contact_submissions
      (
        id,
        name,
        email,
        company,
        message,
        ip_address,
        user_agent,
        status,
        created_at
      )
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
    logEvent(
      "d1_insert_failed",
      {
        id: contact.id,

        error:
          String(
            err?.message || err,
          ),
      },
    );

    return errorResponse(
      500,
      "No fue posible enviar el mensaje",
    );
  }


  /**
   * Registro exitoso
   */
  logEvent("contact_saved", {
    id: contact.id,
  });


  /**
   * Telegram se ejecuta en background
   */
  ctx.waitUntil(
    sendTelegramNotification(
      contact,
      env,
    ),
  );


  /**
   * Respuesta exitosa
   */
  return successResponse(
    contact.id,
  );
}


/**
 * Worker principal
 */
export default {

  async fetch(
    request,
    env,
    ctx,
  ) {

    const url =
      new URL(request.url);

    const path =
      url.pathname.replace(
        /\/+$/,
        "",
      ) || "/";


    /**
     * POST /api/contact
     */
    if (
      path ===
      "/api/contact"
    ) {

      if (
        request.method ===
        "POST"
      ) {
        return handleContact(
          request,
          env,
          ctx,
        );
      }


      return errorResponse(
        405,
        "Método no permitido",
        {
          Allow: "POST",
        },
      );
    }


    /**
     * GET /api/health
     */
    if (
      path ===
      "/api/health"
    ) {

      if (
        request.method === "GET" ||
        request.method === "HEAD"
      ) {

        return json(
          {
            status: "ok",
          },
          200,
        );
      }


      return errorResponse(
        405,
        "Método no permitido",
        {
          Allow: "GET",
        },
      );
    }


    /**
     * GET /api/debug
     *
     * TEMPORAL.
     *
     * No muestra secretos.
     * Solamente indica si existen.
     */
    if (
      path ===
      "/api/debug"
    ) {

      if (
        request.method !== "GET"
      ) {
        return errorResponse(
          405,
          "Método no permitido",
          {
            Allow: "GET",
          },
        );
      }


      return json(
        {

          worker:
            "vulnfocus-v2",

          debugVersion:
            "debug-2026-09-03-01",

          hasTurnstileSecret:
            Boolean(
              env.TURNSTILE_SECRET_KEY,
            ),

          hasTelegramBotToken:
            Boolean(
              env.TELEGRAM_BOT_TOKEN,
            ),

          hasTelegramChatId:
            Boolean(
              env.TELEGRAM_CHAT_ID,
            ),

          hasDB:
            Boolean(
              env.DB,
            ),

          hasRateLimiter:
            Boolean(
              env.CONTACT_RATE_LIMITER,
            ),

          allowedHostnames:
            env.TURNSTILE_ALLOWED_HOSTNAMES ||
            null,

          storeIp:
            env.STORE_IP ||
            null,

        },
        200,
      );
    }


    /**
     * Deny by default
     */
    return errorResponse(
      404,
      "Recurso no encontrado",
    );
  },
};
