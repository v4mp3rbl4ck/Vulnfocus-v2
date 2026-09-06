import { describe, expect, it } from "vitest";
import { QUOTE_CONFIG } from "../worker/config/quote-config.js";
import { evaluateHours, evaluateMultiplier } from "../worker/lib/quote/rules.js";
import { computeScope } from "../worker/lib/quote/scope.js";
import { computeComplexity } from "../worker/lib/quote/complexity.js";
import { computeEffort } from "../worker/lib/quote/effort.js";
import { computePricing, multiServiceDiscount } from "../worker/lib/quote/pricing.js";
import { normalizeQuoteInput, catalog } from "../worker/lib/quote/normalize.js";
import { buildQuote, publicQuoteView } from "../worker/lib/quote/engine.js";
import { formatQuoteNumber, generatePublicId, PUBLIC_ID_RE } from "../worker/lib/quote/number.js";

/** Entrada normalizada mínima para un servicio, con los valores por defecto. */
function inputFor(serviceId, scopeOver = {}, contextOver = {}) {
  const service = catalog.services.find((s) => s.id === serviceId);
  const scope = {};
  for (const q of service.questions) {
    scope[q.id] = Array.isArray(q.default) ? [...q.default] : q.default;
  }
  const context = {};
  for (const q of catalog.context.questions) {
    context[q.id] = Array.isArray(q.default) ? [...q.default] : q.default;
  }
  return {
    services: [serviceId],
    scope: { [serviceId]: { ...scope, ...scopeOver } },
    context: { ...context, ...contextOver },
    contact: { company: "ACME", name: "Ana", email: "a@b.com", phone: null, notes: null },
    currency: "CLP",
  };
}

