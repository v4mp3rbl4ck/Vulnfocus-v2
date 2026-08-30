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

/**
 * Rate limiting.
 *
 * Implementación: binding NATIVO de Cloudflare (`ratelimits` en wrangler.jsonc),
 * respaldado por la misma infraestructura que las Rate Limiting Rules del WAF.
 * NO es un contador in-memory del isolate, así que es válido en producción
 * distribuida. Su alcance real (por PoP, eventualmente consistente) está
 * documentado en el README.
 */

async function post(ip, i) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    contactRequest(
      validPayload({
        email: `rl${i}@ejemplo.com`,
        message: `Mensaje válido de prueba de rate limiting número ${i}.`,
      }),
      { "CF-Connecting-IP": ip },
    ),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await resetDb();
  mockOutboundFetch({ siteverify: okSiteverify() });
});
afterEach(() => vi.unstubAllGlobals());

describe("Rate limiting 5/min por IP", () => {
  it("los 5 primeros envíos válidos son 201 y el 6º es 429", async () => {
    const ip = "203.0.113.77";
    const codigos = [];
    for (let i = 1; i <= 7; i++) codigos.push((await post(ip, i)).status);

    expect(codigos.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(codigos[5]).toBe(429);
    expect(codigos[6]).toBe(429);

    // Solo se persisten los 5 aceptados: el 429 corta antes de tocar D1.
    expect(await countRows()).toBe(5);
  });

  it("la respuesta 429 incluye Retry-After y no es cacheable", async () => {
    const ip = "203.0.113.88";
    for (let i = 1; i <= 5; i++) await post(ip, i);
    const res = await post(ip, 6);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("el límite es por IP: otra IP no queda afectada", async () => {
    const bloqueada = "203.0.113.99";
    for (let i = 1; i <= 6; i++) await post(bloqueada, i);
    expect((await post(bloqueada, 7)).status).toBe(429);

    // IP distinta, contador independiente
    expect((await post("203.0.113.100", 1)).status).toBe(201);
  });

  it("el rate limit se evalúa antes de gastar una verificación de Turnstile", async () => {
    const ip = "203.0.113.111";
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    for (let i = 1; i <= 5; i++) await post(ip, i);
    const antes = calls.siteverify.length;

    const res = await post(ip, 6);
    expect(res.status).toBe(429);
    // El 6º no llega a llamar a Siteverify
    expect(calls.siteverify.length).toBe(antes);
  });
});
