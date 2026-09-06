import { describe, expect, it, vi } from "vitest";
import proposalForm from "../frontend/src/features/quote/ProposalRequestForm.jsx?raw";
import useTurnstileSource from "../frontend/src/hooks/useTurnstile.js?raw";
import { quoteEs } from "../frontend/src/utils/i18n/quote-es.js";
import { quoteEn } from "../frontend/src/utils/i18n/quote-en.js";
import {
  TURNSTILE_STATUS,
  createTurnstileWidget,
} from "../frontend/src/lib/turnstileWidget.js";

/**
 * CICLO DE VIDA DE TURNSTILE EN EL FORMULARIO DE PROPUESTA FORMAL.
 *
 * CAUSA RAÍZ QUE SE FIJA AQUÍ
 *
 * El widget se montaba una sola vez, en el efecto de montaje, y exigía que el
 * contenedor existiera en ese instante. El formulario de propuesta vive dentro
 * de un diálogo que primero consulta la API, así que en el montaje su
 * contenedor todavía no está en el DOM. Y como `window.turnstile` sí solía
 * estar —el script llega cacheado—, se tomaba el camino rápido y NO se
 * instalaba ningún reintento: el widget no se montaba nunca. La persona veía
 * "Completa la verificación para poder enviar" sin nada que completar, con el
 * botón deshabilitado, y solo recargando la página se volvía a jugar la
 * carrera entre el script y el contenedor.
 *
 * Estas pruebas ejercitan la máquina de estados de verdad, con una API de
 * Turnstile falsa, y cubren las dos entradas asíncronas en los dos órdenes
 * posibles. No hay DOM en la suite, y no hace falta: el contenedor solo se pasa
 * a `render()`, nunca se manipula.
 */

/** Doble de `window.turnstile`. Registra lo que se le pide y expone los callbacks. */
function fakeTurnstile() {
  const api = {
    rendered: [],
    reset: vi.fn(),
    remove: vi.fn(),
    render: vi.fn((container, options) => {
      api.rendered.push({ container, options });
      return `widget-${api.rendered.length}`;
    }),
    /** Últimos callbacks entregados a Turnstile. */
    last() {
      return api.rendered[api.rendered.length - 1].options;
    },
  };
  return api;
}

const NODE = { id: "contenedor" }; // basta con que sea identificable

function crear({ api, siteKey = "1x00000000000000000000AA" } = {}) {
  const cambios = [];
  const widget = createTurnstileWidget({
    siteKey,
    language: "es",
    getApi: () => api,
    onChange: (state) => cambios.push(state),
  });
  return { widget, cambios };
}

// ---------------------------------------------------------------------------
describe("El contenedor aparece DESPUÉS del script (la regresión)", () => {
  it("no monta nada mientras no haya contenedor, y monta en cuanto llega", () => {
    const api = fakeTurnstile(); // el script YA está cargado
    const { widget } = crear({ api });

    // Primer intento: es el que hacía el efecto de montaje del formulario,
    // cuando el diálogo aún está pidiendo los datos a la API.
    expect(widget.ensureRendered()).toBe(false);
    expect(api.render).not.toHaveBeenCalled();
    expect(widget.getState().status).toBe(TURNSTILE_STATUS.LOADING);

    // El formulario termina de cargar y el nodo entra en el DOM.
    widget.attach(NODE);

    expect(api.render).toHaveBeenCalledTimes(1);
    expect(api.rendered[0].container).toBe(NODE);
    expect(widget.getState().status).toBe(TURNSTILE_STATUS.READY);
    // Y ya no queda nada pendiente: el sondeo se detiene.
    expect(widget.ensureRendered()).toBe(true);
  });

  it("el estado distingue «cargando» de «pendiente de resolver»", () => {
    // Es la diferencia entre "espera" y "haz algo", y confundirlas era el
    // síntoma que veía el usuario.
    const api = fakeTurnstile();
    const { widget } = crear({ api });

    expect(widget.getState().status).toBe(TURNSTILE_STATUS.LOADING);
    widget.attach(NODE);
    expect(widget.getState().status).toBe(TURNSTILE_STATUS.READY);
    api.last().callback("token-1");
    expect(widget.getState().status).toBe(TURNSTILE_STATUS.SOLVED);
  });
});

