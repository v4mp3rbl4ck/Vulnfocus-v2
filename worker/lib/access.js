/**
 * VERIFICACIÓN DE CLOUDFLARE ACCESS — defensa en profundidad de /api/admin/*.
 *
 * Cloudflare Access es la autenticación. Este módulo NO la sustituye: comprueba
 * que la petición trae una aserción de identidad válida FIRMADA por el equipo de
 * Access configurado. Sirve para que la administración no quede expuesta si
 * alguien retira la política de Access del panel, o si el Worker recibe tráfico
 * por una ruta que no pasa por ella (workers.dev, otro dominio, un route mal
 * configurado). Sin esta comprobación, "está detrás de Access" sería una
 * suposición; con ella, es un requisito verificado en cada petición.
 *
 * NO se implementa autenticación propia (usuario/contraseña, sesiones, tokens
 * emitidos por nosotros) a propósito: sería una superficie nueva que mantener y
 * que rotar, y Access ya resuelve MFA, SSO, expiración y revocación.
 *
 * Qué se valida, en este orden:
 *
 *   1. Configuración presente y con forma correcta (team domain y AUD).
 *   2. Presencia del JWT: cabecera Cf-Access-Jwt-Assertion o cookie CF_Authorization.
 *   3. Cabecera del JWT: alg RS256 (nunca "none", nunca HMAC) y kid.
 *   4. Firma contra el JWKS público del equipo (cacheado en memoria del isolate).
 *   5. Claims: iss exacto, aud exacto, exp, nbf/iat con tolerancia de reloj.
 *   6. Identidad: email (o common_name en tokens de servicio) y, si se declara,
 *      allowlist propia en ADMIN_ALLOWED_EMAILS.
 *
 * REQUIERE CONFIGURACIÓN DEL PROPIETARIO (docs/CLOUDFLARE_MANUAL_ACTIONS.md):
 *   vars.CF_ACCESS_TEAM_DOMAIN = "<equipo>.cloudflareaccess.com"
 *   vars.CF_ACCESS_AUD         = AUD tag de la aplicación de Access
 */

import { logEvent } from './http.js';

const JWKS_PATH = '/cdn-cgi/access/certs';
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_TIMEOUT_MS = 5000;
const CLOCK_SKEW_S = 60;

// El team domain sale de la configuración, no del usuario, pero se valida igual:
// es el host de una petición saliente y una errata no debe convertirse en SSRF.
const TEAM_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/;
const AUD_RE = /^[A-Za-z0-9._-]{32,128}$/;

/** Cache del JWKS por team domain, en memoria del isolate. Nunca en D1. */
let jwksCache = { teamDomain: '', keys: null, expiresAt: 0 };

/** Normaliza lo que el propietario haya escrito: con o sin esquema, con o sin barra. */
export function normalizeTeamDomain(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

/** Lee una cookie concreta sin depender de librerías. */
function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return '';
}

/**
 * El JWT llega en la cabecera que inyecta Access; la cookie es el respaldo para
 * peticiones de navegación del propio navegador.
 */
export function extractAccessToken(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header.trim();
  return readCookie(request.headers.get('Cookie'), 'CF_Authorization');
}

async function loadJwks(teamDomain) {
  const now = Date.now();
  if (jwksCache.teamDomain === teamDomain && jwksCache.keys && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  const res = await fetch(`https://${teamDomain}${JWKS_PATH}`, {
    signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`jwks-http-${res.status}`);

  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : null;
  if (!keys || keys.length === 0) throw new Error('jwks-empty');

  jwksCache = { teamDomain, keys, expiresAt: now + JWKS_TTL_MS };
  return keys;
}

/** Invalida la cache. Existe para los tests; en producción caduca sola. */
export function resetJwksCache() {
  jwksCache = { teamDomain: '', keys: null, expiresAt: 0 };
}

/**
 * Verifica la aserción de identidad de Cloudflare Access.
 *
 * @returns {Promise<{ok: true, identity: {email: string, sub: string}}|{ok: false, reason: string}>}
 *
 * Fail closed en todos los casos: configuración ausente, JWT ausente, algoritmo
 * inesperado, JWKS inalcanzable, firma inválida o claim que no cuadra.
 */
export async function verifyAccessJwt(request, env) {
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const aud = String(env.CF_ACCESS_AUD || '').trim();

  if (!TEAM_DOMAIN_RE.test(teamDomain)) return { ok: false, reason: 'team-domain-not-configured' };
  if (!AUD_RE.test(aud)) return { ok: false, reason: 'aud-not-configured' };

  const token = extractAccessToken(request);
  if (!token) return { ok: false, reason: 'missing-assertion' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed-jwt' };

  let header;
  try {
    header = decodeJsonSegment(parts[0]);
  } catch {
    return { ok: false, reason: 'malformed-header' };
  }

  // Solo RS256. "none" y los HMAC son la vía clásica de falsificar un JWT
  // cuando el verificador acepta el algoritmo que declara el propio token.
  if (header?.alg !== 'RS256') return { ok: false, reason: 'unexpected-alg' };
  if (typeof header?.kid !== 'string' || header.kid.length === 0) {
    return { ok: false, reason: 'missing-kid' };
  }

  let keys;
  try {
    keys = await loadJwks(teamDomain);
  } catch (err) {
    logEvent('access_jwks_failed', { error: String(err?.message || err) });
    return { ok: false, reason: 'jwks-unreachable' };
  }

  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown-kid' };

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return { ok: false, reason: 'signature-error' };
  }
  if (!verified) return { ok: false, reason: 'bad-signature' };

  let payload;
  try {
    payload = decodeJsonSegment(parts[1]);
  } catch {
    return { ok: false, reason: 'malformed-payload' };
  }

  if (payload?.iss !== `https://${teamDomain}`) return { ok: false, reason: 'bad-issuer' };

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return { ok: false, reason: 'bad-audience' };

  const nowS = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp + CLOCK_SKEW_S < nowS) {
    return { ok: false, reason: 'expired' };
  }
  if (Number.isFinite(payload.nbf) && payload.nbf - CLOCK_SKEW_S > nowS) {
    return { ok: false, reason: 'not-yet-valid' };
  }
  if (Number.isFinite(payload.iat) && payload.iat - CLOCK_SKEW_S > nowS) {
    return { ok: false, reason: 'issued-in-future' };
  }

  // Los tokens de servicio de Access no llevan email: llevan common_name.
  const email = String(payload.email || payload.common_name || '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'no-identity' };

  return { ok: true, identity: { email, sub: String(payload.sub || '') } };
}

/** Allowlist propia, opcional, además de la política de Access. */
export function parseAdminAllowlist(env) {
  return String(env.ADMIN_ALLOWED_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Autorización completa de un administrador: identidad de Access verificada y,
 * si existe allowlist, pertenencia a ella.
 */
export async function authorizeAdmin(request, env) {
  const result = await verifyAccessJwt(request, env);
  if (!result.ok) return result;

  const allowlist = parseAdminAllowlist(env);
  if (allowlist.length > 0 && !allowlist.includes(result.identity.email)) {
    return { ok: false, reason: 'not-in-allowlist' };
  }
  return result;
}
