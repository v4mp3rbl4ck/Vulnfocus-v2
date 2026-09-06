# VulnFocus — React + Cloudflare Workers + D1

Plataforma comercial de seguridad ofensiva. Frontend React servido como Static
Assets de Cloudflare y una API serverless en un Worker. Sin servidores que
administrar.

```
Internet
   │
   ▼
Cloudflare (DNS · TLS · CDN · WAF · Turnstile)
   │
   ├── /*        → Static Assets  (un HTML por ruta + 404 real, no facturable)
   │
   └── /api/*    → Worker
                     ├── POST /api/contact ─────┬── Turnstile Siteverify
                     │                          ├── D1 (contact_submissions)
                     │                          └── NotificationService
                     ├── POST /api/quotes ──────┬── Turnstile Siteverify
                     │                          ├── motor de cotización
                     │                          ├── D1 (quotes)
                     │                          └── NotificationService
                     ├── GET  /api/quotes/:public_id
                     └── GET  /api/health
```

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Estructura, fuentes de verdad, routing |
| [docs/QUOTING_ENGINE.md](docs/QUOTING_ENGINE.md) | Motor de esfuerzo y precios, y cómo cambiar tarifas |
| [docs/D1_SCHEMA.md](docs/D1_SCHEMA.md) | Tablas, índices y consultas habituales |
| [docs/CLOUDFLARE_DEPLOYMENT.md](docs/CLOUDFLARE_DEPLOYMENT.md) | Variables, secretos, despliegue y rollback |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Telegram, correo, CRM, SysReptor, analytics |
| [docs/SECURITY.md](docs/SECURITY.md) | Controles y revisión de la superficie pública |
| [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) | Comprobaciones visuales y de accesibilidad |
| [VULNFOCUS_RESTRUCTURE_PLAN.md](VULNFOCUS_RESTRUCTURE_PLAN.md) | Auditoría y plan de la reestructuración |
| [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) | Estado de cada fase |

## Puesta en marcha

```bash
npm ci                       # raíz (wrangler + vitest)
npm --prefix frontend ci     # frontend
cp .dev.vars.example .dev.vars
npm run db:migrate:local     # crea las tablas en la D1 local
npm run build                # compila el frontend a frontend/build/
npm run dev                  # http://localhost:8787
```

`.dev.vars` trae las claves de **prueba** públicas de Turnstile documentadas por
Cloudflare. Con ellas el formulario funciona en local sin tocar producción.
`.dev.vars` está en `.gitignore` y nunca debe contener un secreto real. Es también
donde viven los hostnames de desarrollo (`localhost`, `127.0.0.1`), que **no**
están en la configuración de producción.

> **Entornos:** el nivel raíz de `wrangler.jsonc` **es** producción. No hay
> bloques `env.*` y ningún script usa `--env`. Ver
> [docs/CLOUDFLARE_DEPLOYMENT.md](docs/CLOUDFLARE_DEPLOYMENT.md) § "Modelo de
> entornos".

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Suite Vitest sobre `workerd` con D1 local (**406 tests**) |
| `npm run dev` | Worker + assets + D1 en local |
| `npm run build` | Instala el frontend, lo compila y prerenderiza las rutas |
| `npm run build:site` | Solo el post-build: 1 HTML por ruta, `404.html`, sitemap |
| `npm run build:site:check` | Verifica que el build tiene una página por ruta |
| `npm run deploy` | Build y despliegue (lo normal es que despliegue Workers Builds) |
| `npm run deploy:dry-run` | Valida configuración y bindings **sin desplegar** |
| `npm run db:migrate` | Aplica `migrations/` a la D1 remota |
| `npm run db:migrate:local` | Aplica `migrations/` a la D1 de Miniflare |
| `npm run db:backup [db]` | Export de D1 a `backups/` |
| `npm run acceptance <url>` | Test de aceptación E2E (`smoke` = solo automático) |
| `npm run tail` | Logs en vivo |

## Estructura

