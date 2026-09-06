# Assets de SEO y de marca

## Qué pasaba

`frontend/public/index.html` y `manifest.json` referenciaban **siete ficheros PNG
que no existían en el repositorio**:

```
/favicon-16x16.png      /icon-192x192.png      /og-image.png
/favicon-32x32.png      /icon-512x512.png      /logo.png
/apple-touch-icon.png
```

Consecuencias reales, todas silenciosas:

- Cada visita pedía esos ficheros y recibía **404**.
- Compartir cualquier URL en LinkedIn, WhatsApp, Slack o X producía una
  **previsualización vacía**: la etiqueta `og:image` apuntaba a un 404.
- Instalar la aplicación desde Android mostraba **icono roto**.
- El `logo` del JSON-LD de `Organization` apuntaba a un 404, así que Google no
  podía asociar ningún logotipo a la entidad.

Nada de esto lo detectaba el build ni la suite de tests: el sitio compilaba y se
veía bien. Por eso ahora hay un test (`test/seo-assets.test.js`) que falla si
vuelve a referenciarse un asset inexistente.

## Qué hay ahora

| Fichero | Tamaño | Origen | Naturaleza |
|---|---|---|---|
| `favicon.svg` | vectorial | **ya existía** | **Marca real** |
| `favicon-16x16.png` | 16×16 | derivado del SVG | Rasterización de la marca real |
| `favicon-32x32.png` | 32×32 | derivado del SVG | Rasterización de la marca real |
| `apple-touch-icon.png` | 180×180 | derivado del SVG | Rasterización + fondo opaco |
| `icon-192x192.png` | 192×192 | derivado del SVG | Rasterización, zona segura *maskable* |
| `icon-512x512.png` | 512×512 | derivado del SVG | Rasterización, zona segura *maskable* |
| `logo.png` | 512×512 | compuesto | **ASSET TÉCNICO — sustituible** |
| `og-image.png` | 1200×630 | compuesto | **ASSET TÉCNICO — sustituible** |

### Qué significa "derivado del SVG"

No se ha inventado una identidad visual. `scripts/generate-brand-assets.py`
dibuja **exactamente** el escudo de `frontend/public/favicon.svg`: las mismas
coordenadas de los dos `<path>` y los mismos dos colores, `#0080FF` y `#FF4458`.
Los iconos son la marca que ya existía, en los tamaños que faltaban.

### BRANDING ASSET REQUIRED

Dos piezas son **técnicas** y conviene sustituirlas por diseño real:

- **`og-image.png`** — tarjeta 1200×630 con el escudo, el nombre y la descripción
  de actividad que ya está en el sitio. Tipografía del sistema (DejaVu Sans), no
  una tipografía de marca. Cumple su función: la previsualización deja de estar
  vacía y no dice nada falso.
- **`logo.png`** — escudo sobre fondo oscuro con el nombre debajo. Suficiente para
  el JSON-LD; un logotipo diseñado quedaría mejor.

**Lo que NO contienen, y no debe añadirse sin que sea cierto:** clientes,
testimonios, certificaciones, premios, número de proyectos, valoraciones ni
precios. El JSON-LD tampoco declara `AggregateRating`, `Review`, `award` ni
`Offer`, y hay un test que lo impide.

## Regenerar

```bash
python3 scripts/generate-brand-assets.py
```

Requiere Pillow (`pip install Pillow`). **No forma parte de `npm run build`**: se
ejecuta a mano cuando cambia el escudo, y su salida se versiona. Añadir una
dependencia de Python al build de un proyecto Node por siete ficheros que cambian
una vez al año no compensa.

Para sustituir un asset por su versión de diseño, basta con dejar el fichero en
`frontend/public/` con el mismo nombre. No hay que tocar nada más.

## Verificación

```bash
npm test -- test/seo-assets.test.js     # existencia y coherencia
npm run build                            # copia public/ a build/
ls -la frontend/build/*.png              # deben estar los siete
```

Y tras desplegar:

- [opengraph.xyz](https://www.opengraph.xyz) sobre `https://vulnfocus.com`
- [Rich Results Test](https://search.google.com/test/rich-results) para el JSON-LD
- Instalar la PWA desde Android y comprobar el icono
- `curl -sI https://vulnfocus.com/og-image.png` → **200**, no 404

## Otros elementos de SEO, ya resueltos

| Elemento | Dónde |
|---|---|
| `<title>`, `description` y `keywords` por ruta | `frontend/src/config/site.json` → `scripts/build-site.mjs` |
| `canonical` por ruta | Igual. La página de error no se declara canónica de sí misma |
| `hreflang` es / en / x-default | Igual, salvo en las rutas `noindex` |
| Open Graph y Twitter Card por ruta | Igual |
| JSON-LD `BreadcrumbList` y `Service` | `scripts/build-site.mjs` |
| JSON-LD `Organization` y `WebSite` | `frontend/public/index.html` |
| `sitemap.xml` generado desde el manifiesto | `scripts/build-site.mjs` |
| `robots.txt` con `Disallow: /api/` y `/estimacion` | `frontend/public/robots.txt` |
| `noindex` en `/estimacion` | `site.json` → `noindex: true` |
| 404 real en rutas inexistentes | `wrangler.jsonc` → `not_found_handling: "404-page"` |

`robots.txt` **no menciona `/admin`** a propósito: listar una ruta privada en un
fichero público es publicarla. La protección es el 404 y Cloudflare Access.
