import { env } from "cloudflare:test";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.js";
import {
  contactRequest,
  countRows,
  mockOutboundFetch,
  okSiteverify,
  resetDb,
  validPayload,
} from "./helpers.js";

/** Ejecuta el Worker y espera a que terminen los ctx.waitUntil() pendientes. */
async function call(request) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await resetDb();
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
describe("Métodos HTTP y superficie de API", () => {
  const url = "https://vulnfocus.com/api/contact";

  it.each(["GET", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])(
    "%s /api/contact -> 405 con cabecera Allow",
    async (method) => {
      const res = await call(new Request(url, { method }));
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    },
  );

  it("GET /api/health -> 200 sin datos internos", async () => {
    const res = await call(new Request("https://vulnfocus.com/api/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it.each([
    "/api/contacts",
    "/api/contacts/stats",
    "/api/logs",
    "/api/logs/stats",
    "/api/status",
    "/api/",
    "/api/admin",
  ])("endpoint legacy %s -> 404 (deny by default)", async (path) => {
    const res = await call(new Request(`https://vulnfocus.com${path}`));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ status: "error", message: "Recurso no encontrado" });
  });
});

// ---------------------------------------------------------------------------
describe("Content-Type y tamaño del cuerpo", () => {
  it("Content-Type incorrecto -> 415", async () => {
    const res = await call(
      contactRequest(validPayload(), { "Content-Type": "text/plain" }),
    );
    expect(res.status).toBe(415);
  });

  it("acepta application/json con charset", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(
      contactRequest(validPayload(), { "Content-Type": "application/json; charset=utf-8" }),
    );
    expect(res.status).toBe(201);
  });

  it("JSON malformado -> 400", async () => {
    const res = await call(contactRequest("{no-es-json"));
    expect(res.status).toBe(400);
  });

  it("cuerpo mayor de 16 KB -> 413", async () => {
    const res = await call(contactRequest({ message: "a".repeat(20000) }));
    expect(res.status).toBe(413);
  });
});

// ---------------------------------------------------------------------------
describe("Validación de campos", () => {
  beforeEach(() => mockOutboundFetch({ siteverify: okSiteverify() }));

  const casos = [
    ["nombre de 1 carácter", { name: "A" }],
    ["nombre de más de 100", { name: "A".repeat(101) }],
    ["nombre sin ninguna letra", { name: "12345" }],
    ["email sin arroba", { email: "noesunemail" }],
    ["email sin TLD", { email: "ana@ejemplo" }],
    ["email con salto de línea (inyección de cabeceras)", { email: "a@b.com\nBcc: x@y.z" }],
    ["email de más de 254", { email: `${"a".repeat(250)}@ejemplo.com` }],
    ["mensaje de menos de 10", { message: "corto" }],
    ["mensaje de más de 5000", { message: "m".repeat(5001) }],
    ["company de más de 100", { company: "c".repeat(101) }],
    ["campos ausentes", {}],
  ];

  it.each(casos)("%s -> 400", async (_desc, over) => {
    const payload = _desc === "campos ausentes"
      ? { turnstileToken: "0.token-de-prueba" }
      : validPayload(over);
    const res = await call(contactRequest(payload));
    expect(res.status).toBe(400);
    expect(await countRows()).toBe(0);
  });

  it("el mensaje de error no revela qué campo falló", async () => {
    const res = await call(contactRequest(validPayload({ email: "malo" })));
    const body = await res.json();
    expect(body.message).toBe("Revisa los datos del formulario e inténtalo de nuevo");
    expect(JSON.stringify(body)).not.toMatch(/email|campo|field/i);
  });

  it("acepta 5000 caracteres exactos (límite inclusivo)", async () => {
    const res = await call(contactRequest(validPayload({ message: "m".repeat(5000) })));
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe("Honeypot", () => {
  it("devuelve un 201 indistinguible, sin escribir D1 ni llamar a Turnstile/Telegram", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });

    const res = await call(
      contactRequest(validPayload({ website: "http://spam.tld" })),
    );

    // 1) Respuesta indistinguible de un envío correcto
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.message).toBe("Mensaje recibido correctamente");
    expect(body.submission_id).toMatch(/^[0-9a-f-]{36}$/);

    // 2) No escribe en D1
    expect(await countRows()).toBe(0);

    // 3) No invoca Telegram
    expect(calls.telegram).toHaveLength(0);

    // 4) No gasta una verificación de Turnstile
    expect(calls.siteverify).toHaveLength(0);
  });

  it("el submission_id devuelto no corresponde a ninguna fila real", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(contactRequest(validPayload({ website: "x" })));
    const { submission_id } = await res.json();
    const row = await env.DB.prepare("SELECT id FROM contact_submissions WHERE id = ?")
      .bind(submission_id)
      .first();
    expect(row).toBeNull();
  });

  it("un honeypot con solo espacios NO se considera relleno", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(contactRequest(validPayload({ website: "   " })));
    expect(res.status).toBe(201);
    expect(await countRows()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Turnstile en el endpoint", () => {
  it("sin token -> 403 y sin escribir en D1", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const p = validPayload();
    delete p.turnstileToken;
    const res = await call(contactRequest(p));
    expect(res.status).toBe(403);
    expect(await countRows()).toBe(0);
  });

  it("token inválido -> 403", async () => {
    mockOutboundFetch({
      siteverify: { success: false, "error-codes": ["invalid-input-response"] },
    });
    const res = await call(contactRequest(validPayload()));
    expect(res.status).toBe(403);
    expect(await countRows()).toBe(0);
  });

  it("hostname distinto -> 403", async () => {
    mockOutboundFetch({ siteverify: okSiteverify("atacante.tld") });
    const res = await call(contactRequest(validPayload()));
    expect(res.status).toBe(403);
    expect(await countRows()).toBe(0);
  });

  it("Siteverify caído -> 403 (fail closed), no 201", async () => {
    mockOutboundFetch({ siteverify: new Error("network down") });
    const res = await call(contactRequest(validPayload()));
    expect(res.status).toBe(403);
    expect(await countRows()).toBe(0);
  });

  it("acepta también el nombre de campo nativo cf-turnstile-response", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const p = validPayload();
    delete p.turnstileToken;
    p["cf-turnstile-response"] = "0.token-nativo";
    const res = await call(contactRequest(p));
    expect(res.status).toBe(201);
  });

  it("la respuesta de error no filtra el error-code interno de Turnstile", async () => {
    mockOutboundFetch({
      siteverify: { success: false, "error-codes": ["invalid-input-secret"] },
    });
    const res = await call(contactRequest(validPayload()));
    expect(await res.text()).not.toMatch(/invalid-input-secret/);
  });
});

