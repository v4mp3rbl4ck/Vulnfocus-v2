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

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: securityHeaders(extraHeaders),
  });
}

/** Error hacia el cliente: siempre genérico. Nunca stack traces, SQL, ni detalle de Turnstile. */
export function errorResponse(status, messageEs, extraHeaders = {}) {
  return json({ status: "error", message: messageEs }, status, extraHeaders);
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
