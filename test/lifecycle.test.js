import { describe, expect, it } from "vitest";
import {
  INITIAL_STATUS,
  PROPOSAL_REQUESTED_STATUS,
  PUBLIC_PROPOSAL_ORIGINS,
  QUOTE_STATUSES,
  TERMINAL_STATUSES,
  allowedTransitions,
  canTransition,
  isQuoteStatus,
  validateTransition,
} from "../worker/lib/quote/lifecycle.js";

/**
 * MÁQUINA DE ESTADOS DEL CICLO COMERCIAL.
 *
 * Se prueba aislada del transporte porque las reglas son la parte que hay que
 * poder razonar: qué se puede mover, qué no, y qué es definitivo. El test de
 * `admin-api.test.js` comprueba que la API las respeta; este comprueba que las
 * reglas en sí son coherentes (sin estados inalcanzables, sin ciclos que
 * permitan "des-aceptar", sin destinos fuera del conjunto declarado).
 */

describe("Conjunto de estados", () => {
  it("son los siete acordados y no hay duplicados", () => {
    expect(QUOTE_STATUSES).toEqual([
      "NEW",
      "CONTACTED",
      "PROPOSAL_REQUESTED",
      "PROPOSAL_SENT",
      "ACCEPTED",
      "REJECTED",
      "EXPIRED",
    ]);
    expect(new Set(QUOTE_STATUSES).size).toBe(QUOTE_STATUSES.length);
  });

  it("el estado inicial es NEW", () => {
    expect(INITIAL_STATUS).toBe("NEW");
    expect(QUOTE_STATUSES).toContain(INITIAL_STATUS);
  });

  it("isQuoteStatus rechaza todo lo que no sea un estado exacto", () => {
    for (const value of ["new", "NEW ", "", null, undefined, 0, {}, [], "WON", "DELETED"]) {
      expect(isQuoteStatus(value), JSON.stringify(value)).toBe(false);
    }
    for (const value of QUOTE_STATUSES) expect(isQuoteStatus(value)).toBe(true);
  });
});

describe("Transiciones", () => {
  it("todo destino declarado es un estado válido", () => {
    for (const from of QUOTE_STATUSES) {
      for (const to of allowedTransitions(from)) {
        expect(QUOTE_STATUSES, `${from} → ${to}`).toContain(to);
      }
    }
  });

  it("ningún estado se transiciona a sí mismo", () => {
    for (const from of QUOTE_STATUSES) {
      expect(allowedTransitions(from), from).not.toContain(from);
      expect(canTransition(from, from), from).toBe(false);
    }
  });

  it("los estados terminales no tienen salida", () => {
    expect(TERMINAL_STATUSES).toEqual(["ACCEPTED", "REJECTED"]);
    for (const terminal of TERMINAL_STATUSES) {
      expect(allowedTransitions(terminal), terminal).toEqual([]);
      for (const to of QUOTE_STATUSES) {
        expect(canTransition(terminal, to), `${terminal} → ${to}`).toBe(false);
      }
    }
  });

  it("ACCEPTED solo se alcanza desde PROPOSAL_SENT", () => {
    // Es el disparador previsto de SysReptor: no debe poder llegarse por atajo.
    const origins = QUOTE_STATUSES.filter((from) => canTransition(from, "ACCEPTED"));
    expect(origins).toEqual(["PROPOSAL_SENT"]);
  });

  it("el camino comercial completo es recorrible", () => {
    const path = ["NEW", "CONTACTED", "PROPOSAL_REQUESTED", "PROPOSAL_SENT", "ACCEPTED"];
    for (let i = 1; i < path.length; i += 1) {
      expect(canTransition(path[i - 1], path[i]), `${path[i - 1]} → ${path[i]}`).toBe(true);
    }
  });

  it("se puede rechazar o caducar en cualquier punto no terminal", () => {
    for (const from of ["NEW", "CONTACTED", "PROPOSAL_REQUESTED", "PROPOSAL_SENT"]) {
      expect(canTransition(from, "REJECTED"), from).toBe(true);
      expect(canTransition(from, "EXPIRED"), from).toBe(true);
    }
  });

  it("una caducada se puede retomar, pero solo como CONTACTED", () => {
    expect(allowedTransitions("EXPIRED")).toEqual(["CONTACTED"]);
  });

  it("todo estado no inicial es alcanzable desde NEW", () => {
    // Un estado al que no se puede llegar sería configuración muerta.
    const reachable = new Set([INITIAL_STATUS]);
    const queue = [INITIAL_STATUS];
    while (queue.length > 0) {
      for (const to of allowedTransitions(queue.shift())) {
        if (!reachable.has(to)) {
          reachable.add(to);
          queue.push(to);
        }
      }
    }
    expect([...reachable].sort()).toEqual([...QUOTE_STATUSES].sort());
  });
});

