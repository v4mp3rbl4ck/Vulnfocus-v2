/**
 * Utilidades de respuesta HTTP del Worker.
 *
 * El fichero `_headers` de Static Assets NO se aplica a las respuestas generadas
 * por el Worker, así que las cabeceras de seguridad se ponen explícitamente aquí.
 */

export function securityHeaders(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...extra,
  };
}

/**
 * Serializa a JSON escapando los caracteres que solo son peligrosos FUERA de un
 * parser de JSON.
 *
 * `JSON.stringify` no escapa `<`, `>` ni `&`, así que el nombre de empresa
 * `<script>alert(1)</script>` aparece literal en el cuerpo de la respuesta. Con
 * `Content-Type: application/json`, `nosniff` y la CSP de `securityHeaders()` un
 * navegador no lo interpreta como HTML, y por eso no era explotable. Pero el
 * cuerpo de una API acaba en sitios que no controlamos: incrustado en una página
 * por un consumidor, en un panel de logs, en una herramienta de terceros. Ahí el
 * escapado sí decide.
 *
 * `\u003c` es JSON perfectamente válido: `JSON.parse` devuelve exactamente el
 * mismo texto, así que ni el frontend ni ningún cliente nota la diferencia.
 *
 * U+2028 y U+2029 se escapan porque son salto de línea para un parser de
 * JavaScript aunque sean válidos dentro de una cadena JSON: sin escaparlos, un
 * cuerpo interpolado en un `<script>` se rompe (y ahí empieza la inyección).
 */
function safeJsonStringify(body) {
  return JSON.stringify(body).replace(/[<>&\u2028\u2029]/g, (ch) => {
    switch (ch) {
      case "<": return "\\u003c";
      case ">": return "\\u003e";
      case "&": return "\\u0026";
      case "\u2028": return "\\u2028";
      default: return "\\u2029";
    }
  });
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(safeJsonStringify(body), {
    status,
    headers: securityHeaders(extraHeaders),
  });
}

/** Error hacia el cliente: siempre genérico. Nunca stack traces, SQL, ni detalle de Turnstile. */
export function errorResponse(status, messageEs, extraHeaders = {}) {
  return json({ status: "error", message: messageEs }, status, extraHeaders);
}

/**
 * Error de validación con el campo señalado.
 *
 * Forma fija, para que el navegador no tenga que adivinar:
 *
 *   { "status": "error", "error": "validation_error",
 *     "field": "targetDate", "reason": "too-far", "message": "…" }
 *
 *  · `error` y `reason` son códigos estables: es de lo que depende la interfaz
 *    para traducir el mensaje al idioma del visitante.
 *  · `message` es el texto en español que sirve de reserva si la interfaz no
 *    conoce el código. Sale de un catálogo cerrado y NUNCA interpola entrada del
 *    usuario: un mensaje que devuelve lo que llegó es un reflector.
 *  · `field` procede siempre de una lista cerrada del validador, nunca del
 *    cuerpo de la petición.
 *
 * Solo la usan endpoints cuyos campos son exactamente los que la persona ve en
 * pantalla. Donde el validador cubre un catálogo interno —/api/contact,
 * /api/quotes— se sigue devolviendo el error genérico de `errorResponse`: ahí
 * decir qué campo falló describiría la forma interna del validador.
 */
export function validationErrorResponse({ field, reason, message }) {
  return json({ status: "error", error: "validation_error", field, reason, message }, 400);
}

/** Éxito. Se usa también para el honeypot con un id sintético, para que un bot
 *  no pueda distinguir "aceptado" de "descartado". */
export function successResponse(submissionId, status = 201) {
  return json(
    {
      status: "success",
      message: "Mensaje recibido correctamente",
      submission_id: submissionId,
    },
    status,
  );
}

/** Log estructurado. NUNCA incluir cuerpo de la petición, tokens, ni secretos. */
export function logEvent(event, fields = {}) {
  try {
    console.log(JSON.stringify({ event, ...fields }));
  } catch {
    console.log(event);
  }
}
