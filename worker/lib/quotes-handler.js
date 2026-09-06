/**
 * COTIZADOR — endpoints públicos.
 *
 *   POST /api/quotes             crea una estimación
 *   GET  /api/quotes/:public_id  recupera una estimación ya creada
 *
 * Principios que gobiernan este fichero:
 *
 *  · **El backend recalcula todo.** Horas, complejidad, precio y estado se
 *    derivan aquí. Lo que el navegador envíe en esos campos ni siquiera se lee.
 *  · **Mismo orden de controles que /api/contact**: rate limit → cabeceras →
 *    tamaño → JSON → honeypot → validación → Turnstile → D1 → 201 → avisos.
 *    Turnstile va después de la validación para no gastar una verificación en
 *    un cuerpo que ya sabemos que es inválido.
 *  · **D1 es la fuente de verdad.** Si falla, 500 y no se notifica a nadie. Si
 *    fallan las notificaciones, la cotización ya está guardada y el usuario ya
 *    tiene su número.
 *  · **Sin endpoints administrativos.** No hay forma pública de listar, cambiar
 *    de estado ni borrar cotizaciones.
 */

import { errorResponse, json, logEvent } from './http.js';
import { readJsonPayload, truncate } from './request.js';
import { parseAllowedHostnames, verifyTurnstile } from './turnstile.js';
import { asTrimmedString } from './validate.js';
import { allowedCurrencies, buildQuote, publicQuoteView } from './quote/engine.js';
import { normalizeQuoteInput } from './quote/normalize.js';
import { PUBLIC_ID_RE, generatePublicId, nextQuoteNumber } from './quote/number.js';
import { createNotificationService } from '../integrations/notifications.js';
import { createCrmAdapter } from '../integrations/crm/index.js';

// El alcance es un objeto con hasta tres servicios; 32 KB es holgado para eso y
// sigue siendo un techo estricto.
const MAX_BODY_BYTES = 32 * 1024;
const MAX_UA_LENGTH = 256;

/**
 * Une la vista pública con los metadatos de la fila.
 *
 * Se devuelve también el alcance declarado: son los datos que el propio cliente
 * acaba de enviar, y la vista imprimible los necesita para el apartado
 * "Alcance declarado" del documento.
 */
function estimateResponse(view, row, declared) {
  return {
    status: 'success',
    quote: {
      ...view,
      scope: declared.scope,
      context: declared.context,
      quoteNumber: row.quote_number,
      publicId: row.public_id,
      company: row.company,
      contactName: row.contact_name,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    },
  };
}

