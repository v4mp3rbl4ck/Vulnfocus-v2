import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.js";
import {
  countProposalRequests,
  countQuotes,
  mockOutboundFetch,
  okSiteverify,
  proposalRequest,
  quoteRequest,
  quoteRow,
  resetProposalRequests,
  resetQuotes,
  resetStatusEvents,
  statusEvents,
  validProposalPayload,
  validQuotePayload,
} from "./helpers.js";
import {
  TARGET_DATE_MAX_DAYS,
  targetDateBounds,
} from "../frontend/src/config/proposal-request.js";

/**
 * SOLICITUD DE PROPUESTA FORMAL — POST /api/quotes/:public_id/request-proposal
 *
 * Es la única ruta pública que cambia el estado comercial de una cotización, así
 * que lo que se prueba aquí no es solo que funcione, sino sobre todo qué NO
 * puede hacer:
 *
 *  · No crea cotizaciones. Ni una nueva, ni un duplicado de la existente.
 *  · No acepta horas, precio, complejidad ni alcance desde el navegador. Todo
 *    eso se lee de D1, y una petición que los traiga los deja exactamente igual.
 *  · No permite alcanzar estados que no sean PROPOSAL_REQUESTED, ni partiendo de
 *    estados que la lleve ya una persona.
 *  · No responde distinto a "no existe" y "el identificador es inválido".
 */

async function call(request, overrides) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    request,
    overrides ? { ...env, ...overrides } : env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

/** Crea una cotización real por la API pública y devuelve su vista. */
async function crearCotizacion(over) {
  mockOutboundFetch({ siteverify: okSiteverify() });
  const res = await call(quoteRequest(validQuotePayload(over)));
  expect(res.status).toBe(201);
  return (await res.json()).quote;
}

/** `AAAA-MM-DD` a N días de hoy, con el mismo criterio UTC que usa la regla. */
function enDias(dias) {
  const hoy = new Date();
  const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return new Date(base + dias * 86400000).toISOString().slice(0, 10);
}

const ayer = () => enDias(-1);

/** Fija tarifas en una cotización ya creada, como si el propietario las hubiera configurado. */
async function conPrecio(publicId, { currency = "CLP", min = 1200000, max = 1800000 } = {}) {
  await env.DB.prepare(
    "UPDATE quotes SET currency = ?, min_price = ?, max_price = ? WHERE public_id = ?",
  )
    .bind(currency, min, max, publicId)
    .run();
}

