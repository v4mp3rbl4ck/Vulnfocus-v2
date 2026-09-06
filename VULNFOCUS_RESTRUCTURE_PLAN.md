# VULNFOCUS — PLAN DE REESTRUCTURACIÓN COMERCIAL

> **FASE 0 — Assessment completo.** Documento generado tras auditar el
> repositorio **real** (sin asumir nombres de fichero). Es la referencia de
> arquitectura, riesgos y criterios de aceptación del trabajo posterior.
>
> Progreso vivo: [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md)
> Comportamiento antes/después: [`docs/BASELINE_BEHAVIOR.md`](docs/BASELINE_BEHAVIOR.md)

---

## 1. Arquitectura actual (verificada, no supuesta)

```
Internet
   │
   ▼
Cloudflare (DNS · TLS · CDN · WAF · Turnstile)
   │
   ├── /*        → Static Assets  (frontend/build, no facturable, 0 invocaciones)
   │
   └── /api/*    → Worker (worker/index.js)   [assets.run_worker_first]
                     ├── POST /api/contact
                     │     rate limit → Content-Type → tamaño → JSON → honeypot
                     │     → validación → Turnstile Siteverify → INSERT D1
                     │     → 201 → ctx.waitUntil(Telegram)
                     ├── GET/HEAD /api/health   → {"status":"ok"}
                     └── *  → 404 JSON genérico (deny by default)
```

### 1.1 Árbol real del repositorio

```
package.json                 scripts npm (build/test/deploy/d1)
wrangler.jsonc               main, assets, ratelimits, d1_databases, vars, observability
vitest.config.mjs            pool workerd + D1 efímera + migraciones aplicadas en runtime
migrations/
  0001_contact_submissions.sql
worker/
  index.js                   routing + handleContact  (442 líneas)
  lib/http.js                json() / errorResponse() / successResponse() / logEvent() / securityHeaders()
  lib/validate.js            LIMITS + validateContact() + asTrimmedString()
  lib/turnstile.js           verifyTurnstile() + parseAllowedHostnames()  (fail closed)
  lib/telegram.js            buildTelegramText() + sendTelegramNotification()  (nunca lanza)
test/
  helpers.js                 mockOutboundFetch, validPayload, contactRequest, resetDb…
  setup.js                   applyD1Migrations()
  contact.test.js            (superficie API, validación, honeypot, E2E, atomicidad, cabeceras, carga)
  rate-limit.test.js
  turnstile.test.js
scripts/
  acceptance-test.sh         E2E contra despliegue real
  d1-backup.sh · verify-migration.sh · mongo-*.{sh,mjs} · telegram-check.mjs
  retention-purge.sql
frontend/                    CRA 5 + CRACO (alias "@" → src)
  public/index.html          SEO estático + 3 bloques JSON-LD + script Turnstile (render=explicit)
  public/_headers            cabeceras y CSP de los ASSETS (no aplica al Worker)
  public/robots.txt · sitemap.xml · manifest.json · favicon.svg · .assetsignore
  src/App.js                 BrowserRouter con 4 rutas
  src/index.css              Tailwind + tokens shadcn
  src/App.css                1256 líneas, tokens propios (--brand-primary #0080FF)
  src/context/LanguageContext.js   ES/EN en memoria
  src/utils/translations.js        diccionario ES/EN
  src/components/            Header · Hero · Services · Methodology · Contact · Deliverables ·
                             FAQ · Certifications · Process · Footer · SEO · ui/sonner
  src/pages/                 Home · Resources · ProcessPage · CertificationsPage
  src/hooks/use-toast.js     hook Radix (ver deuda técnica D-03)
README.md · MIGRACION_CLOUDFLARE.md · STAGING_RELEASE_GATE.md · GUIA_AUTOGESTION_CLOUDFLARE.md
```

### 1.2 Rutas actuales

| Ruta | Origen | Estado hoy |
|---|---|---|
| `/` | SPA `Home` | OK |
| `/recursos` | SPA `Resources` | OK |
| `/proceso` | SPA `ProcessPage` | OK |
| `/certificaciones` | SPA `CertificationsPage` | OK |
| cualquier otra | `not_found_handling: single-page-application` | **200 + index.html** (problema, ver P-01) |
| `POST /api/contact` | Worker | OK |
| `GET /api/health` | Worker | OK |
| `/api/*` desconocida | Worker | 404 JSON |

