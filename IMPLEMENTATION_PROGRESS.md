# IMPLEMENTATION PROGRESS

Estados: `TODO` · `IN PROGRESS` · `DONE` · `BLOCKED`
Regla: **nada se marca DONE sin estar implementado y validado** (tests o verificación explícita).

---

## Resumen

| Fase | Estado |
|---|---|
| 0 · Assessment + baseline | **DONE** |
| A · Infra de rutas + SEO estático | **DONE** |
| 1 · Conversión comercial | **DONE** |
| 2 · Cotizador automático | **DONE** |
| 3 · Integraciones | **DONE** (correo, CRM y SysReptor preparados y deshabilitados por falta de decisión del propietario) |
| 4 · Seguridad | **DONE** |
| 5 · Routing y 404 | **DONE** |
| 6 · SEO | **DONE** |
| 7 · Analytics | **DONE** (sin proveedor configurado, por diseño) |
| 8 · Testing | **DONE** |
| 9 · QA visual | **DONE** |
| 10 · Documentación | **DONE** |
| 11 · Hardening final y preparación para producción | **DONE** |

**Tests: 406 verdes (178 originales intactos + 228 nuevos) · Build: verde ·
Sin regresiones conocidas.**

---

## FASE 11 — Hardening final · **DONE** · 6 de septiembre de 2026

### P0 — resueltos

| # | Hallazgo | Estado | Evidencia |
|---|---|---|---|
| P0-1 | **Scripts de despliegue rotos.** `package.json` pasaba `--env staging` / `--env production` a un `wrangler.jsonc` **sin bloques `env.*`**. `wrangler deploy --env production` habría creado un Worker distinto (`vulnfocus-v2-production`) **sin D1 y sin limitadores**: despliegue "correcto", aplicación a medias. | DONE | Nivel raíz = producción. Scripts sin `--env`. 6 tests lo fijan |
| P0-2 | **`db:migrate:staging` apuntaba a `vulnfocus-staging`**, una base que no existe en la configuración. | DONE | `npm run db:migrate` → `vulnfocus-production`. Test que compara con el binding |
| P0-3 | **Copia pública del sitio en workers.dev.** `vulnfocus-v2.jesus62175.workers.dev` estaba en `TURNSTILE_ALLOWED_HOSTNAMES`: sitio navegable, indexable y funcional fuera del dominio propio. | DONE | Hostname retirado y `workers_dev: false` |

### P1 — resueltos

| # | Hallazgo | Estado | Evidencia |
|---|---|---|---|
| P1-1 | **HSTS anunciaba `preload`** sin que el dominio estuviera inscrito: compromiso irreversible en la práctica, sin ninguna ventaja. | DONE | `max-age=31536000; includeSubDomains`. Verificado con `curl -sI` |
| P1-2 | **Siete assets referenciados que no existían** (`og-image.png`, `logo.png`, favicons, iconos del manifiesto): 404 en cada visita y previsualización vacía al compartir. | DONE | Generados desde el escudo real. `test/seo-assets.test.js` |
| P1-3 | **Sin forma de gestionar las cotizaciones.** Solo `wrangler d1 execute` con SQL a mano, sin validación de transiciones ni auditoría. | DONE | Mini CRM completo, deshabilitado por defecto |
| P1-4 | **Sin ciclo de vida.** La columna `status` admitía cualquier valor del CHECK sin reglas de transición. | DONE | Máquina de estados + 20 tests |
| P1-5 | **Asunto del acuse al cliente** no seguía el formato acordado y mostraba "pendiente de confirmar" donde no hay tarifa, insinuando un precio. | DONE | `Solicitud recibida — VulnFocus VF-AAAA-NNNNNN`. Sin línea de importe si no hay tarifa |
| P1-6 | **Correos y Telegram con identificadores internos** (`web`, `infra_externa`) en lugar de nombres. | DONE | `worker/lib/quote/labels.js`, desde el mismo catálogo |
| P1-7 | **`json()` no escapaba `<`, `>`, `&`.** No explotable (Content-Type estricto + nosniff + CSP), pero el cuerpo de una API acaba incrustado en sitios que no controlamos. | DONE | Escapado `\uXXXX`; `JSON.parse` devuelve lo mismo |
| P1-8 | **`currency` con tipo incorrecto** caía a la moneda por defecto en silencio, a diferencia del resto del normalizador. | DONE | Se rechaza con 400 |