beforeEach(async () => {
  await resetProposalRequests();
  await resetStatusEvents();
  await resetQuotes();
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
describe("Superficie del endpoint", () => {
  it.each(["PUT", "DELETE", "PATCH"])("%s -> 405 con Allow: GET, POST", async (method) => {
    const res = await call(proposalRequest("a".repeat(32), undefined, { method }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, POST");
  });

  it("ninguna otra subruta de una cotización existe", async () => {
    const creada = await crearCotizacion();
    for (const accion of ["status", "breakdown", "delete", "request-proposal/extra"]) {
      const res = await call(
        new Request(`https://vulnfocus.com/api/quotes/${creada.publicId}/${accion}`, {
          headers: { "CF-Connecting-IP": "198.51.100.90" },
        }),
      );
      expect(res.status, accion).toBe(404);
    }
  });

  it("Content-Type incorrecto -> 415", async () => {
    const creada = await crearCotizacion();
    const res = await call(
      proposalRequest(creada.publicId, validProposalPayload(), {
        headers: { "Content-Type": "text/plain" },
      }),
    );
    expect(res.status).toBe(415);
  });

  it("un cuerpo desmesurado -> 413 y no se toca la base", async () => {
    const creada = await crearCotizacion();
    const res = await call(
      proposalRequest(creada.publicId, validProposalPayload({ notes: "a".repeat(20000) })),
    );
    expect(res.status).toBe(413);
    expect(await countProposalRequests()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("Identificador", () => {
  it.each([
    "no-es-un-id",
    "1",
    "f".repeat(31),
    "0000000000000000000000000000000g",
    "VF-2026-000001",
  ])("un public_id inválido devuelve el mismo 404 (%s)", async (id) => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(proposalRequest(encodeURIComponent(id), validProposalPayload()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ status: "error", message: "Recurso no encontrado" });
  });

  it("una cotización inexistente devuelve 404, con el mismo cuerpo", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(proposalRequest("f".repeat(32), validProposalPayload()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ status: "error", message: "Recurso no encontrado" });
    expect(await countProposalRequests()).toBe(0);
  });

  it("el número comercial no sirve para pedir la propuesta", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(proposalRequest(creada.quoteNumber, validProposalPayload()));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("Camino feliz", () => {
  it("registra la solicitud, cambia el estado y deja el evento de auditoría", async () => {
    const creada = await crearCotizacion();
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(
      proposalRequest(
        creada.publicId,
        validProposalPayload({ targetDate: "2026-11-02" }),
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal).toMatchObject({
      quoteNumber: creada.quoteNumber,
      publicId: creada.publicId,
      alreadyRequested: false,
    });
    expect(body.proposal.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // La solicitud, con los tres campos adicionales y ninguno más.
    const fila = await env.DB.prepare(
      "SELECT * FROM quote_proposal_requests WHERE quote_number = ?",
    )
      .bind(creada.quoteNumber)
      .first();
    expect(fila.notes).toBe("Preferimos empezar después del cierre contable.");
    expect(fila.target_date).toBe("2026-11-02");
    expect(fila.scope_notes).toContain("staging");
    expect(fila.source).toBe("public_estimate");

    // El estado de la cotización existente.
    const quote = await quoteRow(creada.publicId);
    expect(quote.status).toBe("PROPOSAL_REQUESTED");
    expect(quote.updated_at).not.toBe(quote.created_at);

    // Y su rastro en el histórico, con el origen distinguible del administrativo.
    const eventos = await statusEvents(quote.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      quote_number: creada.quoteNumber,
      from_status: "NEW",
      to_status: "PROPOSAL_REQUESTED",
      actor_email: "ana@ejemplo.com",
      actor_source: "client",
    });
    expect(eventos[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // El aviso interno sale con el formato acordado. `calls` se instaló después
    // de crear la cotización, así que el único mensaje que recoge es este.
    expect(calls.telegram).toHaveLength(1);
    const texto = calls.telegram[0].body.text;
    expect(texto).toContain("Nueva solicitud de propuesta formal");
    expect(texto).toContain(`Cotizacion: ${creada.quoteNumber}`);
    expect(texto).toContain("Cliente: Ana López");
    expect(texto).toContain("Empresa: ACME S.A.");
    expect(texto).toContain("Servicio(s): Pentesting Web");
    expect(texto).toMatch(/Alcance resumido: Pentesting Web \(1 aplicaciones web, 2 roles/);
    expect(texto).toMatch(/Horas estimadas: \d+-\d+ h/);
    expect(texto).toContain("Fecha objetivo: 2026-11-02");
  });

  it("NO crea una cotización nueva: sigue habiendo exactamente una", async () => {
    const creada = await crearCotizacion();
    expect(await countQuotes()).toBe(1);

    mockOutboundFetch({ siteverify: okSiteverify() });
    await call(proposalRequest(creada.publicId, validProposalPayload()));

    expect(await countQuotes()).toBe(1);
    expect(await countProposalRequests()).toBe(1);
    const quote = await quoteRow(creada.publicId);
    expect(quote.quote_number).toBe(creada.quoteNumber);
  });

  it("los tres campos adicionales son opcionales", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(
      proposalRequest(creada.publicId, { turnstileToken: "0.token-de-prueba" }),
    );
    expect(res.status).toBe(200);

    const fila = await env.DB.prepare(
      "SELECT notes, target_date, scope_notes FROM quote_proposal_requests",
    ).first();
    expect(fila).toEqual({ notes: null, target_date: null, scope_notes: null });
  });
});

// ---------------------------------------------------------------------------
describe("Solicitudes duplicadas", () => {
  async function pedir(publicId) {
    mockOutboundFetch({ siteverify: okSiteverify() });
    return call(proposalRequest(publicId, validProposalPayload()));
  }

  it("la segunda solicitud es idempotente: no duplica nada ni vuelve a avisar", async () => {
    const creada = await crearCotizacion();

    const primera = await pedir(creada.publicId);
    expect(primera.status).toBe(200);
    const primeraBody = await primera.json();

    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    const segunda = await call(proposalRequest(creada.publicId, validProposalPayload()));

    expect(segunda.status).toBe(200);
    const segundaBody = await segunda.json();
    expect(segundaBody.proposal.alreadyRequested).toBe(true);
    // Misma marca de tiempo: es la solicitud original, no una nueva.
    expect(segundaBody.proposal.requestedAt).toBe(primeraBody.proposal.requestedAt);

    expect(await countProposalRequests()).toBe(1);
    expect(await countQuotes()).toBe(1);
    // Ni segundo aviso ni segundo evento de auditoría.
    expect(calls.telegram).toHaveLength(0);
    const quote = await quoteRow(creada.publicId);
    expect(await statusEvents(quote.id)).toHaveLength(1);
  });

  it("cinco intentos seguidos dejan una sola solicitud", async () => {
    const creada = await crearCotizacion();
    for (let i = 0; i < 5; i += 1) {
      const res = await pedir(creada.publicId);
      // El limitador puede cortar alguno; ninguno puede duplicar.
      expect([200, 429]).toContain(res.status);
    }
    expect(await countProposalRequests()).toBe(1);
    expect(await countQuotes()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Estado de origen", () => {
  async function fijarEstado(publicId, status) {
    await env.DB.prepare("UPDATE quotes SET status = ? WHERE public_id = ?")
      .bind(status, publicId)
      .run();
  }

  it("desde CONTACTED también se admite: es un cliente que se adelanta", async () => {
    const creada = await crearCotizacion();
    await fijarEstado(creada.publicId, "CONTACTED");

    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(proposalRequest(creada.publicId, validProposalPayload()));

    expect(res.status).toBe(200);
    const quote = await quoteRow(creada.publicId);
    expect(quote.status).toBe("PROPOSAL_REQUESTED");
    expect((await statusEvents(quote.id))[0].from_status).toBe("CONTACTED");
  });

  it.each(["PROPOSAL_SENT", "ACCEPTED", "REJECTED", "EXPIRED"])(
    "desde %s se rechaza con 409 y no se toca el estado",
    async (status) => {
      const creada = await crearCotizacion();
      await fijarEstado(creada.publicId, status);

      mockOutboundFetch({ siteverify: okSiteverify() });
      const res = await call(proposalRequest(creada.publicId, validProposalPayload()));

      expect(res.status).toBe(409);
      expect((await res.json()).status).toBe("error");
      expect((await quoteRow(creada.publicId)).status).toBe(status);
      expect(await countProposalRequests()).toBe(0);
    },
  );

  it("una solicitud ya registrada gana al estado avanzado: sigue siendo idempotente", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });
    await call(proposalRequest(creada.publicId, validProposalPayload()));

    // Comercial envía la propuesta y el cliente vuelve a pulsar su enlace.
    await fijarEstado(creada.publicId, "PROPOSAL_SENT");

    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(proposalRequest(creada.publicId, validProposalPayload()));

    expect(res.status).toBe(200);
    expect((await res.json()).proposal.alreadyRequested).toBe(true);
    expect((await quoteRow(creada.publicId)).status).toBe("PROPOSAL_SENT");
  });
});

// ---------------------------------------------------------------------------
describe("Manipulación desde el cliente", () => {
  /** Envía el cuerpo indicado y devuelve la fila de la cotización antes y después. */
  async function intentar(publicId, extra) {
    const antes = await quoteRow(publicId);
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(
      proposalRequest(publicId, validProposalPayload(extra)),
    );
    return { res, antes, despues: await quoteRow(publicId) };
  }

  it("un precio inventado en el cuerpo no llega a la base", async () => {
    const creada = await crearCotizacion();
    const { res, antes, despues } = await intentar(creada.publicId, {
      price: 999,
      min_price: 1,
      max_price: 999999999,
      currency: "USD",
      pricing: { available: true, min: 1, max: 1 },
    });

    expect(res.status).toBe(200);
    expect(despues.currency).toBe(antes.currency);
    expect(despues.min_price).toBe(antes.min_price);
    expect(despues.max_price).toBe(antes.max_price);
    expect(await res.text()).not.toContain("999999999");
  });

  it("unas horas inventadas no cambian el esfuerzo calculado", async () => {
    const creada = await crearCotizacion();
    const { res, antes, despues } = await intentar(creada.publicId, {
      hours: 1,
      min_hours: 1,
      max_hours: 2,
      estimated_hours: 1,
      effort: { minHours: 1, maxHours: 2 },
    });

    expect(res.status).toBe(200);
    expect(despues.min_hours).toBe(antes.min_hours);
    expect(despues.max_hours).toBe(antes.max_hours);
    expect(despues.estimated_hours).toBe(antes.estimated_hours);
  });

  it("un alcance reenviado no reescribe el declarado ni la complejidad", async () => {
    const creada = await crearCotizacion();
    const { res, antes, despues } = await intentar(creada.publicId, {
      scope: { web: { apps: 50, roles: 20 } },
      services: ["red_team", "cloud"],
      complexity: "LOW",
      scope_json: '{"web":{"apps":50}}',
    });

    expect(res.status).toBe(200);
    expect(despues.scope_json).toBe(antes.scope_json);
    expect(despues.services_json).toBe(antes.services_json);
    expect(despues.complexity).toBe(antes.complexity);
  });

  it("no se puede fijar un estado arbitrario ni saltar a ACCEPTED", async () => {
    const creada = await crearCotizacion();
    const { res, despues } = await intentar(creada.publicId, {
      status: "ACCEPTED",
      to_status: "ACCEPTED",
    });

    expect(res.status).toBe(200);
    // El único destino posible por esta ruta.
    expect(despues.status).toBe("PROPOSAL_REQUESTED");
  });

  it("no se pueden reescribir los datos de contacto ni el número de cotización", async () => {
    const creada = await crearCotizacion();
    const { res, antes, despues } = await intentar(creada.publicId, {
      email: "atacante@ejemplo.com",
      contact: { email: "atacante@ejemplo.com", name: "Otro" },
      quote_number: "VF-2026-999999",
      quoteNumber: "VF-2026-999999",
      company: "Otra S.A.",
    });

    expect(res.status).toBe(200);
    expect(despues.email).toBe(antes.email);
    expect(despues.contact_name).toBe(antes.contact_name);
    expect(despues.company).toBe(antes.company);
    expect(despues.quote_number).toBe(creada.quoteNumber);
  });

  it("el prototipo no se contamina desde el cuerpo", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(
      proposalRequest(
        creada.publicId,
        JSON.stringify({
          turnstileToken: "0.token-de-prueba",
          __proto__: { contaminado: true },
          constructor: { prototype: { contaminado: true } },
        }),
      ),
    );
    expect([200, 400]).toContain(res.status);
    expect({}.contaminado).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("Validación de los campos adicionales", () => {
  it.each([
    ["notes con tipo incorrecto", { notes: 42 }, "notes", "type"],
    ["scopeNotes con tipo incorrecto", { scopeNotes: { a: 1 } }, "scopeNotes", "type"],
    ["notes demasiado largas", { notes: "a".repeat(1001) }, "notes", "too-long"],
    ["scopeNotes demasiado largas", { scopeNotes: "a".repeat(1001) }, "scopeNotes", "too-long"],
    ["targetDate con formato libre", { targetDate: "el mes que viene" }, "targetDate", "format"],
    ["targetDate inexistente en el calendario", { targetDate: "2026-02-31" }, "targetDate", "format"],
    ["targetDate con tipo incorrecto", { targetDate: 20261102 }, "targetDate", "format"],
  ])("%s -> 400 señalando el campo, sin tocar la base", async (_caso, extra, field, reason) => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(proposalRequest(creada.publicId, validProposalPayload(extra)));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ status: "error", error: "validation_error", field, reason });
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);

    expect(await countProposalRequests()).toBe(0);
    expect((await quoteRow(creada.publicId)).status).toBe("NEW");
  });

  it("una fecha anterior a hoy se rechaza como `past`", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(
      proposalRequest(creada.publicId, validProposalPayload({ targetDate: ayer() })),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "validation_error",
      field: "targetDate",
      reason: "past",
    });
    expect(await countProposalRequests()).toBe(0);
  });

  it("una fecha más allá de la ventana se rechaza como `too-far`", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(
      proposalRequest(
        creada.publicId,
        validProposalPayload({ targetDate: enDias(TARGET_DATE_MAX_DAYS + 1) }),
      ),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ field: "targetDate", reason: "too-far" });
    // El mensaje dice hasta cuándo, que es lo que la persona necesita saber.
    expect(body.message).toContain(targetDateBounds().max);
  });

  it.each([
    ["hoy", 0],
    ["mañana", 1],
    ["el último día admitido", TARGET_DATE_MAX_DAYS],
  ])("una fecha válida (%s) se acepta y se guarda", async (_caso, dias) => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });
    const fecha = enDias(dias);

    const res = await call(
      proposalRequest(creada.publicId, validProposalPayload({ targetDate: fecha })),
    );

    expect(res.status).toBe(200);
    const fila = await env.DB.prepare(
      "SELECT target_date FROM quote_proposal_requests",
    ).first();
    expect(fila.target_date).toBe(fecha);
  });

  it("el mensaje de error no filtra nada interno", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(
      proposalRequest(
        creada.publicId,
        validProposalPayload({ targetDate: "<script>alert(1)</script>" }),
      ),
    );

    const texto = await res.text();
    // Ni rastro de SQL, rutas, trazas, nombres de tabla ni del propio valor
    // recibido: el catálogo de mensajes es cerrado y no interpola la entrada.
    expect(texto).not.toMatch(/SELECT|INSERT|D1_|sqlite|at Object|\.js:\d+/i);
    expect(texto).not.toMatch(/quote_proposal_requests|quotes\b|public_id/);
    expect(texto).not.toContain("script>");
    expect(texto).not.toContain("alert(1)");
  });

  it("un cuerpo que no es un objeto -> 400 sin campo concreto", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(proposalRequest(creada.publicId, JSON.stringify(["notes"])));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_error", field: "body" });
  });
});

// ---------------------------------------------------------------------------
describe("Códigos de error distinguibles", () => {
  it("cada situación tiene su propio código HTTP", async () => {
    const creada = await crearCotizacion();

    // 400 · datos inválidos
    mockOutboundFetch({ siteverify: okSiteverify() });
    const cuatrocientos = await call(
      proposalRequest(creada.publicId, validProposalPayload({ targetDate: ayer() })),
    );
    expect(cuatrocientos.status).toBe(400);

    // 404 · no existe
    mockOutboundFetch({ siteverify: okSiteverify() });
    expect(
      (await call(proposalRequest("f".repeat(32), validProposalPayload()))).status,
    ).toBe(404);

    // 409 · la lleva una persona
    await env.DB.prepare("UPDATE quotes SET status = 'PROPOSAL_SENT' WHERE public_id = ?")
      .bind(creada.publicId)
      .run();
    mockOutboundFetch({ siteverify: okSiteverify() });
    const conflicto = await call(proposalRequest(creada.publicId, validProposalPayload()));
    expect(conflicto.status).toBe(409);
    expect(await conflicto.json()).toMatchObject({
      status: "error",
      error: "proposal_conflict",
    });
  });

  it("un fallo del servidor NO cuenta por qué", async () => {
    // Sin D1 el endpoint no puede continuar. El cuerpo tiene que ser el genérico
    // de siempre: ni el binding, ni la consulta, ni la excepción.
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(proposalRequest(creada.publicId, validProposalPayload()), {
      DB: undefined,
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      status: "error",
      message: "No fue posible registrar la solicitud",
    });
  });

  it("el 429 del limitador no se confunde con un error de validación", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });
    const ip = "203.0.113.91";

    let ultima;
    for (let i = 0; i < 5; i += 1) {
      ultima = await call(
        proposalRequest(creada.publicId, validProposalPayload(), {
          headers: { "CF-Connecting-IP": ip },
        }),
      );
    }

    expect(ultima.status).toBe(429);
    const body = await ultima.json();
    expect(body.error).toBeUndefined(); // no es un validation_error
    expect(ultima.headers.get("Retry-After")).toBe("60");
  });
});

