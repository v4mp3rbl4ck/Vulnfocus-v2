#!/usr/bin/env node
/**
 * POST-BUILD DEL SITIO — prerenderizado por ruta, 404 real y sitemap.
 *
 * Por qué existe
 * --------------
 * La SPA se sirve como Static Assets de Cloudflare. Con
 * `not_found_handling: "single-page-application"` CUALQUIER ruta devolvía
 * 200 + index.html: `/wp-admin`, `/.env` o `/backup` parecían recursos reales y
 * los rastreadores indexaban páginas inexistentes.
 *
 * El conjunto de rutas públicas es finito y se conoce en tiempo de build, así
 * que este script materializa UN HTML POR RUTA. Con
 * `not_found_handling: "404-page"`, lo que no existe como asset cae en
 * `404.html` y devuelve un 404 real. Es una allowlist por construcción, no una
 * lista negra de nombres comunes, y mantiene 0 invocaciones del Worker para el
 * tráfico estático.
 *
 * Efecto secundario deseado: cada URL sale del build con su <title>,
 * description, canonical, Open Graph y JSON-LD ya en el HTML, visibles para
 * rastreadores que no ejecutan JavaScript.
 *
 * Uso:  node scripts/build-site.mjs [--build-dir frontend/build] [--check]
 *       --check  no escribe: solo verifica que el build tiene una página por ruta.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "frontend/src/config/site.json");

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes("--check");
const buildDirArg = argv.indexOf("--build-dir");
const BUILD_DIR = resolve(
  ROOT,
  buildDirArg !== -1 ? argv[buildDirArg + 1] : "frontend/build",
);

// Marcadores del bloque reemplazable. Son <meta> y no comentarios porque el
// minificador de HTML de CRA borra los comentarios en producción.
const START = '<meta name="vf-seo" content="start">';
const END = '<meta name="vf-seo" content="end">';
/** Localiza el marcador tolerando `/>` o `>` y el orden de atributos del minificador. */
function findMarker(html, kind) {
  const re = new RegExp(`<meta[^>]*name=["']vf-seo["'][^>]*content=["']${kind}["'][^>]*>`, "i");
  const m = re.exec(html);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

const site = JSON.parse(readFileSync(MANIFEST, "utf8"));
const BASE = site.baseUrl.replace(/\/+$/, "");

/** Escapa para insertar dentro de un atributo HTML entre comillas dobles. */
function attr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escapa para insertar como texto de un elemento. */
function text(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** URL canónica absoluta de una ruta del manifiesto. */
function absUrl(path) {
  return path === "/" ? `${BASE}/` : `${BASE}${path}`;
}

/**
 * Fichero de destino dentro de build/ para una ruta.
 *
 * Se escribe `<ruta>.html`, NO `<ruta>/index.html`. Con `html_handling` en su
 * valor por defecto ("auto-trailing-slash"), Cloudflare sirve `/servicios`
 * directamente desde `servicios.html` con un 200; si el fichero estuviera en
 * `servicios/index.html`, `/servicios` respondería 307 hacia `/servicios/`, que
 * no es la URL canónica que declaran las páginas ni la del sitemap. Verificado
 * con `wrangler dev`.
 */
function outFile(path) {
  return path === "/" ? join(BUILD_DIR, "index.html") : join(BUILD_DIR, `${path}.html`);
}

/**
 * JSON-LD específico de la ruta. Solo se emite lo que es verificable desde el
 * propio sitio: migas de pan y el tipo de servicio. Nada de agregados de
 * valoraciones, reseñas ni precios: no existen y serían datos inventados.
 */
function structuredData(route, seo) {
  const blocks = [];
  const segments = route.path.split("/").filter(Boolean);

  if (segments.length > 0) {
    const items = [{ name: "Inicio", url: `${BASE}/` }];
    let acc = "";
    for (const seg of segments) {
      acc += `/${seg}`;
      const known = site.routes.find((r) => r.path === acc);
      items.push({
        name: known ? known.seo.es.title.split("|")[0].trim() : seg,
        url: absUrl(acc),
      });
    }
    blocks.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name,
        item: it.url,
      })),
    });
  }

  if (route.service) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "Service",
      name: seo.title.split("|")[0].trim(),
      description: seo.description,
      serviceType: "Penetration testing",
      provider: { "@type": "Organization", name: "VulnFocus", url: BASE },
      areaServed: { "@type": "Country", name: "Chile" },
      url: absUrl(route.path),
    });
  }

  return blocks
    .map((b) => `\n        <script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join("");
}

/** Bloque SEO completo que sustituye a VF_SEO_START…VF_SEO_END. */
function seoBlock(route) {
  const seo = route.seo[site.defaultLocale];
  const url = absUrl(route.path);
  const noindex = route.noindex === true;
  const image = `${BASE}/og-image.png`;
  const lines = [
    `<title>${text(seo.title)}</title>`,
    `<meta name="description" content="${attr(seo.description)}" />`,
  ];
  if (seo.keywords) lines.push(`<meta name="keywords" content="${attr(seo.keywords)}" />`);
  lines.push(`<meta name="robots" content="${noindex ? "noindex, nofollow" : "index, follow"}" />`);
  // La página de error no es un recurso canónico de nada: declararse canónica de
  // sí misma la convertiría en una URL indexable más.
  if (!route.isErrorPage) lines.push(`<link rel="canonical" href="${attr(url)}" />`);
  if (!noindex) {
    lines.push(
      `<link rel="alternate" hreflang="es" href="${attr(url)}" />`,
      `<link rel="alternate" hreflang="en" href="${attr(`${url}${url.includes("?") ? "&" : "?"}lang=en`)}" />`,
      `<link rel="alternate" hreflang="x-default" href="${attr(url)}" />`,
    );
  }
  lines.push(
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${attr(site.brand)}" />`,
    `<meta property="og:locale" content="es_CL" />`,
    `<meta property="og:url" content="${attr(url)}" />`,
    `<meta property="og:title" content="${attr(seo.title)}" />`,
    `<meta property="og:description" content="${attr(seo.description)}" />`,
    `<meta property="og:image" content="${attr(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${attr(seo.title)}" />`,
    `<meta name="twitter:description" content="${attr(seo.description)}" />`,
    `<meta name="twitter:image" content="${attr(image)}" />`,
  );

  const body = lines.map((l) => `        ${l}`).join("\n");
  return `${START}\n${body}${noindex ? "" : structuredData(route, seo)}\n        ${END}`;
}