describe("PROPOSAL_REQUESTED: el único estado que puede fijar el cliente", () => {
  it("el endpoint público solo lo admite desde NEW y CONTACTED", () => {
    // La máquina admite más orígenes hacia PROPOSAL_REQUESTED de los que puede
    // provocar un visitante. Esta lista es la que consulta el endpoint público y
    // es deliberadamente más estrecha.
    expect(PUBLIC_PROPOSAL_ORIGINS).toEqual(["NEW", "CONTACTED"]);
    for (const from of PUBLIC_PROPOSAL_ORIGINS) {
      expect(canTransition(from, PROPOSAL_REQUESTED_STATUS), from).toBe(true);
    }
  });

  it("ningún origen público es terminal ni permite saltarse la propuesta", () => {
    for (const from of PUBLIC_PROPOSAL_ORIGINS) {
      expect(TERMINAL_STATUSES, from).not.toContain(from);
      expect(canTransition(from, "ACCEPTED"), from).toBe(false);
    }
  });

  it("desde estados avanzados o terminales NO se puede volver a solicitar", () => {
    for (const from of ["PROPOSAL_SENT", "ACCEPTED", "REJECTED", "EXPIRED"]) {
      expect(PUBLIC_PROPOSAL_ORIGINS, from).not.toContain(from);
      expect(canTransition(from, PROPOSAL_REQUESTED_STATUS), from).toBe(false);
    }
  });

  it("una propuesta solicitada avanza, pero nunca directamente a ACCEPTED", () => {
    expect(allowedTransitions(PROPOSAL_REQUESTED_STATUS)).toEqual([
      "CONTACTED",
      "PROPOSAL_SENT",
      "REJECTED",
      "EXPIRED",
    ]);
    expect(canTransition(PROPOSAL_REQUESTED_STATUS, "ACCEPTED")).toBe(false);
    expect(canTransition(PROPOSAL_REQUESTED_STATUS, "NEW")).toBe(false);
  });
});

describe("validateTransition: razones distinguibles", () => {
  it.each([
    ["NEW", "CONTACTED", null],
    ["NEW", "NEW", "same-status"],
    ["NEW", "ACCEPTED", "transition-not-allowed"],
    ["ACCEPTED", "CONTACTED", "terminal-status"],
    ["REJECTED", "NEW", "terminal-status"],
    ["NEW", "WON", "unknown-target-status"],
    ["inventado", "NEW", "unknown-current-status"],
    ["NEW", "", "unknown-target-status"],
  ])("%s → %s", (from, to, reason) => {
    const result = validateTransition(from, to);
    if (reason === null) {
      expect(result).toEqual({ ok: true });
    } else {
      expect(result).toEqual({ ok: false, reason });
    }
  });

  it("un destino con tipo incorrecto se rechaza antes de mirar el origen", () => {
    for (const to of [null, undefined, 42, {}, ["NEW"]]) {
      expect(validateTransition("NEW", to)).toEqual({
        ok: false,
        reason: "unknown-target-status",
      });
    }
  });
});