### P2 — implementados

| # | Mejora | Estado |
|---|---|---|
| P2-1 | Auditoría de cambios de estado (`quote_status_events`, append-only, cascade) | DONE |
| P2-2 | Verificación del JWT de Cloudflare Access en el backend | DONE |
| P2-3 | El contrato del CRM se invoca de verdad en cada transición | DONE |
| P2-4 | Política de retención documentada + scripts de informe y purga | DONE |
| P2-5 | Flujo de SysReptor documentado (aprobación manual, datos, controles) | DONE |
| P2-6 | Revisión del motor con cifras medidas y 8 hallazgos comerciales | DONE |
| P2-7 | Tests de rutas y fuzzing (25), configuración (32), seguridad (35), correo (26), impresión (26), SEO (18) | DONE |

### Verificación ejecutada

```
npm test                      406 passed (14 files)   exit 0
npm run build                 Compiled successfully   exit 0
npm run build:site:check      16 rutas + 404.html     exit 0
npm run deploy:dry-run        129,69 KiB · 38 assets · 4 limitadores · D1
wrangler dev                  24 rutas legítimas → 200
                              31 rutas de fuzzing → 404   (0 fallos)
                              cabeceras verificadas en assets y en el Worker
escaneo de secretos           11 patrones · 0 hallazgos reales
```

### Pendiente del propietario

Ver `docs/CLOUDFLARE_MANUAL_ACTIONS.md`. Bloqueantes: **M-01** migración D1,
**M-02** secretos, **M-03** hostnames de Turnstile, **M-04** dominio propio antes
de `workers_dev: false`, **M-10** site key real, **M-12** prueba de humo.

---

## FASE 0 — Assessment · **DONE**

| Tarea | Estado | Evidencia |
|---|---|---|
| Auditoría del repositorio real | DONE | `VULNFOCUS_RESTRUCTURE_PLAN.md` §1 |
| Baseline de tests | DONE | 73/73 verdes antes de tocar nada |
| Baseline de build | DONE | `Compiled successfully`, 97,38 kB gzip |
| Snapshot de retorno (no hay git local) | DONE | `vulnfocus-baseline-*.tar.gz` |
| Documento de comportamiento previo | DONE | `docs/BASELINE_BEHAVIOR.md` |

## FASE A — Rutas y SEO estático · **DONE**

| Tarea | Estado | Evidencia |
|---|---|---|
| Manifiesto único de rutas | DONE | `frontend/src/config/site.json`, 16 rutas |
| Prerenderizado de un HTML por ruta | DONE | `scripts/build-site.mjs` |
| `404.html` y `not_found_handling: "404-page"` | DONE | `wrangler.jsonc` |
| Sitemap generado desde el manifiesto | DONE | `build/sitemap.xml` |
| Verificación con Cloudflare real | DONE | `wrangler dev`: 16 rutas → 200; 9 rutas de fuzzing → 404 |
| Corrección del 307 por trailing slash | DONE | `<ruta>.html` en lugar de `<ruta>/index.html` |

## FASE 1 — Conversión comercial · **DONE**

| Tarea | Estado | Evidencia |
|---|---|---|
| Home rediseñada | DONE | Propuesta de valor, doble CTA, propuestas de valor, servicios, diferenciación, contacto |
| `/servicios` + 9 páginas de servicio | DONE | `frontend/src/data/services.js`, ES y EN completos |
| Objetivo / qué se evalúa / metodología / pruebas / entregables / duración / marcos | DONE | En cada página de servicio |
| Diferenciación scan vs pentest manual | DONE | `ScanVsPentest.jsx` con la cadena Discovery → … → Retesting |
| Entregables detallados | DONE | `DeliverablesDetail.jsx`, 8 entregables + informe de ejemplo bajo petición |
| CTA "Cotizar pentest" | DONE | Cabecera, hero, cada servicio, banda de conversión y pie |
| Navegación, foco, estados y responsive | DONE | `docs/QA_CHECKLIST.md` |
| Corrección de los toasts inertes | DONE | Un único sistema (sonner) |

## FASE 2 — Cotizador · **DONE**