// ---------------------------------------------------------------------------
describe("Turnstile y honeypot", () => {
  it("un token inválido -> 403 y nada se registra", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: { success: false, "error-codes": ["invalid-input-response"] } });

    const res = await call(proposalRequest(creada.publicId, validProposalPayload()));

    expect(res.status).toBe(403);
    expect(await countProposalRequests()).toBe(0);
    expect((await quoteRow(creada.publicId)).status).toBe("NEW");
  });

  it("sin token -> 403", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(
      proposalRequest(creada.publicId, validProposalPayload({ turnstileToken: undefined })),
    );
    expect(res.status).toBe(403);
    expect(await countProposalRequests()).toBe(0);
  });

  it("sin secreto configurado -> 503 (fail closed)", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(
      proposalRequest(creada.publicId, validProposalPayload()),
      { TURNSTILE_SECRET_KEY: "" },
    );
    expect(res.status).toBe(503);
    expect(await countProposalRequests()).toBe(0);
  });

  it("un hostname fuera de la allowlist -> 403", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify("otro-dominio.com") });
    const res = await call(proposalRequest(creada.publicId, validProposalPayload()));
    expect(res.status).toBe(403);
    expect(await countProposalRequests()).toBe(0);
  });

  it("el honeypot responde como un éxito pero no escribe nada", async () => {
    const creada = await crearCotizacion();
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(
      proposalRequest(creada.publicId, validProposalPayload({ website: "http://spam" })),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("success");
    expect(await countProposalRequests()).toBe(0);
    expect((await quoteRow(creada.publicId)).status).toBe("NEW");
    // Ni Siteverify ni Telegram: el bot no gasta nada.
    expect(calls.siteverify).toHaveLength(0);
    expect(calls.telegram).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("Rate limiting", () => {
  it("corta a partir del 4.º intento desde la misma IP", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });

    const ip = "203.0.113.77";
    const codigos = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await call(
        proposalRequest(creada.publicId, validProposalPayload(), {
          headers: { "CF-Connecting-IP": ip },
        }),
      );
      codigos.push(res.status);
    }

    expect(codigos.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codigos[codigos.length - 1]).toBe(429);
    expect(await countProposalRequests()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("GET: datos para prellenar el formulario", () => {
  it("devuelve la cotización con los datos de contacto enmascarados", async () => {
    const creada = await crearCotizacion();

    const res = await call(proposalRequest(creada.publicId, undefined, { method: "GET" }));
    expect(res.status).toBe(200);

    const cuerpo = await res.text();
    // El correo y el teléfono reales NO viajan: el enlace de una estimación se
    // comparte, y no debe convertirse en una ficha de contacto.
    expect(cuerpo).not.toContain("ana@ejemplo.com");
    expect(cuerpo).not.toContain("1234 5678");
    expect(cuerpo).not.toMatch(/\+56 9/);

    const { quote, proposal } = JSON.parse(cuerpo);
    expect(quote.email).toBe("a•••@ejemplo.com");
    expect(quote.phone).toMatch(/78$/);
    expect(quote.contactName).toBe("Ana López");
    expect(quote.company).toBe("ACME S.A.");
    expect(quote.quoteNumber).toBe(creada.quoteNumber);
    expect(quote.services).toEqual(["web"]);
    expect(quote.scopeSummary).toContain("Pentesting Web");
    expect(quote.effort.minHours).toBe(creada.effort.minHours);
    expect(proposal).toEqual({ requested: false, requestedAt: null, available: true });
  });

  it("no expone identificadores internos ni el desglose del cálculo", async () => {
    const creada = await crearCotizacion();
    const res = await call(proposalRequest(creada.publicId, undefined, { method: "GET" }));
    const cuerpo = await res.text();

    const fila = await quoteRow(creada.publicId);
    expect(cuerpo).not.toContain(fila.id); // el UUID interno
    expect(cuerpo).not.toMatch(/breakdown|totalHours|multiplier|estimated_hours/i);
    expect(cuerpo).not.toMatch(/"status":"NEW"/);
  });

  it("tras solicitarla, el prellenado lo refleja y ya no está disponible", async () => {
    const creada = await crearCotizacion();
    mockOutboundFetch({ siteverify: okSiteverify() });
    await call(proposalRequest(creada.publicId, validProposalPayload()));

    const res = await call(proposalRequest(creada.publicId, undefined, { method: "GET" }));
    const { proposal } = await res.json();
    expect(proposal.requested).toBe(true);
    expect(proposal.available).toBe(false);
    expect(proposal.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("una cotización inexistente o un id inválido devuelven el mismo 404", async () => {
    for (const id of ["f".repeat(32), "no-es-un-id"]) {
      const res = await call(proposalRequest(id, undefined, { method: "GET" }));
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ status: "error", message: "Recurso no encontrado" });
    }
  });
});

// ---------------------------------------------------------------------------
describe("Precio: solo con PRICING_ENABLED y tarifa", () => {
  it("con el precio deshabilitado no se expone ningún importe", async () => {
    const creada = await crearCotizacion();
    await conPrecio(creada.publicId);

    const res = await call(proposalRequest(creada.publicId, undefined, { method: "GET" }), {
      PRICING_ENABLED: "false",
    });

    const cuerpo = await res.text();
    expect(cuerpo).not.toContain("1200000");
    expect(JSON.parse(cuerpo).quote.pricing).toEqual({ available: false });
  });

  it("con el precio habilitado se expone el rango guardado", async () => {
    const creada = await crearCotizacion();
    await conPrecio(creada.publicId);

    const res = await call(proposalRequest(creada.publicId, undefined, { method: "GET" }), {
      PRICING_ENABLED: "true",
    });

    expect((await res.json()).quote.pricing).toEqual({
      available: true,
      currency: "CLP",
      min: 1200000,
      max: 1800000,
    });
  });

  it("habilitado pero sin tarifa en la fila sigue sin haber precio", async () => {
    // Es el estado del repositorio: PRICING_ENABLED se puede encender, pero sin
    // tarifas configuradas la cotización se guardó sin importes.
    const creada = await crearCotizacion();
    const res = await call(proposalRequest(creada.publicId, undefined, { method: "GET" }), {
      PRICING_ENABLED: "true",
    });
    expect((await res.json()).quote.pricing).toEqual({ available: false });
  });

  it("el aviso de Telegram solo lleva la línea de precio cuando lo hay", async () => {
    const creada = await crearCotizacion();
    await conPrecio(creada.publicId);

    const sinPrecio = mockOutboundFetch({ siteverify: okSiteverify() });
    await call(proposalRequest(creada.publicId, validProposalPayload()), {
      PRICING_ENABLED: "false",
    });
    expect(sinPrecio.telegram[0].body.text).not.toContain("Precio:");

    // Se deshace la solicitud anterior por completo —fila, estado y auditoría—
    // para repetir el mismo camino con el precio habilitado.
    await resetProposalRequests();
    await resetStatusEvents();
    await env.DB.prepare("UPDATE quotes SET status = 'NEW' WHERE public_id = ?")
      .bind(creada.publicId)
      .run();

    const conPrecioCalls = mockOutboundFetch({ siteverify: okSiteverify() });
    await call(proposalRequest(creada.publicId, validProposalPayload()), {
      PRICING_ENABLED: "true",
    });
    expect(conPrecioCalls.telegram[0].body.text).toContain("Precio: 1.200.000 - 1.800.000 CLP");
  });
});
