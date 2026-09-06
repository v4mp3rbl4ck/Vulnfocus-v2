import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index.js";
import { resetJwksCache } from "../worker/lib/access.js";
import {
  ACCESS_AUD,
  ACCESS_TEAM_DOMAIN,
  adminEnv,
  adminRequest,
  createAccessKeyPair,
  mockOutboundFetch,
  okSiteverify,
  quoteRequest,
  resetQuotes,
  resetStatusEvents,
  signAccessJwt,
  validQuotePayload,
} from "./helpers.js";

/**
 * API DE ADMINISTRACIÓN — mini CRM detrás de Cloudflare Access.
 *
 * Lo que estos tests protegen, por orden de gravedad:
 *
 *  1. Que la administración NO exista mientras `ADMIN_ENABLED` no sea "true", y
 *     que su ausencia sea indistinguible de una ruta inexistente (404, mismo
 *     cuerpo, mismas cabeceras). Un 401 o un 403 ya confirmarían que hay algo.
 *  2. Que con el interruptor encendido siga haciendo falta una aserción de
 *     identidad de Cloudflare Access **válida y verificada criptográficamente**.
 *     Se firman JWT reales con un par RSA generado en el test, así que la
 *     verificación que se ejercita es la de producción.
 *  3. Que los estados solo se muevan por transiciones declaradas y que cada
 *     cambio quede registrado con quién y cuándo.
 *  4. Que la administración no pueda escribir nada más: ni importes, ni horas,
 *     ni datos de contacto, ni borrar filas.
 */

let keys;

