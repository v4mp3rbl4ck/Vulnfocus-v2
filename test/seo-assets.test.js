import { describe, expect, it } from "vitest";
import indexHtml from "../frontend/public/index.html?raw";
import robots from "../frontend/public/robots.txt?raw";
import manifest from "../frontend/public/manifest.json";
import site from "../frontend/src/config/site.json";
import buildSite from "../scripts/build-site.mjs?raw";

// Vite resuelve estos imports en tiempo de build: si el fichero NO existe, el
// import falla y el test no llega ni a ejecutarse. Es exactamente la garantía
// que hace falta: los siete PNG estaban referenciados y ninguno existía.
import faviconSvg from "../frontend/public/favicon.svg?raw";
import favicon16 from "../frontend/public/favicon-16x16.png?url";
import favicon32 from "../frontend/public/favicon-32x32.png?url";
import appleTouch from "../frontend/public/apple-touch-icon.png?url";
import icon192 from "../frontend/public/icon-192x192.png?url";
import icon512 from "../frontend/public/icon-512x512.png?url";
import logoPng from "../frontend/public/logo.png?url";
import ogImage from "../frontend/public/og-image.png?url";

/**
 * ASSETS DE SEO Y DE MARCA.
 *
 * Este test existe por un fallo concreto: `index.html` y `manifest.json`
 * referenciaban siete PNG que no estaban en el repositorio. Nada lo detectaba —
 * el build compilaba, los tests pasaban y el sitio se veía bien— porque el
 * síntoma es un 404 silencioso y una previsualización vacía al compartir el
 * enlace.
 *
 * La comprobación es que TODO lo referenciado existe de verdad. No se validan
 * los píxeles: eso es diseño, no corrección.
 */

const PRESENT = {
  "/favicon-16x16.png": favicon16,
  "/favicon-32x32.png": favicon32,
  "/apple-touch-icon.png": appleTouch,
  "/icon-192x192.png": icon192,
  "/icon-512x512.png": icon512,
  "/logo.png": logoPng,
  "/og-image.png": ogImage,
};

describe("Los assets referenciados existen", () => {
  it.each(Object.keys(PRESENT))("%s está en frontend/public", (name) => {
    expect(PRESENT[name]).toBeTruthy();
  });

  it("el escudo SVG sigue siendo la fuente de la marca", () => {
    expect(faviconSvg).toContain("#0080FF");
    expect(faviconSvg).toContain("#FF4458");
  });

  it("todo icono del manifiesto existe", () => {
    for (const icon of manifest.icons) {
      const known = icon.src === "/favicon.svg" || Object.keys(PRESENT).includes(icon.src);
      expect(known, `icono no existente: ${icon.src}`).toBe(true);
    }
  });

  it("el manifiesto declara los tamaños que Android e iOS necesitan", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const maskable = manifest.icons.filter((i) => (i.purpose || "").includes("maskable"));
    expect(maskable.length).toBeGreaterThanOrEqual(2);
  });

  it("todo href/src local de index.html apunta a un fichero real", () => {
    const referenced = [...indexHtml.matchAll(/(?:href|content|src)="(\/[^"]+)"/g)].map((m) => m[1]);
    const known = new Set([
      ...Object.keys(PRESENT),
      "/favicon.svg",
      "/manifest.json",
      "/",
    ]);
    for (const ref of referenced) {
      // Los assets con hash los inyecta el build de CRA.
      if (ref.startsWith("/static/")) continue;
      expect(known, `referencia sin fichero: ${ref}`).toContain(ref);
    }
  });

  it("las URL absolutas de imagen apuntan al dominio de producción", () => {
    const images = [...indexHtml.matchAll(/content="(https:\/\/[^"]+\.(?:png|jpg|svg))"/g)].map(
      (m) => m[1],
    );
    expect(images.length).toBeGreaterThan(0);
    for (const url of images) {
      expect(url.startsWith("https://vulnfocus.com/"), url).toBe(true);
      const path = url.replace("https://vulnfocus.com", "");
      expect(Object.keys(PRESENT), path).toContain(path);
    }
  });
});

describe("Metadatos por ruta", () => {
  it("el generador emite la og:image que existe", () => {
    expect(buildSite).toContain("/og-image.png");
  });

  it("el shell declara los marcadores que sustituye el post-build", () => {
    expect(indexHtml).toContain('name="vf-seo" content="start"');
    expect(indexHtml).toContain('name="vf-seo" content="end"');
  });

  it("Open Graph y Twitter Card completos en el shell", () => {
    for (const tag of [
      'property="og:type"',
      'property="og:title"',
      'property="og:description"',
      'property="og:image"',
      'property="og:url"',
      'name="twitter:card" content="summary_large_image"',
      'name="twitter:image"',
      'rel="canonical"',
      'rel="manifest"',
    ]) {
      expect(indexHtml, tag).toContain(tag);
    }
  });

  it("no se publica ningún dato estructurado inventado", () => {
    // Ni valoraciones, ni reseñas, ni premios, ni precios: no existen.
    for (const forbidden of [
      "AggregateRating",
      "aggregateRating",
      "Review",
      "ratingValue",
      "reviewCount",
      "award",
      "priceRange",
      "Offer",
    ]) {
      expect(indexHtml, forbidden).not.toContain(forbidden);
      expect(buildSite, forbidden).not.toContain(forbidden);
    }
  });

  it("robots.txt protege la API y la consulta de estimaciones", () => {
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /estimacion");
    expect(robots).toContain("Sitemap: https://vulnfocus.com/sitemap.xml");
    // El panel no se menciona: nombrarlo en robots.txt sería publicarlo.
    expect(robots).not.toContain("/admin");
  });

  it("el sitemap sale del manifiesto y excluye lo no indexable", () => {
    const indexable = site.routes.filter((r) => !r.noindex);
    expect(indexable.length).toBeGreaterThanOrEqual(15);
    expect(site.routes.find((r) => r.path === "/estimacion").noindex).toBe(true);
  });
});
