/**
 * API DE ADMINISTRACIÓN — mini CRM interno de VulnFocus.
 *
 *   GET   /api/admin/session                      identidad verificada
 *   GET   /api/admin/stats                        recuento por estado
 *   GET   /api/admin/quotes                       listado con filtro y búsqueda
 *   GET   /api/admin/quotes/:public_id            ficha + histórico
 *   PATCH /api/admin/quotes/:public_id/status     transición de estado
 *
 * Tres candados, en este orden, y ninguno es opcional:
 *
 *  1. `ADMIN_ENABLED` distinto de "true" → **404**, no 403. Con el interruptor
 *     apagado la administración no existe: no se puede ni averiguar que está ahí.
 *  2. Aserción de identidad de Cloudflare Access verificada criptográficamente
 *     (worker/lib/access.js). Sin ella también **404**, por lo mismo.
 *  3. Rate limit propio, aunque la petición venga de una sesión legítima.
 *
 * Solo se escribe la columna `status` (y `updated_at`), y solo a través de la
 * máquina de estados de quote/lifecycle.js. No existe ninguna ruta que borre una
 * cotización, ni que edite importes, horas, alcance o datos de contacto: el
 * cálculo lo hace el motor y los datos los envió el cliente. Cambiarlos a mano
 * dejaría una cotización que no se corresponde con nada.
 */

import { errorResponse, json, logEvent } from '../http.js';
import { readJsonPayload } from '../request.js';
import { authorizeAdmin } from '../access.js';
import { PUBLIC_ID_RE } from '../quote/number.js';
import { QUOTE_STATUSES, allowedTransitions, validateTransition } from '../quote/lifecycle.js';
import { createCrmAdapter } from '../../integrations/crm/index.js';

const MAX_BODY_BYTES = 4 * 1024;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 100;
const MAX_NOTE_LENGTH = 500;

/** ¿Está la administración habilitada por configuración? */
export function adminEnabled(env) {
  return String(env.ADMIN_ENABLED || '').toLowerCase() === 'true';
}

/** 404 idéntico al de cualquier ruta inexistente. Es intencional. */
function notFound() {
  return errorResponse(404, 'Recurso no encontrado');
}

