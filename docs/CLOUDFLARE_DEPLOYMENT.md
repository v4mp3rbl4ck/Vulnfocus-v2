# Despliegue en Cloudflare

## Variables y secretos

### Build (públicas, se incrustan en el bundle)

| Nombre | Dónde | Para qué |
|---|---|---|
| `REACT_APP_TURNSTILE_SITE_KEY` | `frontend/.env.production` | Renderiza el widget. **Público por diseño.** |
| `INLINE_RUNTIME_CHUNK=false` | `frontend/.env.production` | Permite CSP sin `unsafe-inline` en `script-src` |
| `GENERATE_SOURCEMAP=false` | `frontend/.env.production` | No publicar el código fuente original |

### Runtime (`vars` de `wrangler.jsonc`, no secretas)

| Nombre | Por defecto | Para qué |
|---|---|---|
| `STORE_IP` | `"false"` | Si se persiste la IP del visitante |
| `TURNSTILE_ALLOWED_HOSTNAMES` | lista | Allowlist **exacta** de hostnames de Siteverify |
| `PRICING_ENABLED` | `"false"` | Habilita el rango económico en las estimaciones |
| `QUOTE_DEFAULT_CURRENCY` | `"CLP"` | Moneda por defecto |
| `EMAIL_PROVIDER` | `"null"` | `null` · `resend` · `mailchannels` |
| `EMAIL_FROM` | `""` | Remitente. Requiere dominio verificado |
| `EMAIL_INTERNAL_TO` | `""` | Destinatario del aviso comercial interno |
| `CRM_PROVIDER` | `"null"` | Sin CRM elegido todavía |
| `SYSREPTOR_ENABLED` | `"false"` | Integración preparada y deshabilitada |
| `ADMIN_ENABLED` | `"false"` | Mini CRM. Con `"false"`, `/admin` y `/api/admin/*` devuelven 404 |
| `CF_ACCESS_TEAM_DOMAIN` | `""` | `<equipo>.cloudflareaccess.com`. Sin él la administración no arranca |
| `CF_ACCESS_AUD` | `""` | AUD tag de la aplicación de Access. Público, no es un secreto |
| `ADMIN_ALLOWED_EMAILS` | `""` | Allowlist opcional además de Access |