```
worker/
  index.js                 Routing y handler de /api/contact
  lib/quotes-handler.js    Endpoints del cotizador
  lib/quote/               Motor: normalize → scope → complexity → effort → pricing
  lib/request.js           Content-Type, tamaño y parseo JSON (común)
  lib/turnstile.js         Verificación Siteverify
  lib/telegram.js          Notificaciones
  lib/validate.js          Validación del formulario de contacto
  lib/http.js              Respuestas y cabeceras de seguridad
  lib/access.js            Verificación del JWT de Cloudflare Access
  lib/admin/               API y panel del mini CRM (deshabilitados por defecto)
  lib/quote/lifecycle.js   Máquina de estados comercial
  config/quote-config.js   HORAS, FACTORES Y TARIFAS (único sitio con números de negocio)
  integrations/            NotificationService, correo, CRM, SysReptor
frontend/                  React (CRA + CRACO)
  public/index.html        Shell con los marcadores del bloque SEO
  public/_headers          Cabeceras de los assets
  src/config/site.json     MANIFIESTO DE RUTAS + SEO por URL
  src/config/quote-catalog.json  Catálogo público de preguntas (lo lee también el Worker)
  src/data/services.js     Contenido de las páginas de servicio
  src/features/quote/      Wizard, máquina de estados y vista de estimación
migrations/                SQL versionado de D1
scripts/build-site.mjs     Post-build: 1 HTML por ruta, 404.html y sitemap
test/                      Suite Vitest
wrangler.jsonc             Configuración de Cloudflare
```

---

## Decisiones de diseño

### Routing: un HTML por ruta y 404 real

Antes, `assets.not_found_handling: "single-page-application"` hacía que
**cualquier** ruta devolviera 200 con `index.html`: `/wp-admin`, `/.env` o
`/backup` parecían recursos reales y los rastreadores indexaban páginas
inexistentes.

El conjunto de rutas públicas es finito y se conoce en tiempo de build, así que
`scripts/build-site.mjs` materializa `build/<ruta>.html` por cada entrada de
`frontend/src/config/site.json`, y `not_found_handling: "404-page"` manda lo
demás a `404.html` con código 404. Es una **allowlist por construcción**, no una
lista negra de nombres comunes, y mantiene 0 invocaciones del Worker para el
tráfico estático.

De paso, cada URL sale del build con su `<title>`, `description`, `canonical`,
Open Graph y JSON-LD propios, visibles para rastreadores que no ejecutan
JavaScript.

Se escribe `<ruta>.html` y no `<ruta>/index.html` a propósito: con la segunda
forma Cloudflare responde `307` hacia `/<ruta>/`, que no es la URL canónica.
Verificado con `wrangler dev`.

> **Importante:** `npm run build` encadena `install:frontend → build:frontend →
> build:site`. Sin el último paso no existen los HTML por ruta y **todas las
> rutas devolverían 404**. `npm run build:site:check` lo verifica.

### Routing: `run_worker_first`

Con `compatibility_date >= 2025-04-01` Cloudflare activa
`assets_navigation_prefers_asset_serving`: las peticiones de navegación
(`Sec-Fetch-Mode: navigate`) **no invocan el Worker**. Sin más configuración,
escribir `vulnfocus.com/api/contact` en el navegador devolvería `index.html` en
lugar de un 405.

`assets.run_worker_first: ["/api/*"]` da control explícito: `/api/*` siempre va al
Worker, el resto siempre a Static Assets.

Es un **array de patrones acotado, no `true`**. La diferencia importa: con `true`
cada visita invocaría el Worker y consumiría cuota. Verificado instrumentando el
Worker en local: 10 peticiones estáticas (4 rutas SPA, JS, CSS, favicon,
robots.txt, sitemap.xml, manifest.json) produjeron **0 invocaciones**; solo
`/api/health` y `/api/contact` lo invocaron. Las peticiones a Static Assets son
gratuitas e ilimitadas.

### Protección SEO de entornos no productivos

`frontend/public/_headers` emite `X-Robots-Tag: noindex, nofollow` en reglas
acotadas por hostname para `staging.vulnfocus.com` y las URLs `*.workers.dev`.
No se tocan `robots.txt`, `sitemap.xml` ni las etiquetas `canonical`: son
ficheros comunes a todos los entornos y deben seguir describiendo la
configuración SEO de producción. Como refuerzo, `index.html` declara `canonical`
hacia `https://vulnfocus.com/`, así que una página de staging se declara copia de
la de producción y no compite con ella.