### 1.3 API actual

| Método | Ruta | Códigos | Notas |
|---|---|---|---|
| POST | `/api/contact` | 201 · 400 · 403 · 405 · 413 · 415 · 429 · 500 · 503 | Body ≤ 16 KB, `application/json`, honeypot `website`, Turnstile obligatorio |
| GET/HEAD | `/api/health` | 200 · 405 | `{"status":"ok"}` |
| * | `/api/*` | 404 | Deny by default |

Cabeceras de toda respuesta del Worker: `no-store`, `nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `CSP: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`,
`Cross-Origin-Resource-Policy: same-origin`. Sin CORS (API same-origin).

### 1.4 D1

Una sola tabla: `contact_submissions(id, name, email, company, message, ip_address, user_agent, status, created_at)`
con `CHECK(status IN ('new','read','replied','spam'))` y un índice por `created_at DESC`.

### 1.5 Variables y secretos actuales

| Nombre | Tipo | Dónde | Uso |
|---|---|---|---|
| `REACT_APP_TURNSTILE_SITE_KEY` | **build, pública** | `frontend/.env.production` | Renderiza el widget |
| `INLINE_RUNTIME_CHUNK` / `GENERATE_SOURCEMAP` | build | `frontend/.env.production` | CSP sin `unsafe-inline` en `script-src` |
| `TURNSTILE_SECRET_KEY` | **secret** | Cloudflare Secrets | Siteverify |
| `TELEGRAM_BOT_TOKEN` | **secret** | Cloudflare Secrets | Bot API |
| `TELEGRAM_CHAT_ID` | **secret** | Cloudflare Secrets | Destino |
| `TURNSTILE_ALLOWED_HOSTNAMES` | var runtime | `wrangler.jsonc` | Allowlist exacta de hostnames |
| `STORE_IP` | var runtime | `wrangler.jsonc` | `"false"` ⇒ no se persiste IP |

### 1.6 Dependencias

* Raíz: `wrangler ^4.36`, `vitest ^4.1.11`, `@cloudflare/vitest-plugin ^1.1.2`. **Sin dependencias de runtime.**
* Frontend: React 19, react-router-dom 7, lucide-react, sonner, next-themes, clsx, tailwind-merge, cva; build con `react-scripts` 5.0.1 + CRACO 7.

### 1.7 Flujo de contacto (comportamiento que NO se puede romper)

```
React Contact.jsx
  → valida en cliente (no es control de seguridad)
  → POST /api/contact {name,email,company,message,website,turnstileToken}
      → CONTACT_RATE_LIMITER.limit({key: CF-Connecting-IP})   5/60s  → 429
      → Content-Type application/json*                               → 415
      → Content-Length y bytes reales ≤ 16 KB                        → 413
      → JSON.parse                                                   → 400
      → honeypot `website` no vacío  → 201 SINTÉTICO (sin D1, sin Turnstile, sin Telegram)
      → validateContact()                                            → 400 genérico
      → verifyTurnstile() fail-closed                                → 403 / 503
      → INSERT contact_submissions                                   → 500 si falla
      → 201 {status,message,submission_id}
      → ctx.waitUntil(sendTelegramNotification)  (su fallo NO afecta al 201)
