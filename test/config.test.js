import { describe, expect, it } from "vitest";
import wranglerRaw from "../wrangler.jsonc?raw";
import headersRaw from "../frontend/public/_headers?raw";
import pkg from "../package.json";
import { QUOTE_CONFIG } from "../worker/config/quote-config.js";
import { QUOTE_STATUSES } from "../worker/lib/quote/lifecycle.js";
import migration0002 from "../migrations/0002_quotes.sql?raw";
import migration0004 from "../migrations/0004_proposal_requests.sql?raw";
import devVarsExample from "../.dev.vars.example?raw";
import frontendEnvProduction from "../frontend/.env.production?raw";

/**
 * COHERENCIA DE LA CONFIGURACIÓN DE DESPLIEGUE.
 *
 * Estos tests existen porque la clase de fallo más caro de este proyecto no es
 * un bug de JavaScript: es un despliegue que "funciona" con la configuración
 * equivocada. Un `--env staging` sobreviviente crea un Worker sin D1 y sin
 * limitadores; un hostname de más en la allowlist de Turnstile deja una copia
 * pública del sitio; un `preload` de HSTS es irreversible en la práctica.
 *
 * Nada de esto lo detecta un test funcional, porque el código es correcto. Se
 * detecta comparando los ficheros de configuración entre sí.
 */

/**
 * JSONC → objeto. Elimina comentarios respetando cadenas y escapes: un
 * `"https://..."` dentro de un valor no es un comentario de línea.
 */
function parseJsonc(source) {
  let out = "";
  let inString = false;
  let escaped = false;
  let comment = null; // "line" | "block" | null

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (comment === "line") {
      if (ch === "\n") { comment = null; out += ch; }
      continue;
    }
    if (comment === "block") {
      if (ch === "*" && next === "/") { comment = null; i += 1; }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "/" && next === "/") { comment = "line"; i += 1; continue; }
    if (ch === "/" && next === "*") { comment = "block"; i += 1; continue; }
    out += ch;
  }

  // Comas finales, que JSONC admite y JSON.parse no.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const wrangler = parseJsonc(wranglerRaw);

describe("wrangler.jsonc — una sola fuente de configuración", () => {
  it("el nivel raíz es producción: no existen bloques env.*", () => {
    // Si alguien reintroduce `env`, los scripts sin --env dejarían de coincidir
    // con lo que se despliega y volvería la deriva que este test cierra.
    expect(wrangler.env).toBeUndefined();
  });

  it("declara nombre, entrypoint y compatibility_date", () => {
    expect(wrangler.name).toBe("vulnfocus-v2");
    expect(wrangler.main).toBe("worker/index.js");
    expect(wrangler.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Una fecha futura hace que Cloudflare rechace el despliegue.
    expect(new Date(wrangler.compatibility_date).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("ningún script de npm usa --env", () => {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect(command, `script "${name}"`).not.toMatch(/--env\b/);
    }
  });

  it("los scripts de base de datos apuntan a la D1 declarada en el binding", () => {
    const dbName = wrangler.d1_databases[0].database_name;
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (!command.includes("wrangler d1")) continue;
      expect(command, `script "${name}"`).toContain(dbName);
    }
  });

  it("no quedan scripts de entornos inexistentes", () => {
    for (const name of Object.keys(pkg.scripts)) {
      expect(name).not.toMatch(/staging/);
    }
    expect(pkg.scripts["db:migrate:staging"]).toBeUndefined();
    expect(pkg.scripts["deploy:production"]).toBeUndefined();
  });
});

describe("Static Assets y superficie del Worker", () => {
  it("las rutas desconocidas caen en un 404 real, no en el shell de la SPA", () => {
    expect(wrangler.assets.not_found_handling).toBe("404-page");
  });

  it("el Worker se ejecuta primero en /api/* y en /admin*", () => {
    // /admin* debe pasar por el Worker: si fuera un asset, existiría como
    // fichero y respondería 200 a cualquiera.
    expect(wrangler.assets.run_worker_first).toContain("/api/*");
    expect(wrangler.assets.run_worker_first).toContain("/admin");
    expect(wrangler.assets.run_worker_first).toContain("/admin/*");
  });

  it("el directorio de assets es el build del frontend", () => {
    expect(wrangler.assets.directory).toBe("./frontend/build");
  });
});

describe("Turnstile — allowlist de producción", () => {
  const hostnames = wrangler.vars.TURNSTILE_ALLOWED_HOSTNAMES.split(",").map((h) => h.trim());

  it("solo el dominio de producción y su www", () => {
    expect(hostnames).toEqual(["vulnfocus.com", "www.vulnfocus.com"]);
  });

  it("ningún hostname de workers.dev en producción", () => {
    for (const hostname of hostnames) {
      expect(hostname, hostname).not.toMatch(/workers\.dev$/);
    }
  });

  it("ningún hostname de desarrollo en producción", () => {
    for (const hostname of hostnames) {
      expect(hostname, hostname).not.toMatch(/^(localhost|127\.0\.0\.1|\[::1\])/);
    }
  });

  it("workers.dev queda deshabilitado: producción se sirve solo por dominio propio", () => {
    expect(wrangler.workers_dev).toBe(false);
  });
});

describe("Interruptores de producción", () => {
  it("PRICING_ENABLED sigue apagado mientras no haya tarifas reales", () => {
    const rates = Object.values(QUOTE_CONFIG.pricing.currencies).map((c) => c.hourlyRate);
    const anyRate = rates.some((rate) => Number.isFinite(rate) && rate > 0);
    if (!anyRate) {
      // Sin tarifa configurada, activar el flag no produciría precios: produciría
      // estimaciones "sin precio" con la promesa contraria en la configuración.
      expect(wrangler.vars.PRICING_ENABLED).toBe("false");
    }
  });

  it("la administración nace deshabilitada", () => {
    expect(wrangler.vars.ADMIN_ENABLED).toBe("false");
  });

  it("no se declara ningún proveedor externo sin credenciales", () => {
    expect(wrangler.vars.EMAIL_PROVIDER).toBe("null");
    expect(wrangler.vars.CRM_PROVIDER).toBe("null");
    expect(wrangler.vars.SYSREPTOR_ENABLED).toBe("false");
  });

  it("vars no contiene nada con aspecto de secreto", () => {
    // Los secretos van en Cloudflare Secrets. `vars` se ve en el panel y en el
    // resultado de `wrangler deploy`.
    for (const [key, value] of Object.entries(wrangler.vars)) {
      expect(key, key).not.toMatch(/SECRET|TOKEN|API_KEY|PASSWORD|PRIVATE/i);
      expect(String(value), key).not.toMatch(/^(sk-|re_|xox|ghp_|eyJ)/);
    }
  });
});

describe("Rate limiting", () => {
  it("hay un limitador por superficie y ningún namespace repetido", () => {
    const names = wrangler.ratelimits.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "CONTACT_RATE_LIMITER",
        "QUOTE_RATE_LIMITER",
        "QUOTE_READ_RATE_LIMITER",
        "ADMIN_RATE_LIMITER",
      ]),
    );
    const namespaces = wrangler.ratelimits.map((r) => r.namespace_id);
    expect(new Set(namespaces).size).toBe(namespaces.length);
  });

  it("los límites son finitos y con periodo declarado", () => {
    for (const limiter of wrangler.ratelimits) {
      expect(limiter.simple.limit, limiter.name).toBeGreaterThan(0);
      expect(limiter.simple.period, limiter.name).toBeGreaterThan(0);
    }
  });
});

