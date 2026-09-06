import { afterEach, describe, expect, it, vi } from "vitest";
import proposalForm from "../frontend/src/features/quote/ProposalRequestForm.jsx?raw";
import proposalRulesSource from "../frontend/src/config/proposal-request.js?raw";
import workerProposalSource from "../worker/lib/quote/proposal.js?raw";
import { quoteEs } from "../frontend/src/utils/i18n/quote-es.js";
import { quoteEn } from "../frontend/src/utils/i18n/quote-en.js";
import { requestFormalProposal } from "../frontend/src/features/quote/quoteApi.js";
import { normalizeProposalInput } from "../worker/lib/quote/proposal.js";
import {
  TARGET_DATE_MAX_DAYS,
  TARGET_DATE_MIN_DAYS,
  targetDateBounds,
  validateTargetDate,
} from "../frontend/src/config/proposal-request.js";

/**
 * ERRORES DE LA SOLICITUD DE PROPUESTA FORMAL.
 *
 * CAUSA RAÍZ QUE SE FIJA AQUÍ
 *
 * El cliente de la API traducía a `generic` todo lo que no fuera 404, 409, 429 o
 * 403. Un 400 por una fecha fuera de rango llegaba al formulario como "No fue
 * posible enviar la solicitud. Inténtalo de nuevo": ni el código ni el campo
 * sobrevivían al viaje, así que la persona no tenía forma de saber qué corregir
 * y reintentaba exactamente lo mismo.
 *
 * Y la ventana de fechas solo existía en el Worker, de modo que el formulario
 * dejaba elegir una fecha que el servidor iba a rechazar después. Ahora la regla
 * vive en un módulo compartido que importan los dos.
 *
 * El servidor SIGUE SIENDO LA AUTORIDAD: la validación del navegador se adelanta
 * a la respuesta, no la sustituye. Los tests de `proposal-request.test.js`
 * comprueban que el Worker rechaza por su cuenta.
 */

afterEach(() => vi.unstubAllGlobals());

const PUBLIC_ID = "a".repeat(32);

/** `AAAA-MM-DD` a N días de hoy, con el mismo criterio UTC que la regla. */
function enDias(dias) {
  const hoy = new Date();
  const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return new Date(base + dias * 86400000).toISOString().slice(0, 10);
}

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

const respuesta = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ---------------------------------------------------------------------------
describe("Una sola regla de fechas para los dos lados", () => {
  it("la ventana es de hoy a dos años, y está declarada una sola vez", () => {
    expect(TARGET_DATE_MIN_DAYS).toBe(0);
    expect(TARGET_DATE_MAX_DAYS).toBe(730);

    const { min, max } = targetDateBounds();
    expect(min).toBe(enDias(0));
    expect(max).toBe(enDias(730));
  });

  it("el Worker importa la regla en lugar de tener su propia copia", () => {
    // El drift no se ve venir: aparece cuando alguien ajusta una de las dos
    // ventanas y el formulario empieza a admitir fechas que el servidor rechaza.
    expect(workerProposalSource).toContain(
      "from '../../../frontend/src/config/proposal-request.js'",
    );
    expect(workerProposalSource).not.toMatch(/=\s*730\b/);
    expect(workerProposalSource).not.toMatch(/TARGET_DATE_WINDOW_DAYS\s*=/);
  });

  it("el formulario usa esa misma regla para el calendario", () => {
    expect(proposalForm).toContain("from '../../config/proposal-request'");
    expect(proposalForm).toContain("min={bounds.min}");
    expect(proposalForm).toContain("max={bounds.max}");
    expect(proposalForm).toContain("targetDateBounds()");
    // Ni un solo número de días escrito a mano en el componente.
    expect(proposalForm).not.toMatch(/730|2\s*años|two years/);
  });

  it("la regla no depende de React ni del navegador: corre en el Worker", () => {
    expect(proposalRulesSource).not.toMatch(/from 'react'|window\.|document\./);
  });
});

