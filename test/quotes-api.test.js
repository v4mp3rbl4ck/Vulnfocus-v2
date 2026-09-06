import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.js";
import {
  countQuotes,
  mockOutboundFetch,
  okSiteverify,
  quoteRequest,
  resetQuotes,
  validQuotePayload,
} from "./helpers.js";
import { QUOTE_CONFIG } from "../worker/config/quote-config.js";

async function call(request, envOver = env) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, envOver, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await resetQuotes();
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
describe("Superficie del endpoint", () => {
  it.each(["GET", "PUT", "DELETE", "PATCH", "OPTIONS"])(
    "%s /api/quotes -> 405 con cabecera Allow",
    async (method) => {
      const res = await call(new Request("https://vulnfocus.com/api/quotes", { method }));
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    },
  );

  it.each([
    "/api/quotes/list",
    "/api/quotes/admin",
    "/api/quotes/all/export",
  ])("no existe superficie administrativa: %s", async (path) => {
    const res = await call(new Request(`https://vulnfocus.com${path}`));
    expect([404, 429]).toContain(res.status);
    if (res.status === 404) {
      expect(await res.json()).toEqual({ status: "error", message: "Recurso no encontrado" });
    }
  });

  it("la barra final se normaliza: /api/quotes/ es /api/quotes", async () => {
    const res = await call(new Request("https://vulnfocus.com/api/quotes/"));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("Content-Type incorrecto -> 415", async () => {
    const res = await call(quoteRequest(validQuotePayload(), { "Content-Type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("JSON malformado -> 400", async () => {
    const res = await call(quoteRequest("{no-es-json"));
    expect(res.status).toBe(400);
  });

  it("cuerpo mayor de 32 KB -> 413", async () => {
    const payload = validQuotePayload();
    payload.contact.notes = "a".repeat(40000);
    const res = await call(quoteRequest(payload));
    expect(res.status).toBe(413);
    expect(await countQuotes()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("Validación", () => {
  beforeEach(() => mockOutboundFetch({ siteverify: okSiteverify() }));

  const casos = [
    ["servicio inexistente", { services: ["inventado"] }],
    ["sin servicios", { services: [] }],
    ["servicios duplicados", { services: ["web", "web"] }],
    ["más servicios de los permitidos", { services: ["web", "api", "cloud", "mobile"] }],
    ["services no es un array", { services: "web" }],
    ["contacto ausente", { contact: {} }],
    ["email inválido", { contact: { company: "ACME", name: "Ana", email: "no-es-email" } }],
    ["empresa vacía", { contact: { company: "", name: "Ana", email: "a@b.com" } }],
    ["moneda no admitida", { currency: "BTC" }],
    ["cuerpo que no es objeto", null],
  ];

  it.each(casos)("%s -> 400 genérico y sin fila en D1", async (_desc, over) => {
    const payload = over === null ? "[]" : validQuotePayload(over);
    const res = await call(quoteRequest(payload));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe("Revisa los datos del formulario e inténtalo de nuevo");
    // El mensaje no revela qué campo falló ni la forma interna del validador.
    expect(JSON.stringify(body)).not.toMatch(/services|contact|scope|currency|field/i);
    expect(await countQuotes()).toBe(0);
  });

  it("números negativos, decimales o fuera de rango -> 400", async () => {
    for (const apps of [-5, 0, 2.5, 100000, "dos"]) {
      const payload = validQuotePayload();
      payload.scope.web.apps = apps;
      const res = await call(quoteRequest(payload));
      expect(res.status, `apps=${apps}`).toBe(400);
    }
    expect(await countQuotes()).toBe(0);
  });

  it("tipos incorrectos en boolean, select y multiselect -> 400", async () => {
    const casosTipo = [
      ["waf", "sí"],
      ["environment", "produccion"],
      ["stack", "spa"],
      ["stack", ["inventada"]],
    ];
    for (const [field, value] of casosTipo) {
      const payload = validQuotePayload();
      payload.scope.web[field] = value;
      const res = await call(quoteRequest(payload));
      expect(res.status, `${field}`).toBe(400);
    }
  });

  it("acepta el alcance mínimo y el máximo declarados en el catálogo", async () => {
    const minimo = validQuotePayload();
    minimo.scope.web = { apps: 1, roles: 1 };
    expect((await call(quoteRequest(minimo))).status).toBe(201);

    const maximo = validQuotePayload();
    maximo.scope.web = {
      apps: 50,
      roles: 20,
      auth: "sso",
      endpoints: "gt400",
      api_asociada: true,
      waf: true,
      environment: "both",
      stack: ["spa", "server_rendered", "cms", "legacy", "microservices"],
    };
    const res = await call(quoteRequest(maximo));
    expect(res.status).toBe(201);
    const { quote } = await res.json();
    expect(quote.effort.maxHours).toBeLessThanOrEqual(QUOTE_CONFIG.effort.maxHours);
  });
});

// ---------------------------------------------------------------------------
describe("Manipulación desde el cliente", () => {
  beforeEach(() => mockOutboundFetch({ siteverify: okSiteverify() }));

  it("los campos comerciales enviados por el cliente se ignoran por completo", async () => {
    const limpio = await call(quoteRequest(validQuotePayload()));
    const esperado = (await limpio.json()).quote;

    const manipulado = validQuotePayload({
      estimated_hours: 1,
      min_hours: 1,
      max_hours: 1,
      min_price: 1,
      max_price: 1,
      price: 1,
      discount: 0.99,
      complexity: "LOW",
      status: "ACCEPTED",
      quote_number: "VF-1999-000001",
      public_id: "00000000000000000000000000000000",
      internal: { totalHours: 1 },
      effort: { minHours: 1, maxHours: 1 },
      pricing: { available: true, min: 1, max: 1 },
    });

    const res = await call(quoteRequest(manipulado));
    expect(res.status).toBe(201);
    const { quote } = await res.json();

    expect(quote.effort).toEqual(esperado.effort);
    expect(quote.complexity).toBe(esperado.complexity);
    expect(quote.quoteNumber).not.toBe("VF-1999-000001");
    expect(quote.publicId).not.toBe("00000000000000000000000000000000");

    const row = await env.DB.prepare(
      "SELECT status, estimated_hours, min_price, max_price FROM quotes WHERE quote_number = ?",
    )
      .bind(quote.quoteNumber)
      .first();

    // El estado SIEMPRE nace en NEW y el precio nunca viene del cliente.
    expect(row.status).toBe("NEW");
    expect(row.estimated_hours).toBeGreaterThan(1);
    expect(row.min_price).toBeNull();
    expect(row.max_price).toBeNull();
  });

  it("la respuesta nunca incluye tarifas, multiplicadores ni desglose interno", async () => {
    const res = await call(quoteRequest(validQuotePayload()));
    const text = await res.text();
    expect(text).not.toMatch(/hourlyRate|multiplier|baseHours|breakdown|margin|minimumAmount/i);
    expect(text).not.toMatch(/internal/);
  });
});

// ---------------------------------------------------------------------------
describe("Turnstile y honeypot", () => {
  it("sin token -> 403 y sin fila", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const payload = validQuotePayload();
    delete payload.turnstileToken;
    const res = await call(quoteRequest(payload));
    expect(res.status).toBe(403);
    expect(await countQuotes()).toBe(0);
  });

  it("token inválido -> 403 sin filtrar el error-code interno", async () => {
    mockOutboundFetch({ siteverify: { success: false, "error-codes": ["invalid-input-secret"] } });
    const res = await call(quoteRequest(validQuotePayload()));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/invalid-input-secret/);
    expect(await countQuotes()).toBe(0);
  });

  it("Siteverify caído -> 403 (fail closed)", async () => {
    mockOutboundFetch({ siteverify: new Error("network down") });
    expect((await call(quoteRequest(validQuotePayload()))).status).toBe(403);
    expect(await countQuotes()).toBe(0);
  });

  it("hostname fuera de la allowlist -> 403", async () => {
    mockOutboundFetch({ siteverify: okSiteverify("atacante.tld") });
    expect((await call(quoteRequest(validQuotePayload()))).status).toBe(403);
  });

  it("honeypot: 201 indistinguible, sin D1, sin Turnstile y sin Telegram", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(quoteRequest(validQuotePayload({ website: "http://spam.tld" })));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.quote.quoteNumber).toMatch(/^VF-\d{4}-\d{6}$/);
    expect(await countQuotes()).toBe(0);
    expect(calls.siteverify).toHaveLength(0);
    expect(calls.telegram).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("Camino feliz y persistencia", () => {
  it("201 con estimación, fila en D1 y aviso a Telegram", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(
      quoteRequest(validQuotePayload(), { "User-Agent": "Mozilla/5.0 (tests)" }),
    );

    expect(res.status).toBe(201);
    const { quote } = await res.json();

    expect(quote.quoteNumber).toMatch(/^VF-\d{4}-000001$/);
    expect(quote.publicId).toMatch(/^[0-9a-f]{32}$/);
    expect(quote.services).toEqual(["web"]);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(quote.complexity);
    expect(quote.effort.minDays).toBeGreaterThanOrEqual(1);
    expect(quote.includes).toEqual(expect.arrayContaining(["manual_testing", "technical_report"]));
    // Sin tarifa configurada no se inventa un precio.
    expect(quote.pricing).toEqual({ available: false });

    expect(await countQuotes()).toBe(1);
    const row = await env.DB.prepare("SELECT * FROM quotes").first();
    expect(row.company).toBe("ACME S.A.");
    expect(row.email).toBe("ana@ejemplo.com");
    expect(row.status).toBe("NEW");
    expect(row.user_agent).toBe("Mozilla/5.0 (tests)");
    expect(JSON.parse(row.services_json)).toEqual(["web"]);
    expect(JSON.parse(row.breakdown_json).totalHours).toBe(row.estimated_hours);
    expect(row.expires_at > row.created_at).toBe(true);

    expect(calls.telegram).toHaveLength(1);
    const text = calls.telegram[0].body.text;
    expect(text).toContain("Nueva oportunidad VulnFocus");
    expect(text).toContain(quote.quoteNumber);
    expect(text).toContain("ACME S.A.");
    expect(calls.telegram[0].body).not.toHaveProperty("parse_mode");
  });

  it("el correlativo avanza sin repetirse ni saltarse números", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const numeros = [];
    for (let i = 0; i < 5; i++) {
      const res = await call(quoteRequest(validQuotePayload()));
      numeros.push((await res.json()).quote.quoteNumber);
    }
    const year = new Date().getUTCFullYear();
    expect(numeros).toEqual([1, 2, 3, 4, 5].map((n) => `VF-${year}-${String(n).padStart(6, "0")}`));
  });

  it("cotizaciones simultáneas no colisionan en número ni en identificador público", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const respuestas = await Promise.all(
      Array.from({ length: 12 }, () => call(quoteRequest(validQuotePayload()))),
    );
    const quotes = await Promise.all(respuestas.map((r) => r.json()));

    expect(respuestas.every((r) => r.status === 201)).toBe(true);
    expect(new Set(quotes.map((q) => q.quote.quoteNumber)).size).toBe(12);
    expect(new Set(quotes.map((q) => q.quote.publicId)).size).toBe(12);
    expect(await countQuotes()).toBe(12);
  });

  it("admite varios servicios a la vez", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const payload = validQuotePayload({
      services: ["api", "web"],
      scope: {
        web: { apps: 1, roles: 2 },
        api: { endpoints: 120, roles: 3, api_type: ["rest", "graphql"] },
      },
    });
    const res = await call(quoteRequest(payload));
    expect(res.status).toBe(201);
    const { quote } = await res.json();
    // Orden canónico por catálogo, no el que envió el cliente.
    expect(quote.services).toEqual(["web", "api"]);
  });

  it("calcula el rango económico cuando hay tarifa y PRICING_ENABLED", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const original = QUOTE_CONFIG.pricing.currencies.CLP.hourlyRate;
    QUOTE_CONFIG.pricing.currencies.CLP.hourlyRate = 60000;
    QUOTE_CONFIG.pricing.currencies.CLP.minimumAmount = 0;
    try {
      const res = await call(quoteRequest(validQuotePayload()), {
        ...env,
        PRICING_ENABLED: "true",
      });
      const { quote } = await res.json();
      expect(quote.pricing.available).toBe(true);
      expect(quote.pricing.currency).toBe("CLP");
      expect(quote.pricing.max).toBeGreaterThanOrEqual(quote.pricing.min);
      expect(quote.pricing.min % 10000).toBe(0);
      // Ni tarifa ni descuento viajan al cliente.
      expect(JSON.stringify(quote.pricing)).not.toMatch(/60000|discount|rate/i);

      const row = await env.DB.prepare("SELECT min_price, max_price, currency FROM quotes").first();
      expect(row.currency).toBe("CLP");
      expect(row.min_price).toBe(quote.pricing.min);
    } finally {
      QUOTE_CONFIG.pricing.currencies.CLP.hourlyRate = original;
      QUOTE_CONFIG.pricing.currencies.CLP.minimumAmount = null;
    }
  });
});

// ---------------------------------------------------------------------------
describe("Atomicidad: D1 frente a notificaciones", () => {
  it("si D1 falla no se devuelve 201 ni se notifica", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    const brokenEnv = {
      ...env,
      DB: {
        prepare() {
          return {
            bind() {
              return {
                run() { throw new Error("D1_ERROR: no such table: quotes"); },
                first() { throw new Error("D1_ERROR: no such table: quote_counters"); },
              };
            },
          };
        },
      },
    };

    const res = await call(quoteRequest(validQuotePayload()), brokenEnv);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe("No fue posible generar la estimación");
    expect(JSON.stringify(body)).not.toMatch(/D1_ERROR|no such table/);
    expect(calls.telegram).toHaveLength(0);
  });

  it("si Telegram falla la cotización permanece guardada y el usuario recibe 201", async () => {
    mockOutboundFetch({ siteverify: okSiteverify(), telegramStatus: 500 });
    const res = await call(quoteRequest(validQuotePayload()));
    expect(res.status).toBe(201);
    expect(await countQuotes()).toBe(1);
  });

  it("sin Telegram configurado la cotización se guarda igual", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(quoteRequest(validQuotePayload()), {
      ...env,
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_CHAT_ID: "",
    });
    expect(res.status).toBe(201);
    expect(await countQuotes()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/quotes/:public_id", () => {
  async function crear() {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(quoteRequest(validQuotePayload()));
    return (await res.json()).quote;
  }

  it("devuelve la estimación con su identificador público", async () => {
    const creada = await crear();
    const res = await call(
      new Request(`https://vulnfocus.com/api/quotes/${creada.publicId}`, {
        headers: { "CF-Connecting-IP": "198.51.100.240" },
      }),
    );

    expect(res.status).toBe(200);
    const { quote } = await res.json();
    expect(quote.quoteNumber).toBe(creada.quoteNumber);
    expect(quote.company).toBe("ACME S.A.");
    expect(quote.scope.web.apps).toBe(1);
    expect(quote.effort.minHours).toBe(creada.effort.minHours);
  });

  it("no expone email, teléfono, notas, estado ni desglose interno", async () => {
    const creada = await crear();
    const res = await call(
      new Request(`https://vulnfocus.com/api/quotes/${creada.publicId}`, {
        headers: { "CF-Connecting-IP": "198.51.100.241" },
      }),
    );
    const text = await res.text();
    expect(text).not.toMatch(/ana@ejemplo\.com/);
    expect(text).not.toMatch(/1234 5678|\+56 9/);
    expect(text).not.toMatch(/"status":"NEW"/);
    expect(text).not.toMatch(/breakdown|totalHours|multiplier/i);
  });

  it("un identificador inexistente o mal formado devuelve el mismo 404", async () => {
    const casos = [
      "f".repeat(32),
      "no-es-un-id",
      "../../etc/passwd",
      "1",
      "%00",
      "0000000000000000000000000000000g",
    ];
    for (const id of casos) {
      const res = await call(
        new Request(`https://vulnfocus.com/api/quotes/${encodeURIComponent(id)}`, {
          headers: { "CF-Connecting-IP": "198.51.100.242" },
        }),
      );
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ status: "error", message: "Recurso no encontrado" });
    }
  });

  it("el número comercial NO sirve para recuperar la cotización (no es enumerable)", async () => {
    const creada = await crear();
    const res = await call(
      new Request(`https://vulnfocus.com/api/quotes/${creada.quoteNumber}`, {
        headers: { "CF-Connecting-IP": "198.51.100.243" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])(
    "%s sobre una estimación existente -> 405 (no se puede modificar)",
    async (method) => {
      const creada = await crear();
      const res = await call(
        new Request(`https://vulnfocus.com/api/quotes/${creada.publicId}`, {
          method,
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.244" },
          body: JSON.stringify({ status: "ACCEPTED" }),
        }),
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("GET");

      const row = await env.DB.prepare("SELECT status FROM quotes").first();
      expect(row.status).toBe("NEW");
    },
  );
});

// ---------------------------------------------------------------------------
describe("Rate limiting del cotizador", () => {
  it("corta a partir del 4.º envío desde la misma IP y antes de gastar Turnstile", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    const ip = "203.0.113.201";
    const codigos = [];
    for (let i = 0; i < 5; i++) {
      const res = await call(quoteRequest(validQuotePayload(), { "CF-Connecting-IP": ip }));
      codigos.push(res.status);
    }

    expect(codigos.slice(0, 3)).toEqual([201, 201, 201]);
    expect(codigos.slice(3)).toEqual([429, 429]);
    expect(await countQuotes()).toBe(3);
    // Los rechazados no llegan a llamar a Siteverify.
    expect(calls.siteverify).toHaveLength(3);
  });

  it("la respuesta 429 lleva Retry-After y no es cacheable", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const ip = "203.0.113.202";
    for (let i = 0; i < 3; i++) {
      await call(quoteRequest(validQuotePayload(), { "CF-Connecting-IP": ip }));
    }
    const res = await call(quoteRequest(validQuotePayload(), { "CF-Connecting-IP": ip }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
