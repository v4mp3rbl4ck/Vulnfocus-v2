import { afterEach, describe, expect, it, vi } from "vitest";
import estimateResult from "../frontend/src/features/quote/EstimateResult.jsx?raw";
import estimatePage from "../frontend/src/pages/EstimatePage.jsx?raw";
import proposalForm from "../frontend/src/features/quote/ProposalRequestForm.jsx?raw";
import { quoteEs } from "../frontend/src/utils/i18n/quote-es.js";
import { quoteEn } from "../frontend/src/utils/i18n/quote-en.js";
import { EVENTS } from "../frontend/src/lib/analytics.js";
import {
  fetchProposalPrefill,
  requestFormalProposal,
} from "../frontend/src/features/quote/quoteApi.js";

/**
 * "SOLICITAR PROPUESTA FORMAL" EN /estimacion?id=<public_id>
 *
 * El fallo que corrige este cambio no era un error de programación: el botón
 * funcionaba, llevaba a una página que existía y el formulario de contacto
 * enviaba correctamente. Lo que se perdía por el camino era la cotización. Un
 * test funcional del Worker no lo habría visto nunca, porque por el Worker no
 * pasaba nada.
 *
 * Por eso lo que se fija aquí es el contrato del lado del navegador:
 *
 *  1. El botón NO navega al formulario de contacto genérico.
 *  2. La solicitud viaja al endpoint de ESA cotización, con su `public_id`.
 *  3. El navegador no aporta horas, precio ni alcance, ni los saca del
 *     almacenamiento local: la fuente es la API, y detrás D1.
 *
 * La suite corre en workerd y no tiene DOM, así que la parte de React se
 * verifica sobre el fuente —igual que print-document.test.js hace con las reglas
 * de impresión— y el cliente de la API, que es JavaScript sin React, se ejercita
 * de verdad con la red interceptada.
 */

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
describe("El botón conserva la cotización", () => {
  it("ya no enlaza al formulario de contacto genérico", () => {
    // La regresión concreta: <Link to="/#contacto"> perdía el public_id.
    expect(estimateResult).not.toContain('to="/#contacto"');
    expect(estimateResult).not.toContain("#contacto");
    expect(estimateResult).not.toMatch(/from ['"]react-router-dom['"]/);
  });

  it("abre el formulario específico de propuesta formal", () => {
    expect(estimateResult).toContain("import ProposalRequestForm from './ProposalRequestForm'");
    expect(estimateResult).toContain("<ProposalRequestForm");
    expect(estimateResult).toContain("setProposalOpen(true)");
  });

  it("le pasa la cotización, que es la que lleva el public_id", () => {
    expect(estimateResult).toMatch(/<ProposalRequestForm[\s\S]{0,200}quote=\{quote\}/);
    // Y no se ofrece el botón si no hay identificador con el que pedirla.
    expect(estimateResult).toContain("disabled={!quote.publicId || proposalRequested}");
    expect(estimateResult).toMatch(/\{proposalOpen && quote\.publicId &&/);
  });

  it("una vez solicitada, el botón deja de ofrecer una segunda solicitud", () => {
    expect(estimateResult).toContain("onRequested={() => setProposalRequested(true)}");
    expect(estimateResult).toContain("t.quote.proposal.requestedBadge");
  });

  it("/estimacion sigue recuperando la estimación por el id de la URL", () => {
    // Si esto cambiara, el formulario recibiría una cotización sin publicId.
    expect(estimatePage).toContain("searchParams.get('id')");
    expect(estimatePage).toContain("fetchQuote(publicId)");
    expect(estimatePage).toContain("<EstimateResult quote={quote}");
  });
});

// ---------------------------------------------------------------------------
describe("El formulario no inventa datos", () => {
  it("los recupera de la API con el public_id", () => {
    expect(proposalForm).toContain("fetchProposalPrefill(publicId)");
    expect(proposalForm).toContain("requestFormalProposal(publicId,");
  });

  it("no usa el almacenamiento del navegador como fuente", () => {
    // localStorage puede servir de comodidad visual en otras pantallas, pero
    // aquí la única fuente admisible es D1 a través de la API. Se busca el ACCESO
    // (`localStorage.getItem`), no la palabra: el comentario del módulo la
    // menciona precisamente para explicar por qué no se usa.
    expect(proposalForm).not.toMatch(/(local|session)Storage\s*\./);
    expect(proposalForm).not.toMatch(/getItem|setItem/);
  });

  it("solo envía los tres campos adicionales, el honeypot y la verificación", () => {
    const cuerpo = proposalForm.slice(
      proposalForm.indexOf("requestFormalProposal(publicId, {"),
      proposalForm.indexOf("turnstile.reset()"),
    );
    expect(cuerpo).toContain("notes:");
    expect(cuerpo).toContain("targetDate:");
    expect(cuerpo).toContain("scopeNotes:");
    expect(cuerpo).toContain("website:");
    expect(cuerpo).toContain("turnstileToken:");
    // Nada de lo que calcula el motor viaja de vuelta.
    expect(cuerpo).not.toMatch(/hours|price|pricing|complexity|scope:|services|status/);
  });

  it("mantiene a la vista el resumen de la estimación original", () => {
    expect(proposalForm).toContain('className="proposal-summary"');
    expect(proposalForm).toContain("p.fields.quoteNumber");
    expect(proposalForm).toContain("p.fields.scope");
    expect(proposalForm).toContain("p.fields.effort");
  });

  it("el importe solo se muestra si el servidor lo devuelve", () => {
    // El servidor solo lo devuelve con PRICING_ENABLED="true" y tarifa guardada.
    expect(proposalForm).toContain("prefill?.pricing?.available &&");
  });

  it("conserva el honeypot y la verificación de Turnstile", () => {
    expect(proposalForm).toContain('className="honeypot-field"');
    expect(proposalForm).toContain("turnstile.containerRef");
    // El ciclo de vida completo del widget se prueba en turnstile-widget.test.js.
    expect(proposalForm).toContain("turnstile.enabled && !turnstile.solved");
  });

  it("el diálogo no se imprime", () => {
    expect(proposalForm).toContain('className="proposal-overlay no-print"');
  });
});

// ---------------------------------------------------------------------------
describe("Cliente de la API: a dónde va realmente la solicitud", () => {
  /** Intercepta la red y devuelve las peticiones vistas. */
  function interceptar(response) {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        calls.push({ url, options });
        return response;
      }),
    );
    return calls;
  }

  const PUBLIC_ID = "a".repeat(32);

  const ok = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("POST va al endpoint de esa cotización, nunca a /api/contact", async () => {
    const calls = interceptar(ok({ proposal: { quoteNumber: "VF-2026-000001" } }));

    const result = await requestFormalProposal(PUBLIC_ID, {
      notes: "hola",
      turnstileToken: "0.token",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/api/quotes/${PUBLIC_ID}/request-proposal`);
    expect(calls[0].options.method).toBe("POST");
    // La regresión que se corrige: la solicitud NO puede acabar en el formulario
    // genérico ni en una cotización nueva.
    expect(calls[0].url).not.toContain("/api/contact");
    expect(calls[0].url).not.toBe("/api/quotes");
  });

  it("el cuerpo lleva solo lo que el usuario escribió", async () => {
    const calls = interceptar(ok({ proposal: {} }));

    await requestFormalProposal(PUBLIC_ID, {
      notes: "Empezamos en octubre",
      targetDate: "2026-10-01",
      scopeNotes: "Solo el portal de clientes",
      website: "",
      turnstileToken: "0.token",
    });

    const body = JSON.parse(calls[0].options.body);
    expect(Object.keys(body).sort()).toEqual([
      "notes",
      "scopeNotes",
      "targetDate",
      "turnstileToken",
      "website",
    ]);
  });

  it("el public_id se codifica: no se puede colar otra ruta por el parámetro", async () => {
    const calls = interceptar(ok({ proposal: {} }));
    await requestFormalProposal("../admin/quotes", {});
    expect(calls[0].url).toBe("/api/quotes/..%2Fadmin%2Fquotes/request-proposal");
  });

  it("GET pide el prellenado de la misma cotización", async () => {
    const calls = interceptar(
      ok({ quote: { quoteNumber: "VF-2026-000001" }, proposal: { requested: false } }),
    );

    const result = await fetchProposalPrefill(PUBLIC_ID);

    expect(result.ok).toBe(true);
    expect(result.proposal).toEqual({ requested: false });
    expect(calls[0].url).toBe(`/api/quotes/${PUBLIC_ID}/request-proposal`);
    expect(calls[0].options.method).toBe("GET");
  });

  it.each([
    [404, "notFound"],
    [409, "inProgress"],
    [429, "rateLimited"],
    [403, "verification"],
    [500, "generic"],
  ])("un %i se traduce a un error que la interfaz sabe explicar", async (status, error) => {
    interceptar(new Response("{}", { status }));
    const result = await requestFormalProposal(PUBLIC_ID, {});
    expect(result).toEqual({ ok: false, error });
  });

  it("un fallo de red no se confunde con un rechazo del servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    expect(await requestFormalProposal(PUBLIC_ID, {})).toEqual({ ok: false, error: "network" });
    expect(await fetchProposalPrefill(PUBLIC_ID)).toEqual({ ok: false, error: "network" });
  });
});

// ---------------------------------------------------------------------------
describe("Textos y analítica", () => {
  it("los textos existen en los dos idiomas y con las mismas claves", () => {
    const claves = (obj) => Object.keys(obj).sort();
    expect(claves(quoteEs.proposal)).toEqual(claves(quoteEn.proposal));
    expect(claves(quoteEs.proposal.fields)).toEqual(claves(quoteEn.proposal.fields));
    expect(claves(quoteEs.proposal.form)).toEqual(claves(quoteEn.proposal.form));
    expect(claves(quoteEs.proposal.errors)).toEqual(claves(quoteEn.proposal.errors));
  });

  it("ningún texto está vacío", () => {
    const recorrer = (obj, ruta = "proposal") => {
      for (const [clave, valor] of Object.entries(obj)) {
        if (typeof valor === "object") recorrer(valor, `${ruta}.${clave}`);
        else expect(String(valor).trim().length, `${ruta}.${clave}`).toBeGreaterThan(0);
      }
    };
    recorrer(quoteEs.proposal);
    recorrer(quoteEn.proposal);
  });

  it("los errores del cliente de la API tienen texto en ambos idiomas", () => {
    for (const error of ["generic", "network", "notFound", "rateLimited", "verification", "inProgress"]) {
      expect(quoteEs.proposal.errors[error], `es.${error}`).toBeTruthy();
      expect(quoteEn.proposal.errors[error], `en.${error}`).toBeTruthy();
    }
  });

  it("abrir el formulario y enviarlo son dos eventos distintos", () => {
    expect(EVENTS).toContain("formal_proposal_requested");
    expect(EVENTS).toContain("formal_proposal_submitted");
    expect(estimateResult).toContain("track('formal_proposal_requested')");
    expect(proposalForm).toContain("track('formal_proposal_submitted')");
  });
});