// ---------------------------------------------------------------------------
describe("La regla, aplicada", () => {
  it.each([
    ["ayer", -1, "past"],
    ["hace un año", -365, "past"],
    ["un día más allá del máximo", TARGET_DATE_MAX_DAYS + 1, "too-far"],
    ["dentro de diez años", 3650, "too-far"],
  ])("%s se rechaza (%s)", (_caso, dias, reason) => {
    const resultado = validateTargetDate(enDias(dias));
    expect(resultado).toEqual({ ok: false, reason });
  });

  it.each([
    ["hoy", 0],
    ["mañana", 1],
    ["dentro de un año", 365],
    ["el último día admitido", TARGET_DATE_MAX_DAYS],
  ])("%s se acepta", (_caso, dias) => {
    expect(validateTargetDate(enDias(dias))).toEqual({ ok: true, value: enDias(dias) });
  });

  it("vacío es válido: la fecha objetivo es opcional", () => {
    for (const vacio of ["", "   ", null, undefined]) {
      expect(validateTargetDate(vacio), JSON.stringify(vacio)).toEqual({ ok: true, value: null });
    }
  });

  it.each(["2026-13-01", "2026-02-31", "01/11/2026", "el mes que viene", "2026-11"])(
    "«%s» no es una fecha (format)",
    (valor) => {
      expect(validateTargetDate(valor)).toEqual({ ok: false, reason: "format" });
    },
  );

  it("el validador del Worker devuelve campo, motivo y mensaje", () => {
    const resultado = normalizeProposalInput({ targetDate: enDias(-1) });
    expect(resultado).toMatchObject({ ok: false, field: "targetDate", reason: "past" });
    expect(resultado.message).toBe("La fecha objetivo no puede ser anterior a hoy.");
  });

  it("el mensaje de «demasiado lejana» dice hasta cuándo", () => {
    const resultado = normalizeProposalInput({ targetDate: enDias(TARGET_DATE_MAX_DAYS + 1) });
    expect(resultado.message).toContain(targetDateBounds().max);
  });

  it("ningún mensaje del catálogo devuelve lo que llegó", () => {
    const veneno = "<img src=x onerror=alert(1)>";
    for (const payload of [{ notes: veneno.repeat(60) }, { targetDate: veneno }]) {
      const resultado = normalizeProposalInput(payload);
      expect(resultado.ok).toBe(false);
      expect(resultado.message).not.toContain("<");
      expect(resultado.message).not.toContain("alert");
    }
  });
});

