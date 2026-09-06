import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../worker/index.js";
import site from "../frontend/src/config/site.json";
import wranglerRaw from "../wrangler.jsonc?raw";

/**
 * ROUTING Y FUZZING.
 *
 * Dos capas distintas, y cada una se prueba donde de verdad decide:
 *
 *  1. **Estática.** `/wp-admin`, `/.env`, `/backup` no llegan al Worker: los
 *     resuelve Cloudflare Static Assets. Con `not_found_handling: "404-page"`
 *     devuelven 404 porque NO existe un asset con ese nombre. Lo que se puede
 *     verificar aquí, y es lo que importa, es que el manifiesto de rutas —el que
 *     genera los assets— no contiene ninguna de esas rutas y que la
 *     configuración que produce el 404 sigue en su sitio. La comprobación
 *     end-to-end con HTTP real está en scripts/acceptance-test.sh y en el
 *     checklist de despliegue.
 *
 *  2. **Del Worker.** Todo lo que empieza por /api/ (y /admin) sí pasa por el
 *     Worker, y ahí el 404 es responsabilidad del router. Eso se prueba
 *     invocando el Worker de verdad.
 *
 * El criterio es allowlist, nunca lista negra: se comprueba que el conjunto de
 * rutas válidas es EXACTAMENTE el declarado, no que unos cuantos nombres
 * conocidos estén bloqueados.
 */

async function call(request, overrides) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, { ...env, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function get(path, method = "GET") {
  return new Request(`https://vulnfocus.com${path}`, {
    method,
    headers: { "CF-Connecting-IP": "198.51.100.7" },
  });
}

const declaredPaths = site.routes.map((route) => route.path);

// Rutas que un escáner prueba siempre. La lista es para el test, NO para el
// código: en producción no existe ninguna lista negra.
const FUZZ_PATHS = [
  "/admin",
  "/administrator",
  "/wp-admin",
  "/wp-login.php",
  "/phpmyadmin",
  "/.env",
  "/.env.local",
  "/.git",
  "/.git/config",
  "/backup",
  "/backup.zip",
  "/config.php",
  "/server-status",
  "/actuator/health",
  "/random",
  "/asdasdasd",
  "/servicios/inventado",
  "/cotizar/algo",
  "/api",
  "/api/",
  "/api/random",
  "/api/admin",
  "/api/admin/quotes",
  "/api/users",
  "/api/logs",
  "/api/v1/quotes",
  "/api/contact/all",
];

// El recorrido de directorios se resuelve en el parser de URL, ANTES de que el
// router mire nada: `/api/quotes/../contact` ya llega como `/api/contact`. Se
// prueba aparte porque el resultado correcto no es 404 en todos los casos, sino
// "lo que corresponda a la ruta normalizada" — que es justamente la garantía
// buscada: no se puede alcanzar una ruta distinta de las declaradas.
const TRAVERSAL_CASES = [
  // Normaliza a /api/contact, que existe pero no admite GET.
  ["/api/quotes/../contact", 405],
  // Normaliza a /api/admin, que no existe con la administración apagada.
  ["/api/health/../admin", 404],
  // Normaliza a /api/health.
  ["/api/quotes/../health", 200],
  // Sale de /api por completo: no hay ruta.
  ["/api/../../etc/passwd", 404],
];

describe("Rutas legítimas del sitio", () => {
  it("las páginas exigidas están declaradas en el manifiesto", () => {
    for (const path of [
      "/",
      "/servicios",
      "/cotizar",
      "/proceso",
      "/recursos",
      "/certificaciones",
    ]) {
      expect(declaredPaths, `falta la ruta ${path}`).toContain(path);
    }
  });

  it("cada servicio del catálogo tiene su página declarada", () => {
    const servicePages = site.routes.filter((route) => route.service);
    expect(servicePages.length).toBeGreaterThanOrEqual(9);
    for (const route of servicePages) {
      expect(route.path.startsWith("/servicios/"), route.path).toBe(true);
    }
  });

  it("ninguna ruta de fuzzing está declarada como página del sitio", () => {
    for (const path of FUZZ_PATHS) {
      expect(declaredPaths, `${path} NO debe existir como asset`).not.toContain(path);
    }
  });

  it("el manifiesto no declara ninguna ruta administrativa", () => {
    for (const path of declaredPaths) {
      expect(path, path).not.toMatch(/admin|login|dashboard|panel|\.env|\.git/i);
    }
  });

  it("la configuración que produce el 404 real sigue activa", () => {
    // Sin esto, cualquier ruta volvería a devolver 200 + index.html.
    expect(wranglerRaw).toMatch(/"not_found_handling":\s*"404-page"/);
    expect(wranglerRaw).not.toMatch(/"not_found_handling":\s*"single-page-application"/);
  });
});

describe("Superficie del Worker: deny by default", () => {
  it("las rutas válidas de la API responden", async () => {
    const health = await call(get("/api/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
  });

  it("/api/health acepta HEAD y rechaza POST con 405", async () => {
    expect((await call(get("/api/health", "HEAD"))).status).toBe(200);
    const post = await call(get("/api/health", "POST"));
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET");
  });

  it.each(FUZZ_PATHS.filter((p) => p.startsWith("/api")))(
    "%s devuelve 404 en el Worker",
    async (path) => {
      const response = await call(get(path));
      expect(response.status).toBe(404);
      const body = await response.json();
      // Mensaje idéntico para todo: no se distingue "no existe" de "no autorizado".
      expect(body).toEqual({ status: "error", message: "Recurso no encontrado" });
    },
  );

  it("el 404 del Worker no revela nada en las cabeceras", async () => {
    const response = await call(get("/api/admin/quotes"));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    for (const header of ["Server", "X-Powered-By", "WWW-Authenticate", "Allow"]) {
      expect(response.headers.get(header), header).toBeNull();
    }
  });

  it("/admin devuelve 404 con la administración deshabilitada", async () => {
    for (const method of ["GET", "POST", "HEAD"]) {
      const response = await call(get("/admin", method), { ADMIN_ENABLED: "false" });
      expect(response.status, method).toBe(404);
    }
  });

  it("las rutas de la API solo aceptan su método", async () => {
    const cases = [
      ["/api/contact", "GET", "POST"],
      ["/api/quotes", "GET", "POST"],
      ["/api/quotes/" + "a".repeat(32), "POST", "GET"],
    ];
    for (const [path, method, allow] of cases) {
      const response = await call(get(path, method));
      expect(response.status, `${method} ${path}`).toBe(405);
      expect(response.headers.get("Allow")).toBe(allow);
    }
  });

  it.each(TRAVERSAL_CASES)(
    "%s se normaliza y resuelve como la ruta declarada (%i)",
    async (path, expected) => {
      const response = await call(get(path));
      expect(response.status).toBe(expected);
    },
  );

  it("una ruta anidada bajo /api/quotes/ no se convierte en superficie nueva", async () => {
    for (const path of [
      "/api/quotes/abc/def",
      "/api/quotes/abc/status",
      `/api/quotes/${"a".repeat(32)}/breakdown`,
    ]) {
      const response = await call(get(path));
      expect(response.status, path).toBe(404);
    }
  });

  it("la barra final no crea rutas distintas", async () => {
    expect((await call(get("/api/health/"))).status).toBe(200);
    expect((await call(get("/api/health///"))).status).toBe(200);
  });
});