// ---------------------------------------------------------------------------
describe("El script llega DESPUÉS del contenedor", () => {
  it("reintenta hasta que window.turnstile existe", () => {
    let api; // el script todavía no ha cargado
    const cambios = [];
    const widget = createTurnstileWidget({
      siteKey: "1x00000000000000000000AA",
      getApi: () => api,
      onChange: (state) => cambios.push(state),
    });

    widget.attach(NODE);
    expect(widget.getState().rendered).toBe(false);

    // Varias vueltas del sondeo sin script: nada se rompe y nada se monta.
    expect(widget.ensureRendered()).toBe(false);
    expect(widget.ensureRendered()).toBe(false);
    expect(widget.getState().status).toBe(TURNSTILE_STATUS.LOADING);

    api = fakeTurnstile();
    expect(widget.ensureRendered()).toBe(true);
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(widget.getState().status).toBe(TURNSTILE_STATUS.READY);
  });

  it("nunca monta dos widgets aunque se insista", () => {
    const api = fakeTurnstile();
    const { widget } = crear({ api });
    widget.attach(NODE);
    for (let i = 0; i < 10; i += 1) widget.ensureRendered();
    widget.attach(NODE); // el mismo nodo: no es un cambio
    expect(api.render).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe("Tokens: de un solo uso y con caducidad", () => {
  it("`callback` entrega el token y habilita el envío", () => {
    const api = fakeTurnstile();
    const { widget } = crear({ api });
    widget.attach(NODE);

    api.last().callback("token-fresco");

    expect(widget.getState()).toMatchObject({
      status: TURNSTILE_STATUS.SOLVED,
      token: "token-fresco",
    });
  });

  it.each([
    ["expired-callback", "caducado"],
    ["timeout-callback", "agotado"],
    ["error-callback", "con error"],
  ])("`%s` descarta el token (%s) y vuelve a pedir la verificación", (nombre) => {
    const api = fakeTurnstile();
    const { widget } = crear({ api });
    widget.attach(NODE);
    api.last().callback("token-viejo");
    expect(widget.getState().token).toBe("token-viejo");

    api.last()[nombre]();

    // Un token caducado NO se reutiliza: el Worker lo rechazaría con un 403 que
    // la persona no puede explicarse.
    expect(widget.getState()).toMatchObject({ status: TURNSTILE_STATUS.READY, token: "" });
  });

  it("`reset()` pide un token nuevo a Turnstile y vacía el actual", () => {
    const api = fakeTurnstile();
    const { widget } = crear({ api });
    widget.attach(NODE);
    api.last().callback("token-gastado");

    widget.reset();

    expect(api.reset).toHaveBeenCalledWith("widget-1");
    expect(widget.getState()).toMatchObject({ status: TURNSTILE_STATUS.READY, token: "" });
  });

  it("`reset()` no lanza si Turnstile ya no conoce el widget", () => {
    const api = fakeTurnstile();
    api.reset = vi.fn(() => {
      throw new Error("widget desconocido");
    });
    const { widget } = crear({ api });
    widget.attach(NODE);

    expect(() => widget.reset()).not.toThrow();
    expect(widget.getState().token).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("Cerrar y reabrir el formulario, sin recargar la página", () => {
  it("al salir el nodo del DOM se suelta el widget y se vuelve a «cargando»", () => {
    const api = fakeTurnstile();
    const { widget } = crear({ api });
    widget.attach(NODE);
    api.last().callback("token-1");

    widget.attach(null); // React retira el nodo al cerrar el diálogo

    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(widget.getState()).toMatchObject({ status: TURNSTILE_STATUS.LOADING, token: "" });
  });

  it("reabrir monta un widget nuevo y con token limpio", () => {
    const api = fakeTurnstile();
    const { widget } = crear({ api });

    widget.attach(NODE);
    api.last().callback("token-de-la-primera-vez");
    widget.attach(null);

    // Segunda apertura: nada del intento anterior sobrevive.
    widget.attach({ id: "contenedor-2" });

    expect(api.render).toHaveBeenCalledTimes(2);
    expect(widget.getState()).toMatchObject({ status: TURNSTILE_STATUS.READY, token: "" });
  });

  it("`destroy()` es reversible: StrictMode monta, desmonta y vuelve a montar", () => {
    // En desarrollo React invoca los efectos dos veces. Un destroy definitivo
    // dejaría el formulario sin verificación y sin forma de recuperarla.
    const api = fakeTurnstile();
    const { widget } = crear({ api });
    widget.attach(NODE);

    widget.destroy();
    expect(api.remove).toHaveBeenCalledTimes(1);

    widget.revive();
    widget.attach(NODE);

    expect(api.render).toHaveBeenCalledTimes(2);
    expect(widget.getState().status).toBe(TURNSTILE_STATUS.READY);
  });

  it("StrictMode: la ref se reengancha ANTES de rearmar los efectos", () => {
    // Orden real de React al remontar: soltar refs → limpiar efectos → enganchar
    // refs → montar efectos. Si `attach` se rindiera por estar "destruido", el
    // contenedor se perdería aquí y el widget no se montaría nunca.
    const api = fakeTurnstile();
    const { widget } = crear({ api });

    widget.attach(NODE); // primer montaje
    widget.attach(null); // 1. React suelta la ref
    widget.destroy(); //    2. limpieza del efecto de desmontaje
    widget.attach(NODE); // 3. React vuelve a enganchar la ref
    widget.revive(); //     4. el efecto se rearma

    expect(widget.getState().rendered).toBe(true);
    expect(widget.getState().status).toBe(TURNSTILE_STATUS.READY);
    expect(widget.ensureRendered()).toBe(true);
  });

  it("tras `destroy()` los callbacks pendientes no resucitan el estado", () => {
    const api = fakeTurnstile();
    const { widget } = crear({ api });
    widget.attach(NODE);
    const callbacks = api.last();

    widget.destroy();
    callbacks.callback("token-tardío");

    expect(widget.getState().token).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("Sin site key configurada", () => {
  it("la verificación no aplica y no bloquea el formulario", () => {
    const api = fakeTurnstile();
    const { widget } = crear({ api, siteKey: "" });

    expect(widget.getState().status).toBe(TURNSTILE_STATUS.DISABLED);
    // `true` = no queda nada pendiente, así que el sondeo ni siquiera arranca.
    expect(widget.ensureRendered()).toBe(true);
    widget.attach(NODE);
    expect(api.render).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("Cómo lo consume el formulario", () => {
  it("el hook expone los tres estados y el sondeo se detiene solo", () => {
    expect(useTurnstileSource).toContain("createTurnstileWidget");
    // Callback ref: es lo que permite montar cuando el nodo aparece tarde.
    expect(useTurnstileSource).toContain("widgetRef.current.attach(node)");
    expect(useTurnstileSource).toContain("if (widget.ensureRendered()) clearInterval(poll)");
    expect(useTurnstileSource).toContain("return () => widget.destroy()");
  });

  it("el botón solo se habilita con token vigente, no con el widget a medias", () => {
    expect(proposalForm).toContain(
      "disabled={status === 'sending' || (turnstile.enabled && !turnstile.solved)}",
    );
    // La condición anterior miraba el token suelto, sin saber si el widget
    // llegó a montarse.
    expect(proposalForm).not.toContain("turnstile.enabled && !turnstile.token");
  });

  it("el formulario muestra un mensaje distinto por estado", () => {
    expect(proposalForm).toContain("TURNSTILE_STATUS.LOADING");
    expect(proposalForm).toContain("p.captcha.loading");
    expect(proposalForm).toContain("turnstile.ready && !turnstile.solved");
    expect(proposalForm).toContain("p.captcha.pending");
    expect(proposalForm).toContain("turnstile.solved && (");
    expect(proposalForm).toContain("p.captcha.solved");
  });

  it("el token se renueva después de cada envío, salga bien o mal", () => {
    const submit = proposalForm.slice(
      proposalForm.indexOf("const handleSubmit"),
      proposalForm.indexOf("const summary"),
    );
    expect(submit).toContain("turnstile.reset()");
    // Y antes de decidir qué hacer con el resultado: el token ya se gastó.
    expect(submit.indexOf("turnstile.reset()")).toBeLessThan(submit.indexOf("if (!result.ok)"));
  });

  it("los tres mensajes existen en los dos idiomas", () => {
    for (const estado of ["loading", "pending", "solved"]) {
      expect(quoteEs.proposal.captcha[estado], `es.${estado}`).toBeTruthy();
      expect(quoteEn.proposal.captcha[estado], `en.${estado}`).toBeTruthy();
    }
  });
});
