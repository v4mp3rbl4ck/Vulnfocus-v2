/**
 * Verificación server-side de Cloudflare Turnstile (Siteverify).
 *
 * Endpoint oficial y único. No existe ninguna variable de entorno, cabecera ni
 * parámetro que permita saltarse esta verificación: cualquier bypass sería una
 * puerta trasera de producción. Los tests sustituyen `globalThis.fetch`, que es
 * el mecanismo soportado por @cloudflare/vitest-plugin.
 */

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const SITEVERIFY_TIMEOUT_MS = 5000;

// Longitud máxima documentada para idempotency_key; el token de respuesta se
// acota con el mismo criterio para no reenviar basura arbitraria a Cloudflare.
const MAX_TOKEN_LENGTH = 2048;

/**
 * @param {string|undefined} token         Token emitido por el widget.
 * @param {string} remoteIp                CF-Connecting-IP, opcional.
 * @param {object} env                     Bindings del Worker (TURNSTILE_SECRET_KEY).
 * @param {string[]} expectedHostnames     Allowlist EXACTA de hostnames aceptados.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 *
 * Fail closed: cualquier fallo (secreto ausente, red, timeout, 5xx, JSON
 * inválido, hostname fuera de la allowlist) rechaza el envío.
 */
export async function verifyTurnstile(token, remoteIp, env, expectedHostnames) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: false, reason: "not-configured" };
  }
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "missing-token" };
  }

  const body = {
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
    // Un idempotency_key por intento de verificación: si hay que reintentar por
    // un error de red, el reintento no "quema" el token (evita timeout-or-duplicate).
    idempotency_key: crypto.randomUUID(),
  };
  if (remoteIp) body.remoteip = remoteIp;

  let result;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `siteverify-http-${res.status}` };
    result = await res.json();
  } catch {
    // Cubre red caída, timeout del AbortSignal y cuerpo que no es JSON válido.
    return { ok: false, reason: "siteverify-unreachable" };
  }

  if (!result || result.success !== true) {
    const codes = Array.isArray(result?.["error-codes"]) ? result["error-codes"] : [];
    return { ok: false, reason: codes.join(",") || "invalid" };
  }

  // Allowlist exacta, nunca endsWith(): "vulnfocus.com.evil.tld" terminaría en
  // "vulnfocus.com" y pasaría una comprobación por sufijo.
  if (expectedHostnames.length > 0 && !expectedHostnames.includes(result.hostname)) {
    return { ok: false, reason: "hostname-mismatch" };
  }

  return { ok: true };
}

/** Parsea la allowlist declarada en `vars.TURNSTILE_ALLOWED_HOSTNAMES`. */
export function parseAllowedHostnames(env) {
  return (env.TURNSTILE_ALLOWED_HOSTNAMES || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}