// ---------------------------------------------------------------------------
describe("Cada código HTTP llega distinto al formulario", () => {
  it("400 conserva campo, motivo y mensaje: NO se convierte en genérico", async () => {
    interceptar(
      respuesta(400, {
        status: "error",
        error: "validation_error",
        field: "targetDate",
        reason: "too-far",
        message: "La fecha objetivo no puede ir más allá del 2028-09-06.",
      }),
    );

    const resultado = await requestFormalProposal(PUBLIC_ID, {});

    expect(resultado).toEqual({
      ok: false,
      error: "validation",
      field: "targetDate",
      reason: "too-far",
      message: "La fecha objetivo no puede ir más allá del 2028-09-06.",
    });
    // El síntoma original: todo acababa aquí.
    expect(resultado.error).not.toBe("generic");
  });

  it.each([
    [404, "notFound"],
    [409, "inProgress"],
    [429, "rateLimited"],
    [403, "verification"],
    [503, "unavailable"],
    [500, "generic"],
    [502, "generic"],
  ])("%i → %s", async (status, error) => {
    interceptar(respuesta(status, { status: "error", message: "…" }));
    expect(await requestFormalProposal(PUBLIC_ID, {})).toEqual({ ok: false, error });
  });

  it("un 400 sin cuerpo utilizable no rompe nada", async () => {
    interceptar(new Response("no es json", { status: 400 }));
    expect(await requestFormalProposal(PUBLIC_ID, {})).toEqual({
      ok: false,
      error: "validation",
      field: null,
      reason: null,
      message: null,
    });
  });

  it("un campo desconocido en el 400 se transporta igual, sin inventar", async () => {
    interceptar(
      respuesta(400, { error: "validation_error", field: "campoNuevo", reason: "raro" }),
    );
    const resultado = await requestFormalProposal(PUBLIC_ID, {});
    expect(resultado.field).toBe("campoNuevo");
    expect(resultado.message).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("Cómo lo muestra el formulario", () => {
  it("valida la fecha antes de enviar y no llama a la API si falla", () => {
    const submit = proposalForm.slice(
      proposalForm.indexOf("const handleSubmit"),
      proposalForm.indexOf("const summary"),
    );
    expect(submit).toContain("const fecha = validateTargetDate(form.targetDate)");
    // El `return` va ANTES de la llamada: la petición no llega a salir.
    expect(submit.indexOf("if (!fecha.ok)")).toBeLessThan(
      submit.indexOf("requestFormalProposal(publicId"),
    );
    expect(submit).toMatch(/if \(!fecha\.ok\) \{[\s\S]{0,220}?return;/);
  });

  it("el error de un campo se pinta bajo ese campo, no solo en el banner", () => {
    expect(proposalForm).toContain('id="proposal-target-date-error"');
    expect(proposalForm).toContain("{fieldErrors.targetDate}");
    expect(proposalForm).toContain("{fieldErrors.notes}");
    expect(proposalForm).toContain("{fieldErrors.scopeNotes}");
    // Y el campo queda marcado para quien navega con lector de pantalla.
    expect(proposalForm).toContain("aria-invalid={fieldErrors.targetDate ? 'true' : undefined}");
    expect(proposalForm).toContain('role="alert"');
  });

  it("el banner general se reserva para lo que no es de un campo", () => {
    const submit = proposalForm.slice(
      proposalForm.indexOf("const handleSubmit"),
      proposalForm.indexOf("const summary"),
    );
    expect(submit).toContain("FORM_FIELDS.includes(result.field)");
    expect(submit).toContain("setFieldErrors({");
    expect(submit).toContain("setError(p.errors[result.error] || p.errors.generic)");
  });

  it("elegir una fecha válida limpia el error de ese campo", () => {
    expect(proposalForm).toContain("const updateTargetDate = (event) =>");
    expect(proposalForm).toContain("if (check.ok) delete next.targetDate;");
    expect(proposalForm).toContain("onChange={updateTargetDate}");
  });

  it("no se puede enviar con errores locales pendientes", () => {
    expect(proposalForm).toContain("Object.keys(fieldErrors).length > 0");
  });

  it("Turnstile sigue siendo obligatorio", () => {
    expect(proposalForm).toContain("(turnstile.enabled && !turnstile.solved)");
    expect(proposalForm).toContain("turnstileToken: turnstile.token");
  });
});

// ---------------------------------------------------------------------------
describe("Textos", () => {
  it("hay mensaje por campo y motivo en los dos idiomas", () => {
    for (const idioma of [quoteEs, quoteEn]) {
      for (const [campo, motivos] of Object.entries({
        targetDate: ["format", "past", "too-far"],
        notes: ["too-long", "type"],
        scopeNotes: ["too-long", "type"],
      })) {
        for (const motivo of motivos) {
          expect(idioma.proposal.fieldErrors[campo][motivo], `${campo}.${motivo}`).toBeTruthy();
        }
      }
    }
  });

  it("el mensaje de fecha lejana interpola el límite real", () => {
    expect(quoteEs.proposal.fieldErrors.targetDate["too-far"]).toContain("{max}");
    expect(quoteEn.proposal.fieldErrors.targetDate["too-far"]).toContain("{max}");
    expect(proposalForm).toContain("plantilla.replace('{max}', bounds.max)");
  });

  it("409 y 429 se leen como situaciones, no como averías", () => {
    expect(quoteEs.proposal.alreadyRequested).toContain("ya fue solicitada anteriormente");
    expect(quoteEs.proposal.errors.rateLimited).toContain("demasiados intentos");
    expect(quoteEs.proposal.errors.rateLimited).toContain("unos minutos");
    expect(quoteEs.proposal.errors.inProgress).toContain("en curso");
    for (const texto of Object.values(quoteEs.proposal.errors)) {
      expect(texto).not.toMatch(/error interno|fallo del sistema|500/i);
    }
  });

  it("todos los códigos que devuelve el cliente de la API tienen texto", () => {
    for (const error of [
      "generic",
      "network",
      "notFound",
      "rateLimited",
      "verification",
      "unavailable",
      "inProgress",
    ]) {
      expect(quoteEs.proposal.errors[error], `es.${error}`).toBeTruthy();
      expect(quoteEn.proposal.errors[error], `en.${error}`).toBeTruthy();
    }
  });
});