### Cotizador

`/cotizar` es un wizard de cinco pasos que envía respuestas de formulario, nunca
cifras. **El backend recalcula todo**: horas, complejidad, precio y estado los
deriva el Worker a partir de `worker/config/quote-config.js`, que no viaja al
navegador. Los campos comerciales que llegaran en el cuerpo ni se leen: el
normalizador solo mira claves declaradas en el catálogo público.

Sin tarifa configurada o con `PRICING_ENABLED != "true"`, la estimación se
entrega con esfuerzo y duración pero **sin importes**. Es deliberado: inventar
un precio sería peor que no darlo. Ver
[docs/QUOTING_ENGINE.md](docs/QUOTING_ENGINE.md).

La descarga en PDF usa el diálogo de impresión del navegador sobre una vista con
`@media print` dedicada. La justificación de no generar el PDF en el Worker está
en el mismo documento.

### Rate limiting

Binding nativo `ratelimits` de Workers: **5 solicitudes / 60 s por
`CF-Connecting-IP`** en el contacto, **3 / 60 s** al crear una cotización y
**30 / 60 s** al consultarla.

Lo que es y lo que no es:

- **No es un contador in-memory** del isolate. Está respaldado por la misma
  infraestructura que las Rate Limiting Rules del WAF, así que es válido en
  producción distribuida.
- **Es local por ubicación (PoP) de Cloudflare.** Cada centro de datos lleva su
  propio contador para una misma clave.
- **Es eventualmente consistente.** Los contadores se cachean en la máquina que
  ejecuta el Worker y se sincronizan en segundo plano.
- **No es un mecanismo contable.** Es una defensa anti-abuso, no una garantía de
  "como máximo 5".

Cloudflare desaconseja usar la IP como clave, por NAT, proxies y redes móviles.
Aquí se acepta conscientemente porque:

- es un formulario público sin autenticación: no hay `user_id` ni API key;
- **Turnstile es el control anti-bot primario**, y el honeypot otra capa;
- el rate limit es solo una capa adicional que amortigua ráfagas.

No se introducen KV, Durable Objects ni D1 para mejorar su precisión: añadirían
componentes que mantener a cambio de una exactitud que este caso de uso no
necesita.

Alternativa con Rate Limiting Rules del WAF: en plan **Free** solo hay 1 regla,
con período de conteo y timeout de **10 s** — no permite expresar "5 por minuto".
Eso requiere **Pro**. El binding del Worker sí admite `period: 60`.

### Turnstile

Validación server-side obligatoria contra el endpoint oficial Siteverify.
**Fail closed**: secreto ausente, red caída, timeout, 5xx o JSON inválido
rechazan el envío.

- `idempotency_key` (UUIDv4) por intento: un reintento por error de red no
  "quema" el token.
- Validación de hostname con **allowlist exacta**. Nunca `endsWith()`:
  `vulnfocus.com.atacante.tld` termina en `vulnfocus.com` y pasaría una
  comprobación por sufijo.
- Los `error-codes` internos se registran, nunca se devuelven al cliente.

No existe ninguna variable, cabecera ni parámetro que permita saltarse la
verificación. Los tests sustituyen `globalThis.fetch` — el mecanismo soportado
por `@cloudflare/vitest-plugin` — de modo que el Worker bajo test es exactamente
el que se despliega.

### D1 y Telegram: orden y atomicidad

```
validar → rate limit → Turnstile → INSERT D1 → 201 → ctx.waitUntil(Telegram)
```

- Si **D1 falla**: se devuelve 500 y no se notifica. El usuario puede reintentar.
- Si **Telegram falla**: el usuario ya recibió 201 y el contacto está en D1. El
  error se registra. Nadie reenvía nada y no se generan duplicados.

`ctx.waitUntil()` extiende la ejecución hasta 30 s tras la respuesta. La entrega
a Telegram no está garantizada, y es aceptable: la fuente de verdad es D1.

### Envíos duplicados

**No se implementa idempotencia**, y es deliberado:

- el token de Turnstile es de un solo uso, así que el doble clic y el reintento
  por timeout ya reciben `timeout-or-duplicate` → 403;