/** POST /api/quotes */
export async function handleQuoteCreate(request, env, ctx) {
  const clientIp = request.headers.get('CF-Connecting-IP') || '';

  // 1. Rate limiting, antes de gastar nada.
  if (env.QUOTE_RATE_LIMITER) {
    const { success } = await env.QUOTE_RATE_LIMITER.limit({ key: clientIp || 'sin-ip' });
    if (!success) {
      logEvent('rate_limited', { path: '/api/quotes' });
      return errorResponse(429, 'Demasiadas solicitudes. Inténtalo en unos minutos.', {
        'Retry-After': '60',
      });
    }
  }

  // 2. Cabeceras, tamaño y sintaxis.
  const body = await readJsonPayload(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const payload = body.payload;

  // 3. Honeypot: misma respuesta que un envío correcto, para que un bot no
  //    pueda distinguirlas. No toca D1 ni gasta una verificación de Turnstile.
  if (asTrimmedString(payload?.website).length > 0) {
    logEvent('honeypot_triggered', { path: '/api/quotes' });
    return json(
      {
        status: 'success',
        quote: {
          quoteNumber: `VF-${new Date().getUTCFullYear()}-000000`,
          publicId: generatePublicId(),
          complexity: 'MEDIUM',
          effort: { minHours: 0, maxHours: 0, minDays: 0, maxDays: 0 },
          pricing: { available: false },
          services: [],
          includes: [],
        },
      },
      201,
    );
  }

  // 4. Validación estructural contra el catálogo público.
  const normalized = normalizeQuoteInput(payload, allowedCurrencies());
  if (!normalized.ok) {
    // El campo se registra para poder depurar, pero NUNCA se devuelve: revelaría
    // la forma interna del validador.
    logEvent('quote_validation_failed', { field: normalized.field });
    return errorResponse(400, 'Revisa los datos del formulario e inténtalo de nuevo');
  }

  // 5. Turnstile, con la misma verificación server-side que el contacto.
  const turnstile = await verifyTurnstile(
    payload?.turnstileToken ?? payload?.['cf-turnstile-response'],
    clientIp,
    env,
    parseAllowedHostnames(env),
  );

  if (!turnstile.ok) {
    logEvent('turnstile_rejected', { reason: turnstile.reason, path: '/api/quotes' });
    if (turnstile.reason === 'not-configured') {
      return errorResponse(503, 'El formulario no está disponible temporalmente');
    }
    return errorResponse(
      403,
      'No fue posible verificar la solicitud. Recarga la página e inténtalo de nuevo.',
    );
  }

  // 6. Cálculo. Íntegramente server-side.
  const quote = buildQuote(normalized.data, env);

  if (!env.DB) {
    logEvent('d1_not_configured', { path: '/api/quotes' });
    return errorResponse(500, 'No fue posible generar la estimación');
  }

  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + (quote.validityDays || 30) * 24 * 60 * 60 * 1000,
  ).toISOString();

  let quoteNumber;
  try {
    quoteNumber = await nextQuoteNumber(env.DB, now.getUTCFullYear());
  } catch (err) {
    logEvent('quote_number_failed', { error: String(err?.message || err) });
    return errorResponse(500, 'No fue posible generar la estimación');
  }

  const row = {
    id: crypto.randomUUID(),
    public_id: generatePublicId(),
    quote_number: quoteNumber,
    company: normalized.data.contact.company,
    contact_name: normalized.data.contact.name,
    email: normalized.data.contact.email,
    phone: normalized.data.contact.phone,
    notes: normalized.data.contact.notes,
    services_json: JSON.stringify(normalized.data.services),
    scope_json: JSON.stringify(normalized.data.scope),
    context_json: JSON.stringify(normalized.data.context),
    breakdown_json: JSON.stringify(quote.internal),
    complexity: quote.complexity,
    estimated_hours: quote.internal.totalHours,
    min_hours: quote.effort.minHours,
    max_hours: quote.effort.maxHours,
    currency: quote.pricing.available ? quote.pricing.currency : null,
    min_price: quote.pricing.available ? quote.pricing.min : null,
    max_price: quote.pricing.available ? quote.pricing.max : null,
    // El estado SIEMPRE nace en NEW. No existe forma de que el cliente lo fije.
    status: 'NEW',
    engine_version: quote.engineVersion,
    user_agent: truncate(request.headers.get('User-Agent') || '', MAX_UA_LENGTH),
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: expiresAt,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO quotes (
         id, public_id, quote_number, company, contact_name, email, phone, notes,
         services_json, scope_json, context_json, breakdown_json,
         complexity, estimated_hours, min_hours, max_hours,
         currency, min_price, max_price, status, engine_version, user_agent,
         created_at, updated_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id, row.public_id, row.quote_number, row.company, row.contact_name, row.email,
        row.phone, row.notes, row.services_json, row.scope_json, row.context_json,
        row.breakdown_json, row.complexity, row.estimated_hours, row.min_hours, row.max_hours,
        row.currency, row.min_price, row.max_price, row.status, row.engine_version,
        row.user_agent, row.created_at, row.updated_at, row.expires_at,
      )
      .run();
  } catch (err) {
    logEvent('quote_insert_failed', { error: String(err?.message || err) });
    return errorResponse(500, 'No fue posible generar la estimación');
  }

  logEvent('quote_saved', {
    quote_number: row.quote_number,
    services: normalized.data.services.join('+'),
    complexity: quote.complexity,
    hours: quote.internal.totalHours,
  });

  // 7. Avisos en segundo plano. Su fallo no puede afectar a lo ya guardado.
  const origin = new URL(request.url).origin;
  const notificationPayload = {
    quoteNumber: row.quote_number,
    publicId: row.public_id,
    company: row.company,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    services: normalized.data.services,
    complexity: quote.complexity,
    // Horas calculadas por el motor. El aviso interno las muestra tal cual; el
    // acuse al cliente solo muestra la banda y la duración.
    estimatedHours: quote.internal.totalHours,
    minHours: quote.effort.minHours,
    maxHours: quote.effort.maxHours,
    minDays: quote.effort.minDays,
    maxDays: quote.effort.maxDays,
    pricing: quote.pricing,
    createdAt: row.created_at,
  };

  const notifications = createNotificationService(env);
  const crm = createCrmAdapter(env);

  ctx.waitUntil(
    Promise.all([
      notifications.quoteCreated(notificationPayload, {
        estimate: `${origin}/estimacion?id=${row.public_id}`,
      }),
      crm.createLead({
        ...notificationPayload,
        currency: row.currency,
        minPrice: row.min_price,
        maxPrice: row.max_price,
      }),
    ]).catch(() => {}),
  );

  return json(estimateResponse(publicQuoteView(quote), row, normalized.data), 201);
}

