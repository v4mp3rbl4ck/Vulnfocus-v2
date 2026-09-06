import { env } from "cloudflare:test";
import { vi } from "vitest";

export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TELEGRAM_HOST = "https://api.telegram.org";

// Administración: equipo y audiencia ficticios de Cloudflare Access. No existen;
// el JWKS se sirve desde el mock y las claves se generan en el propio test.
export const ACCESS_TEAM_DOMAIN = "vulnfocus-test.cloudflareaccess.com";
export const ACCESS_AUD = "a".repeat(64);
export const ACCESS_JWKS_URL = `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;

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
  const calls = { siteverify: [], telegram: [], jwks: [] };

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

    // JWKS de Cloudflare Access. Se sirve el que pida el test, para poder probar
    // también el caso "el JWKS no responde".
    if (url === ACCESS_JWKS_URL) {
      calls.jwks.push(url);
      if (opts.jwks === "unreachable") throw new Error("network");
      return new Response(JSON.stringify({ keys: opts.jwks ?? [] }), {
        status: opts.jwksStatus ?? 200,
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

// ---------------------------------------------------------------------------
// Cotizador

export function quoteRequest(body, headers = {}) {
  return new Request("https://vulnfocus.com/api/quotes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": nextTestIp(),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const validQuotePayload = (over = {}) => ({
  services: ["web"],
  scope: {
    web: {
      apps: 1,
      roles: 2,
      auth: "password",
      endpoints: "lt50",
      api_asociada: false,
      waf: false,
      environment: "staging",
      stack: [],
    },
  },
  context: {
    retest: false,
    executive_session: false,
    report_language: "es",
    urgency: "normal",
    out_of_hours: false,
  },
  contact: {
    company: "ACME S.A.",
    name: "Ana López",
    email: "ana@ejemplo.com",
    phone: "+56 9 1234 5678",
    notes: "",
  },
  currency: "CLP",
  turnstileToken: "0.token-de-prueba",
  ...over,
});

export async function countQuotes() {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM quotes").first();
  return r.n;
}

export async function resetQuotes() {
  await env.DB.prepare("DELETE FROM quotes").run();
  await env.DB.prepare("DELETE FROM quote_counters").run();
}

// ---------------------------------------------------------------------------
// Administración / Cloudflare Access
//
// Se genera un par RSA de verdad y se firman JWT reales con WebCrypto. Así el
// test ejercita la MISMA verificación de firma que producción
// (worker/lib/access.js) en lugar de simular su resultado: un fallo en la
// comprobación de `alg`, de `aud` o de la firma se vería aquí.

const ADMIN_KID = "test-key-1";

/** Par RSA-2048 para firmar, y su clave pública en formato JWKS. */
export async function createAccessKeyPair() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    jwks: [{ kid: ADMIN_KID, kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" }],
  };
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value) {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Firma una aserción de identidad de Access.
 * @param {CryptoKey} privateKey
 * @param {object} over  Sobrescribe claims, o la cabecera vía `over.header`.
 */
export async function signAccessJwt(privateKey, over = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: ADMIN_KID, typ: "JWT", ...(over.header || {}) };
  const payload = {
    iss: `https://${ACCESS_TEAM_DOMAIN}`,
    aud: [ACCESS_AUD],
    sub: "test-subject",
    email: "admin@vulnfocus.com",
    iat: nowS,
    nbf: nowS,
    exp: nowS + 600,
    ...over,
  };
  delete payload.header;

  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

/** Entorno con la administración habilitada y Access configurado. */
export function adminEnv(base, over = {}) {
  return {
    ...base,
    ADMIN_ENABLED: "true",
    CF_ACCESS_TEAM_DOMAIN: ACCESS_TEAM_DOMAIN,
    CF_ACCESS_AUD: ACCESS_AUD,
    ADMIN_ALLOWED_EMAILS: "",
    ...over,
  };
}

export function adminRequest(path, { token, method = "GET", body, headers = {} } = {}) {
  return new Request(`https://vulnfocus.com${path}`, {
    method,
    headers: {
      ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      "CF-Connecting-IP": nextTestIp(),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

export async function resetStatusEvents() {
  await env.DB.prepare("DELETE FROM quote_status_events").run();
}