- el botón se deshabilita mientras `isSubmitting`;
- un duplicado ocasional en un formulario de contacto de bajo volumen es un coste
  operativo trivial frente a añadir constraint única, ventana temporal y gestión
  de colisiones.

### Datos personales

El formulario recoge nombre, email, empresa (opcional) y mensaje.

- **IP**: no se almacena. `STORE_IP="false"` guarda `NULL`. La IP se usa en
  memoria como clave del rate limit y como `remoteip` de Siteverify, pero no se
  persiste. Ponlo a `"true"` solo si aparece una necesidad concreta.
- **User-Agent**: se guarda truncado a 256 caracteres, como entrada no confiable.
  Nunca se interpreta como HTML ni entra en SQL dinámico.
- **Retención sugerida: 12 meses.** No se aplica automáticamente. Cuando el
  propietario la confirme y la refleje en la política de privacidad:
  `npx wrangler d1 execute vulnfocus --remote --file=scripts/retention-purge.sql`
- **Borrado a petición**: `DELETE FROM contact_submissions WHERE email = ?`.

Los backups de D1 contienen estos datos: `backups/` está en `.gitignore` y deben
guardarse cifrados con la misma retención.

### Cabeceras y CSP

`frontend/public/_headers` cubre los assets. **No se aplica a las respuestas del
Worker**, que llevan las suyas en `worker/lib/http.js`.

CSP sin `unsafe-eval` y **sin `unsafe-inline` en `script-src`**. Esto último
requiere `INLINE_RUNTIME_CHUNK=false` (en `frontend/.env.production`), que evita
que CRA incruste el runtime chunk como `<script>` inline.

`style-src 'unsafe-inline'` **sí** está presente, por una razón concreta:
`Contact.jsx` y otros componentes usan `style={{...}}` de React, que genera
atributos `style` inline, y CSP2+ los bloquea sin esa directiva. Queda registrado
como **deuda técnica menor**, no como vulnerabilidad: el riesgo de
`style-src 'unsafe-inline'` es muy inferior al de su equivalente en `script-src`.
Se resolvería moviendo esos estilos a `App.css`.

Orígenes externos permitidos, todos necesarios y documentados:

| Origen | Directiva | Por qué |
|---|---|---|
| `challenges.cloudflare.com` | `script-src`, `frame-src`, `connect-src` | Widget de Turnstile |
| `fonts.googleapis.com` | `style-src` | Hoja de estilos de Inter |
| `fonts.gstatic.com` | `font-src` | Ficheros de la fuente |

### Caché

- `/static/*` (nombres con hash): `max-age=31536000, immutable`.
- `index.html`: `max-age=0, must-revalidate`. Si se cacheara, un despliegue nuevo
  podría seguir sirviendo un shell viejo que apunta a bundles inexistentes.
- Todas las respuestas del Worker, incluidos los errores: `no-store`.

### `compatibility_date`

Fija el conjunto de comportamientos del runtime. No se actualiza sola porque
cambiarla puede alterar el comportamiento del Worker. Revísala al actualizar
Wrangler de forma significativa (1-2 veces al año) y vuelve a pasar `npm test` y
el smoke test antes de desplegar el cambio.

### Un solo entorno, declarado

`wrangler.jsonc` declara la D1, los cuatro limitadores y las `vars` **en el nivel
raíz, que es producción**. No hay bloques `env.*`.

El modelo anterior —documentación describiendo `env.staging`/`env.production`
sobre un fichero sin entornos— tenía un fallo silencioso: `wrangler deploy --env
production` sobre un fichero sin entornos crea un Worker **distinto**
(`vulnfocus-v2-production`), sin D1 y sin limitadores. El despliegue no falla; la
aplicación queda a medias. `test/config.test.js` impide que vuelva.

La protección frente a un despliegue accidental no es la ausencia de binding sino
`npm run deploy:dry-run`, las versiones de Cloudflare y `wrangler rollback`.

## Secretos