```

---

## 2. Problemas encontrados en la auditoría

| ID | Severidad | Hallazgo | Acción en este trabajo |
|---|---|---|---|
| **P-01** | Alta (SEO/superficie) | `assets.not_found_handling: "single-page-application"` ⇒ `/wp-admin`, `/.env`, `/backup`… devuelven **200 + index.html**. Fuzzing masivo de rutas da falsos positivos y los rastreadores indexan basura. | Rediseño de routing (§4.2). Sin blacklists. |
| **P-02** | Alta (operativa) | **Deriva `wrangler.jsonc` ↔ documentación**: README/`MIGRACION`/`STAGING_RELEASE_GATE` describen `env.staging` y `env.production`; el fichero real declara D1 en **raíz** (`vulnfocus-production`) y **no tiene entornos**. `npm run dev`, `deploy:staging`, `deploy:production` usan `--env` y **fallarían**. `db:migrate:production` apunta a `vulnfocus`, el binding a `vulnfocus-production`. | **No se toca el modelo de entornos** (produciría un cambio de despliegue no verificable desde aquí). Se documenta y se marca `REQUIERE CONFIGURACIÓN DEL PROPIETARIO`. Los cambios en `wrangler.jsonc` son **aditivos** y a nivel raíz, coherentes con el fichero real. |
| **P-03** | Media | **Sin control de versiones local** (`.git` ausente) y sin `.gitignore`. Ningún rollback de código disponible en la copia de trabajo. | Snapshot `tar.gz` previo al primer cambio + `.gitignore` propuesto + checklist de rollback. |
| **P-04** | Media | `README` referencia `.dev.vars.example`, **que no existe**. Arranque local documentado no reproducible. | Se crea `.dev.vars.example` solo con claves **de prueba públicas** de Cloudflare. |
| **P-05** | Media | Contenido comercial pobre: 5 servicios como tarjetas sin página propia, sin diferenciación scan vs pentest manual, sin CTA de cotización, sin entregables detallados. | Fases 1 y 2. |
| **P-06** | Media | `Certifications.jsx` afirma **OSCP, CEH, CISSP, eWPT** del "equipo". No verificable desde el repositorio. | Se **conserva la ruta**, pero el contenido pasa a un modelo de datos con marca explícita `REQUIERE CONFIRMACIÓN DEL PROPIETARIO`; no se añaden certificaciones nuevas ni testimonios ni clientes. |
| **P-07** | Baja | Assets SEO inexistentes (`og-image.png`, `logo.png`, `favicon-32x32.png`, `apple-touch-icon.png`) referenciados por `index.html` y `manifest.json`. | Se documenta; se generan los que se puedan sin inventar identidad de marca (SVG existente). |
| **P-08** | Baja | `sitemap.xml` con `lastmod` de 2025 y URLs de ancla (`/#services`) que no son URLs canónicas. | Se regenera desde el manifiesto de rutas en build. |
| **P-09** | Baja (bug) | `Contact.jsx` usa `useToast()` de Radix mientras `App.js` monta el `<Toaster/>` de **sonner**: los toasts nunca se muestran. | Se corrige usando un único sistema (sonner), sin cambiar el flujo de red. |
| **P-10** | Info | `body` en `index.css` fija `background:#000` y después `@apply bg-background` (blanco en `:root`). Funciona por `.app-wrapper`, pero es frágil. | Se ordena sin cambiar la identidad visual. |
| **P-11** | Info | `style-src 'unsafe-inline'` necesario por estilos inline de React (deuda ya documentada). | Se reduce moviendo estilos inline nuevos a CSS; no se elimina la directiva (rompería lo existente). |

---

## 3. Riesgos de regresión y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Romper `POST /api/contact` | Los 73 tests existentes son el gate. **No se modifica `handleContact`**; el routing nuevo se añade por delante sin alterar su rama. Se ejecuta la suite completa tras cada fase. |
| Romper Turnstile | `worker/lib/turnstile.js` **no se modifica**. La cotización lo reutiliza tal cual. |
| Romper Telegram | `sendTelegramNotification` se conserva; se añade un constructor de mensaje separado para cotizaciones. Sigue sin `parse_mode`. |
| Romper D1 | Migraciones **solo aditivas** (`CREATE TABLE IF NOT EXISTS`). Cero `ALTER`/`DROP` sobre `contact_submissions`. |
| 404 real rompiendo rutas legítimas | Prerender de una página por ruta conocida + test automático que verifica que **todas** las rutas del manifiesto existen en `build/`. Rollback: volver a `single-page-application` en una línea. |
| Presupuesto de bundle / coste Workers | El motor de precios vive en el Worker (no viaja al navegador). Los assets siguen sin invocar el Worker. |
| Precios inventados | `worker/config/quote-config.js` con placeholders `null` y bandera `PRICING_ENABLED`; si no hay tarifa configurada, la API devuelve esfuerzo/duración pero **omite el rango económico**. |

---

## 4. Arquitectura propuesta

### 4.1 Capas

