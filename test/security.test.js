import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index.js";
import { normalizeQuoteInput } from "../worker/lib/quote/normalize.js";
import { computePricing } from "../worker/lib/quote/pricing.js";
import { QUOTE_CONFIG } from "../worker/config/quote-config.js";
import {
  countQuotes,
  mockOutboundFetch,
  okSiteverify,
  quoteRequest,
  resetQuotes,
  validQuotePayload,
} from "./helpers.js";

/**
 * REVISIÓN DE SEGURIDAD DEL COTIZADOR — casos que no cubre la suite funcional.
 *
 * La suite de `quotes-api.test.js` prueba que el endpoint hace su trabajo. Esta
 * prueba que no hace NADA MÁS cuando se le empuja: contaminación de prototipos,
 * asignación masiva por rutas indirectas, XSS almacenado, enumeración de
 * identificadores, fuga de información en los errores y manipulación de precios.
 *
 * Todo se comprueba contra el Worker real, con la misma verificación de Turnstile
 * y la misma D1 que en producción. No hay ningún interruptor de test en el código
 * de producción que estos casos puedan estar esquivando.
 */

async function call(request, overrides) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, { ...env, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

beforeEach(async () => {
  await resetQuotes();
  mockOutboundFetch({ siteverify: okSiteverify() });
});

// ---------------------------------------------------------------------------
describe("Contaminación de prototipos", () => {
  it("__proto__ en el cuerpo no contamina Object.prototype", async () => {
    const payload = validQuotePayload();
    const body = JSON.stringify({
      ...payload,
      __proto__: { polluted: "yes" },
      constructor: { prototype: { polluted: "yes" } },
    });

    const response = await call(quoteRequest(body));
    expect(response.status).toBe(201);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it("__proto__ dentro de scope y context no llega al motor", async () => {
    const payload = validQuotePayload();
    const body = JSON.stringify({
      ...payload,
      scope: { web: { ...payload.scope.web, __proto__: { apps: 9999 } } },
      context: { ...payload.context, __proto__: { urgency: "urgent" } },
    });

    const response = await call(quoteRequest(body));
    expect(response.status).toBe(201);
    const { quote } = await response.json();

    const limpio = await call(quoteRequest(validQuotePayload()));
    expect(quote.effort).toEqual((await limpio.json()).quote.effort);
    expect({}.apps).toBeUndefined();
  });

  it("el normalizador solo copia claves declaradas en el catálogo", () => {
    const result = normalizeQuoteInput(
      {
        ...validQuotePayload(),
        scope: { web: { apps: 1, roles: 1, __proto__: { x: 1 }, inventada: 5, toString: "no" } },
      },
      ["CLP"],
    );
    expect(result.ok).toBe(true);
    expect(Object.keys(result.data.scope.web)).not.toContain("inventada");
    expect(Object.keys(result.data.scope.web)).not.toContain("__proto__");
    // Y solo hay claves que el catálogo declara.
    expect(Object.prototype.hasOwnProperty.call(result.data, "price")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.data, "status")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Asignación masiva y manipulación comercial", () => {
  const FORBIDDEN_FIELDS = [
    "price",
    "finalPrice",
    "final_price",
    "estimatedHours",
    "estimated_hours",
    "discount",
    "discountRate",
    "margin",
    "hourlyRate",
    "status",
    "quoteStatus",
    "internalNotes",
    "internal_notes",
    "engineVersion",
    "engine_version",
    "publicId",
    "public_id",
    "quoteNumber",
    "quote_number",
    "createdAt",
    "created_at",
    "expiresAt",
    "expires_at",
    "userAgent",
    "user_agent",
    "breakdown",
    "breakdown_json",
  ];

  it("ninguno de los campos comerciales del cliente altera el resultado", async () => {
    const limpio = await call(quoteRequest(validQuotePayload()));
    const esperado = (await limpio.json()).quote;

    for (const field of FORBIDDEN_FIELDS) {
      mockOutboundFetch({ siteverify: okSiteverify() });
      const response = await call(
        quoteRequest(validQuotePayload({ [field]: field.includes("Hour") ? 1 : "MANIPULADO" })),
      );
      expect(response.status, field).toBe(201);
      const { quote } = await response.json();
      expect(quote.effort, field).toEqual(esperado.effort);
      expect(quote.complexity, field).toBe(esperado.complexity);
      expect(quote.pricing, field).toEqual(esperado.pricing);
    }
  });

  it("ninguna fila nace con estado distinto de NEW", async () => {
    for (const status of ["ACCEPTED", "PROPOSAL_SENT", "accepted", "'; UPDATE quotes SET status='ACCEPTED"]) {
      mockOutboundFetch({ siteverify: okSiteverify() });
      const response = await call(quoteRequest(validQuotePayload({ status })));
      expect(response.status, status).toBe(201);
    }
    const { results } = await env.DB.prepare("SELECT DISTINCT status FROM quotes").all();
    expect(results.map((r) => r.status)).toEqual(["NEW"]);
  });

  it("con PRICING_ENABLED=false no hay importes ni en la respuesta ni en D1", async () => {
    const response = await call(
      quoteRequest(validQuotePayload({ pricing: { available: true, min: 1, max: 2 } })),
      { PRICING_ENABLED: "false" },
    );
    const { quote } = await response.json();
    expect(quote.pricing).toEqual({ available: false });

    const row = await env.DB.prepare("SELECT currency, min_price, max_price FROM quotes").first();
    expect(row.currency).toBeNull();
    expect(row.min_price).toBeNull();
    expect(row.max_price).toBeNull();
  });

  it("activar PRICING_ENABLED sin tarifas configuradas NO produce precios", () => {
    // Es el caso peligroso: el interruptor encendido y la configuración vacía.
    // Debe seguir sin precio en lugar de calcular sobre `null`.
    const pricing = computePricing({ minHours: 40, maxHours: 60 }, "CLP", 1, QUOTE_CONFIG, {
      PRICING_ENABLED: "true",
    });
    expect(pricing.available).toBe(false);
    expect(pricing.reason).toBe("not-configured");
    expect(pricing.min).toBeUndefined();
  });

  it("el precio se calcula solo desde las horas del motor, nunca desde el cliente", () => {
    const config = {
      ...QUOTE_CONFIG,
      pricing: {
        ...QUOTE_CONFIG.pricing,
        currencies: {
          ...QUOTE_CONFIG.pricing.currencies,
          CLP: { ...QUOTE_CONFIG.pricing.currencies.CLP, hourlyRate: 1000, minimumAmount: 0 },
        },
      },
    };
    const env2 = { PRICING_ENABLED: "true" };
    const base = computePricing({ minHours: 10, maxHours: 20 }, "CLP", 1, config, env2);
    // Un "descuento" inventado no puede entrar: computePricing no acepta ese
    // parámetro y el descuento sale del número de servicios.
    const conDescuento = computePricing({ minHours: 10, maxHours: 20 }, "CLP", 3, config, env2);
    expect(base.min).toBeGreaterThan(0);
    expect(conDescuento.min).toBeLessThanOrEqual(base.min);
    expect(base.discountRate).toBe(0);
  });

  it("una moneda no declarada se rechaza", async () => {
    // "clp " se normaliza (trim + mayúsculas) y sí es válida. `null` equivale a
    // "no la envío" y toma la moneda por defecto. Todo lo demás se rechaza,
    // incluidos los tipos incorrectos: no se convierten en la moneda por defecto
    // en silencio.
    const casos = [
      ["EUR", 400],
      ["BTC", 400],
      ["clp ", 201],
      ["'; --", 400],
      [42, 400],
      [{ code: "CLP" }, 400],
      [["CLP"], 400],
      [null, 201],
    ];
    for (const [currency, expected] of casos) {
      mockOutboundFetch({ siteverify: okSiteverify() });
      const response = await call(quoteRequest(validQuotePayload({ currency })));
      expect(response.status, JSON.stringify(currency)).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
describe("XSS almacenado y escapado", () => {
  const PAYLOADS = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "javascript:alert(1)",
    "<svg/onload=alert(1)>",
    "{{constructor.constructor('alert(1)')()}}",
  ];

  it("el texto peligroso se almacena tal cual, sin ejecutarse ni corromper el JSON", async () => {
    for (const payload of PAYLOADS) {
      mockOutboundFetch({ siteverify: okSiteverify() });
      const response = await call(
        quoteRequest(
          validQuotePayload({
            contact: {
              company: `ACME ${payload}`,
              name: `Ana ${payload}`,
              email: "ana@ejemplo.com",
              phone: "",
              notes: payload,
            },
          }),
        ),
      );
      expect(response.status, payload).toBe(201);

      // La respuesta es JSON con Content-Type estricto y CSP que no permite nada:
      // el navegador no la interpreta como HTML.
      expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");

      // Y el dato viaja escapado como JSON, no como HTML crudo.
      const text = await response.text();
      expect(text).not.toContain("<script>alert(1)</script>");
      expect(JSON.parse(text).quote.company).toContain(payload);
    }
  });

  it("el teléfono solo admite caracteres de teléfono", async () => {
    for (const phone of ["<script>", "+56 9 <b>", "javascript:1", "'; DROP--"]) {
      mockOutboundFetch({ siteverify: okSiteverify() });
      const response = await call(
        quoteRequest(
          validQuotePayload({
            contact: { ...validQuotePayload().contact, phone },
          }),
        ),
      );
      expect(response.status, phone).toBe(400);
    }
  });

  it("la lectura pública devuelve JSON, nunca HTML", async () => {
    const created = await call(
      quoteRequest(
        validQuotePayload({
          contact: {
            company: '<script>alert(1)</script>',
            name: "Ana López",
            email: "ana@ejemplo.com",
            phone: "",
            notes: "",
          },
        }),
      ),
    );
    const { quote } = await created.json();

    const read = await call(
      new Request(`https://vulnfocus.com/api/quotes/${quote.publicId}`, {
        headers: { "CF-Connecting-IP": "203.0.113.44" },
      }),
    );
    expect(read.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect((await read.json()).quote.company).toBe('<script>alert(1)</script>');
  });
});

// ---------------------------------------------------------------------------
describe("IDOR y enumeración", () => {
  it("public_id es impredecible: 128 bits y sin repeticiones", async () => {
    const ids = new Set();
    for (let i = 0; i < 8; i += 1) {
      mockOutboundFetch({ siteverify: okSiteverify() });
      const response = await call(quoteRequest(validQuotePayload()));
      const { quote } = await response.json();
      expect(quote.publicId).toMatch(/^[0-9a-f]{32}$/);
      ids.add(quote.publicId);
    }
    expect(ids.size).toBe(8);
  });

  it("el correlativo visible NO sirve para recuperar nada", async () => {
    const response = await call(quoteRequest(validQuotePayload()));
    const { quote } = await response.json();

    for (const candidate of [
      quote.quoteNumber,
      quote.quoteNumber.replace(/-/g, ""),
      "1",
      "000001",
      encodeURIComponent(quote.quoteNumber),
    ]) {
      const read = await call(
        new Request(`https://vulnfocus.com/api/quotes/${candidate}`, {
          headers: { "CF-Connecting-IP": "203.0.113.45" },
        }),
      );
      expect(read.status, candidate).toBe(404);
    }
  });

  it("un public_id inexistente y uno mal formado devuelven exactamente lo mismo", async () => {
    const bodies = [];
    for (const id of ["a".repeat(32), "no-es-un-id", "0", "%2e%2e%2f", "A".repeat(32)]) {
      const read = await call(
        new Request(`https://vulnfocus.com/api/quotes/${id}`, {
          headers: { "CF-Connecting-IP": "203.0.113.46" },
        }),
      );
      expect(read.status, id).toBe(404);
      bodies.push(await read.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("la lectura pública no expone datos de contacto ni el desglose", async () => {
    const created = await call(quoteRequest(validQuotePayload()));
    const { quote } = await created.json();

    const read = await call(
      new Request(`https://vulnfocus.com/api/quotes/${quote.publicId}`, {
        headers: { "CF-Connecting-IP": "203.0.113.47" },
      }),
    );
    const text = await read.text();
    for (const leak of ["ana@ejemplo.com", "1234 5678", "breakdown", "hourlyRate", "\"status\":\"NEW\"", "user_agent"]) {
      expect(text, leak).not.toContain(leak);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Robustez del cuerpo de la petición", () => {
  it.each([
    ["JSON truncado", "{\"services\":[\"web\"]"],
    ["array en la raíz", "[]"],
    ["cadena en la raíz", "\"web\""],
    ["null", "null"],
    ["número", "42"],
    ["vacío", ""],
  ])("%s se rechaza sin escribir en D1", async (_label, body) => {
    const response = await call(quoteRequest(body));
    expect([400, 415]).toContain(response.status);
    expect(await countQuotes()).toBe(0);
  });

  it("un cuerpo enorme se corta por tamaño real, no solo por Content-Length", async () => {
    const payload = validQuotePayload();
    payload.contact.notes = "x".repeat(40 * 1024);
    const response = await call(
      quoteRequest(JSON.stringify(payload), { "Content-Length": "10" }),
    );
    expect(response.status).toBe(413);
    expect(await countQuotes()).toBe(0);
  });

  it("un anidamiento profundo se ignora en lugar de recorrerse", async () => {
    // El normalizador lee SOLO las claves declaradas en el catálogo, así que una
    // estructura arbitrariamente profunda en `scope.web` no se recorre: no hay
    // recursión sobre entrada no confiable y por tanto no hay agotamiento de pila.
    // El resultado debe ser idéntico al de un cuerpo limpio.
    const limpio = await call(quoteRequest(validQuotePayload()));
    const esperado = (await limpio.json()).quote;

    let nested = { a: 1 };
    for (let i = 0; i < 2000; i += 1) nested = { a: nested };

    mockOutboundFetch({ siteverify: okSiteverify() });
    const payload = validQuotePayload();
    const response = await call(
      quoteRequest(
        validQuotePayload({ scope: { web: { ...payload.scope.web, profundo: nested } } }),
      ),
    );
    expect(response.status).toBe(201);
    const { quote } = await response.json();
    expect(quote.effort).toEqual(esperado.effort);
    // Y la clave inventada no se ha almacenado.
    expect(Object.keys(quote.scope.web)).not.toContain("profundo");
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""])(
    "Content-Type %s se rechaza con 415",
    async (contentType) => {
      const response = await call(
        quoteRequest(validQuotePayload(), { "Content-Type": contentType }),
      );
      expect(response.status).toBe(415);
    },
  );
});

// ---------------------------------------------------------------------------
describe("Fuga de información en los errores", () => {
  it("ningún error revela SQL, rutas, ni el campo que falló", async () => {
    const casos = [
      validQuotePayload({ services: [] }),
      validQuotePayload({ contact: { company: "A", name: "B", email: "no-es-email" } }),
      validQuotePayload({ scope: { web: { apps: -5 } } }),
      validQuotePayload({ currency: "XXX" }),
    ];

    for (const payload of casos) {
      mockOutboundFetch({ siteverify: okSiteverify() });
      const response = await call(quoteRequest(payload));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({
        status: "error",
        message: "Revisa los datos del formulario e inténtalo de nuevo",
      });
      const text = JSON.stringify(body);
      for (const leak of ["SELECT", "INSERT", "sqlite", "worker/", "scope.", "contact.", "stack"]) {
        expect(text, leak).not.toContain(leak);
      }
    }
  });

  it("un fallo de D1 no filtra la consulta", async () => {
    const roto = {
      ...env,
      DB: {
        prepare: () => ({
          bind: () => ({
            run: () => Promise.reject(new Error("SQLITE_ERROR: no such table: quotes")),
            first: () => Promise.reject(new Error("SQLITE_ERROR: no such table: quote_counters")),
          }),
        }),
      },
    };
    const response = await call(quoteRequest(validQuotePayload()), roto);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("SQLITE");
    expect(text).not.toContain("quote_counters");
  });

  it("el rechazo de Turnstile no filtra el error-code interno", async () => {
    mockOutboundFetch({
      siteverify: { success: false, "error-codes": ["invalid-input-secret", "timeout-or-duplicate"] },
    });
    const response = await call(quoteRequest(validQuotePayload()));
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).not.toContain("invalid-input-secret");
    expect(text).not.toContain("timeout-or-duplicate");
  });

  it("las respuestas de error no se cachean", async () => {
    const response = await call(quoteRequest("{"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
describe("Turnstile no se puede esquivar", () => {
  it("ninguna variable de entorno desactiva la verificación", async () => {
    for (const over of [
      { TURNSTILE_SECRET_KEY: "" },
      { SKIP_TURNSTILE: "true" },
      { NODE_ENV: "test" },
      { DEBUG: "1" },
      { TURNSTILE_ALLOWED_HOSTNAMES: "" },
    ]) {
      mockOutboundFetch({ siteverify: { success: false, "error-codes": ["invalid-input-response"] } });
      const response = await call(quoteRequest(validQuotePayload()), over);
      expect([403, 503], JSON.stringify(over)).toContain(response.status);
      expect(await countQuotes()).toBe(0);
    }
  });

  it("una cabecera no sustituye al token", async () => {
    const payload = validQuotePayload();
    delete payload.turnstileToken;
    mockOutboundFetch({ siteverify: okSiteverify() });
    const response = await call(
      quoteRequest(payload, {
        "CF-Connecting-IP": "203.0.113.99",
        "X-Turnstile-Verified": "true",
        "CF-Turnstile-Response": "0.token",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("un hostname parecido al legítimo no pasa la allowlist", async () => {
    for (const hostname of [
      "vulnfocus.com.evil.tld",
      "evil-vulnfocus.com",
      "wwwvulnfocus.com",
      "VULNFOCUS.COM",
      "sub.vulnfocus.com",
    ]) {
      mockOutboundFetch({ siteverify: okSiteverify(hostname) });
      const response = await call(quoteRequest(validQuotePayload()));
      expect(response.status, hostname).toBe(403);
    }
  });
});