Nunca en el repositorio. Se cargan por entorno:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
# solo si se activa el correo:
npx wrangler secret put RESEND_API_KEY
```

El **site key** de Turnstile sí es público y vive en `frontend/.env.production`.

## Deuda técnica conocida

1. **CRA sin mantenimiento.** `react-scripts` 5.0.1 es la última versión publicada
   y arrastra advisories sin parche disponible. Ninguno llega al navegador
   (verificado: sin sourcemaps, sin `eval`, sin dependencias en tiempo de
   ejecución del build), pero la cadena de build no tiene ruta de actualización.
   Migrar a Vite es la solución real. Ver `MIGRACION_CLOUDFLARE.md` § Dependencias.

2. **`style-src 'unsafe-inline'`.** Sigue haciendo falta por los estilos inline de
   React: la barra de progreso del wizard tiene un `width` dinámico que no puede
   vivir en la hoja. El honeypot, que antes usaba un atributo `style`, ya se
   oculta desde CSS. El panel de administración **no** necesita esta excepción:
   usa CSP con `nonce` por respuesta.

3. ~~**Toasts inertes.**~~ **Corregido.** Un único sistema (sonner).

4. ~~**Assets SEO ausentes.**~~ **Corregido.** Los siete PNG existen y se generan
   con `scripts/generate-brand-assets.py` a partir del escudo real de
   `favicon.svg`. `og-image.png` y `logo.png` son **assets técnicos**,
   sustituibles por diseño: ver [docs/SEO_ASSETS.md](docs/SEO_ASSETS.md).

5. ~~**Modelo de entornos de `wrangler.jsonc`.**~~ **Corregido.** El nivel raíz es
   producción, no hay `env.*` y ningún script usa `--env`. Con tests que lo fijan.

6. **Sin entorno de staging.** Es una decisión, no un olvido: un segundo entorno
   con su D1, sus secretos y su Turnstile es coste de mantenimiento real. El
   sustituto son los 406 tests sobre `workerd` con D1 real, `deploy:dry-run` y
   `wrangler rollback`. Si algún día hace falta, la forma recomendada está en
   [docs/CLOUDFLARE_DEPLOYMENT.md](docs/CLOUDFLARE_DEPLOYMENT.md), y **no** pasa
   por añadir `env.staging` a este fichero.

7. **`scripts/generate-brand-assets.py` requiere Python y Pillow.** No forma parte
   de `npm run build` y su salida se versiona: se ejecuta a mano cuando cambia el
   escudo. Añadir una dependencia de Python al build por siete ficheros que
   cambian una vez al año no compensa.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Estructura, decisiones y árbol del proyecto |
| [docs/QUOTING_ENGINE.md](docs/QUOTING_ENGINE.md) | Cómo funciona el motor de cotización |
| [docs/QUOTE_PRICING_REVIEW.md](docs/QUOTE_PRICING_REVIEW.md) | **Revisión de horas y tarifas, con cifras medidas** |
| [docs/D1_SCHEMA.md](docs/D1_SCHEMA.md) | Esquema, migraciones y cómo aplicarlas |
| [docs/CLOUDFLARE_DEPLOYMENT.md](docs/CLOUDFLARE_DEPLOYMENT.md) | Variables, bindings, despliegue y rollback |
| [docs/CLOUDFLARE_MANUAL_ACTIONS.md](docs/CLOUDFLARE_MANUAL_ACTIONS.md) | **Qué debe hacer el propietario a mano** |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Telegram, correo, CRM, SysReptor y analítica |
| [docs/SECURITY.md](docs/SECURITY.md) | Superficie, controles y revisión de riesgos |
| [docs/ADMIN.md](docs/ADMIN.md) | **Mini CRM: arquitectura, ciclo de vida y activación** |
| [docs/DATA_RETENTION.md](docs/DATA_RETENTION.md) | **Qué se guarda, cuánto y cómo se purga** |
| [docs/SEO_ASSETS.md](docs/SEO_ASSETS.md) | Iconos, Open Graph y datos estructurados |
| [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) | **Estado verificado antes de desplegar** |
| [docs/RELEASE_GATE.md](docs/RELEASE_GATE.md) | **Veredicto de producción y evidencia** |
| [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) | Revisión visual y de accesibilidad |
| [docs/BASELINE_BEHAVIOR.md](docs/BASELINE_BEHAVIOR.md) | Contrato del comportamiento previo |
| [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) | Estado por fase |