### Secretos (Cloudflare Secrets — **nunca** en el repositorio)

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
# solo si se activa correo:
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAILCHANNELS_API_KEY
```

`npx wrangler secret list` muestra los nombres, nunca los valores.

## Bindings

| Binding | Tipo | Notas |
|---|---|---|
| `ASSETS` | Static Assets | `frontend/build`, `not_found_handling: "404-page"`, `run_worker_first: ["/api/*"]` |
| `DB` | D1 | `contact_submissions`, `quotes`, `quote_counters` |
| `CONTACT_RATE_LIMITER` | Rate limit | 5 / 60 s |
| `QUOTE_RATE_LIMITER` | Rate limit | 3 / 60 s — **nuevo** |
| `QUOTE_READ_RATE_LIMITER` | Rate limit | 30 / 60 s |
| `ADMIN_RATE_LIMITER` | Rate limit | 60 / 60 s, por identidad de Access |

Los `namespace_id` van del `1001` al `1004` y son distintos entre sí: cada
superficie tiene su cubo y ninguna consume la cuota de otra. Un test lo verifica.

## Despliegue

```bash
npm ci
npm run build          # instala el frontend, compila y prerenderiza las rutas
npm test               # 308 tests
npm run db:migrate     # migraciones sobre vulnfocus-production
npx wrangler deploy
```

`npm run build` encadena tres pasos y **los tres son obligatorios**:

```
install:frontend → build:frontend → build:site
```

Sin `build:site` no existen los HTML por ruta y **todas las rutas devolverían
404**. `npm run build:site:check` lo verifica sin escribir nada.

## Checklist de despliegue

- [ ] `npm test` en verde (308 tests)
- [ ] `npm run build` en verde
- [ ] `npm run build:site:check` en verde
- [ ] `npm run db:migrate` aplicado (incluye `0002_quotes.sql` y `0003_quote_status_events.sql`)
- [ ] `wrangler d1 execute vulnfocus-production --remote --command "SELECT COUNT(*) FROM quote_status_events;"` responde sin error
- [ ] Secretos presentes: `wrangler secret list`
- [ ] `npm run deploy:dry-run` muestra los **cuatro** bindings de rate limit y la D1
- [ ] `frontend/.env.production` con el site key **real** de Turnstile
- [ ] `TURNSTILE_ALLOWED_HOSTNAMES` incluye el hostname del entorno desplegado
- [ ] Tras desplegar: `/`, `/servicios`, `/servicios/pentesting-web`, `/proceso`,
      `/recursos`, `/certificaciones`, `/cotizar` → **200**
- [ ] `/wp-admin`, `/.env`, `/backup`, `/admin` → **404**
- [ ] `GET /api/health` → 200; `GET /api/logs` y `GET /api/admin/quotes` → 404
- [ ] Envío real del formulario de contacto → 201, fila en D1, aviso en Telegram
- [ ] Envío real del cotizador → 201, `VF-AAAA-NNNNNN`, fila en `quotes`, aviso
- [ ] `GET /api/quotes/<public_id>` devuelve la estimación
- [ ] `GET /api/quotes/<quote_number>` devuelve 404
- [ ] Consola del navegador sin errores en `/` y en `/cotizar`

## Checklist de rollback

Por orden de menor a mayor alcance:

1. **Rutas que devuelven 404 tras el despliegue** → falta el post-build.
   `npm run build:site && npx wrangler deploy`. Alternativa inmediata: volver
   `assets.not_found_handling` a `"single-page-application"` y desplegar; se
   pierde el 404 real pero todas las rutas vuelven a responder.
2. **Problema solo en el cotizador** → retirar `/api/quotes` del router de
   `worker/index.js` y desplegar. `/api/contact` no depende de él. Las filas ya
   creadas en `quotes` no estorban.
3. **Problema en las notificaciones** → `EMAIL_PROVIDER="null"` y desplegar.
   Telegram y D1 siguen funcionando.
4. **Rollback completo del Worker** → `npx wrangler rollback` (o
   `wrangler deploy` desde el commit anterior). **Las migraciones de D1 no se
   revierten**, y no hace falta: `0002_quotes.sql` es aditiva y el Worker
   anterior sencillamente no consulta esas tablas.
5. **Restauración de datos** → `npm run db:backup` antes de cualquier cambio;
   los backups contienen datos personales y deben guardarse cifrados.

## Modelo de entornos — RESUELTO

**El nivel raíz de `wrangler.jsonc` ES producción.** No existen bloques `env.*`,
y `package.json` ya no tiene ningún script con `--env`.

Antes había deriva: la documentación describía `env.staging` y `env.production`,
el fichero real declaraba todo en la raíz, y los scripts pasaban `--env`. El
resultado no era un error visible sino algo peor: `wrangler deploy --env production`
sobre un fichero **sin** entornos crea un Worker distinto —`vulnfocus-v2-production`—
**sin D1 y sin limitadores de tasa**. El despliegue "funciona" y la aplicación
queda a medias.

Despliegue real:

```
GitHub  →  Cloudflare Workers Builds  →  vulnfocus-v2  →  vulnfocus.com
```

Comandos vigentes:

| Comando | Qué hace |
|---|---|
| `npm run dev` | `wrangler dev` con la misma configuración, D1 local y `.dev.vars` |
| `npm run deploy` | Build completo y `wrangler deploy` (respaldo manual; lo normal es que despliegue Workers Builds) |
| `npm run deploy:dry-run` | Valida configuración y bindings **sin desplegar** |
| `npm run db:migrate` | Migraciones sobre la D1 remota |
| `npm run db:migrate:local` | Migraciones sobre la D1 de Miniflare |
| `npm run tail` | Logs en vivo |

Hay tests que impiden que la deriva vuelva (`test/config.test.js`): fallan si
reaparece un bloque `env.*`, si algún script usa `--env`, o si un script de base
de datos apunta a un nombre distinto del binding.

### Si algún día hace falta staging

**No añadir `env.staging` a este fichero.** Reintroduce exactamente el problema
que se acaba de cerrar: una configuración que hereda a medias y que hay que
recordar mantener sincronizada.

La forma recomendada, cuando llegue el momento:

1. Un **Worker aparte** (`vulnfocus-staging`) con su propio `wrangler.staging.jsonc`,
   su propia D1 y sus propios secretos.
2. Desplegarlo con `wrangler deploy -c wrangler.staging.jsonc`.
3. `TURNSTILE_ALLOWED_HOSTNAMES` con el hostname de staging, **nunca** el de
   producción.
4. `_headers` ya envía `X-Robots-Tag: noindex, nofollow` a `staging.vulnfocus.com`
   y a `*.workers.dev`: staging no compite en buscadores.
5. La copia de datos de producción a staging debe ir **anonimizada**
   (`docs/DATA_RETENTION.md`).

Mientras tanto, el sustituto de staging es: `npm test` (308 tests),
`npm run deploy:dry-run`, `npm run dev` en local y las versiones de Cloudflare,
que permiten desplegar y revertir con `wrangler rollback`.

## Cambios de configuración de esta fase

| Cambio | Efecto | Rollback |
|---|---|---|
| `workers_dev: false` | Retira `vulnfocus-v2.<sub>.workers.dev` | `true` y desplegar |
| `TURNSTILE_ALLOWED_HOSTNAMES` sin workers.dev | Solo `vulnfocus.com` y `www.` | Añadir el hostname |
| `run_worker_first` incluye `/admin` y `/admin/*` | El panel no es un asset estático | Quitarlos |
| `ADMIN_RATE_LIMITER` (60/60 s) | Limita la administración | Quitar el binding |
| `ADMIN_ENABLED`, `CF_ACCESS_*`, `ADMIN_ALLOWED_EMAILS` | Administración, apagada | `ADMIN_ENABLED="false"` |
| HSTS sin `preload` | Menos compromiso irreversible | — |

> **Antes de desplegar `workers_dev: false`**, verificar que el dominio propio
> está asociado: `docs/CLOUDFLARE_MANUAL_ACTIONS.md` → **M-04**. Si no lo
> estuviera, workers.dev sería el único acceso.

## Acciones manuales

Las que no puede hacer este repositorio están en
**`docs/CLOUDFLARE_MANUAL_ACTIONS.md`**, cada una con dónde, qué y resultado
esperado.