```
                     ┌──────────────────────── Cloudflare ────────────────────────┐
Navegador ──────────▶│ Static Assets (React SPA prerenderizada por ruta)          │
                     │   · 1 HTML por ruta conocida  → 200                        │
                     │   · 404.html                  → 404 real                   │
                     └───────────────┬────────────────────────────────────────────┘
                                     │ /api/*  (run_worker_first)
                                     ▼
                     ┌──────────────── Worker ────────────────────────────────────┐
                     │ router  → handleContact (INTACTO)                          │
                     │         → handleQuoteCreate / handleQuoteRead              │
                     │                                                            │
                     │ lib/quote/    normalize → scope → complexity → effort →    │
                     │               pricing → quote        (100 % server-side)   │
                     │ config/quote-config.js   horas, factores, tarifas, moneda  │
                     │                                                            │
                     │ integrations/  NotificationService ─┬─ TelegramChannel     │
                     │                                     ├─ EmailAdapter        │
                     │                                     │    (Null|Resend|MC)  │
                     │                CRMAdapter (Null)    └─ …                   │
                     │                SysReptorAdapter (deshabilitado, flag)      │
                     │                                                            │
                     │ D1: contact_submissions · quotes · quote_counters          │
                     └────────────────────────────────────────────────────────────┘
```

### 4.2 Routing y 404 — diseño (sin blacklists)

El conjunto de rutas públicas es **finito y conocido en build**. Por tanto:

1. `frontend/src/config/site.json` es el **manifiesto único** (ruta, SEO ES/EN, prioridad de sitemap).
2. `scripts/build-site.mjs` (post-build) genera, por cada ruta, `build/<ruta>/index.html`:
   copia del shell de la SPA con `<title>`, `description`, `canonical`, Open Graph,
   Twitter y JSON-LD **específicos de esa URL** (resuelve también FASE 6).
   Genera además `build/404.html` y regenera `sitemap.xml`.
3. `wrangler.jsonc`: `assets.not_found_handling: "404-page"`.

Resultado: `/servicios/pentesting-web` → asset real → **200**;
`/wp-admin`, `/.env`, `/backup`, `/random` → sin asset → **404** con la página de
error de la marca. Es una *allowlist por construcción*, no una lista negra, y
mantiene 0 invocaciones del Worker para tráfico estático.

### 4.3 Motor de cotización

```
INPUT (JSON del wizard)
  → NORMALIZATION   coerción de tipos, recorte, clamp a rangos del catálogo
  → SCOPE ENGINE    horas por volumen declarado (apps, endpoints, hosts, usuarios…)
  → COMPLEXITY ENGINE  multiplicadores por SSO, WAF, producción, evasión…
  → EFFORT ENGINE   base + scope + complejidad + opcionales → horas, banda, días
  → PRICING ENGINE  tarifa × horas → mínimo comercial → descuentos → impuestos → rango
  → QUOTE           objeto de presentación (sin datos comerciales internos)
```

* Catálogo público de preguntas: `frontend/src/config/quote-catalog.json`
  — **importado por el wizard y por el Worker desde el mismo fichero** (fuente única, sin drift).
* Parámetros comerciales: `worker/config/quote-config.js` — **nunca** llega al navegador.
* El backend **recalcula siempre**. Horas, precio, estado y descuentos enviados por el cliente se ignoran.

### 4.4 Identificadores

| Campo | Formato | Visibilidad | Uso |
|---|---|---|---|
| `id` | UUIDv4 | interno | PK |
| `quote_number` | `VF-2026-000042` | mostrado al cliente | referencia comercial |
| `public_id` | 32 hex aleatorios (128 bits) | en la URL | `GET /api/quotes/:public_id` |

`quote_number` es secuencial por año y se genera **atómicamente en D1**
(`INSERT … ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value`).
Al ser secuencial, **no se usa como identificador de recuperación**: la lectura
va por `public_id` no predecible (evita enumeración).

---

## 5. Fases, ficheros y criterios

### Orden de ejecución

| # | Fase | Por qué en ese orden |
|---|---|---|
| 0 | Assessment + baseline + snapshot | Referencia de comparación |
| A | Infra de rutas/SEO (parte de F5+F6) | Fase 1 crea rutas nuevas; sin esta infra nacerían con 200 falsos y sin SEO |
| 1 | Conversión comercial | Home, servicios, diferenciación, entregables, UX |
| 2 | Cotizador (motor → D1 → API → wizard → estimación/PDF) | Depende de A y 1 |
| 3 | Integraciones desacopladas | Depende de 2 |
| 4 | Revisión de seguridad | Sobre la superficie ya construida |
| 7 | Analytics privacy-first | Necesita los eventos del wizard |
| 8/9 | Tests + QA | Continuo, con cierre explícito |
| 10 | Documentación | Cierre |