describe("D1", () => {
  it("hay exactamente una base y con directorio de migraciones", () => {
    expect(wrangler.d1_databases).toHaveLength(1);
    const db = wrangler.d1_databases[0];
    expect(db.binding).toBe("DB");
    expect(db.migrations_dir).toBe("migrations");
    expect(db.database_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("los estados del CHECK de D1 coinciden con la máquina de estados", () => {
    // Si divergen, una transición válida en la aplicación fallaría en la base.
    //
    // El CHECK vigente es el de la ÚLTIMA migración que lo define: 0002 creó la
    // tabla y 0004 la reconstruyó para ampliar la restricción. Compararlo con
    // 0002 daría verde para siempre aunque el estado nuevo no hubiera llegado
    // nunca a la base.
    const vigente = [migration0002, migration0004]
      .map((sql) => /CHECK \(status IN \(([^)]+)\)\)/.exec(sql))
      .filter(Boolean)
      .pop();

    expect(vigente).toBeTruthy();
    const declared = vigente[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(declared.sort()).toEqual([...QUOTE_STATUSES].sort());
  });

  it("0004 reconstruye la tabla sin llevarse por delante el histórico", () => {
    // `quote_status_events` referencia `quotes` con ON DELETE CASCADE: soltar la
    // tabla padre con esa clave foránea armada borraría la auditoría entera. El
    // orden del fichero es la única defensa, y por eso se fija aquí.
    const copia = migration0004.indexOf("CREATE TABLE quote_status_events_backup");
    const sueltaHistorico = migration0004.indexOf("DROP TABLE quote_status_events;");
    const sueltaQuotes = migration0004.indexOf("DROP TABLE quotes;");
    const restaura = migration0004.indexOf("INSERT INTO quote_status_events (");

    for (const [nombre, posicion] of Object.entries({
      copia,
      sueltaHistorico,
      sueltaQuotes,
      restaura,
    })) {
      expect(posicion, nombre).toBeGreaterThan(-1);
    }

    expect(copia).toBeLessThan(sueltaHistorico);
    expect(sueltaHistorico).toBeLessThan(sueltaQuotes);
    expect(sueltaQuotes).toBeLessThan(restaura);
  });

  it("la solicitud de propuesta no puede duplicarse en la base", () => {
    // La idempotencia no depende de que el Worker se acuerde de comprobarla.
    expect(migration0004).toMatch(/CREATE TABLE IF NOT EXISTS quote_proposal_requests/);
    expect(migration0004).toMatch(/quote_id\s+TEXT NOT NULL UNIQUE/);
  });
});

describe("_headers de Static Assets", () => {
  it("HSTS con includeSubDomains y SIN preload", () => {
    const line = headersRaw
      .split("\n")
      .find((l) => /^\s+Strict-Transport-Security:/.test(l));
    expect(line, "falta la cabecera HSTS").toBeTruthy();
    expect(line).toContain("max-age=31536000");
    expect(line).toContain("includeSubDomains");
    // `preload` es una decisión irreversible en la práctica: la lista va
    // compilada en los navegadores. Ver el comentario del propio _headers.
    expect(line).not.toContain("preload");
  });

  it("no se anuncia preload en ninguna cabecera activa", () => {
    const active = headersRaw
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(active).not.toMatch(/preload/);
  });

  it("la CSP no permite scripts inline ni eval", () => {
    const csp = headersRaw.split("\n").find((l) => /^\s+Content-Security-Policy:/.test(l));
    expect(csp).toBeTruthy();
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/'unsafe-eval'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("las cabeceras defensivas básicas están presentes", () => {
    for (const header of [
      "X-Content-Type-Options: nosniff",
      "X-Frame-Options: DENY",
      "Referrer-Policy:",
      "Permissions-Policy:",
      "Cross-Origin-Opener-Policy:",
    ]) {
      expect(headersRaw, header).toContain(header);
    }
  });
});

describe("Nada con aspecto de secreto real en el repositorio", () => {
  // Patrones de credenciales reales de los proveedores que usa el proyecto.
  // Deliberadamente NO incluye la clave de PRUEBA de Turnstile
  // (1x0000000000000000000000000000000AA), que Cloudflare publica en su
  // documentación precisamente para esto.
  const SECRET_PATTERNS = [
    [/re_[A-Za-z0-9]{20,}/, "clave de Resend"],
    [/sk-[A-Za-z0-9]{20,}/, "clave secreta genérica"],
    [/sk_live_|pk_live_/, "clave de pago en producción"],
    [/ghp_[A-Za-z0-9]{30,}|github_pat_/, "token de GitHub"],
    [/xox[baprs]-/, "token de Slack"],
    [/AKIA[0-9A-Z]{16}/, "clave de AWS"],
    [/AIza[0-9A-Za-z_-]{30,}/, "clave de Google"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "clave privada"],
    [/[0-9]{8,10}:[A-Za-z0-9_-]{35}/, "token de bot de Telegram"],
    [/0x4[A-Za-z0-9_-]{20,}/, "clave real de Turnstile"],
    [/eyJhbGciOi[A-Za-z0-9_-]{10,}/, "JWT emitido"],
  ];

  const FILES = {
    "wrangler.jsonc": wranglerRaw,
    ".dev.vars.example": devVarsExample,
    "frontend/.env.production": frontendEnvProduction,
    "frontend/public/_headers": headersRaw,
    "package.json": JSON.stringify(pkg),
  };

  it.each(Object.keys(FILES))("%s no contiene credenciales", (name) => {
    for (const [pattern, label] of SECRET_PATTERNS) {
      expect(FILES[name], `${name}: posible ${label}`).not.toMatch(pattern);
    }
  });

  it(".dev.vars.example solo trae valores de prueba o vacíos", () => {
    for (const line of devVarsExample.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      const value = rest.join("=").trim();
      if (value === "") continue;
      // Clave de PRUEBA documentada por Cloudflare, hostnames y "false"/"null".
      const allowed =
        value === "1x0000000000000000000000000000000AA" ||
        /^(true|false|null|CLP|USD)$/i.test(value) ||
        /^[a-z0-9.,:_-]+$/i.test(value);
      expect(allowed, `${key} tiene un valor que no parece de prueba`).toBe(true);
    }
  });

  it("frontend/.env.production no incluye ningún secreto de servidor", () => {
    // CRA incrusta todo lo que empieza por REACT_APP_ en el bundle público.
    for (const line of frontendEnvProduction.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const key = trimmed.split("=")[0];
      expect(key, `${key} acabaría en el bundle público`).not.toMatch(
        /SECRET|TELEGRAM|RESEND|MAILCHANNELS|PRIVATE|_AUD$/i,
      );
    }
  });

  it("el site key de Turnstile sigue siendo un marcador o un site key público", () => {
    const match = /REACT_APP_TURNSTILE_SITE_KEY=(.+)/.exec(frontendEnvProduction);
    expect(match, "falta REACT_APP_TURNSTILE_SITE_KEY").toBeTruthy();
    const value = match[1].trim();
    // El site key es PÚBLICO por diseño. Lo que se vigila es que no se cuele
    // aquí una clave *secreta* (que empieza por 0x4 o 1x/2x/3x seguido de
    // 000...), que sí sería un incidente.
    expect(value).not.toMatch(/^(1x|2x|3x)0{20,}/);
  });
});
