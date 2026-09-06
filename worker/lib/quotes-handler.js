/**
 * COTIZADOR — endpoints públicos.
 *
 *   POST /api/quotes                              crea una estimación
 *   GET  /api/quotes/:public_id                   recupera una estimación ya creada
 *   GET  /api/quotes/:public_id/request-proposal  datos para pedir la propuesta formal
 *   POST /api/quotes/:public_id/request-proposal  registra la solicitud de propuesta
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
 *  · **Sin endpoints administrativos.** No hay forma pública de listar ni de
 *    borrar cotizaciones. El único cambio de estado que puede provocar un
 *    visitante es pedir la propuesta formal de SU cotización, hacia un único
 *    destino y desde un conjunto cerrado de orígenes.
 */

import { errorResponse, json, logEvent } from './http.js';
import { readJsonPayload, truncate } from './request.js';
import { parseAllowedHostnames, verifyTurnstile } from './turnstile.js';
import { asTrimmedString } from './validate.js';
import { QUOTE_CONFIG, allowedCurrencies, buildQuote, publicQuoteView } from './quote/engine.js';
import { normalizeQuoteInput } from './quote/normalize.js';
import { PUBLIC_ID_RE, generatePublicId, nextQuoteNumber } from './quote/number.js';
import { PROPOSAL_REQUESTED_STATUS, PUBLIC_PROPOSAL_ORIGINS } from './quote/lifecycle.js';
import { maskEmail, maskPhone, normalizeProposalInput } from './quote/proposal.js';
import { scopeSummary } from './quote/labels.js';
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

// ---------------------------------------------------------------------------
// SOLICITUD DE PROPUESTA FORMAL
//
//   GET  /api/quotes/:public_id/request-proposal   datos para prellenar el formulario
//   POST /api/quotes/:public_id/request-proposal   registra la solicitud
//
// Es la única ruta pública que cambia el estado de una cotización, y lo hace
// hacia un solo destino (PROPOSAL_REQUESTED) desde un conjunto cerrado de
// orígenes (lifecycle.PUBLIC_PROPOSAL_ORIGINS). No acepta horas, ni precio, ni
// complejidad, ni alcance: todo eso se lee de D1, que es donde lo dejó el motor.
//
// NO crea una cotización nueva. La solicitud es una fila en
// `quote_proposal_requests` con UNIQUE(quote_id): pulsar dos veces el botón, o
// reenviar la petición, no puede producir dos oportunidades ni dos avisos.

const MAX_PROPOSAL_BODY_BYTES = 8 * 1024;

/** Campos de `quotes` que necesita este flujo. Se listan para no arrastrar el desglose interno. */
const PROPOSAL_QUOTE_COLUMNS = `id, public_id, quote_number, company, contact_name, email, phone,
          services_json, scope_json, complexity, min_hours, max_hours,
          currency, min_price, max_price, status, created_at, expires_at`;

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Rango económico visible.
 *
 * Dos condiciones, y hacen falta las dos: que el motor lo calculara cuando se
 * creó la cotización (hay importes en la fila) y que el precio siga habilitado
 * ahora. Si alguien apaga PRICING_ENABLED, las cotizaciones antiguas dejan de
 * mostrar importes: no se sigue publicando un precio que la casa ya no sostiene.
 */
function visiblePricing(row, env) {
  const enabled = String(env.PRICING_ENABLED || '').toLowerCase() === 'true';
  if (!enabled || !row.currency || row.min_price === null || row.min_price === undefined) {
    return { available: false };
  }
  return { available: true, currency: row.currency, min: row.min_price, max: row.max_price };
}

/** Banda de esfuerzo tal y como se le muestra al cliente. Nunca `estimated_hours`. */
function effortView(row) {
  const perDay = QUOTE_CONFIG.hoursPerDay || 8;
  return {
    minHours: row.min_hours,
    maxHours: row.max_hours,
    minDays: Math.max(1, Math.ceil(row.min_hours / perDay)),
    maxDays: Math.max(1, Math.ceil(row.max_hours / perDay)),
  };
}