### 5.1 Ficheros que se MODIFICAN

```
wrangler.jsonc                          not_found_handling, ratelimits (+1), vars (+flags)
package.json                            scripts (build:site, test)
vitest.config.mjs                       proyectos: worker (workerd) + node (motor/lógica)
worker/index.js                         router: + /api/quotes, + /api/quotes/:id  (handleContact intacto)
worker/lib/telegram.js                  + buildQuoteTelegramText() (sin tocar lo existente)
frontend/src/App.js                     rutas nuevas + NotFound + ScrollToTop
frontend/src/index.css · App.css        tokens, estados focus, componentes nuevos
frontend/src/utils/translations.js      textos nuevos ES/EN
frontend/src/components/Header.jsx      navegación + CTA "Cotizar"
frontend/src/components/Footer.jsx      mapa del sitio
frontend/src/components/Hero.jsx        propuesta de valor + doble CTA
frontend/src/components/Services.jsx    tarjetas enlazadas a las páginas de servicio
frontend/src/components/Contact.jsx     corrección P-09 + estados de UI
frontend/src/components/SEO.jsx         alineado con el manifiesto
frontend/src/pages/*.jsx                SEO por ruta
frontend/public/index.html              limpieza de meta que ahora inyecta el build
frontend/public/robots.txt              coherente con el nuevo mapa
README.md                               comandos, arquitectura, variables
```

### 5.2 Ficheros NUEVOS

```
VULNFOCUS_RESTRUCTURE_PLAN.md · IMPLEMENTATION_PROGRESS.md
docs/ARCHITECTURE.md · QUOTING_ENGINE.md · D1_SCHEMA.md · CLOUDFLARE_DEPLOYMENT.md
     INTEGRATIONS.md · SECURITY.md · BASELINE_BEHAVIOR.md · QA_CHECKLIST.md
.gitignore · .dev.vars.example
migrations/0002_quotes.sql
scripts/build-site.mjs
worker/config/quote-config.js
worker/lib/quote/{normalize,scope,complexity,effort,pricing,engine,schema,number}.js
worker/lib/quotes-handler.js
worker/integrations/{notifications,email/{index,null,resend,mailchannels},crm/{index,null},sysreptor}.js
frontend/src/config/site.json · quote-catalog.json
frontend/src/data/services.js
frontend/src/components/{Layout,Seo,CTASection,ScanVsPentest,DeliverablesDetail,NotFound,...}.jsx
frontend/src/features/quote/{QuoteWizard.jsx,steps/*,wizardMachine.js,quoteApi.js,storage.js}
frontend/src/pages/{ServicesIndex,ServiceDetail,QuotePage,EstimatePage,NotFoundPage}.jsx
frontend/src/lib/analytics.js
test/worker/*.test.js · test/unit/*.test.js
```

### 5.3 Estrategia de testing

| Nivel | Runner | Qué cubre |
|---|---|---|
| Worker + D1 real (workerd) | `vitest` proyecto `worker` | contacto (73 existentes, intactos), cotizaciones, routing `/api/*`, Turnstile, rate limit, fallos de D1/Telegram, manipulación de precio/horas/estado |
| Puro (node) | `vitest` proyecto `unit` | motor de cotización (scope/complejidad/esfuerzo/pricing), máquina de estados del wizard, validación de catálogo, manifiesto de rutas |
| Build | `scripts/build-site.mjs` + test | toda ruta del manifiesto existe en `build/`; `404.html` presente |
| E2E real | `scripts/acceptance-test.sh` | sin cambios de contrato; se amplía con las rutas nuevas |
| Visual/a11y | `docs/QA_CHECKLIST.md` | 1920/1366/tablet/390 · foco · contraste · overflow |

### 5.4 Criterios de aceptación (se replican en IMPLEMENTATION_PROGRESS.md)

Los 22 del enunciado, más:

* `npm test` verde con **≥ 73** tests previos **sin modificar su semántica**.
* `npm run build` verde y `build/` con un HTML por ruta + `404.html`.
* Ningún secreto en el repositorio (`grep` de patrones en la entrega).
* El navegador nunca recibe tarifas, multiplicadores ni márgenes.
* Toda ruta desconocida devuelve 404; toda ruta legítima 200.
