import { env } from "cloudflare:test";
import { vi } from "vitest";

export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TELEGRAM_HOST = "https://api.telegram.org";

/**
 * Sustituye globalThis.fetch. Es el mecanismo soportado por
 * @cloudflare/vitest-plugin desde la migración a Vitest 4 (fetchMock de
 * "cloudflare:test" fue eliminado).
 *
 * No existe ningún hook de inyección en el código de producción: se intercepta
 * la llamada de red real, así que el Worker bajo test es byte a byte el que se
 * despliega.
 *
 * @param {object} opts
 * @param {object|Error|'invalid-json'} opts.siteverify Respuesta de Siteverify.
 * @param {number} [opts.siteverifyStatus]
 * @param {number} [opts.telegramStatus]
 */
export function mockOutboundFetch(opts = {}) {
  const calls = { siteverify: [], telegram: [] };

  const impl = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === SITEVERIFY) {
      calls.siteverify.push(JSON.parse(init.body));
      if (opts.siteverify instanceof Error) throw opts.siteverify;
      if (opts.siteverify === "invalid-json") {
        return new Response("<html>502 Bad Gateway</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response(JSON.stringify(opts.siteverify ?? { success: false }), {
        status: opts.siteverifyStatus ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.startsWith(TELEGRAM_HOST)) {
      calls.telegram.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true }), {
        status: opts.telegramStatus ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`fetch saliente no esperado en test: ${url}`);
  };

  vi.stubGlobal("fetch", vi.fn(impl));
  return calls;
}

export const okSiteverify = (hostname = "vulnfocus.com") => ({
  success: true,
  challenge_ts: new Date().toISOString(),
  hostname,
  "error-codes": [],
});

// El binding de rate limiting está ACTIVO dentro del pool de Vitest y agrupa por
// clave (la IP). Sin una IP distinta por petición, a partir del 6º envío toda la
// suite recibiría 429. Por eso cada request de test lleva una IP única salvo que
// el test fije una a propósito (ver rate-limit.test.js).
let ipCounter = 0;
export function nextTestIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}:${ipCounter}`;
}

export function contactRequest(body, headers = {}) {
  return new Request("https://vulnfocus.com/api/contact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": nextTestIp(),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const validPayload = (over = {}) => ({
  name: "Ana López",
  email: "ana@ejemplo.com",
  company: "ACME S.A.",
  message: "Quisiera cotizar un pentest web para nuestra API de producción.",
  turnstileToken: "0.token-de-prueba",
  ...over,
});

export async function countRows() {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM contact_submissions").first();
  return r.n;
}

export async function resetDb() {
  await env.DB.prepare("DELETE FROM contact_submissions").run();
}
