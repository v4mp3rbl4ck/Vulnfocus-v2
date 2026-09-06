# Checklist de producción

Estado a **6 de septiembre de 2026**. Se marca solo lo verificado con evidencia,
no lo que "debería" estar bien.

## Leyenda

- ✅ **VERIFICADO** — ejecutado en este entorno, con salida comprobada
- ⛔ **BLOQUEANTE** — impide el despliegue hasta resolverse
- ⏸ **PENDIENTE DEL PROPIETARIO** — no es un error; requiere una decisión o una credencial
- ➖ **NO APLICA**

---

## 1. Código y pruebas

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 1.1 | Suite completa en verde | ✅ | `npm test` → **406 passed (14 files)**, exit code 0 |
| 1.2 | Los 178 tests originales intactos | ✅ | `contact` 53 · `quotes-api` 50 · `quote-engine` 42 · `turnstile` 16 · `consistency` 13 · `rate-limit` 4 = **178** |
| 1.3 | Ningún test desactivado o comentado | ✅ | Sin `.skip`, `.only`, `.todo` ni `xit` en `test/` |
| 1.4 | Build del frontend | ✅ | `npm run build` → exit 0, `Compiled successfully`, 132,39 kB gzip |
| 1.5 | Post-build de rutas | ✅ | `npm run build:site:check` → "OK — 16 rutas + 404.html presentes" |
| 1.6 | Bundle del Worker válido | ✅ | `npm run deploy:dry-run` → 129,69 KiB, 38 assets, 4 limitadores + D1 |
| 1.7 | Migraciones válidas e idempotentes | ✅ | Las tres aplicadas dos veces sobre SQLite sin error |

## 2. Configuración de Cloudflare

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 2.1 | Una sola fuente de configuración, sin `env.*` | ✅ | `wrangler.jsonc`; test lo fija |
| 2.2 | Ningún script con `--env` | ✅ | `test/config.test.js` |
| 2.3 | Scripts de base de datos apuntan al binding real | ✅ | `vulnfocus-production` en los tres |
| 2.4 | `TURNSTILE_ALLOWED_HOSTNAMES` sin workers.dev | ✅ | `vulnfocus.com,www.vulnfocus.com` |
| 2.5 | `workers_dev: false` | ✅ | `wrangler.jsonc` |
| 2.6 | 4 limitadores con namespaces distintos | ✅ | 1001–1004, dry-run los muestra |
| 2.7 | HSTS sin `preload` | ✅ | `curl -sI` → `max-age=31536000; includeSubDomains` |
| 2.8 | Migraciones aplicadas en la D1 remota | ⛔ | **NO. Sin credenciales aquí.** M-01 |
| 2.9 | Secretos cargados en producción | ⛔ | No verificable desde aquí. M-02 |
| 2.10 | Hostnames de Turnstile en el panel | ⛔ | No verificable desde aquí. M-03 |
| 2.11 | Dominio propio asociado antes de `workers_dev: false` | ⛔ | **Verificar antes de desplegar.** M-04 |
| 2.12 | Site key real de Turnstile en el build | ⛔ | `frontend/.env.production` tiene el marcador. M-10 |

## 3. Routing

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 3.1 | 16 rutas legítimas → 200 | ✅ | `wrangler dev`, verificado una por una |
| 3.2 | Assets estáticos → 200 | ✅ | sitemap, robots, manifest y los 7 PNG |
| 3.3 | 31 rutas de fuzzing → 404 | ✅ | `/wp-admin`, `/.env`, `/.git/config`, `/backup`, `/phpmyadmin`, `/admin`… **0 fallos** |
| 3.4 | `/api/*` desconocido → 404 | ✅ | `/api/random`, `/api/users`, `/api/logs`, `/api/admin/*` |
| 3.5 | Métodos incorrectos → 405 con `Allow` | ✅ | `GET /api/contact` → 405 |
| 3.6 | `Content-Type` incorrecto → 415 | ✅ | `POST /api/quotes` sin cabecera → 415 |

## 4. Seguridad

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 4.1 | Cabeceras en assets estáticos | ✅ | HSTS, CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP |
| 4.2 | Cabeceras en respuestas del Worker | ✅ | `no-store`, CSP `default-src 'none'`, `nosniff`, CORP |
| 4.3 | CSP sin `unsafe-inline` en `script-src` | ✅ | Test de configuración |
| 4.4 | Turnstile no se puede esquivar | ✅ | 5 escenarios de entorno + cabeceras falsas → 403/503 |
| 4.5 | Allowlist de hostname exacta | ✅ | `vulnfocus.com.evil.tld` y 4 variantes → 403 |
| 4.6 | Sin manipulación de precio, horas o estado | ✅ | 26 campos prohibidos probados uno a uno |
| 4.7 | Contaminación de prototipos sin efecto | ✅ | `__proto__` y `constructor` en cuerpo, `scope` y `context` |
| 4.8 | SQL injection | ✅ | Payloads clásicos en cotizador y búsqueda del panel |
| 4.9 | XSS almacenado | ✅ | 5 payloads; escapado `\uXXXX` en JSON; `textContent` en el panel |
| 4.10 | IDOR y enumeración | ✅ | `public_id` de 128 bits; `quote_number` no recupera nada |
| 4.11 | Errores sin fuga de información | ✅ | Ni SQL, ni rutas, ni campo que falló, ni `error-codes` de Turnstile |
| 4.12 | Administración inaccesible | ✅ | 404 con el interruptor apagado, y con él encendido sin JWT válido |
| 4.13 | JWT de Access verificado de verdad | ✅ | `alg:none`, otra clave, payload manipulado, caducado, `iss`/`aud` ajenos → 404 |
| 4.14 | Sin secretos en el repositorio | ✅ | Escaneo de 11 patrones; solo la clave de PRUEBA pública de Cloudflare |
| 4.15 | Sin secretos en el bundle público | ✅ | Sin `hourlyRate`, `TURNSTILE_SECRET`, `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY` |
| 4.16 | Sin sourcemaps publicados | ✅ | `GENERATE_SOURCEMAP=false`; ningún `.map` en el build |

