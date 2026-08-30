import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile, parseAllowedHostnames } from "../worker/lib/turnstile.js";
import { mockOutboundFetch, okSiteverify } from "./helpers.js";

const ALLOWED = ["vulnfocus.com", "www.vulnfocus.com"];
const TOKEN = "0.token-de-prueba";

afterEach(() => vi.unstubAllGlobals());

describe("verifyTurnstile", () => {
  it("acepta un token válido con hostname en la allowlist", async () => {
    mockOutboundFetch({ siteverify: okSiteverify("vulnfocus.com") });
    const r = await verifyTurnstile(TOKEN, "203.0.113.10", env, ALLOWED);
    expect(r.ok).toBe(true);
  });

  it("envía secret, response, remoteip e idempotency_key (UUID v4) al endpoint oficial", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    await verifyTurnstile(TOKEN, "203.0.113.10", env, ALLOWED);

    expect(calls.siteverify).toHaveLength(1);
    const body = calls.siteverify[0];
    expect(body.secret).toBe(env.TURNSTILE_SECRET_KEY);
    expect(body.response).toBe(TOKEN);
    expect(body.remoteip).toBe("203.0.113.10");
    expect(body.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("genera un idempotency_key distinto por cada intento de verificación", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    await verifyTurnstile(TOKEN, "", env, ALLOWED);
    await verifyTurnstile(TOKEN, "", env, ALLOWED);
    expect(calls.siteverify[0].idempotency_key).not.toBe(calls.siteverify[1].idempotency_key);
  });

  it("omite remoteip cuando no hay IP de cliente", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    await verifyTurnstile(TOKEN, "", env, ALLOWED);
    expect(calls.siteverify[0]).not.toHaveProperty("remoteip");
  });

  it("rechaza token ausente sin llegar a llamar a Siteverify", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    const r = await verifyTurnstile(undefined, "", env, ALLOWED);
    expect(r).toEqual({ ok: false, reason: "missing-token" });
    expect(calls.siteverify).toHaveLength(0);
  });

  it("rechaza token inválido (invalid-input-response)", async () => {
    mockOutboundFetch({
      siteverify: { success: false, "error-codes": ["invalid-input-response"] },
    });
    const r = await verifyTurnstile(TOKEN, "", env, ALLOWED);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-input-response");
  });

  it("rechaza token ya gastado o expirado (timeout-or-duplicate)", async () => {
    mockOutboundFetch({
      siteverify: { success: false, "error-codes": ["timeout-or-duplicate"] },
    });
    const r = await verifyTurnstile(TOKEN, "", env, ALLOWED);
    expect(r).toEqual({ ok: false, reason: "timeout-or-duplicate" });
  });

  it("rechaza hostname fuera de la allowlist", async () => {
    mockOutboundFetch({ siteverify: okSiteverify("atacante.tld") });
    const r = await verifyTurnstile(TOKEN, "", env, ALLOWED);
    expect(r).toEqual({ ok: false, reason: "hostname-mismatch" });
  });

  it("rechaza un sufijo malicioso: la allowlist es exacta, no endsWith()", async () => {
    mockOutboundFetch({ siteverify: okSiteverify("vulnfocus.com.atacante.tld") });
    const r = await verifyTurnstile(TOKEN, "", env, ALLOWED);
    expect(r).toEqual({ ok: false, reason: "hostname-mismatch" });
  });

  it("fail closed ante error de red", async () => {
    mockOutboundFetch({ siteverify: new Error("ECONNREFUSED") });
    const r = await verifyTurnstile(TOKEN, "", env, ALLOWED);
    expect(r).toEqual({ ok: false, reason: "siteverify-unreachable" });
  });

  it("fail closed ante respuesta HTTP 5xx de Siteverify", async () => {
    mockOutboundFetch({ siteverify: {}, siteverifyStatus: 503 });
    const r = await verifyTurnstile(TOKEN, "", env, ALLOWED);
    expect(r).toEqual({ ok: false, reason: "siteverify-http-503" });
  });

  it("fail closed ante JSON inválido en la respuesta", async () => {
    mockOutboundFetch({ siteverify: "invalid-json" });
    const r = await verifyTurnstile(TOKEN, "", env, ALLOWED);
    expect(r).toEqual({ ok: false, reason: "siteverify-unreachable" });
  });

  it("fail closed si el secreto no está configurado", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    const r = await verifyTurnstile(TOKEN, "", { ...env, TURNSTILE_SECRET_KEY: "" }, ALLOWED);
    expect(r).toEqual({ ok: false, reason: "not-configured" });
    expect(calls.siteverify).toHaveLength(0);
  });

  it("no acepta tokens desmesurados (posible abuso de payload)", async () => {
    const calls = mockOutboundFetch({ siteverify: okSiteverify() });
    const r = await verifyTurnstile("x".repeat(2049), "", env, ALLOWED);
    expect(r).toEqual({ ok: false, reason: "missing-token" });
    expect(calls.siteverify).toHaveLength(0);
  });
});

describe("parseAllowedHostnames", () => {
  it("lee la allowlist declarada en vars", () => {
    expect(parseAllowedHostnames(env)).toEqual(["vulnfocus.com", "www.vulnfocus.com"]);
  });

  it("devuelve lista vacía si no está configurada", () => {
    expect(parseAllowedHostnames({})).toEqual([]);
  });
});