// ---------------------------------------------------------------------------
describe("Camino feliz end-to-end (D1 real, Turnstile y Telegram mockeados)", () => {
  it("201 + fila en D1 con todos los campos correctos + notificación Telegram", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    const antes = Date.now();

    const res = await call(
      contactRequest(validPayload(), {
        "CF-Connecting-IP": "203.0.113.10",
        "User-Agent": "Mozilla/5.0 (suite de tests)",
      }),
    );

    // --- Respuesta -----------------------------------------------------------
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.submission_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    // No se filtra nada interno de D1
    expect(Object.keys(body).sort()).toEqual(["message", "status", "submission_id"]);

    // --- D1: exactamente una fila -------------------------------------------
    expect(await countRows()).toBe(1);
    const row = await env.DB.prepare("SELECT * FROM contact_submissions").first();

    expect(row.id).toBe(body.submission_id);
    expect(row.name).toBe("Ana López");
    expect(row.email).toBe("ana@ejemplo.com");
    expect(row.company).toBe("ACME S.A.");
    expect(row.message).toBe(
      "Quisiera cotizar un pentest web para nuestra API de producción.",
    );
    expect(row.status).toBe("new");
    expect(row.user_agent).toBe("Mozilla/5.0 (suite de tests)");
    // STORE_IP = "false" en wrangler.jsonc -> minimización de PII
    expect(row.ip_address).toBeNull();

    // created_at: ISO 8601 UTC y coherente con el momento del envío
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const t = Date.parse(row.created_at);
    expect(t).toBeGreaterThanOrEqual(antes - 1000);
    expect(t).toBeLessThanOrEqual(Date.now() + 1000);

    // --- Telegram ------------------------------------------------------------
    expect(calls.telegram).toHaveLength(1);
    const tg = calls.telegram[0];
    expect(tg.url).toBe(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    );
    expect(tg.body.chat_id).toBe(env.TELEGRAM_CHAT_ID);
    expect(tg.body.text).toContain("Nuevo contacto VulnFocus");
    expect(tg.body.text).toContain("Nombre: Ana López");
    expect(tg.body.text).toContain("Email: ana@ejemplo.com");
    expect(tg.body.text).toContain("Empresa: ACME S.A.");
    expect(tg.body.text).toContain(row.id);
    // Sin parse_mode: no hay superficie de inyección Markdown/HTML
    expect(tg.body).not.toHaveProperty("parse_mode");
  });

  it("normaliza email a minúsculas y recorta espacios", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    await call(
      contactRequest(
        validPayload({ name: "  Ana López  ", email: "  Ana@EJEMPLO.com  " }),
      ),
    );
    const row = await env.DB.prepare("SELECT * FROM contact_submissions").first();
    expect(row.email).toBe("ana@ejemplo.com");
    expect(row.name).toBe("Ana López");
  });

  it("company vacía se guarda como NULL, no como cadena vacía", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    await call(contactRequest(validPayload({ company: "" })));
    const row = await env.DB.prepare("SELECT * FROM contact_submissions").first();
    expect(row.company).toBeNull();
  });

  it("guarda la IP cuando STORE_IP = 'true'", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const ctx = createExecutionContext();
    await worker.fetch(
      contactRequest(validPayload(), { "CF-Connecting-IP": "203.0.113.10" }),
      { ...env, STORE_IP: "true" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const row = await env.DB.prepare("SELECT * FROM contact_submissions").first();
    expect(row.ip_address).toBe("203.0.113.10");
  });

  it("trunca el User-Agent a 256 caracteres", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    await call(contactRequest(validPayload(), { "User-Agent": "U".repeat(500) }));
    const row = await env.DB.prepare("SELECT * FROM contact_submissions").first();
    expect(row.user_agent).toHaveLength(256);
  });

  it("almacena literalmente payloads tipo SQLi sin alterar la base (prepared statements)", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const evil = "'); DROP TABLE contact_submissions;-- y más texto para pasar el mínimo";
    await call(contactRequest(validPayload({ message: evil })));

    const row = await env.DB.prepare("SELECT * FROM contact_submissions").first();
    expect(row.message).toBe(evil);
    // La tabla sigue existiendo y con una única fila
    expect(await countRows()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Atomicidad lógica: D1 vs Telegram", () => {
  it("si D1 falla NO se devuelve 201 y no se notifica a Telegram", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });

    // Se simula un fallo de D1 sustituyendo el binding solo en esta llamada.
    const brokenEnv = {
      ...env,
      DB: {
        prepare() {
          return {
            bind() {
              return {
                run() {
                  throw new Error("D1_ERROR: no such table: contact_submissions");
                },
              };
            },
          };
        },
      },
    };

    const ctx = createExecutionContext();
    const res = await worker.fetch(contactRequest(validPayload()), brokenEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe("No fue posible enviar el mensaje");
    // El error interno de D1 no se filtra al cliente
    expect(JSON.stringify(body)).not.toMatch(/D1_ERROR|no such table|contact_submissions/);
    expect(calls.telegram).toHaveLength(0);
  });

  it("si Telegram falla el contacto permanece en D1 y el usuario recibe 201", async () => {
    mockOutboundFetch({ siteverify: okSiteverify(), telegramStatus: 500 });

    const res = await call(contactRequest(validPayload()));

    expect(res.status).toBe(201);
    expect(await countRows()).toBe(1);
  });

  it("si Telegram no está configurado el envío sigue siendo 201", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      contactRequest(validPayload()),
      { ...env, TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(201);
    expect(await countRows()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Cabeceras de las respuestas del Worker", () => {
  const esperadas = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  it("201 lleva no-store y el resto de cabeceras", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(contactRequest(validPayload()));
    expect(res.status).toBe(201);
    for (const [k, v] of Object.entries(esperadas)) expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("ninguna respuesta de error es cacheable", async () => {
    mockOutboundFetch({ siteverify: { success: false, "error-codes": ["invalid-input-response"] } });

    const respuestas = [
      await call(new Request("https://vulnfocus.com/api/contact")), // 405
      await call(new Request("https://vulnfocus.com/api/logs")), // 404
      await call(contactRequest("{malo")), // 400
      await call(contactRequest(validPayload(), { "Content-Type": "text/plain" })), // 415
      await call(contactRequest({ message: "a".repeat(20000) })), // 413
      await call(contactRequest(validPayload())), // 403
    ];

    for (const r of respuestas) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("no expone cabeceras CORS (la API es same-origin)", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });
    const res = await call(contactRequest(validPayload()));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("Carga: 100 envíos consecutivos", () => {
  it("inserta 100 filas con UUID únicos y sin errores", async () => {
    mockOutboundFetch({ siteverify: okSiteverify() });

    const ids = [];
    for (let i = 0; i < 100; i++) {
      const res = await call(
        contactRequest(
          validPayload({
            email: `usuario${i}@ejemplo.com`,
            message: `Mensaje de prueba de carga número ${i} con longitud suficiente.`,
          }),
        ),
      );
      expect(res.status).toBe(201);
      ids.push((await res.json()).submission_id);
    }

    expect(await countRows()).toBe(100);
    expect(new Set(ids).size).toBe(100);

    const { results } = await env.DB.prepare(
      "SELECT id, created_at FROM contact_submissions ORDER BY created_at",
    ).all();
    expect(results).toHaveLength(100);
    for (const r of results) {
      expect(r.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });
});