| Tarea | Estado | Evidencia |
|---|---|---|
| `/cotizar` wizard de 5 pasos | DONE | `features/quote/QuoteWizard.jsx` |
| Alcance dinámico por servicio | DONE | 49 preguntas en `quote-catalog.json`, 9 servicios |
| Motor de esfuerzo server-side | DONE | `worker/lib/quote/{scope,complexity,effort}.js` |
| Motor de precios server-side | DONE | `worker/lib/quote/pricing.js` |
| Configuración separada del motor | DONE | `worker/config/quote-config.js` |
| Multi-servicio | DONE | Hasta 3, con descuento configurable |
| Migración D1 aditiva | DONE | `migrations/0002_quotes.sql` |
| `POST /api/quotes` | DONE | Turnstile, rate limit, honeypot, validación, D1 |
| `GET /api/quotes/:public_id` | DONE | Rate limit y datos mínimos |
| Identificadores seguros | DONE | `public_id` de 128 bits + correlativo atómico |
| Telegram | DONE | Reutiliza la integración existente |
| PDF | DONE | Impresión del navegador sobre vista `@media print`; alternativa justificada en `docs/QUOTING_ENGINE.md` |
| Persistencia del borrador | DONE | `sessionStorage`, sin datos de contacto, caduca a 12 h |
| Resumen antes de enviar | DONE | Paso de contacto |

## FASE 3 — Integraciones · **DONE**

| Tarea | Estado | Evidencia |
|---|---|---|
| `NotificationService` | DONE | `worker/integrations/notifications.js` |
| Adaptadores de correo | DONE | `null` (activo), `resend`, `mailchannels` |
| `sendQuoteConfirmation` / `sendInternalQuoteAlert` / `sendContactConfirmation` | DONE | `email/templates.js` |
| `CRMAdapter` + `NullCRMAdapter` | DONE | `crm/` |
| Adaptador SysReptor | DONE | Preparado, deshabilitado, sin inventar su API |
| Índices D1 y prepared statements | DONE | `migrations/0002_quotes.sql`, `docs/D1_SCHEMA.md` |

## FASE 4 — Seguridad · **DONE**

Revisión completa en `docs/SECURITY.md`, con la tabla de riesgos y las
verificaciones ejecutadas contra un despliegue real.

## FASES 5–7 · **DONE**

| Fase | Evidencia |
|---|---|
| 5 · Routing y 404 | Verificado con `wrangler dev`: 404 real en `/admin`, `/phpmyadmin`, `/wp-admin`, `/.env`, `/.git/config`, `/backup`, `/random`, `/servicios/inventado`, `/cotizar/algo` |
| 6 · SEO | Title, description, canonical, hreflang, Open Graph, Twitter y JSON-LD por URL en el HTML servido; sitemap generado; sin keyword stuffing; sin testimonios, clientes ni certificaciones inventadas |
| 7 · Analytics | `frontend/src/lib/analytics.js` con los 7 eventos pedidos, allowlist de propiedades y sin proveedor por defecto |

## FASE 8 — Testing · **DONE**

| Fichero | Tests |
|---|---|
| `test/contact.test.js` | 53 — los originales, sin cambios de semántica |
| `test/turnstile.test.js` | 16 — sin cambios |
| `test/rate-limit.test.js` | 4 — sin cambios |
| `test/quote-engine.test.js` | 42 — motor: reglas, alcance, complejidad, esfuerzo, precios, normalización, identificadores |
| `test/quotes-api.test.js` | 50 — endpoints: superficie, validación, manipulación, Turnstile, honeypot, persistencia, concurrencia, atomicidad, lectura, rate limit |
| `test/consistency.test.js` | 13 — coherencia entre manifiesto, catálogo y configuración comercial |
| `test/admin-api.test.js` | 46 — administración: interruptor, Access, listado, búsqueda, ciclo de vida, panel |
| `test/security.test.js` | 35 — prototipos, asignación masiva, XSS, IDOR, robustez, fugas |
| `test/config.test.js` | 32 — configuración de despliegue, cabeceras y escaneo de secretos |
| `test/email.test.js` | 26 — plantillas, adaptadores y aislamiento de canales |
| `test/print-document.test.js` | 26 — contrato del documento imprimible |
| `test/routing.test.js` | 25 — rutas legítimas y 29 de fuzzing |
| `test/lifecycle.test.js` | 20 — máquina de estados comercial |
| `test/seo-assets.test.js` | 18 — existencia de assets y metadatos |
| **Total** | **406** (73 originales + 105 de la fase 2 + 228 de la fase 11) |

## FASE 9 — QA visual · **DONE**

`docs/QA_CHECKLIST.md`. Revisado en 1920×1080, 1366×768, 768 y 390×844 con
capturas reales.