function parse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Escapa los comodines de LIKE. Sin esto, buscar "100%" o "a_b" haría de
 * comodín y devolvería filas que no coinciden con lo que se pidió.
 */
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Cursor de paginación por clave: (created_at, id) descendente. */
function encodeCursor(row) {
  return btoa(`${row.created_at}|${row.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return null;
  let decoded;
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    decoded = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  } catch {
    return null;
  }
  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) return null;
  const createdAt = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  // Formas esperadas: ISO 8601 y UUID. Cualquier otra cosa se descarta en lugar
  // de llegar a la consulta.
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(createdAt)) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return { createdAt, id };
}

/** Fila del listado. Lo justo para decidir a quién llamar. */
function listItem(row) {
  return {
    publicId: row.public_id,
    quoteNumber: row.quote_number,
    company: row.company,
    contactName: row.contact_name,
    email: row.email,
    services: parse(row.services_json, []),
    complexity: row.complexity,
    estimatedHours: row.estimated_hours,
    minHours: row.min_hours,
    maxHours: row.max_hours,
    currency: row.currency,
    minPrice: row.min_price,
    maxPrice: row.max_price,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

/** GET /api/admin/session */
async function handleSession(identity, env) {
  return json({
    status: 'success',
    session: {
      email: identity.email,
      statuses: QUOTE_STATUSES,
      pricingEnabled: String(env.PRICING_ENABLED || '').toLowerCase() === 'true',
    },
  });
}

/** GET /api/admin/stats */
async function handleStats(env) {
  const { results } = await env.DB.prepare(
    'SELECT status, COUNT(*) AS total FROM quotes GROUP BY status',
  ).all();

  const byStatus = Object.fromEntries(QUOTE_STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const row of results || []) {
    if (Object.prototype.hasOwnProperty.call(byStatus, row.status)) byStatus[row.status] = row.total;
    total += row.total;
  }
  return json({ status: 'success', stats: { total, byStatus } });
}

/** GET /api/admin/quotes */
async function handleList(request, env, url) {
  const filters = [];
  const binds = [];

  const status = url.searchParams.get('status');
  if (status) {
    // Allowlist estricta: el valor no se interpola nunca, pero un estado
    // inexistente es un error del cliente y se dice.
    if (!QUOTE_STATUSES.includes(status)) {
      return errorResponse(400, 'Estado no válido');
    }
    filters.push('status = ?');
    binds.push(status);
  }

  const rawQuery = (url.searchParams.get('q') || '').trim();
  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return errorResponse(400, 'Búsqueda demasiado larga');
  }
  if (rawQuery.length > 0) {
    const needle = `%${escapeLike(rawQuery.toLowerCase())}%`;
    filters.push(
      "(LOWER(company) LIKE ? ESCAPE '\\' OR LOWER(contact_name) LIKE ? ESCAPE '\\'" +
        " OR LOWER(email) LIKE ? ESCAPE '\\' OR LOWER(quote_number) LIKE ? ESCAPE '\\')",
    );
    binds.push(needle, needle, needle, needle);
  }

  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) return errorResponse(400, 'Cursor no válido');
    filters.push('(created_at < ? OR (created_at = ? AND id < ?))');
    binds.push(decoded.createdAt, decoded.createdAt, decoded.id);
  }

  const requested = Number(url.searchParams.get('limit') || DEFAULT_LIMIT);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const { results } = await env.DB.prepare(
    `SELECT id, public_id, quote_number, company, contact_name, email, services_json,
            complexity, estimated_hours, min_hours, max_hours, currency, min_price, max_price,
            status, created_at, updated_at, expires_at
       FROM quotes
       ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all();

  const rows = results || [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return json({
    status: 'success',
    quotes: page.map(listItem),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  });
}

/** GET /api/admin/quotes/:public_id */
async function handleDetail(env, publicId) {
  const row = await env.DB.prepare(
    `SELECT id, public_id, quote_number, company, contact_name, email, phone, notes,
            services_json, scope_json, context_json, breakdown_json,
            complexity, estimated_hours, min_hours, max_hours,
            currency, min_price, max_price, status, engine_version,
            created_at, updated_at, expires_at
       FROM quotes
      WHERE public_id = ?`,
  )
    .bind(publicId)
    .first();

  if (!row) return notFound();

  const { results } = await env.DB.prepare(
    `SELECT from_status, to_status, actor_email, note, created_at
       FROM quote_status_events
      WHERE quote_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
  )
    .bind(row.id)
    .all();

  return json({
    status: 'success',
    quote: {
      ...listItem(row),
      phone: row.phone,
      notes: row.notes,
      scope: parse(row.scope_json, {}),
      context: parse(row.context_json, {}),
      // El desglose interno del cálculo sí es visible aquí: es la razón de ser
      // de la ficha (poder explicar por qué salieron esas horas).
      breakdown: parse(row.breakdown_json, null),
      engineVersion: row.engine_version,
      allowedTransitions: allowedTransitions(row.status),
      history: (results || []).map((event) => ({
        from: event.from_status,
        to: event.to_status,
        actor: event.actor_email,
        note: event.note,
        at: event.created_at,
      })),
    },
  });
}

/** PATCH /api/admin/quotes/:public_id/status */
async function handleStatusChange(request, env, publicId, identity, ctx) {
  const body = await readJsonPayload(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const payload = body.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return errorResponse(400, 'Solicitud no válida');
  }

  const target = typeof payload.status === 'string' ? payload.status : '';
  const note = typeof payload.note === 'string' ? payload.note.trim().slice(0, MAX_NOTE_LENGTH) : '';

  const current = await env.DB.prepare('SELECT id, quote_number, status FROM quotes WHERE public_id = ?')
    .bind(publicId)
    .first();
  if (!current) return notFound();

  const check = validateTransition(current.status, target);
  if (!check.ok) {
    logEvent('admin_transition_rejected', {
      quote_number: current.quote_number,
      from: current.status,
      to: target,
      reason: check.reason,
    });
    return json(
      {
        status: 'error',
        message: 'Transición de estado no permitida',
        reason: check.reason,
        from: current.status,
        allowed: allowedTransitions(current.status),
      },
      409,
    );
  }

  const now = new Date().toISOString();

  // UPDATE condicionado al estado que se acaba de leer: si otra sesión mueve la
  // misma cotización entre la lectura y la escritura, este UPDATE no afecta a
  // ninguna fila y se responde 409 en lugar de pisar el cambio ajeno.
  // El batch mantiene juntos el cambio y su registro de auditoría.
  const [updated] = await env.DB.batch([
    env.DB.prepare('UPDATE quotes SET status = ?, updated_at = ? WHERE id = ? AND status = ?').bind(
      target,
      now,
      current.id,
      current.status,
    ),
    env.DB.prepare(
      `INSERT INTO quote_status_events
         (id, quote_id, quote_number, from_status, to_status, actor_email, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      current.id,
      current.quote_number,
      current.status,
      target,
      identity.email,
      note || null,
      now,
    ),
  ]);

  if (!updated?.meta?.changes) {
    logEvent('admin_transition_conflict', {
      quote_number: current.quote_number,
      from: current.status,
      to: target,
    });
    return json({ status: 'error', message: 'La cotización cambió mientras se editaba' }, 409);
  }

  logEvent('admin_transition', {
    quote_number: current.quote_number,
    from: current.status,
    to: target,
    // La identidad se registra porque es el sentido de la auditoría. Es personal
    // interno, nunca un dato del cliente.
    actor: identity.email,
  });

  // Sincronización con el CRM externo, si algún día hay uno. Va en segundo plano
  // y su fallo NO revierte el cambio: D1 ya es la fuente de verdad y el histórico
  // ya está escrito. Con CRM_PROVIDER="null" esto solo deja una línea de log.
  //
  // SysReptor NO se invoca aquí a propósito, ni siquiera en ACCEPTED: crear un
  // proyecto es una acción deliberada y manual (docs/INTEGRATIONS.md §SysReptor).
  const crm = createCrmAdapter(env);
  const sync = async () => {
    if (target === 'ACCEPTED') return crm.markWon({ quoteNumber: current.quote_number });
    if (target === 'REJECTED') {
      return crm.markLost({ quoteNumber: current.quote_number, reason: note || null });
    }
    return crm.updateLead({ quoteNumber: current.quote_number, status: target });
  };
  const pending = sync().catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(pending);

  return json({
    status: 'success',
    quote: {
      publicId,
      quoteNumber: current.quote_number,
      status: target,
      updatedAt: now,
      allowedTransitions: allowedTransitions(target),
    },
  });
}

/** Respuesta 405 uniforme. */
function methodNotAllowed(allow) {
  return errorResponse(405, 'Método no permitido', { Allow: allow });
}

/**
 * Router de /api/admin/*.
 *
 * @param {Request} request
 * @param {object} env
 * @param {string} path  Ruta ya normalizada (sin barra final).
 * @param {object} [ctx]  ExecutionContext, para los avisos en segundo plano.
 */
export async function handleAdmin(request, env, path, ctx) {
  // Candado 1: el interruptor. Ni se mira la petición.
  if (!adminEnabled(env)) return notFound();

  // Candado 2: identidad verificada de Cloudflare Access.
  const auth = await authorizeAdmin(request, env);
  if (!auth.ok) {
    logEvent('admin_unauthorized', { reason: auth.reason, path });
    return notFound();
  }

  // Candado 3: rate limit por identidad, no por IP: una sesión legítima no debe
  // poder paginar la tabla entera a toda velocidad.
  if (env.ADMIN_RATE_LIMITER) {
    const { success } = await env.ADMIN_RATE_LIMITER.limit({ key: auth.identity.email });
    if (!success) {
      logEvent('rate_limited', { path: '/api/admin/*' });
      return errorResponse(429, 'Demasiadas solicitudes. Inténtalo en unos minutos.', {
        'Retry-After': '60',
      });
    }
  }

  if (!env.DB) {
    logEvent('d1_not_configured', { path });
    return errorResponse(500, 'No fue posible completar la operación');
  }

  const url = new URL(request.url);
  const isRead = request.method === 'GET' || request.method === 'HEAD';

  try {
    if (path === '/api/admin/session') {
      if (!isRead) return methodNotAllowed('GET');
      return handleSession(auth.identity, env);
    }

    if (path === '/api/admin/stats') {
      if (!isRead) return methodNotAllowed('GET');
      return handleStats(env);
    }

    if (path === '/api/admin/quotes') {
      if (!isRead) return methodNotAllowed('GET');
      return handleList(request, env, url);
    }

    if (path.startsWith('/api/admin/quotes/')) {
      const rest = path.slice('/api/admin/quotes/'.length);
      const [publicId, action, ...extra] = rest.split('/');

      // Un identificador con formato incorrecto se trata como inexistente, igual
      // que en la ruta pública: no se confirma qué formatos existen.
      if (extra.length > 0 || !PUBLIC_ID_RE.test(publicId || '')) return notFound();

      if (action === undefined) {
        if (!isRead) return methodNotAllowed('GET');
        return handleDetail(env, publicId);
      }

      if (action === 'status') {
        if (request.method !== 'PATCH') return methodNotAllowed('PATCH');
        return handleStatusChange(request, env, publicId, auth.identity, ctx);
      }

      return notFound();
    }

    return notFound();
  } catch (err) {
    // Igual que en el resto del Worker: al cliente, mensaje genérico; al log, lo
    // necesario para depurar y nada más.
    logEvent('admin_error', { path, error: String(err?.message || err) });
    return errorResponse(500, 'No fue posible completar la operación');
  }
}

export default handleAdmin;
