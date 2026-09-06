import { describe, expect, it } from "vitest";
import catalog from "../frontend/src/config/quote-catalog.json";
import site from "../frontend/src/config/site.json";
import { QUOTE_CONFIG } from "../worker/config/quote-config.js";

/**
 * Coherencia entre las cuatro fuentes de configuración del sitio.
 *
 * Son ficheros de datos que evolucionan por separado y que nada obliga a
 * mantener sincronizados: si alguien añade un servicio al catálogo y se olvida
 * de su regla de horas, el motor lo cotizaría a precio de base sin avisar. Esta
 * suite es esa alarma.
 */
describe("Manifiesto de rutas", () => {
  it("no hay rutas duplicadas y todas empiezan por /", () => {
    const paths = site.routes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith("/")).toBe(true);
  });

  it("ninguna ruta acaba en barra (evita duplicar la URL canónica)", () => {
    for (const route of site.routes) {
      if (route.path === "/") continue;
      expect(route.path.endsWith("/"), route.path).toBe(false);
    }
  });

  it("toda ruta declara SEO en los dos idiomas", () => {
    for (const route of site.routes) {
      for (const lang of ["es", "en"]) {
        const seo = route.seo[lang];
        expect(seo, `${route.path}.${lang}`).toBeTruthy();
        expect(seo.title.length, `${route.path}.${lang}.title`).toBeGreaterThan(10);
        expect(seo.description, `${route.path}.${lang}.description`).toBeTruthy();
      }
    }
  });

  it("los títulos y descripciones indexables caben en un resultado de búsqueda", () => {
    // Google recorta alrededor de 60 caracteres de título y 160 de descripción.
    // Se admite algo de margen; lo que se vigila es que nadie escriba un
    // párrafo entero ni deje una descripción telegráfica en una página pública.
    for (const route of site.routes) {
      if (route.noindex) continue;
      for (const lang of ["es", "en"]) {
        const seo = route.seo[lang];
        expect(seo.title.length, `${route.path}.${lang}.title`).toBeLessThanOrEqual(75);
        expect(seo.description.length, `${route.path}.${lang}.description`).toBeGreaterThan(70);
        expect(seo.description.length, `${route.path}.${lang}.description`).toBeLessThanOrEqual(200);
      }
    }
  });

  it("las páginas indexables declaran prioridad de sitemap y la privada no", () => {
    for (const route of site.routes) {
      if (route.noindex) continue;
      expect(route.sitemap?.priority, route.path).toBeTruthy();
    }
    // La consulta de una estimación no debe entrar en el sitemap.
    expect(site.routes.find((r) => r.path === "/estimacion").noindex).toBe(true);
  });

  it("cada servicio del cotizador tiene su página declarada como ruta", () => {
    const paths = new Set(site.routes.map((r) => r.path));
    const servicePaths = site.routes.filter((r) => r.service).map((r) => r.service);
    for (const id of catalog.services.map((s) => s.id)) {
      expect(servicePaths, `servicio sin página: ${id}`).toContain(id);
    }
    expect(paths.has("/cotizar")).toBe(true);
    expect(paths.has("/estimacion")).toBe(true);
  });
});

describe("Catálogo del cotizador y configuración comercial", () => {
  it("cada servicio del catálogo tiene configuración de esfuerzo", () => {
    for (const service of catalog.services) {
      expect(QUOTE_CONFIG.effort.services[service.id], service.id).toBeTruthy();
      expect(QUOTE_CONFIG.effort.services[service.id].baseHours).toBeGreaterThan(0);
    }
  });

  it("no hay reglas huérfanas: toda regla apunta a una pregunta existente", () => {
    for (const service of catalog.services) {
      const questionIds = new Set(service.questions.map((q) => q.id));
      const config = QUOTE_CONFIG.effort.services[service.id];
      for (const key of Object.keys(config.scope || {})) {
        expect(questionIds, `${service.id}.scope.${key}`).toContain(key);
      }
      for (const key of Object.keys(config.complexity || {})) {
        expect(questionIds, `${service.id}.complexity.${key}`).toContain(key);
      }
    }
    const contextIds = new Set(catalog.context.questions.map((q) => q.id));
    for (const key of Object.keys(QUOTE_CONFIG.effort.context)) {
      expect(contextIds, `context.${key}`).toContain(key);
    }
  });

  it("toda pregunta influye en el cálculo: no se pide información que no se usa", () => {
    for (const service of catalog.services) {
      const config = QUOTE_CONFIG.effort.services[service.id];
      for (const question of service.questions) {
        const used = Boolean(config.scope?.[question.id] || config.complexity?.[question.id]);
        expect(used, `pregunta sin efecto: ${service.id}.${question.id}`).toBe(true);
      }
    }
  });

  it("toda pregunta y opción está en los dos idiomas", () => {
    const check = (labels, ref) => {
      expect(labels?.es, `${ref}.es`).toBeTruthy();
      expect(labels?.en, `${ref}.en`).toBeTruthy();
    };
    for (const service of catalog.services) {
      check(service.labels, service.id);
      check(service.summary, `${service.id}.summary`);
      for (const q of service.questions) {
        check(q.labels, `${service.id}.${q.id}`);
        for (const o of q.options || []) check(o.labels, `${service.id}.${q.id}.${o.value}`);
      }
    }
    for (const q of catalog.context.questions) {
      check(q.labels, `context.${q.id}`);
      for (const o of q.options || []) check(o.labels, `context.${q.id}.${o.value}`);
    }
    for (const f of catalog.contact.fields) check(f.labels, `contact.${f.id}`);
  });

  it("los valores por defecto son válidos según su propia definición", () => {
    const all = [
      ...catalog.services.flatMap((s) => s.questions),
      ...catalog.context.questions,
    ];
    for (const q of all) {
      if (q.default === undefined) continue;
      if (q.type === "number") {
        expect(Number.isInteger(q.default), q.id).toBe(true);
        expect(q.default).toBeGreaterThanOrEqual(q.min);
        expect(q.default).toBeLessThanOrEqual(q.max);
      }
      if (q.type === "select") {
        expect(q.options.map((o) => o.value), q.id).toContain(q.default);
      }
      if (q.type === "multiselect") {
        const allowed = q.options.map((o) => o.value);
        for (const v of q.default) expect(allowed, q.id).toContain(v);
      }
      if (q.type === "boolean") expect(typeof q.default).toBe("boolean");
    }
  });

  it("los tramos de las reglas 'tiers' están ordenados y terminan en un tramo abierto", () => {
    for (const [serviceId, config] of Object.entries(QUOTE_CONFIG.effort.services)) {
      for (const [key, rule] of Object.entries(config.scope || {})) {
        if (rule.type !== "tiers") continue;
        const ref = `${serviceId}.${key}`;
        const bounded = rule.tiers.filter((t) => t.upTo !== null && t.upTo !== undefined);
        for (let i = 1; i < bounded.length; i++) {
          expect(bounded[i].upTo, ref).toBeGreaterThan(bounded[i - 1].upTo);
        }
        expect(rule.tiers[rule.tiers.length - 1].upTo, `${ref}: falta tramo abierto`).toBeNull();
      }
    }
  });

  it("la configuración de precios no trae valores comerciales inventados", () => {
    for (const [code, money] of Object.entries(QUOTE_CONFIG.pricing.currencies)) {
      expect(money.hourlyRate, `${code}.hourlyRate debe quedar sin definir`).toBeNull();
      expect(money.minimumAmount, `${code}.minimumAmount debe quedar sin definir`).toBeNull();
    }
  });
});
