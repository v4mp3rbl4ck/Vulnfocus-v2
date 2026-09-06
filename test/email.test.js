import { describe, expect, it, vi } from "vitest";
import {
  ESTIMATE_DISCLAIMER,
  contactConfirmation,
  internalQuoteAlert,
  quoteConfirmation,
} from "../worker/integrations/email/templates.js";
import { createEmailAdapter } from "../worker/integrations/email/index.js";
import { createNullEmailAdapter } from "../worker/integrations/email/null.js";
import { createResendAdapter } from "../worker/integrations/email/resend.js";
import { createNotificationService } from "../worker/integrations/notifications.js";
import { createCrmAdapter } from "../worker/integrations/crm/index.js";
import { createSysReptorAdapter } from "../worker/integrations/sysreptor.js";

/**
 * CORREO Y NOTIFICACIONES.
 *
 * Lo que se protege aquí:
 *
 *  1. Que el acuse al cliente NO insinúe un precio cuando el motor no lo calculó.
 *     Es la regla comercial más fácil de romper por accidente al editar una
 *     plantilla, y la que peor sienta a un cliente.
 *  2. Que nada de lo que escribió el usuario llegue sin escapar al HTML.
 *  3. Que ningún canal pueda lanzar: se invocan desde ctx.waitUntil() y su fallo
 *     no puede perder una cotización ya guardada en D1.
 *  4. Que sin proveedor configurado no se haga NINGUNA petición de red.
 */

const QUOTE = {
  quoteNumber: "VF-2026-000042",
  publicId: "b".repeat(32),
  company: "Contoso Chile SpA",
  contactName: "Beatriz Soto",
  email: "beatriz@contoso.cl",
  phone: "+56 9 1234 5678",
  services: ["web", "api"],
  complexity: "MEDIUM",
  estimatedHours: 72,
  minHours: 65,
  maxHours: 87,
  minDays: 9,
  maxDays: 11,
  pricing: { available: false },
  createdAt: "2026-09-06T12:00:00.000Z",
};

const withPrice = {
  ...QUOTE,
  pricing: {
    available: true,
    currency: "CLP",
    min: 3200000,
    max: 4100000,
    taxIncluded: true,
    taxLabel: "IVA",
  },
};