/** GET /api/quotes/:public_id */
export async function handleQuoteRead(request, env, publicId) {
  if (env.QUOTE_READ_RATE_LIMITER) {
    const clientIp = request.headers.get('CF-Connecting-IP') || '';
    const { success } = await env.QUOTE_READ_RATE_LIMITER.limit({ key: clientIp || 'sin-ip' });
    if (!success) {
      logEvent('rate_limited', { path: '/api/quotes/:id' });
      return errorResponse(429, 'Demasiadas solicitudes. Inténtalo en unos minutos.', {
        'Retry-After': '60',
      });
    }
  }

  // Un identificador con formato incorrecto se responde igual que uno
  // inexistente: no se le confirma a nadie que "ese formato sí existe".
  if (typeof publicId !== 'string' || !PUBLIC_ID_RE.test(publicId)) {
    return errorResponse(404, 'Recurso no encontrado');
  }

  if (!env.DB) {
    logEvent('d1_not_configured', { path: '/api/quotes/:id' });
    return errorResponse(500, 'No fue posible recuperar la estimación');
  }

  let row;
  try {
    row = await env.DB.prepare(
      `SELECT public_id, quote_number, company, contact_name, services_json, scope_json,
              context_json, complexity, min_hours, max_hours, currency, min_price, max_price,
              engine_version, created_at, expires_at
         FROM quotes
        WHERE public_id = ?`,
    )
      .bind(publicId)
      .first();
  } catch (err) {
    logEvent('quote_read_failed', { error: String(err?.message || err) });
    return errorResponse(500, 'No fue posible recuperar la estimación');
  }

  if (!row) return errorResponse(404, 'Recurso no encontrado');

  const hoursPerDay = 8;
  const parse = (value, fallback) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };

  // Se devuelve lo necesario para mostrar e imprimir la estimación, y nada más:
  // ni email, ni teléfono, ni notas, ni el desglose interno del cálculo. Quien
  // tenga el enlace no debería obtener más datos de contacto de los que ya
  // tenía.
  return json({
    status: 'success',
    quote: {
      quoteNumber: row.quote_number,
      publicId: row.public_id,
      company: row.company,
      contactName: row.contact_name,
      services: parse(row.services_json, []),
      scope: parse(row.scope_json, {}),
      context: parse(row.context_json, {}),
      complexity: row.complexity,
      effort: {
        minHours: row.min_hours,
        maxHours: row.max_hours,
        minDays: Math.max(1, Math.ceil(row.min_hours / hoursPerDay)),
        maxDays: Math.max(1, Math.ceil(row.max_hours / hoursPerDay)),
      },
      pricing:
        row.currency && row.min_price !== null
          ? { available: true, currency: row.currency, min: row.min_price, max: row.max_price }
          : { available: false },
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      engineVersion: row.engine_version,
    },
  });
}
