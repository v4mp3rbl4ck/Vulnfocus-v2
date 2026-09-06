import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import estimateResult from "../frontend/src/features/quote/EstimateResult.jsx?raw";
import estimateDocument from "../frontend/src/features/quote/EstimateDocument.jsx?raw";
import { quoteEs } from "../frontend/src/utils/i18n/quote-es.js";
import { quoteEn } from "../frontend/src/utils/i18n/quote-en.js";
import { ESTIMATE_DISCLAIMER } from "../worker/integrations/email/templates.js";

/**
 * DOCUMENTO IMPRIMIBLE DE LA ESTIMACIÓN.
 *
 * El PDF se genera con la impresión del navegador sobre una vista `@media print`
 * (la justificación de no generarlo en el Worker está en docs/QUOTING_ENGINE.md).
 * Esa decisión tiene una consecuencia: la calidad del documento depende de unas
 * reglas CSS que nadie ve fallar. Si alguien renombra `.no-print` o quita la
 * regla que oculta la cabecera, el PDF sale con el menú de navegación y los
 * botones dentro, y no lo detecta ningún test funcional.
 *
 * Esto no valida el aspecto —eso es revisión visual, y está en
 * docs/QA_CHECKLIST.md— sino el contrato: qué se oculta, qué aparece y dónde.
 */

// App.css llega como binding desde vitest.config.mjs (ver el comentario allí).
const css = env.TEST_APP_CSS;
const printBlock = css.slice(css.indexOf("@media print"));

describe("Qué NO debe salir impreso", () => {
  it.each([
    [".dark-header", "cabecera y navegación del sitio"],
    [".footer", "pie del sitio"],
    [".cta-band", "banda de conversión"],
    [".no-print", "botones y ayudas de interfaz"],
    [".quote-steps", "indicador de pasos del asistente"],
    [".quote-progress", "barra de progreso"],
    [".quote-nav", "botones de navegación del asistente"],
    [".estimate-share", "enlace privado de la estimación"],
  ])("%s se oculta al imprimir (%s)", (selector) => {
    expect(printBlock, selector).toContain(selector);
  });

  it("el bloque que los oculta usa display:none", () => {
    const hide = printBlock.slice(printBlock.indexOf(".dark-header"));
    expect(hide.slice(0, 400)).toContain("display: none !important");
  });

  it("el enlace privado con el public_id no se imprime", () => {
    // `estimate-share` contiene la URL con el identificador: no debe acabar en un
    // PDF que el cliente reenvía por correo.
    expect(estimateResult).toContain('className="estimate-share no-print"');
  });

  it("los botones de acción están marcados como no imprimibles", () => {
    expect(estimateResult).toContain('className="estimate-actions no-print"');
    expect(estimateResult).toContain('className="estimate-hint no-print"');
  });
});

describe("Qué SÍ debe salir impreso", () => {
  it("el número de cotización, fuera de cualquier bloque no imprimible", () => {
    expect(estimateResult).toContain('className="estimate-number">{quote.quoteNumber}');
    const header = estimateResult.slice(
      estimateResult.indexOf('className="estimate-header"'),
      estimateResult.indexOf("</header>"),
    );
    expect(header).not.toContain("no-print");
  });

  it("la fecha de la estimación", () => {
    expect(estimateResult).toContain('className="estimate-date"');
    expect(estimateResult).toContain("toLocaleDateString");
  });

  it("el aviso de estimación referencial", () => {
    expect(estimateResult).toContain('className="estimate-disclaimer"');
    expect(quoteEs.estimate.disclaimer).toBe(ESTIMATE_DISCLAIMER);
    expect(quoteEn.estimate.disclaimer).toBe(
      "Referential estimate, subject to final scope validation.",
    );
  });

  it("la cabecera de marca propia del documento impreso", () => {
    expect(estimateDocument).toContain('className="print-only estimate-print-header"');
    expect(estimateDocument).toContain("BrandLogo");
    expect(estimateDocument).toContain('className="print-only estimate-print-footer"');
    expect(printBlock).toContain(".print-only");
  });

  it.each([
    ["client", "cliente"],
    ["objective", "objetivo"],
    ["scope", "alcance declarado"],
    ["methodology", "metodología"],
    ["exclusions", "exclusiones"],
    ["disclaimer", "aviso"],
  ])("la sección %s (%s) está en el documento", (key) => {
    expect(estimateDocument).toContain(`p.${key}`);
    expect(quoteEs.print[key], `falta la traducción print.${key}`).toBeTruthy();
    expect(quoteEn.print[key], `falta la traducción EN print.${key}`).toBeTruthy();
  });

  it("los bloques no se parten entre páginas", () => {
    expect(printBlock).toContain("break-inside: avoid");
    expect(printBlock).toContain("@page");
  });

  it("se imprime en claro, no el tema oscuro", () => {
    expect(printBlock).toContain("background: #fff !important");
    expect(printBlock).toContain("color: #000 !important");
  });
});

describe("El documento no filtra información innecesaria", () => {
  it("no imprime el desglose interno del cálculo", () => {
    for (const leak of ["breakdown", "baseHours", "multiplier", "hourlyRate", "internal"]) {
      expect(estimateDocument, leak).not.toContain(leak);
    }
  });

  it("el rango económico solo aparece si el motor lo calculó", () => {
    expect(estimateResult).toContain("quote.pricing?.available ?");
    expect(quoteEs.estimate.priceUnavailable).toBeTruthy();
  });

  it("no promete entregables ni marcos que el sitio no declare", () => {
    // Los textos fijos del documento mencionan solo marcos públicos y
    // verificables, nunca clientes, premios ni certificaciones.
    const textos = `${quoteEs.print.methodologyText} ${quoteEs.print.objectiveText}`;
    for (const inventado of ["ISO 27001", "premio", "cliente", "certificad"]) {
      expect(textos.toLowerCase(), inventado).not.toContain(inventado.toLowerCase());
    }
  });
});