// ---------------------------------------------------------------------------
describe("Acuse al cliente", () => {
  it("el asunto lleva el formato acordado", () => {
    const mail = quoteConfirmation(QUOTE);
    expect(mail.subject).toBe("Solicitud recibida — VulnFocus VF-2026-000042");
    expect(mail.to).toBe("beatriz@contoso.cl");
    expect(mail.kind).toBe("quote_confirmation");
  });

  it("incluye número, servicios, complejidad y duración", () => {
    const mail = quoteConfirmation(QUOTE);
    for (const fragment of [
      "VF-2026-000042",
      "Pentesting Web",
      "Pentesting de API",
      "Media",
      "9–11 días hábiles",
      "65–87 h",
    ]) {
      expect(mail.text, fragment).toContain(fragment);
      expect(mail.html, fragment).toContain(fragment);
    }
  });

  it("usa nombres del catálogo, no identificadores internos", () => {
    const mail = quoteConfirmation(QUOTE);
    expect(mail.text).not.toMatch(/Servicios solicitados: web/);
    expect(mail.text).not.toContain("infra_externa");
  });

  it("SIN precio no menciona ninguna cifra económica", () => {
    const mail = quoteConfirmation(QUOTE);
    expect(mail.text).not.toContain("Estimación económica");
    expect(mail.html).not.toContain("Estimación económica");
    // Tampoco un hueco que dé a entender que había un precio.
    expect(mail.text).not.toMatch(/CLP|USD|\$/);
    // Y explica cuándo llegará la propuesta económica.
    expect(mail.text).toContain("propuesta económica");
  });

  it("CON precio muestra el rango y el impuesto", () => {
    const mail = quoteConfirmation(withPrice);
    expect(mail.text).toContain("3.200.000 – 4.100.000 CLP");
    expect(mail.text).toContain("IVA incluido");
    expect(mail.text).toContain("precio definitivo");
  });

  it("lleva el aviso de estimación referencial", () => {
    expect(ESTIMATE_DISCLAIMER).toBe(
      "Estimación referencial sujeta a validación final del alcance.",
    );
    expect(quoteConfirmation(QUOTE).text).toContain(ESTIMATE_DISCLAIMER);
    expect(quoteConfirmation(QUOTE).html).toContain(ESTIMATE_DISCLAIMER);
  });

  it("incluye el enlace de consulta solo si se le pasa", () => {
    expect(quoteConfirmation(QUOTE).text).not.toContain("http");
    const conEnlace = quoteConfirmation(QUOTE, {
      estimate: "https://vulnfocus.com/estimacion?id=abc",
    });
    expect(conEnlace.text).toContain("https://vulnfocus.com/estimacion?id=abc");
    expect(conEnlace.html).toContain('href="https://vulnfocus.com/estimacion?id=abc"');
  });

  it("NO incluye alcance declarado, notas ni desglose interno", () => {
    const mail = quoteConfirmation({ ...QUOTE, notes: "IP internas 10.0.0.0/8" });
    const todo = `${mail.text}${mail.html}`;
    for (const leak of ["10.0.0.0", "breakdown", "baseHours", "multiplier", "hourlyRate"]) {
      expect(todo, leak).not.toContain(leak);
    }
  });

  it("escapa lo que escribió el usuario antes de meterlo en el HTML", () => {
    const mail = quoteConfirmation({
      ...QUOTE,
      contactName: '<script>alert(1)</script>',
      company: '"><img src=x onerror=alert(1)>',
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

// ---------------------------------------------------------------------------
describe("Aviso interno", () => {
  it("lleva la cabecera y los campos comerciales", () => {
    const mail = internalQuoteAlert(QUOTE, "comercial@vulnfocus.com");
    expect(mail.to).toBe("comercial@vulnfocus.com");
    expect(mail.subject).toBe("Nueva oportunidad VF-2026-000042 — Contoso Chile SpA");
    expect(mail.text.startsWith("NUEVA OPORTUNIDAD")).toBe(true);

    for (const fragment of [
      "VF-2026-000042",
      "Empresa: Contoso Chile SpA",
      "Contacto: Beatriz Soto",
      "Email: beatriz@contoso.cl",
      "Teléfono: +56 9 1234 5678",
      "Complejidad: Media",
      "Horas estimadas: 72",
      "Fecha: 2026-09-06T12:00:00.000Z",
    ]) {
      expect(mail.text, fragment).toContain(fragment);
    }
  });

  it("dice explícitamente que no hay tarifa cuando no la hay", () => {
    expect(internalQuoteAlert(QUOTE, "x@y.cl").text).toContain(
      "Rango comercial: (sin precio: tarifa no configurada)",
    );
    expect(internalQuoteAlert(withPrice, "x@y.cl").text).toContain(
      "Rango comercial: 3.200.000 – 4.100.000 CLP",
    );
  });

  it("marca el teléfono ausente en lugar de dejar el campo vacío", () => {
    expect(internalQuoteAlert({ ...QUOTE, phone: null }, "x@y.cl").text).toContain(
      "Teléfono: (no indicado)",
    );
  });

  it("escapa la entrada del usuario en el HTML", () => {
    const mail = internalQuoteAlert({ ...QUOTE, company: "<b>ACME</b>" }, "x@y.cl");
    expect(mail.html).toContain("&lt;b&gt;ACME&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>ACME</b>");
  });
});

// ---------------------------------------------------------------------------
describe("Acuse de contacto", () => {
  it("no promete plazos ni incluye datos del mensaje", () => {
    const mail = contactConfirmation({
      name: "Ana López",
      email: "ana@ejemplo.com",
      message: "Tenemos un WAF de Fortinet en la DMZ",
    });
    expect(mail.subject).toBe("Hemos recibido tu mensaje — VulnFocus");
    expect(mail.text).not.toContain("Fortinet");
    expect(mail.html).not.toContain("Fortinet");
  });
});

// ---------------------------------------------------------------------------
describe("Selección de adaptador", () => {
  it("por defecto es el inerte y no hace red", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createEmailAdapter({});
    expect(adapter.name).toBe("null");
    expect(adapter.configured).toBe(false);
    const result = await adapter.send(quoteConfirmation(QUOTE));
    expect(result).toEqual({ ok: false, reason: "provider-null" });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("un proveedor desconocido cae en el inerte, no revienta", () => {
    for (const provider of ["sendgrid", "postmark", "SMTP", "resend-v2", " "]) {
      expect(createEmailAdapter({ EMAIL_PROVIDER: provider }).name).toBe("null");
    }
  });

  it("resend se selecciona por configuración y es case-insensitive", () => {
    expect(createEmailAdapter({ EMAIL_PROVIDER: "resend" }).name).toBe("resend");
    expect(createEmailAdapter({ EMAIL_PROVIDER: "RESEND" }).name).toBe("resend");
    expect(createEmailAdapter({ EMAIL_PROVIDER: "mailchannels" }).name).toBe("mailchannels");
  });

  it("resend sin clave o sin remitente no envía y no falla", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    for (const env of [
      { EMAIL_PROVIDER: "resend" },
      { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "clave" },
      { EMAIL_PROVIDER: "resend", EMAIL_FROM: "no-reply@vulnfocus.com" },
    ]) {
      const adapter = createResendAdapter(env);
      expect(adapter.configured).toBe(false);
      expect(await adapter.send(quoteConfirmation(QUOTE))).toEqual({
        ok: false,
        reason: "not-configured",
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("resend configurado envía texto y HTML, con la clave solo en la cabecera", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push({ url, init });
        return new Response("{}", { status: 200 });
      }),
    );

    const adapter = createResendAdapter({
      RESEND_API_KEY: "clave-de-prueba",
      EMAIL_FROM: "VulnFocus <no-reply@vulnfocus.com>",
    });
    expect(adapter.configured).toBe(true);
    expect(await adapter.send(quoteConfirmation(QUOTE))).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(calls[0].init.body);
    expect(body.from).toBe("VulnFocus <no-reply@vulnfocus.com>");
    expect(body.to).toEqual(["beatriz@contoso.cl"]);
    expect(body.text).toBeTruthy();
    expect(body.html).toBeTruthy();
    // La clave NUNCA en el cuerpo.
    expect(calls[0].init.body).not.toContain("clave-de-prueba");
    expect(calls[0].init.headers.Authorization).toBe("Bearer clave-de-prueba");
    vi.unstubAllGlobals();
  });

  it("un 4xx o una caída de red del proveedor no lanzan", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 422 })));
    const adapter = createResendAdapter({ RESEND_API_KEY: "k", EMAIL_FROM: "a@b.cl" });
    expect(await adapter.send(quoteConfirmation(QUOTE))).toEqual({ ok: false, reason: "http-422" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    expect(await adapter.send(quoteConfirmation(QUOTE))).toEqual({
      ok: false,
      reason: "network-error",
    });
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
describe("NotificationService: los canales están aislados", () => {
  it("un canal que lanza no impide a los demás", async () => {
    const telegram = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("api.telegram.org")) {
          telegram.push(url);
          return new Response("{}", { status: 200 });
        }
        throw new Error("proveedor de correo caído");
      }),
    );

    const service = createNotificationService({
      TELEGRAM_BOT_TOKEN: "000:token-de-prueba",
      TELEGRAM_CHAT_ID: "-100123",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "k",
      EMAIL_FROM: "a@vulnfocus.com",
      EMAIL_INTERNAL_TO: "comercial@vulnfocus.com",
    });

    const result = await service.quoteCreated(QUOTE, { estimate: "https://vulnfocus.com/e?id=x" });
    expect(telegram).toHaveLength(1);
    expect(result.telegram.ok).toBe(true);
    expect(result.clientEmail.ok).toBe(false);
    expect(result.internalEmail.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it("sin EMAIL_INTERNAL_TO el aviso interno se omite de forma explícita", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const service = createNotificationService({ EMAIL_PROVIDER: "null" });
    const result = await service.quoteCreated(QUOTE);
    expect(result.internalEmail).toEqual({
      ok: false,
      reason: "internal-recipient-not-configured",
    });
    vi.unstubAllGlobals();
  });

  it("sin nada configurado no se lanza ninguna excepción ni ninguna petición", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const service = createNotificationService({});
    await expect(service.quoteCreated(QUOTE)).resolves.toBeTruthy();
    await expect(
      service.contactReceived({ id: "x", name: "Ana", email: "a@b.cl", message: "hola" }),
    ).resolves.toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
describe("CRM y SysReptor siguen deshabilitados y son inertes", () => {
  it("el CRM por defecto solo registra", async () => {
    const crm = createCrmAdapter({});
    expect(crm.name).toBe("null");
    expect(crm.configured).toBe(false);
    for (const action of ["createLead", "updateLead", "markWon", "markLost"]) {
      await expect(crm[action]({ quoteNumber: "VF-2026-000001" })).resolves.toEqual({
        ok: false,
        reason: "provider-null",
      });
    }
  });

  it("un CRM no implementado cae en el inerte en lugar de fallar", () => {
    for (const provider of ["hubspot", "zoho", "odoo", "pipedrive"]) {
      expect(createCrmAdapter({ CRM_PROVIDER: provider }).name).toBe("null");
    }
  });

  it("SysReptor está deshabilitado y no hace red ni con el flag activo", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const off = createSysReptorAdapter({});
    expect(off.enabled).toBe(false);
    expect(await off.createProjectFromQuote({ quote_number: "VF-2026-000001" })).toEqual({
      ok: false,
      reason: "disabled",
    });

    // Con el flag activo devuelve el borrador para crearlo a mano, sin inventar
    // llamadas a una API que no se ha verificado.
    const on = createSysReptorAdapter({ SYSREPTOR_ENABLED: "true" });
    const result = await on.createProjectFromQuote({
      quote_number: "VF-2026-000002",
      company: "Contoso",
      services_json: '["web"]',
      scope_json: "{}",
      estimated_hours: 40,
      created_at: "2026-09-06T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not-implemented");
    expect(result.draft.reference).toBe("VF-2026-000002");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