// ---------------------------------------------------------------------------
describe("Evaluador de reglas", () => {
  it("perUnitAbove solo cobra a partir del umbral y respeta el techo", () => {
    const rule = { type: "perUnitAbove", above: 1, hoursPerUnit: 10, maxHours: 30 };
    expect(evaluateHours(rule, 1)).toBe(0);
    expect(evaluateHours(rule, 3)).toBe(20);
    expect(evaluateHours(rule, 100)).toBe(30);
  });

  it("perUnitAbove nunca devuelve horas negativas", () => {
    const rule = { type: "perUnitAbove", above: 5, hoursPerUnit: 10 };
    expect(evaluateHours(rule, 1)).toBe(0);
    expect(evaluateHours(rule, -50)).toBe(0);
  });

  it("tiers escoge el primer tramo que cubre el valor y `upTo: null` es el resto", () => {
    const rule = {
      type: "tiers",
      tiers: [{ upTo: 10, hours: 0 }, { upTo: 50, hours: 8 }, { upTo: null, hours: 20 }],
    };
    expect(evaluateHours(rule, 10)).toBe(0);
    expect(evaluateHours(rule, 11)).toBe(8);
    expect(evaluateHours(rule, 50)).toBe(8);
    expect(evaluateHours(rule, 5000)).toBe(20);
  });

  it("map y flag devuelven el elemento neutro ante valores desconocidos", () => {
    expect(evaluateHours({ type: "map", map: { a: 5 } }, "a")).toBe(5);
    expect(evaluateHours({ type: "map", map: { a: 5 } }, "z")).toBe(0);
    expect(evaluateHours({ type: "flag", whenTrue: 8, whenFalse: 0 }, true)).toBe(8);
    expect(evaluateHours({ type: "flag", whenTrue: 8, whenFalse: 0 }, "true")).toBe(0);
  });

  it("perSelected suma solo las opciones conocidas", () => {
    const rule = { type: "perSelected", hours: { a: 2, b: 3 } };
    expect(evaluateHours(rule, ["a", "b"])).toBe(5);
    expect(evaluateHours(rule, ["a", "desconocida"])).toBe(2);
    expect(evaluateHours(rule, "a")).toBe(0);
  });

  it("percentOfSubtotal no aporta horas si la opción está desmarcada", () => {
    const rule = { type: "percentOfSubtotal", percent: 0.15, minHours: 4, maxHours: 40 };
    expect(evaluateHours(rule, false, { subtotalHours: 1000 })).toBe(0);
  });

  it("percentOfSubtotal aplica suelo y techo", () => {
    const rule = { type: "percentOfSubtotal", percent: 0.15, minHours: 4, maxHours: 40 };
    expect(evaluateHours(rule, true, { subtotalHours: 10 })).toBe(4);
    expect(evaluateHours(rule, true, { subtotalHours: 100 })).toBe(15);
    expect(evaluateHours(rule, true, { subtotalHours: 1000 })).toBe(40);
  });

  it("una regla desconocida o corrupta no rompe: 0 horas, factor 1", () => {
    expect(evaluateHours({ type: "inventada" }, 5)).toBe(0);
    expect(evaluateHours(null, 5)).toBe(0);
    expect(evaluateMultiplier({ type: "inventada" }, 5)).toBe(1);
    expect(evaluateMultiplier(null, 5)).toBe(1);
  });

  it("un multiplicador cero o negativo se ignora (no puede anular el esfuerzo)", () => {
    expect(evaluateMultiplier({ type: "flagMultiplier", whenTrue: 0 }, true)).toBe(1);
    expect(evaluateMultiplier({ type: "mapMultiplier", map: { a: -2 } }, "a")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Cálculo por servicio", () => {
  it("WEB: el caso mínimo son las horas base", () => {
    const answers = inputFor("web").scope.web;
    const scope = computeScope("web", answers, QUOTE_CONFIG);
    expect(scope.baseHours).toBe(16);
    // apps=1 y roles=2 -> 1 rol adicional
    expect(scope.scopeHours).toBe(4);
    expect(scope.subtotalHours).toBe(20);
  });

  it("WEB: el ejemplo del enunciado (más roles, API asociada, más endpoints) sube el esfuerzo", () => {
    const answers = inputFor("web", {
      apps: 1,
      roles: 3,
      api_asociada: true,
      endpoints: "50_150",
    }).scope.web;
    const scope = computeScope("web", answers, QUOTE_CONFIG);
    // 16 base + 8 roles (2 adicionales) + 8 API + 8 endpoints
    expect(scope.subtotalHours).toBe(40);
  });

  it("WEB: WAF y producción son complejidad, no alcance", () => {
    const answers = inputFor("web", { waf: true, environment: "production" }).scope.web;
    const scope = computeScope("web", answers, QUOTE_CONFIG);
    const complexity = computeComplexity("web", answers, QUOTE_CONFIG);
    expect(scope.subtotalHours).toBe(20);
    expect(complexity.multiplier).toBeGreaterThan(1);
    expect(complexity.factors.map((f) => f.key).sort()).toEqual(["environment", "waf"]);
  });

  it("API: sin documentación cuesta más que con documentación", () => {
    const con = computeScope("api", inputFor("api", { openapi: true }).scope.api, QUOTE_CONFIG);
    const sin = computeScope("api", inputFor("api", { openapi: false }).scope.api, QUOTE_CONFIG);
    expect(sin.subtotalHours).toBe(con.subtotalHours + 6);
  });

  it("ACTIVE DIRECTORY: el tamaño del dominio y las confianzas mueven la aguja", () => {
    const pequeno = computeScope(
      "active_directory",
      inputFor("active_directory").scope.active_directory,
      QUOTE_CONFIG,
    );
    const grande = computeScope(
      "active_directory",
      inputFor("active_directory", { users: 8000, servers: 120, trusts: true, domains: 2 })
        .scope.active_directory,
      QUOTE_CONFIG,
    );
    expect(grande.subtotalHours).toBeGreaterThan(pequeno.subtotalHours);
    // 24 base + 32 usuarios + 14 servidores + 8 dominio extra + 8 trusts
    expect(grande.subtotalHours).toBe(86);
  });

  it("INFRA: más direcciones y servicios expuestos suben por tramos, no linealmente", () => {
    const a = computeScope(
      "infra_externa",
      inputFor("infra_externa", { public_ips: 8 }).scope.infra_externa,
      QUOTE_CONFIG,
    );
    const b = computeScope(
      "infra_externa",
      inputFor("infra_externa", { public_ips: 9 }).scope.infra_externa,
      QUOTE_CONFIG,
    );
    const c = computeScope(
      "infra_externa",
      inputFor("infra_externa", { public_ips: 32 }).scope.infra_externa,
      QUOTE_CONFIG,
    );
    expect(b.subtotalHours).toBe(a.subtotalHours + 6);
    expect(c.subtotalHours).toBe(b.subtotalHours);
  });

  it("RED TEAM: la duración declarada domina el esfuerzo", () => {
    // Sin opciones de contexto, para que la diferencia sea exactamente la de la
    // duración: el retesting es un porcentaje del subtotal y crecería con él.
    const plano = { retest: false, executive_session: false };
    const dos = computeEffort(inputFor("red_team", { duration_weeks: 2 }, plano), QUOTE_CONFIG);
    const seis = computeEffort(inputFor("red_team", { duration_weeks: 6 }, plano), QUOTE_CONFIG);
    expect(seis.totalHours - dos.totalHours).toBe(4 * 32);
  });

  it("RETESTING: escala con el número de hallazgos y su severidad", () => {
    const pocos = computeScope(
      "retesting",
      inputFor("retesting", { findings: 5 }).scope.retesting,
      QUOTE_CONFIG,
    );
    const muchos = computeScope(
      "retesting",
      inputFor("retesting", { findings: 40 }).scope.retesting,
      QUOTE_CONFIG,
    );
    expect(muchos.subtotalHours - pocos.subtotalHours).toBe(35);
  });

  it("todos los servicios del catálogo producen un esfuerzo positivo y acotado", () => {
    for (const service of catalog.services) {
      const effort = computeEffort(inputFor(service.id), QUOTE_CONFIG);
      expect(effort.totalHours).toBeGreaterThanOrEqual(QUOTE_CONFIG.effort.minHours);
      expect(effort.totalHours).toBeLessThanOrEqual(QUOTE_CONFIG.effort.maxHours);
      expect(effort.minHours).toBeLessThanOrEqual(effort.totalHours);
      expect(effort.maxHours).toBeGreaterThanOrEqual(effort.totalHours);
      expect(effort.minDays).toBeGreaterThanOrEqual(1);
      expect(effort.maxDays).toBeGreaterThanOrEqual(effort.minDays);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Motor de esfuerzo agregado", () => {
  it("el retesting opcional añade horas y se omite si el único servicio ya es retesting", () => {
    const sin = computeEffort(inputFor("web", {}, { retest: false }), QUOTE_CONFIG);
    const con = computeEffort(inputFor("web", {}, { retest: true }), QUOTE_CONFIG);
    expect(con.totalHours).toBeGreaterThan(sin.totalHours);

    const retestSolo = computeEffort(inputFor("retesting", {}, { retest: true }), QUOTE_CONFIG);
    expect(retestSolo.contextBreakdown.some((c) => c.key === "retest")).toBe(false);
  });

  it("la urgencia y el horario nocturno son multiplicadores acotados", () => {
    const normal = computeEffort(inputFor("web"), QUOTE_CONFIG);
    const urgente = computeEffort(
      inputFor("web", {}, { urgency: "urgent", out_of_hours: true }),
      QUOTE_CONFIG,
    );
    expect(urgente.totalHours).toBeGreaterThan(normal.totalHours);
    expect(urgente.contextMultiplier).toBeLessThanOrEqual(QUOTE_CONFIG.effort.multiplierRange.max);
  });

  it("varios servicios suman su esfuerzo", () => {
    const web = computeEffort(inputFor("web"), QUOTE_CONFIG);
    const api = computeEffort(inputFor("api"), QUOTE_CONFIG);
    const ambos = computeEffort(
      {
        ...inputFor("web"),
        services: ["web", "api"],
        scope: { ...inputFor("web").scope, ...inputFor("api").scope },
      },
      QUOTE_CONFIG,
    );
    expect(ambos.servicesSubtotal).toBe(web.servicesSubtotal + api.servicesSubtotal);
  });

  it("etiqueta la complejidad en LOW, MEDIUM o HIGH", () => {
    const bajo = computeEffort(inputFor("retesting", { findings: 1, severities: [] }), QUOTE_CONFIG);
    const alto = computeEffort(
      inputFor("red_team", { duration_weeks: 12, objectives: 5 }),
      QUOTE_CONFIG,
    );
    expect(bajo.complexity).toBe("LOW");
    expect(alto.complexity).toBe("HIGH");
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(computeEffort(inputFor("web"), QUOTE_CONFIG).complexity);
  });
});

// ---------------------------------------------------------------------------
describe("Motor de precios", () => {
  const effort = { minHours: 40, maxHours: 55 };

  it("sin PRICING_ENABLED no hay precio, aunque haya tarifa", () => {
    const config = structuredClone(QUOTE_CONFIG);
    config.pricing.currencies.CLP.hourlyRate = 50000;
    const r = computePricing(effort, "CLP", 1, config, { PRICING_ENABLED: "false" });
    expect(r).toEqual({ available: false, reason: "disabled", currency: "CLP" });
  });

  it("con PRICING_ENABLED pero sin tarifa configurada tampoco inventa un precio", () => {
    const r = computePricing(effort, "CLP", 1, QUOTE_CONFIG, { PRICING_ENABLED: "true" });
    expect(r).toEqual({ available: false, reason: "not-configured", currency: "CLP" });
  });

  it("calcula el rango con impuesto y redondeo comercial", () => {
    const config = structuredClone(QUOTE_CONFIG);
    config.pricing.currencies.CLP.hourlyRate = 50000;
    config.pricing.currencies.CLP.minimumAmount = 0;
    const r = computePricing(effort, "CLP", 1, config, { PRICING_ENABLED: "true" });

    expect(r.available).toBe(true);
    // 40 h * 50 000 * 1,19 = 2 380 000 -> ya es múltiplo de 10 000
    expect(r.min).toBe(2380000);
    // 55 h * 50 000 * 1,19 = 3 272 500 -> redondeo arriba a 3 280 000
    expect(r.max).toBe(3280000);
    expect(r.min % config.pricing.currencies.CLP.roundTo).toBe(0);
    expect(r.taxIncluded).toBe(true);
  });

  it("el mínimo comercial se aplica después del descuento", () => {
    const config = structuredClone(QUOTE_CONFIG);
    config.pricing.currencies.USD.hourlyRate = 10;
    config.pricing.currencies.USD.minimumAmount = 5000;
    const r = computePricing({ minHours: 8, maxHours: 10 }, "USD", 3, config, {
      PRICING_ENABLED: "true",
    });
    expect(r.min).toBe(5000);
    expect(r.max).toBe(5000);
  });

  it("el descuento por varios servicios usa el tramo más alto aplicable", () => {
    expect(multiServiceDiscount(1, QUOTE_CONFIG)).toBe(0);
    expect(multiServiceDiscount(2, QUOTE_CONFIG)).toBe(0.05);
    expect(multiServiceDiscount(4, QUOTE_CONFIG)).toBe(0.08);
  });

  it("una moneda desconocida no produce precio", () => {
    const config = structuredClone(QUOTE_CONFIG);
    config.pricing.currencies.CLP.hourlyRate = 50000;
    const r = computePricing(effort, "BTC", 1, config, { PRICING_ENABLED: "true" });
    expect(r.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Normalización de la entrada", () => {
  const base = () => ({
    services: ["web"],
    scope: { web: { apps: 2, roles: 3 } },
    context: {},
    contact: { company: "ACME", name: "Ana López", email: "ANA@Ejemplo.com  " },
    currency: "CLP",
  });

  it("rellena con los valores por defecto del catálogo lo que no se responde", () => {
    const r = normalizeQuoteInput(base(), ["CLP"]);
    expect(r.ok).toBe(true);
    expect(r.data.scope.web.apps).toBe(2);
    expect(r.data.scope.web.environment).toBe("staging");
    expect(r.data.context.report_language).toBe("es");
  });

  it("normaliza el email y recorta los espacios", () => {
    const r = normalizeQuoteInput(base(), ["CLP"]);
    expect(r.data.contact.email).toBe("ana@ejemplo.com");
  });

  it("IGNORA campos no declarados: no hay mass assignment posible", () => {
    const payload = base();
    payload.estimated_hours = 1;
    payload.min_price = 1;
    payload.status = "ACCEPTED";
    payload.scope.web.campo_inventado = 999;
    payload.contact.role = "admin";

    const r = normalizeQuoteInput(payload, ["CLP"]);
    expect(r.ok).toBe(true);
    expect(r.data).not.toHaveProperty("estimated_hours");
    expect(r.data).not.toHaveProperty("status");
    expect(r.data.scope.web).not.toHaveProperty("campo_inventado");
    expect(Object.keys(r.data.contact).sort()).toEqual([
      "company", "email", "name", "notes", "phone",
    ]);
  });

  it("rechaza servicios desconocidos, repetidos, vacíos o de más", () => {
    for (const services of [[], ["inexistente"], ["web", "web"], ["web", "api", "cloud", "mobile"], "web", null]) {
      const r = normalizeQuoteInput({ ...base(), services }, ["CLP"]);
      expect(r.ok).toBe(false);
      expect(r.field).toBe("services");
    }
  });

  it("rechaza números negativos, decimales y fuera de rango", () => {
    for (const apps of [-1, 0, 1.5, 99999, "muchas", true, null === undefined]) {
      const payload = base();
      payload.scope.web.apps = apps;
      const r = normalizeQuoteInput(payload, ["CLP"]);
      expect(r.ok).toBe(false);
    }
  });

  it("rechaza tipos incorrectos en booleanos, selects y multiselects", () => {
    const casos = [
      ["waf", "sí"],
      ["environment", "produccion"],
      ["auth", 1],
      ["stack", "spa"],
      ["stack", ["spa", "spa"]],
      ["stack", ["inventada"]],
    ];
    for (const [field, value] of casos) {
      const payload = base();
      payload.scope.web[field] = value;
      const r = normalizeQuoteInput(payload, ["CLP"]);
      expect(r.ok, `${field}=${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("ordena multiselects según el catálogo, no según el orden de clic", () => {
    const a = normalizeQuoteInput(
      { ...base(), scope: { web: { stack: ["legacy", "cms"] } } },
      ["CLP"],
    );
    const b = normalizeQuoteInput(
      { ...base(), scope: { web: { stack: ["cms", "legacy"] } } },
      ["CLP"],
    );
    expect(a.data.scope.web.stack).toEqual(b.data.scope.web.stack);
  });

  it("valida los datos de contacto", () => {
    const casos = [
      ["company", ""],
      ["company", "c".repeat(101)],
      ["name", "A"],
      ["name", "12345"],
      ["email", "noesunemail"],
      ["email", "a@b.com\nBcc: x@y.z"],
      ["phone", "llámame; DROP TABLE"],
      ["notes", "n".repeat(1001)],
    ];
    for (const [field, value] of casos) {
      const payload = base();
      payload.contact[field] = value;
      const r = normalizeQuoteInput(payload, ["CLP"]);
      expect(r.ok, `${field}`).toBe(false);
    }
  });

  it("rechaza una moneda fuera de la allowlist", () => {
    expect(normalizeQuoteInput({ ...base(), currency: "BTC" }, ["CLP", "USD"]).ok).toBe(false);
    expect(normalizeQuoteInput({ ...base(), currency: "usd" }, ["CLP", "USD"]).ok).toBe(true);
  });

  it("rechaza cuerpos que no son objetos", () => {
    for (const body of [null, "texto", 42, []]) {
      expect(normalizeQuoteInput(body, ["CLP"]).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Vista pública de la cotización", () => {
  it("no expone el desglose interno ni parámetros comerciales", () => {
    const input = normalizeQuoteInput(
      {
        services: ["web"],
        scope: {},
        context: {},
        contact: { company: "ACME", name: "Ana", email: "a@b.com" },
        currency: "CLP",
      },
      ["CLP"],
    ).data;

    const quote = buildQuote(input, { PRICING_ENABLED: "true" });
    const view = publicQuoteView(quote);
    const serialized = JSON.stringify(view);

    expect(view).not.toHaveProperty("internal");
    expect(serialized).not.toMatch(/hourlyRate|multiplier|baseHours|breakdown|margin|discountRate/);
    expect(view.effort).toEqual({
      minHours: expect.any(Number),
      maxHours: expect.any(Number),
      minDays: expect.any(Number),
      maxDays: expect.any(Number),
    });
  });

  it("incluye retesting y reunión de cierre solo cuando se han pedido", () => {
    const build = (context) => {
      const data = normalizeQuoteInput(
        {
          services: ["web"],
          context,
          contact: { company: "ACME", name: "Ana", email: "a@b.com" },
          currency: "CLP",
        },
        ["CLP"],
      ).data;
      return buildQuote(data, {}).includes;
    };
    expect(build({ retest: true, executive_session: true })).toEqual(
      expect.arrayContaining(["retesting", "closing_meeting"]),
    );
    expect(build({ retest: false, executive_session: false })).not.toEqual(
      expect.arrayContaining(["retesting"]),
    );
  });
});

// ---------------------------------------------------------------------------
describe("Identificadores", () => {
  it("el identificador público son 128 bits aleatorios en hexadecimal", () => {
    const ids = new Set();
    for (let i = 0; i < 500; i++) {
      const id = generatePublicId();
      expect(id).toMatch(PUBLIC_ID_RE);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
  });

  it("el número comercial usa el formato VF-<año>-<6 dígitos>", () => {
    expect(formatQuoteNumber(2026, 42)).toBe("VF-2026-000042");
    expect(formatQuoteNumber(2026, 1234567)).toBe("VF-2026-1234567");
  });
});