async function call(request, overrides) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, { ...env, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/** Crea una cotización real por el camino público y devuelve su public_id. */
async function seedQuote(over = {}) {
  mockOutboundFetch({ siteverify: okSiteverify() });
  const response = await call(quoteRequest(validQuotePayload(over)));
  expect(response.status).toBe(201);
  const { quote } = await response.json();
  return quote;
}

/** Entorno de administración con el JWKS del par de claves del test servido por el mock. */
function envAdmin(over = {}) {
  return adminEnv(env, over);
}

function mockAll() {
  return mockOutboundFetch({ siteverify: okSiteverify(), jwks: keys.jwks });
}

beforeAll(async () => {
  keys = await createAccessKeyPair();
});

beforeEach(async () => {
  resetJwksCache();
  await resetStatusEvents();
  await resetQuotes();
});

// ---------------------------------------------------------------------------
describe("Candado 1: el interruptor", () => {
  const PATHS = [
    "/api/admin/session",
    "/api/admin/stats",
    "/api/admin/quotes",
    `/api/admin/quotes/${"a".repeat(32)}`,
    "/admin",
  ];

  it.each(PATHS)("%s devuelve 404 sin ADMIN_ENABLED", async (path) => {
    mockAll();
    const token = await signAccessJwt(keys.privateKey);
    // Incluso con un token PERFECTAMENTE válido: el interruptor manda.
    const response = await call(adminRequest(path, { token }), envAdmin({ ADMIN_ENABLED: "false" }));
    expect(response.status).toBe(404);
  });

  it("el 404 de la administración es idéntico al de una ruta inexistente", async () => {
    mockAll();
    const admin = await call(adminRequest("/api/admin/quotes"), { ...env, ADMIN_ENABLED: "false" });
    const inexistente = await call(adminRequest("/api/no-existe"), env);

    expect(admin.status).toBe(inexistente.status);
    expect(await admin.text()).toBe(await inexistente.text());
    expect(admin.headers.get("Content-Type")).toBe(inexistente.headers.get("Content-Type"));
    expect(admin.headers.get("Cache-Control")).toBe(inexistente.headers.get("Cache-Control"));
    // Nada que sugiera que ahí hay autenticación.
    expect(admin.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("un valor distinto de \"true\" no habilita nada", async () => {
    mockAll();
    const token = await signAccessJwt(keys.privateKey);
    for (const value of ["", "1", "yes", "TRUE ", "false", "on"]) {
      const response = await call(
        adminRequest("/api/admin/session", { token }),
        envAdmin({ ADMIN_ENABLED: value }),
      );
      expect(response.status, `ADMIN_ENABLED=${JSON.stringify(value)}`).toBe(404);
    }
    // Y "true" sí, para que el test anterior signifique algo.
    const ok = await call(adminRequest("/api/admin/session", { token }), envAdmin());
    expect(ok.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("Candado 2: aserción de Cloudflare Access", () => {
  beforeEach(() => mockAll());

  it("sin JWT devuelve 404, no 401", async () => {
    const response = await call(adminRequest("/api/admin/quotes"), envAdmin());
    expect(response.status).toBe(404);
  });

  it("con JWT válido responde y expone la identidad verificada", async () => {
    const token = await signAccessJwt(keys.privateKey);
    const response = await call(adminRequest("/api/admin/session", { token }), envAdmin());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.session.email).toBe("admin@vulnfocus.com");
    expect(body.session.statuses).toContain("PROPOSAL_SENT");
  });

  it("acepta el JWT por cookie CF_Authorization", async () => {
    const token = await signAccessJwt(keys.privateKey);
    const response = await call(
      adminRequest("/api/admin/session", { headers: { Cookie: `CF_Authorization=${token}; other=1` } }),
      envAdmin(),
    );
    expect(response.status).toBe(200);
  });

  it("rechaza alg=none: la firma no es opcional", async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const b64 = (obj) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const forged = `${b64({ alg: "none", kid: "test-key-1" })}.${b64({
      iss: `https://${ACCESS_TEAM_DOMAIN}`,
      aud: [ACCESS_AUD],
      email: "atacante@example.com",
      exp: nowS + 600,
    })}.`;
    const response = await call(adminRequest("/api/admin/session", { token: forged }), envAdmin());
    expect(response.status).toBe(404);
  });

  it("rechaza un JWT firmado con otra clave", async () => {
    const otro = await createAccessKeyPair();
    const token = await signAccessJwt(otro.privateKey);
    const response = await call(adminRequest("/api/admin/session", { token }), envAdmin());
    expect(response.status).toBe(404);
  });

  it("rechaza un JWT con la firma manipulada", async () => {
    const token = await signAccessJwt(keys.privateKey);
    const parts = token.split(".");
    // Se altera el payload manteniendo la firma original.
    const tampered = `${parts[0]}.${btoa(JSON.stringify({ email: "root@example.com" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.${parts[2]}`;
    const response = await call(adminRequest("/api/admin/session", { token: tampered }), envAdmin());
    expect(response.status).toBe(404);
  });

  it.each([
    ["caducado", { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ["emitido en el futuro", { iat: Math.floor(Date.now() / 1000) + 7200, nbf: Math.floor(Date.now() / 1000) + 7200, exp: Math.floor(Date.now() / 1000) + 9000 }],
    ["otro emisor", { iss: "https://otro-equipo.cloudflareaccess.com" }],
    ["otra audiencia", { aud: ["b".repeat(64)] }],
    ["sin identidad", { email: undefined, common_name: undefined, sub: "" }],
  ])("rechaza un JWT %s", async (_label, over) => {
    const token = await signAccessJwt(keys.privateKey, over);
    const response = await call(adminRequest("/api/admin/session", { token }), envAdmin());
    expect(response.status).toBe(404);
  });

  it("acepta un token de servicio (common_name en lugar de email)", async () => {
    const token = await signAccessJwt(keys.privateKey, {
      email: undefined,
      common_name: "ci-bot.vulnfocus",
    });
    const response = await call(adminRequest("/api/admin/session", { token }), envAdmin());
    expect(response.status).toBe(200);
    expect((await response.json()).session.email).toBe("ci-bot.vulnfocus");
  });

  it("sin CF_ACCESS_TEAM_DOMAIN o sin AUD no arranca: fail closed", async () => {
    const token = await signAccessJwt(keys.privateKey);
    for (const over of [
      { CF_ACCESS_TEAM_DOMAIN: "" },
      { CF_ACCESS_AUD: "" },
      { CF_ACCESS_TEAM_DOMAIN: "evil.example.com" },
      { CF_ACCESS_AUD: "corto" },
    ]) {
      const response = await call(adminRequest("/api/admin/session", { token }), envAdmin(over));
      expect(response.status, JSON.stringify(over)).toBe(404);
    }
  });

  it("si el JWKS no responde, no se autoriza", async () => {
    mockOutboundFetch({ siteverify: okSiteverify(), jwks: "unreachable" });
    const token = await signAccessJwt(keys.privateKey);
    const response = await call(adminRequest("/api/admin/session", { token }), envAdmin());
    expect(response.status).toBe(404);
  });

  it("la allowlist propia se aplica ADEMÁS de Access", async () => {
    const token = await signAccessJwt(keys.privateKey);
    const fuera = await call(
      adminRequest("/api/admin/session", { token }),
      envAdmin({ ADMIN_ALLOWED_EMAILS: "otra@vulnfocus.com" }),
    );
    expect(fuera.status).toBe(404);

    const dentro = await call(
      adminRequest("/api/admin/session", { token }),
      envAdmin({ ADMIN_ALLOWED_EMAILS: "otra@vulnfocus.com, admin@vulnfocus.com" }),
    );
    expect(dentro.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("Listado, búsqueda y ficha", () => {
  let token;

  beforeEach(async () => {
    mockAll();
    token = await signAccessJwt(keys.privateKey);
  });

  it("lista las cotizaciones más recientes primero", async () => {
    await seedQuote({ contact: { ...validQuotePayload().contact, company: "Primera SA" } });
    await seedQuote({ contact: { ...validQuotePayload().contact, company: "Segunda SA" } });
    mockAll();

    const response = await call(adminRequest("/api/admin/quotes", { token }), envAdmin());
    expect(response.status).toBe(200);
    const { quotes, nextCursor } = await response.json();
    expect(quotes).toHaveLength(2);
    expect(quotes[0].company).toBe("Segunda SA");
    expect(quotes[0].status).toBe("NEW");
    expect(nextCursor).toBeNull();
  });

  it("pagina con cursor sin repetir ni perder filas", async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedQuote({
        contact: { ...validQuotePayload().contact, company: `Empresa ${i}` },
      });
    }
    mockAll();

    const first = await call(adminRequest("/api/admin/quotes?limit=2", { token }), envAdmin());
    const page1 = await first.json();
    expect(page1.quotes).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();

    const second = await call(
      adminRequest(`/api/admin/quotes?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, { token }),
      envAdmin(),
    );
    const page2 = await second.json();
    expect(page2.quotes).toHaveLength(2);

    const numbers = [...page1.quotes, ...page2.quotes].map((q) => q.quoteNumber);
    expect(new Set(numbers).size).toBe(4);
  });

  it("un cursor manipulado se rechaza en lugar de llegar a la consulta", async () => {
    for (const cursor of ["../../etc", "' OR 1=1--", btoa("x|y"), "a".repeat(300)]) {
      const response = await call(
        adminRequest(`/api/admin/quotes?cursor=${encodeURIComponent(cursor)}`, { token }),
        envAdmin(),
      );
      expect(response.status, cursor).toBe(400);
    }
  });

  it("filtra por estado y rechaza estados inventados", async () => {
    await seedQuote();
    mockAll();

    const nuevas = await call(adminRequest("/api/admin/quotes?status=NEW", { token }), envAdmin());
    expect((await nuevas.json()).quotes).toHaveLength(1);

    const aceptadas = await call(
      adminRequest("/api/admin/quotes?status=ACCEPTED", { token }),
      envAdmin(),
    );
    expect((await aceptadas.json()).quotes).toHaveLength(0);

    const invalido = await call(
      adminRequest("/api/admin/quotes?status=DROP+TABLE", { token }),
      envAdmin(),
    );
    expect(invalido.status).toBe(400);
  });

  it("busca por empresa, contacto, email y número", async () => {
    const quote = await seedQuote({
      contact: {
        company: "Contoso Chile SpA",
        name: "Beatriz Soto",
        email: "beatriz@contoso.cl",
        phone: "",
        notes: "",
      },
    });
    mockAll();

    for (const needle of ["contoso", "Beatriz", "beatriz@contoso.cl", quote.quoteNumber]) {
      const response = await call(
        adminRequest(`/api/admin/quotes?q=${encodeURIComponent(needle)}`, { token }),
        envAdmin(),
      );
      const body = await response.json();
      expect(body.quotes.map((q) => q.quoteNumber), needle).toContain(quote.quoteNumber);
    }
  });

  it("los comodines de LIKE no actúan como comodín", async () => {
    await seedQuote({
      contact: { ...validQuotePayload().contact, company: "Empresa Normal" },
    });
    mockAll();

    // "%" buscado literalmente NO debe devolver todas las filas.
    for (const needle of ["%", "_", "%%", "\\"]) {
      const response = await call(
        adminRequest(`/api/admin/quotes?q=${encodeURIComponent(needle)}`, { token }),
        envAdmin(),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).quotes, needle).toHaveLength(0);
    }
  });

  it("la inyección SQL clásica no devuelve filas ni rompe la consulta", async () => {
    await seedQuote();
    mockAll();

    for (const payload of ["' OR '1'='1", "'; DROP TABLE quotes;--", "\" UNION SELECT 1--"]) {
      const response = await call(
        adminRequest(`/api/admin/quotes?q=${encodeURIComponent(payload)}`, { token }),
        envAdmin(),
      );
      expect(response.status, payload).toBe(200);
      expect((await response.json()).quotes, payload).toHaveLength(0);
    }
    // La tabla sigue ahí.
    const check = await env.DB.prepare("SELECT COUNT(*) AS n FROM quotes").first();
    expect(check.n).toBe(1);
  });

  it("la ficha incluye el desglose interno y las transiciones posibles", async () => {
    const seeded = await seedQuote();
    mockAll();

    const response = await call(
      adminRequest(`/api/admin/quotes/${seeded.publicId}`, { token }),
      envAdmin(),
    );
    expect(response.status).toBe(200);
    const { quote } = await response.json();
    expect(quote.quoteNumber).toBe(seeded.quoteNumber);
    expect(quote.email).toBe("ana@ejemplo.com");
    expect(quote.breakdown.totalHours).toBeGreaterThan(0);
    expect(quote.allowedTransitions).toContain("CONTACTED");
    expect(quote.history).toEqual([]);
  });

  it("un public_id mal formado o inexistente devuelve el mismo 404", async () => {
    mockAll();
    for (const id of ["corto", "../../quotes", "z".repeat(32), "a".repeat(32)]) {
      const response = await call(
        adminRequest(`/api/admin/quotes/${encodeURIComponent(id)}`, { token }),
        envAdmin(),
      );
      expect(response.status, id).toBe(404);
    }
  });

  it("las estadísticas cuentan por estado sin exponer filas", async () => {
    await seedQuote();
    mockAll();
    const response = await call(adminRequest("/api/admin/stats", { token }), envAdmin());
    const { stats } = await response.json();
    expect(stats.total).toBe(1);
    expect(stats.byStatus.NEW).toBe(1);
    expect(stats.byStatus.ACCEPTED).toBe(0);
    expect(JSON.stringify(stats)).not.toContain("ejemplo.com");
  });

  it("los métodos de escritura no están permitidos en las rutas de lectura", async () => {
    mockAll();
    for (const [path, method] of [
      ["/api/admin/quotes", "DELETE"],
      ["/api/admin/quotes", "POST"],
      ["/api/admin/stats", "PATCH"],
      ["/api/admin/session", "PUT"],
    ]) {
      const response = await call(adminRequest(path, { token, method }), envAdmin());
      expect(response.status, `${method} ${path}`).toBe(405);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Ciclo de vida: transiciones de estado", () => {
  let token;

  beforeEach(async () => {
    mockAll();
    token = await signAccessJwt(keys.privateKey);
  });

  async function transition(publicId, body, over = {}) {
    return call(
      adminRequest(`/api/admin/quotes/${publicId}/status`, { token, method: "PATCH", body }),
      envAdmin(over),
    );
  }

  it("NEW → CONTACTED → PROPOSAL_SENT → ACCEPTED", async () => {
    const seeded = await seedQuote();
    mockAll();

    for (const status of ["CONTACTED", "PROPOSAL_SENT", "ACCEPTED"]) {
      const response = await transition(seeded.publicId, { status });
      expect(response.status, status).toBe(200);
      expect((await response.json()).quote.status).toBe(status);
    }

    const row = await env.DB.prepare("SELECT status, updated_at, created_at FROM quotes WHERE public_id = ?")
      .bind(seeded.publicId)
      .first();
    expect(row.status).toBe("ACCEPTED");
    expect(row.updated_at >= row.created_at).toBe(true);
  });

  it("cada transición deja un evento de auditoría con actor y sentido", async () => {
    const seeded = await seedQuote();
    mockAll();
    await transition(seeded.publicId, { status: "CONTACTED", note: "Llamada inicial" });

    const { results } = await env.DB.prepare(
      "SELECT from_status, to_status, actor_email, note FROM quote_status_events",
    ).all();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      from_status: "NEW",
      to_status: "CONTACTED",
      actor_email: "admin@vulnfocus.com",
      note: "Llamada inicial",
    });
  });

  it("un estado terminal no admite más cambios", async () => {
    const seeded = await seedQuote();
    mockAll();
    await transition(seeded.publicId, { status: "REJECTED" });

    const response = await transition(seeded.publicId, { status: "CONTACTED" });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.reason).toBe("terminal-status");
    expect(body.allowed).toEqual([]);

    const row = await env.DB.prepare("SELECT status FROM quotes WHERE public_id = ?")
      .bind(seeded.publicId)
      .first();
    expect(row.status).toBe("REJECTED");
  });

  it("rechaza saltos no declarados y estados inventados", async () => {
    const seeded = await seedQuote();
    mockAll();

    // NEW no puede ir directo a ACCEPTED: hace falta propuesta enviada.
    const salto = await transition(seeded.publicId, { status: "ACCEPTED" });
    expect(salto.status).toBe(409);
    expect((await salto.json()).reason).toBe("transition-not-allowed");

    for (const status of ["WON", "new", "", null, 42, { status: "NEW" }]) {
      const response = await transition(seeded.publicId, { status });
      expect(response.status, JSON.stringify(status)).toBe(409);
    }

    const row = await env.DB.prepare("SELECT status FROM quotes WHERE public_id = ?")
      .bind(seeded.publicId)
      .first();
    expect(row.status).toBe("NEW");
  });

  it("quedarse en el mismo estado no es una transición", async () => {
    const seeded = await seedQuote();
    mockAll();
    const response = await transition(seeded.publicId, { status: "NEW" });
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe("same-status");
    const events = await env.DB.prepare("SELECT COUNT(*) AS n FROM quote_status_events").first();
    expect(events.n).toBe(0);
  });

  it("EXPIRED puede retomarse como CONTACTED", async () => {
    const seeded = await seedQuote();
    mockAll();
    expect((await transition(seeded.publicId, { status: "EXPIRED" })).status).toBe(200);
    expect((await transition(seeded.publicId, { status: "CONTACTED" })).status).toBe(200);
  });

  it("la transición NO puede cambiar nada más que el estado", async () => {
    const seeded = await seedQuote();
    const before = await env.DB.prepare("SELECT * FROM quotes WHERE public_id = ?")
      .bind(seeded.publicId)
      .first();
    mockAll();

    await transition(seeded.publicId, {
      status: "CONTACTED",
      // Intento de asignación masiva desde el panel.
      min_price: 1,
      max_price: 999999,
      estimated_hours: 1,
      min_hours: 1,
      max_hours: 1,
      complexity: "LOW",
      company: "Otra empresa",
      email: "atacante@example.com",
      quote_number: "VF-1999-000001",
      public_id: "f".repeat(32),
      currency: "USD",
      breakdown_json: "{}",
    });

    const after = await env.DB.prepare("SELECT * FROM quotes WHERE public_id = ?")
      .bind(seeded.publicId)
      .first();

    expect(after.status).toBe("CONTACTED");
    for (const column of Object.keys(before)) {
      if (column === "status" || column === "updated_at") continue;
      expect(after[column], `columna ${column}`).toEqual(before[column]);
    }
  });

  it("no existe ninguna ruta administrativa que borre una cotización", async () => {
    const seeded = await seedQuote();
    mockAll();
    for (const path of [
      `/api/admin/quotes/${seeded.publicId}`,
      `/api/admin/quotes/${seeded.publicId}/delete`,
      "/api/admin/quotes/purge",
    ]) {
      const response = await call(
        adminRequest(path, { token, method: "DELETE" }),
        envAdmin(),
      );
      expect([404, 405]).toContain(response.status);
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM quotes").first()).n).toBe(1);
  });

  it("el cuerpo debe ser JSON y de tamaño acotado", async () => {
    const seeded = await seedQuote();
    mockAll();

    const texto = await call(
      adminRequest(`/api/admin/quotes/${seeded.publicId}/status`, {
        token,
        method: "PATCH",
        body: "status=CONTACTED",
        headers: { "Content-Type": "text/plain" },
      }),
      envAdmin(),
    );
    expect(texto.status).toBe(415);

    const enorme = await call(
      adminRequest(`/api/admin/quotes/${seeded.publicId}/status`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ status: "CONTACTED", note: "x".repeat(6000) }),
      }),
      envAdmin(),
    );
    expect(enorme.status).toBe(413);
  });

  it("la nota se recorta y no se devuelve en ninguna ruta pública", async () => {
    const seeded = await seedQuote();
    mockAll();
    await transition(seeded.publicId, { status: "CONTACTED", note: "n".repeat(900) });

    const event = await env.DB.prepare("SELECT note FROM quote_status_events").first();
    expect(event.note.length).toBe(500);

    const publica = await call(
      new Request(`https://vulnfocus.com/api/quotes/${seeded.publicId}`, {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
      env,
    );
    const text = await publica.text();
    expect(text).not.toContain("nnnn");
    expect(text).not.toContain("admin@vulnfocus.com");
  });
});

// ---------------------------------------------------------------------------
describe("Panel HTML", () => {
  it("se sirve con CSP por nonce y sin indexar", async () => {
    mockAll();
    const token = await signAccessJwt(keys.privateKey);
    const response = await call(adminRequest("/admin", { token }), envAdmin());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toMatch(/script-src 'nonce-[0-9a-f]{32}'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("default-src 'none'");
  });

  it("el nonce cambia en cada respuesta", async () => {
    mockAll();
    const token = await signAccessJwt(keys.privateKey);
    const a = await call(adminRequest("/admin", { token }), envAdmin());
    const b = await call(adminRequest("/admin", { token }), envAdmin());
    const nonce = (res) => /nonce-([0-9a-f]{32})/.exec(res.headers.get("Content-Security-Policy"))[1];
    expect(nonce(a)).not.toBe(nonce(b));
  });

  it("el panel no contiene datos de clientes ni configuración del motor", async () => {
    mockAll();
    const token = await signAccessJwt(keys.privateKey);
    const html = await (await call(adminRequest("/admin", { token }), envAdmin())).text();
    expect(html).not.toMatch(/hourlyRate|minimumAmount|TURNSTILE_SECRET|TELEGRAM_BOT_TOKEN/);
    // La página se rellena por API; no trae filas incrustadas.
    expect(html).not.toContain("ana@ejemplo.com");
  });
});