## FASE 10 — Documentación · **DONE**

`README.md` actualizado y `docs/`: `ARCHITECTURE`, `QUOTING_ENGINE`,
`D1_SCHEMA`, `CLOUDFLARE_DEPLOYMENT`, `INTEGRATIONS`, `SECURITY`,
`QA_CHECKLIST`, `BASELINE_BEHAVIOR`.

---

## Criterios de aceptación

| # | Criterio | Estado |
|---|---|---|
| 1 | Home mejorada | **DONE** |
| 2 | Servicios estructurados | **DONE** |
| 3 | CTA Cotizar visible | **DONE** |
| 4 | `/cotizar` funcional | **DONE** |
| 5 | Wizard responsive | **DONE** |
| 6 | Motor de esfuerzo server-side | **DONE** |
| 7 | Motor de pricing server-side | **DONE** |
| 8 | D1 guarda cotizaciones | **DONE** |
| 9 | Telegram notifica | **DONE** |
| 10 | Email preparado/integrado según disponibilidad real | **DONE** — adaptadores listos; sin proveedor contratado sigue el inerte |
| 11 | PDF funcional o alternativa justificada | **DONE** — impresión del navegador, justificada |
| 12 | IDs seguros | **DONE** |
| 13 | Turnstile activo | **DONE** — en contacto y en cotizador |
| 14 | Rate limiting activo | **DONE** — 3 limitadores |
| 15 | `/api/contact` sigue funcionando | **DONE** — los 73 tests originales verdes, sin cambios de semántica |
| 16 | `/api/health` sigue funcionando | **DONE** |
| 17 | Rutas desconocidas correctamente tratadas | **DONE** |
| 18 | Secrets fuera del repositorio | **DONE** — `.gitignore` + `.dev.vars.example` con claves de prueba |
| 19 | Tests verdes | **DONE** — 406/406 |
| 20 | Build verde | **DONE** |
| 21 | Documentación actualizada | **DONE** |
| 22 | Sin errores críticos de consola | **DONE** — verificado en `/` y `/cotizar` |
| 23 | Mobile funcional | **DONE** — 390×844 |
| 24 | Sin regresiones conocidas | **DONE** — contrato de `docs/BASELINE_BEHAVIOR.md` intacto |

---

## REQUIERE CONFIGURACIÓN DEL PROPIETARIO

| # | Asunto | Qué hace falta | Bloquea |
|---|---|---|---|
| ~~C-01~~ | ~~Modelo de entornos~~ | **RESUELTO en la fase 11.** El nivel raíz es producción, sin `env.*`, sin scripts con `--env` | — |
| C-02 | Certificaciones publicadas | Confirmar cuáles están vigentes; `Certifications.jsx` tiene el hueco preparado y vacío | Nada: la página funciona sin ellas |
| C-03 | Tarifa por hora y mínimo comercial | `pricing.currencies.CLP/USD.hourlyRate` y `minimumAmount`, más `PRICING_ENABLED="true"` | El rango económico de las estimaciones |
| C-04 | Proveedor de correo | Verificar dominio, `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_INTERNAL_TO` y `RESEND_API_KEY` | Acuses por correo |
| C-05 | CRM | Elegir CRM, credencial y mapeo de estados | Sincronización de oportunidades |
| C-06 | SysReptor | URL, autenticación, plantilla y decisión sobre qué datos pueden salir | Creación de proyectos |
| ~~C-07~~ | ~~Assets SEO~~ | **RESUELTO en la fase 11.** Los siete existen, derivados de la marca real. `og-image.png` y `logo.png` son técnicos y sustituibles por diseño | — |
| C-10 | Cloudflare Access | Aplicación, política de identidad, AUD tag y DNS de `admin.vulnfocus.com` | El mini CRM, que queda deshabilitado hasta entonces |
| C-11 | Plazos de retención | Aprobar los de `docs/DATA_RETENTION.md` §2 y publicarlos en la política de privacidad | La purga de datos antiguos |
| C-12 | Site key real de Turnstile | Sustituir el marcador de `frontend/.env.production` | **Los dos formularios en producción** |
| C-08 | Informe de ejemplo anonimizado | Un PDF que publicar | El botón ya existe y dirige a contacto |
| C-09 | Retención de `quotes` | Confirmar plazo y reflejarlo en la política de privacidad | Purga automática |
