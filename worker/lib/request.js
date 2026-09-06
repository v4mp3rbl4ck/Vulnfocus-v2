/**
 * Higiene de la petición, común a todos los endpoints que aceptan JSON.
 *
 * Estaba embebida en handleContact; se extrae para que el cotizador aplique
 * EXACTAMENTE los mismos controles y en el mismo orden. Un endpoint nuevo que
 * se olvide de uno de estos pasos es la forma habitual de abrir un agujero.
 *
 * Los mensajes de error son los mismos de siempre, palabra por palabra: son
 * parte del contrato público de /api/contact.
 */

import { errorResponse } from './http.js';

/** `application/json` con o sin parámetros (charset, etc.). */
export function isJsonContentType(request) {
  const contentType = request.headers.get('Content-Type') || '';
  return contentType.toLowerCase().split(';')[0].trim().startsWith('application/json');
}

/**
 * Valida cabeceras, tamaño y sintaxis, y devuelve el JSON ya parseado.
 *
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<{ok: true, payload: *}|{ok: false, response: Response}>}
 */
export async function readJsonPayload(request, maxBytes) {
  if (!isJsonContentType(request)) {
    return { ok: false, response: errorResponse(415, 'Formato de contenido no soportado') };
  }

  // Content-Length es una pista: barata de comprobar y corta antes de leer.
  const declaredLength = Number(request.headers.get('Content-Length') || '0');
  if (declaredLength > maxBytes) {
    return { ok: false, response: errorResponse(413, 'La solicitud es demasiado grande') };
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: errorResponse(400, 'No fue posible procesar la solicitud') };
  }

  // Y el tamaño REAL, porque Content-Length puede mentir o no venir.
  if (new TextEncoder().encode(raw).length > maxBytes) {
    return { ok: false, response: errorResponse(413, 'La solicitud es demasiado grande') };
  }

  try {
    return { ok: true, payload: JSON.parse(raw) };
  } catch {
    return { ok: false, response: errorResponse(400, 'No fue posible procesar la solicitud') };
  }
}

/** Trunca entrada no confiable que se va a persistir. */
export function truncate(value, max) {
  return (value || '').slice(0, max) || null;
}