function sitemap() {
  const urls = site.routes
    .filter((r) => r.noindex !== true)
    .map((r) => {
      const s = r.sitemap || {};
      const url = absUrl(r.path);
      return [
        "    <url>",
        `        <loc>${text(url)}</loc>`,
        `        <xhtml:link rel="alternate" hreflang="es" href="${attr(url)}"/>`,
        `        <xhtml:link rel="alternate" hreflang="en" href="${attr(`${url}?lang=en`)}"/>`,
        s.changefreq ? `        <changefreq>${s.changefreq}</changefreq>` : null,
        s.priority ? `        <priority>${s.priority}</priority>` : null,
        "    </url>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generado por scripts/build-site.mjs desde frontend/src/config/site.json. No editar a mano. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

// ---------------------------------------------------------------------------

const indexPath = join(BUILD_DIR, "index.html");
if (!existsSync(indexPath)) {
  console.error(`[build-site] No existe ${indexPath}. Ejecuta el build del frontend primero.`);
  process.exit(1);
}

if (CHECK_ONLY) {
  const missing = site.routes.map((r) => outFile(r.path)).filter((f) => !existsSync(f));
  if (!existsSync(join(BUILD_DIR, "404.html"))) missing.push(join(BUILD_DIR, "404.html"));
  if (missing.length > 0) {
    console.error("[build-site] FALTAN páginas en el build:");
    missing.forEach((m) => console.error(`  · ${m}`));
    process.exit(1);
  }
  console.log(`[build-site] OK — ${site.routes.length} rutas + 404.html presentes.`);
  process.exit(0);
}

const shell = readFileSync(indexPath, "utf8");
const markerStart = findMarker(shell, "start");
const markerEnd = findMarker(shell, "end");
if (!markerStart || !markerEnd) {
  console.error(
    `[build-site] El shell no contiene los marcadores ${START} … ${END}. ` +
      "Revisa frontend/public/index.html.",
  );
  process.exit(1);
}

const head = shell.slice(0, markerStart.start);
const tail = shell.slice(markerEnd.end);

let written = 0;
for (const route of site.routes) {
  const file = outFile(route.path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${head}${seoBlock(route)}${tail}`, "utf8");
  written += 1;
}

// 404: mismo shell de la SPA (React monta la página de error), pero servido por
// Cloudflare con código 404 gracias a assets.not_found_handling = "404-page".
writeFileSync(
  join(BUILD_DIR, "404.html"),
  `${head}${seoBlock({
    path: "/404",
    noindex: true,
    isErrorPage: true,
    seo: {
      es: {
        title: "Página no encontrada | VulnFocus",
        description: "La página solicitada no existe.",
        keywords: "",
      },
    },
  })}${tail}`,
  "utf8",
);

writeFileSync(join(BUILD_DIR, "sitemap.xml"), sitemap(), "utf8");

console.log(
  `[build-site] ${written} rutas prerenderizadas + 404.html + sitemap.xml en ${BUILD_DIR}`,
);
const top = readdirSync(BUILD_DIR).filter((f) => !f.startsWith("."));
console.log(`[build-site] raíz del build: ${top.join(" ")}`);