## 5. Cotizador

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 5.1 | Cálculo íntegramente server-side | ✅ | `test/quote-engine.test.js` + `test/security.test.js` |
| 5.2 | Precios desactivados sin tarifa | ✅ | `PRICING_ENABLED="false"` y `hourlyRate: null` |
| 5.3 | Activar el flag sin tarifas no inventa precios | ✅ | Test específico |
| 5.4 | D1 antes que las notificaciones | ✅ | Si D1 falla: 500 y no se notifica |
| 5.5 | Una notificación caída no pierde la cotización | ✅ | Telegram a 500 → la fila persiste y el usuario recibe 201 |
| 5.6 | Correlativo atómico | ✅ | Cotizaciones simultáneas sin colisión |
| 5.7 | Documento imprimible correcto | ✅ | `test/print-document.test.js`, 26 tests |
| 5.8 | Tarifas revisadas por el propietario | ⏸ | `docs/QUOTE_PRICING_REVIEW.md`, 8 hallazgos. M-09 |

## 6. Integraciones

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 6.1 | Telegram funcionando, sin romper | ✅ | Sin `parse_mode`, timeout 5 s, límite de longitud, solo código HTTP en logs |
| 6.2 | Correo: adaptadores implementados | ✅ | `null` (activo) · `resend` · `mailchannels` |
| 6.3 | Correo: proveedor configurado | ⏸ | `EMAIL_PROVIDER="null"`. **Nada se rompe.** M-07 |
| 6.4 | Plantillas cliente e interna | ✅ | 26 tests. Sin precio si no hay tarifa |
| 6.5 | CRM: contrato definido y usado | ✅ | Invocado al crear y en cada transición |
| 6.6 | CRM: proveedor externo | ⏸ | `CRM_PROVIDER="null"`. Mini CRM interno como alternativa |
| 6.7 | SysReptor deshabilitado | ✅ | `SYSREPTOR_ENABLED="false"`, sin red ni con el flag activo |
| 6.8 | Analítica sin datos personales | ✅ | Allowlist de 7 eventos y 5 propiedades |

## 7. Administración

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 7.1 | Implementada y probada | ✅ | 46 tests |
| 7.2 | Deshabilitada por defecto | ✅ | `ADMIN_ENABLED="false"` |
| 7.3 | Ciclo de vida con transiciones válidas | ✅ | 20 tests de la máquina de estados |
| 7.4 | Auditoría de cambios | ✅ | `quote_status_events`, append-only |
| 7.5 | No puede editar ni borrar nada más | ✅ | Test que compara todas las columnas |
| 7.6 | Cloudflare Access configurado | ⛔ | **NO. Sin él, no activar.** M-05 |
| 7.7 | DNS de `admin.vulnfocus.com` | ⛔ | Pendiente. M-06 |

## 8. SEO

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 8.1 | Los 7 PNG referenciados existen | ✅ | Antes daban 404. `test/seo-assets.test.js` |
| 8.2 | Iconos derivados de la marca real | ✅ | Del escudo de `favicon.svg` |
| 8.3 | Open Graph, Twitter, canonical, hreflang por ruta | ✅ | `scripts/build-site.mjs` |
| 8.4 | Sitemap y robots | ✅ | 15 URL indexables; `/estimacion` con `noindex` |
| 8.5 | Sin datos estructurados inventados | ✅ | Sin `AggregateRating`, `Review`, `award` ni `Offer` |
| 8.6 | Assets de diseño definitivos | ⏸ | `og-image.png` y `logo.png` son técnicos. M-11 |

## 9. Datos

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 9.1 | Migraciones aditivas y no destructivas | ✅ | Solo `CREATE ... IF NOT EXISTS` |
| 9.2 | IP no persistida | ✅ | `STORE_IP="false"` |
| 9.3 | Política de retención documentada | ✅ | `docs/DATA_RETENTION.md` |
| 9.4 | Sin purga automática sin aprobación | ✅ | Sin Cron Trigger. Scripts manuales |
| 9.5 | Plazos de retención aprobados | ⏸ | Propuesta pendiente de decisión |
| 9.6 | Copia de seguridad antes de migrar | ⛔ | Ejecutar `npm run db:backup`. M-01 |

---

## Bloqueantes antes de desplegar

1. **M-01** — Aplicar `0003_quote_status_events.sql` con copia previa.
2. **M-02** — Verificar `TURNSTILE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
3. **M-03** — Hostnames de Turnstile: quitar workers.dev.
4. **M-04** — Confirmar el dominio propio **antes** de desplegar `workers_dev: false`.
5. **M-10** — Site key real en `frontend/.env.production`.
6. **M-12** — Prueba de humo tras desplegar.

No bloquean: correo, CRM, administración, SysReptor, tarifas y assets de diseño.
Todos están **deshabilitados de forma explícita** y el sitio funciona sin ellos.