/**
 * Vista de la cotización dentro del formulario de propuesta.
 *
 * Los datos de contacto van enmascarados: el cliente los reconoce y no tiene que
 * volver a teclearlos, y quien reciba el enlace reenviado no obtiene una ficha
 * de contacto. Ver el comentario de worker/lib/quote/proposal.js.
 */
function proposalQuoteView(row, env) {
  const services = parseJson(row.services_json, []);
  return {
    quoteNumber: row.quote_number,
    publicId: row.public_id,
    company: row.company,
    contactName: row.contact_name,
    email: maskEmail(row.email),
    phone: maskPhone(row.phone),
    services,
    scopeSummary: scopeSummary(services, parseJson(row.scope_json, {})),
    complexity: row.complexity,
    effort: effortView(row),
    pricing: visiblePricing(row, env),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Lee la cotización y, si existe, su solicitud de propuesta. */
async function loadProposalContext(env, publicId) {
  const row = await env.DB.prepare(
    `SELECT ${PROPOSAL_QUOTE_COLUMNS} FROM quotes WHERE public_id = ?`,
  )
    .bind(publicId)
    .first();

  if (!row) return { row: null, request: null };

  const request = await env.DB.prepare(
    'SELECT created_at FROM quote_proposal_requests WHERE quote_id = ?',
  )
    .bind(row.id)
    .first();

  return { row, request: request || null };
}

/** GET /api/quotes/:public_id/request-proposal */
export async function handleProposalPrefill(request, env, publicId) {
  if (env.QUOTE_READ_RATE_LIMITER) {
    const clientIp = request.headers.get('CF-Connecting-IP') || '';
    const { success } = await env.QUOTE_READ_RATE_LIMITER.limit({ key: clientIp || 'sin-ip' });
    if (!success) {
      logEvent('rate_limited', { path: '/api/quotes/:id/request-proposal' });
      return errorResponse(429, 'Demasiadas solicitudes. Inténtalo en unos minutos.', {
        'Retry-After': '60',
      });
    }
  }

  // Formato incorrecto e inexistente se responden igual, como en el resto de la
  // superficie pública.
  if (typeof publicId !== 'string' || !PUBLIC_ID_RE.test(publicId)) {
    return errorResponse(404, 'Recurso no encontrado');
  }

  if (!env.DB) {
    logEvent('d1_not_configured', { path: '/api/quotes/:id/request-proposal' });
    return errorResponse(500, 'No fue posible recuperar la estimación');
  }

  let context;
  try {
    context = await loadProposalContext(env, publicId);
  } catch (err) {
    logEvent('proposal_prefill_failed', { error: String(err?.message || err) });
    return errorResponse(500, 'No fue posible recuperar la estimación');
  }

  if (!context.row) return errorResponse(404, 'Recurso no encontrado');

  return json({
    status: 'success',
    proposal: {
      requested: Boolean(context.request),
      requestedAt: context.request?.created_at || null,
      // Si la oportunidad ya la lleva una persona, el formulario se muestra en
      // modo informativo en lugar de ofrecer un botón que iba a devolver 409.
      available:
        !context.request && PUBLIC_PROPOSAL_ORIGINS.includes(context.row.status),
    },
    quote: proposalQuoteView(context.row, env),
  });
}

/** Cuerpo de una solicitud ya registrada. Idéntico se haya creado ahora o antes. */
function proposalAccepted(row, requestedAt, alreadyRequested) {
  return {
    status: 'success',
    proposal: {
      quoteNumber: row.quote_number,
      publicId: row.public_id,
      requestedAt,
      alreadyRequested,
    },
  };
}

/** POST /api/quotes/:public_id/request-proposal */
export async function handleProposalRequest(request, env, publicId, ctx) {
  const clientIp = request.headers.get('CF-Connecting-IP') || '';

  // 1. Rate limiting. Se comparte con la creación de cotizaciones: las dos son
  //    escrituras públicas y una persona legítima usa cada una una vez.
  if (env.QUOTE_RATE_LIMITER) {
    const { success } = await env.QUOTE_RATE_LIMITER.limit({ key: clientIp || 'sin-ip' });
    if (!success) {
      logEvent('rate_limited', { path: '/api/quotes/:id/request-proposal' });
      return errorResponse(429, 'Demasiadas solicitudes. Inténtalo en unos minutos.', {
        'Retry-After': '60',
      });
    }
  }

  // 2. Identificador. Antes de leer el cuerpo y antes de gastar una verificación.
  if (typeof publicId !== 'string' || !PUBLIC_ID_RE.test(publicId)) {
    return errorResponse(404, 'Recurso no encontrado');
  }

  // 3. Cabeceras, tamaño y sintaxis.
  const body = await readJsonPayload(request, MAX_PROPOSAL_BODY_BYTES);
  if (!body.ok) return body.response;
  const payload = body.payload;

  // 4. Honeypot: respuesta indistinguible de un envío correcto y sin tocar D1.
  if (asTrimmedString(payload?.website).length > 0) {
    logEvent('honeypot_triggered', { path: '/api/quotes/:id/request-proposal' });
    return json(
      proposalAccepted(
        { quote_number: `VF-${new Date().getUTCFullYear()}-000000`, public_id: publicId },
        new Date().toISOString(),
        false,
      ),
      200,
    );
  }

  // 5. Solo los tres campos que el cliente puede aportar. El resto del cuerpo no
  //    se lee: horas, precio, complejidad y alcance vienen de D1.
  const normalized = normalizeProposalInput(payload);
  if (!normalized.ok) {
    logEvent('proposal_validation_failed', { field: normalized.field });
    return errorResponse(400, 'Revisa los datos del formulario e inténtalo de nuevo');
  }

  // 6. Turnstile, fail closed, igual que en el resto de la superficie pública.
  const turnstile = await verifyTurnstile(
    payload?.turnstileToken ?? payload?.['cf-turnstile-response'],
    clientIp,
    env,
    parseAllowedHostnames(env),
  );

  if (!turnstile.ok) {
    logEvent('turnstile_rejected', {
      reason: turnstile.reason,
      path: '/api/quotes/:id/request-proposal',
    });
    if (turnstile.reason === 'not-configured') {
      return errorResponse(503, 'El formulario no está disponible temporalmente');
    }
    return errorResponse(
      403,
      'No fue posible verificar la solicitud. Recarga la página e inténtalo de nuevo.',
    );
  }

  if (!env.DB) {
    logEvent('d1_not_configured', { path: '/api/quotes/:id/request-proposal' });
    return errorResponse(500, 'No fue posible registrar la solicitud');
  }

  // 7. La cotización y su estado, desde D1. Nada de lo que envió el navegador
  //    interviene a partir de aquí salvo los tres campos ya validados.
  let context;
  try {
    context = await loadProposalContext(env, publicId);
  } catch (err) {
    logEvent('proposal_lookup_failed', { error: String(err?.message || err) });
    return errorResponse(500, 'No fue posible registrar la solicitud');
  }

  if (!context.row) return errorResponse(404, 'Recurso no encontrado');
  const row = context.row;

  // 8. Idempotencia. Se comprueba ANTES del estado: si comercial ya movió la
  //    oportunidad después de la solicitud, el cliente que vuelve a pulsar debe
  //    ver "ya la hemos recibido", no un error.
  if (context.request) {
    logEvent('proposal_request_duplicate', { quote_number: row.quote_number });
    return json(proposalAccepted(row, context.request.created_at, true), 200);
  }

  // 9. Estados desde los que un visitante puede pedir la propuesta.
  if (!PUBLIC_PROPOSAL_ORIGINS.includes(row.status)) {
    logEvent('proposal_request_rejected', {
      quote_number: row.quote_number,
      status: row.status,
    });
    return json(
      {
        status: 'error',
        message:
          'Esta cotización ya está en curso con nuestro equipo. Escríbenos y la retomamos.',
      },
      409,
    );
  }

  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();

  // 10. Escritura atómica: la solicitud, el cambio de estado y su auditoría.
  //
  //  · El INSERT en `quote_proposal_requests` es el que garantiza que no haya
  //    duplicados: UNIQUE(quote_id) hace fallar el lote entero si dos peticiones
  //    llegan a la vez, y la segunda se responde como idempotente.
  //  · El UPDATE y el evento van condicionados al estado que se acaba de leer.
  //    Si alguien lo movió desde el panel en ese instante, no se pisa su cambio.
  let changed = false;
  try {
    const [, , updated] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO quote_proposal_requests
           (id, quote_id, quote_number, notes, target_date, scope_notes, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        requestId,
        row.id,
        row.quote_number,
        normalized.data.notes,
        normalized.data.targetDate,
        normalized.data.scopeNotes,
        'public_estimate',
        now,
      ),
      env.DB.prepare(
        `INSERT INTO quote_status_events
           (id, quote_id, quote_number, from_status, to_status, actor_email, actor_source,
            note, created_at)
         SELECT ?, id, quote_number, status, ?, email, 'client', ?, ?
           FROM quotes
          WHERE id = ? AND status = ?`,
      ).bind(
        crypto.randomUUID(),
        PROPOSAL_REQUESTED_STATUS,
        'Solicitud de propuesta formal desde la estimación',
        now,
        row.id,
        row.status,
      ),
      env.DB.prepare(
        'UPDATE quotes SET status = ?, updated_at = ? WHERE id = ? AND status = ?',
      ).bind(PROPOSAL_REQUESTED_STATUS, now, row.id, row.status),
    ]);
    changed = Boolean(updated?.meta?.changes);
  } catch (err) {
    // El único fallo esperado aquí es la violación de UNIQUE(quote_id): otra
    // petición idéntica ganó la carrera. El lote se deshizo entero, así que no
    // hay estado a medias; se responde como idempotente y NO se vuelve a avisar.
    const existing = await env.DB.prepare(
      'SELECT created_at FROM quote_proposal_requests WHERE quote_id = ?',
    )
      .bind(row.id)
      .first()
      .catch(() => null);

    if (existing) {
      logEvent('proposal_request_duplicate', { quote_number: row.quote_number, race: true });
      return json(proposalAccepted(row, existing.created_at, true), 200);
    }

    logEvent('proposal_request_failed', { error: String(err?.message || err) });
    return errorResponse(500, 'No fue posible registrar la solicitud');
  }

  logEvent('proposal_requested', {
    quote_number: row.quote_number,
    from: row.status,
    to: PROPOSAL_REQUESTED_STATUS,
    // `changed` en false significa que el estado cambió desde el panel entre la
    // lectura y la escritura. La solicitud queda registrada igual —el interés
    // del cliente es real— y no se pisa lo que hizo la persona.
    status_changed: changed,
  });

  // 11. Avisos en segundo plano. La solicitud ya está en D1; su fallo no la
  //     revierte, exactamente igual que en la creación de la cotización.
  const origin = new URL(request.url).origin;
  const services = parseJson(row.services_json, []);
  const notificationPayload = {
    quoteNumber: row.quote_number,
    publicId: row.public_id,
    company: row.company,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    services,
    scopeSummary: scopeSummary(services, parseJson(row.scope_json, {})),
    complexity: row.complexity,
    ...effortView(row),
    pricing: visiblePricing(row, env),
    notes: normalized.data.notes,
    targetDate: normalized.data.targetDate,
    scopeNotes: normalized.data.scopeNotes,
    requestedAt: now,
  };

  const notifications = createNotificationService(env);
  const crm = createCrmAdapter(env);

  ctx?.waitUntil(
    Promise.all([
      notifications.proposalRequested(notificationPayload, {
        estimate: `${origin}/estimacion?id=${row.public_id}`,
      }),
      crm.updateLead({
        quoteNumber: row.quote_number,
        status: PROPOSAL_REQUESTED_STATUS,
      }),
    ]).catch(() => {}),
  );

  return json(proposalAccepted(row, now, false), 200);
}
