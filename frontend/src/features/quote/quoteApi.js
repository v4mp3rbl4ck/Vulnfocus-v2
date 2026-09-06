/**
 * Cliente de la API del cotizador.
 *
 * Traduce códigos HTTP a errores que la interfaz puede explicar. Nunca muestra
 * el mensaje crudo del servidor cuando existe uno propio: los mensajes del
 * Worker son genéricos por diseño y no están traducidos.
 */

const TIMEOUT_MS = 15000;

async function request(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** POST /api/quotes → { ok, quote } | { ok: false, error } */
export async function createQuote(payload) {
  let response;
  try {
    response = await request('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (response.status === 429) return { ok: false, error: 'rateLimited' };
  if (!response.ok) return { ok: false, error: 'generic', status: response.status };

  try {
    const data = await response.json();
    if (!data?.quote) return { ok: false, error: 'generic' };
    return { ok: true, quote: data.quote };
  } catch {
    return { ok: false, error: 'generic' };
  }
}

/** GET /api/quotes/:publicId → { ok, quote } | { ok: false, error } */
export async function fetchQuote(publicId) {
  let response;
  try {
    response = await request(`/api/quotes/${encodeURIComponent(publicId)}`, { method: 'GET' });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (response.status === 404) return { ok: false, error: 'notFound' };
  if (response.status === 429) return { ok: false, error: 'rateLimited' };
  if (!response.ok) return { ok: false, error: 'generic' };

  try {
    const data = await response.json();
    if (!data?.quote) return { ok: false, error: 'generic' };
    return { ok: true, quote: data.quote };
  } catch {
    return { ok: false, error: 'generic' };
  }
}
