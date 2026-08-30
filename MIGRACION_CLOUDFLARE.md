# Migración VulnFocus: VPS → Cloudflare

Estado del documento: **FASE 0–3 completadas y validadas en local. FASES 4–8
pendientes de ejecución por el propietario** (requieren credenciales de la cuenta
de Cloudflare).

Criterio usado en todo el documento:

- **PASS** — probado, con evidencia
- **UNVERIFIED** — no probado
- **FAIL** — probado y falla

---

## 1. Arquitectura: antes y después

**Antes**

```
Internet → Cloudflare → VPS Debian
                          ├── Nginx  (TLS Let's Encrypt, SPA, proxy /api)
                          ├── FastAPI + Uvicorn (systemd)
                          └── MongoDB
                        UFW · Fail2ban · Certbot · deploy por SSH
```

**Después**

```
Internet → Cloudflare
             ├── /*     → Static Assets (React compilado)
             └── /api/* → Worker → D1 · Turnstile Siteverify · Telegram
```

Ningún servidor Linux que administrar.

## 2. Inventario y clasificación

| Componente | Decisión | Notas |
|---|---|---|
| React 19, React Router, componentes, páginas, contexto | **KEEP** | Sin cambios visuales |
| `translations.js`, `App.css`, `SEO.jsx` | **KEEP** | Intactos |
| `Contact.jsx` | **MODIFY** | Widget Turnstile + `fetch` same-origin |
| `public/index.html` | **MODIFY** | Script de Turnstile |
| CRA + CRACO | **KEEP** | Fase 2 opcional: → Vite |
| `craco.config.js` | **MODIFY** | Se queda solo el alias `@` |
| 45 componentes `shadcn/ui` sin usar | **DELETE** | Solo se importa `sonner` |
| 41 dependencias npm sin usar | **DELETE** | Radix, axios, recharts, zod, recaptcha… |
| `frontend/plugins/` (3.400 líneas, tooling Emergent) | **DELETE** | Solo dev; leía una contraseña de supervisor |
| FastAPI + Uvicorn | **DELETE** | → Worker |
| MongoDB + Motor | **MIGRATE** | → D1 |
| SlowAPI | **DELETE** | → binding `ratelimits` |
| `GET /api/contacts`, `/contacts/stats`, `/logs`, `/logs/stats` | **DELETE** | Admin público sin auth |
| `POST/GET /api/status` | **DELETE** | Endpoint de pruebas |
| `GET /api/` | **DELETE** | Redundante con `/health` |
| `GET /api/health` | **KEEP** | Sin exponer estado interno |
| `POST /api/contact` | **MIGRATE** | Núcleo de la app |
| Middleware de access logs → MongoDB | **DELETE** | → Workers Observability |
| Telegram | **KEEP/MODIFY** | Texto plano, sin `parse_mode` |
| Turnstile | **IMPLEMENT** | No existía validación server-side |
| Nginx, systemd, UFW, Fail2ban, Certbot | **DELETE** | Los cubre Cloudflare |
| `.github/workflows/deploy.yml` (SSH → VPS) | **DELETE** | → Workers Builds |
| `scripts/deploy.sh`, `nginx-security-headers.conf` | **DELETE** | |
| `.emergent/`, `.gitconfig`, `test_result.md`, `memory/` | **DELETE** | Artefactos de la plataforma de scaffolding |

## 3. Hallazgos de seguridad — proyecto original

### H-01 · Endpoints administrativos públicos sin autenticación — **Crítica**

`GET /api/contacts` devolvía hasta 1.000 contactos con nombre, email, empresa,
mensaje, IP y User-Agent. `GET /api/logs` exponía el log de accesos completo.
Sin autenticación; solo rate limiting. Fuga masiva de PII con un `curl`.
CWE-306, OWASP API1+API3.
**Corregido:** endpoints eliminados; el Worker devuelve 404 a todo lo que no sea
`/api/contact` o `/api/health`. Verificado con 7 tests.

### H-02 · CORS permisivo con credenciales — **Alta**

`server.py:462`: `allow_origins=os.environ.get('CORS_ORIGINS','*').split(',')`
junto a `allow_credentials=True`. Si la variable faltaba en el `.env`, quedaba
`*` con credenciales. Combinado con H-01, cualquier web podía leer los contactos
usando el navegador de una víctima.
**Corregido:** API same-origin, sin cabeceras CORS. Verificado con test.

### H-03 · Turnstile sin validación server-side — **Alta**

`ContactFormRequest` declaraba `turnstileToken` pero **nunca se verificaba**. Un
widget sin Siteverify no es un control de seguridad: basta con enviar el POST
directamente.
**Corregido:** Siteverify obligatorio, fail closed, `idempotency_key`, allowlist
exacta de hostname. 14 tests unitarios + 6 de integración.

### H-04 · Sin lockfile — **Media**

Ni `yarn.lock` ni `package-lock.json`, pese a declarar `packageManager: yarn@1.22.22`.
Builds no reproducibles; `npm ci` imposible; sin defensa ante una versión
transitiva comprometida.
**Corregido:** normalizado a npm, dos lockfiles generados y commiteados.
`rm -rf node_modules && npm ci && npm run build` → PASS.

### H-05 · Assets SEO referenciados pero inexistentes — **Baja**

`index.html` referencia `og-image.png`, `logo.png`, `favicon-32x32.png` y
`apple-touch-icon.png`; ninguno existe en `public/`. Previsualizaciones sociales
rotas y 404 en cada carga.
**No corregido:** requiere las imágenes, que no están en el repositorio.

### H-06 · Toasts inertes (bug funcional, no de seguridad) — **Informativo**

`Contact.jsx` usa `useToast()` (Radix) pero `App.js` renderiza el `<Toaster />`
de sonner. Esos toasts nunca se muestran. El `<div className="status-message
success">` sí funciona, así que el usuario no percibe nada roto.
**No corregido a propósito:** cambiar comportamiento durante la migración viola
la prioridad "no romper la web". Arreglo de una línea cuando se decida.

---

## 4. Hallazgo de dependencias (H-07) — cerrado

**Contexto.** `npm audit` en `frontend/` reporta **29 vulnerabilidades**
(9 low, 6 moderate, 14 high) tras aplicar el único fix seguro disponible.

**Metodología.** No me quedé con el número de `npm audit`. Instrumenté
`Module._resolveFilename` durante `npm run build` para registrar qué paquetes se
cargan realmente, usando `webpack`, `tailwindcss` y `autoprefixer` como controles
positivos (los tres detectados → instrumento fiable). Además busqué cada paquete
en el bundle servido.

**Resultado clave:** ninguno de los paquetes vulnerables aparece en
`build/static/js/main.*.js` — **0 ocurrencias**. Todos son cadena de
build/test/dev-server. Ninguno se ejecuta en el navegador del visitante ni en el
Worker.

### Tabla de hallazgos

| Paquete | Directo/transitivo | Versión | Advisory | Sev. | ¿Se carga en el build? | ¿Llega a producción? |
|---|---|---|---|---|---|---|
| `nth-check` | transitivo (`css-select` ← `svgo` ← `@svgr/webpack` ← `react-scripts`) | <2.0.1 | GHSA-rp65-9cf3-cjxr | High | **Sí** | No |
| `postcss` | transitivo (`resolve-url-loader` ← `react-scripts`) | ≤8.5.22 | GHSA-7fh5-64p2-3v2j, GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 | High | **Sí** | No |
| `serialize-javascript` | transitivo (`rollup-plugin-terser` ← `react-scripts`) | ≤7.0.4 | GHSA-5c6j-r48x-rmvq, GHSA-qj8w-gfj5-8c6v | High | **Sí** | No |
| `svgo` | transitivo (`@svgr/plugin-svgo` ← `react-scripts`) | 1.0.0–2.8.2 | GHSA-2p49-hgcm-8545 | High | **Sí** | No |
| `underscore` | transitivo (`jsonpath` ← `workbox-build` ← `react-scripts`) | ≤1.13.7 | GHSA-qpx9-hpmf-5gmw | High | **Sí** | No |
| `css-select`, `resolve-url-loader`, `workbox-build`, `jsonpath`, `bfj` | transitivos de `react-scripts` | varias | (dependen de los anteriores) | High/Mod | **Sí** | No |
| `webpack-dev-server` | transitivo (`react-scripts`) | ≤5.2.6 | GHSA-9jgg-88mc-972h, GHSA-4v9v-hfq4-rm2v, GHSA-79cf-xcqc-c78w, GHSA-mx8g-39q3-5c79, GHSA-f5vj-f2hx-8m93, GHSA-m28w-2pqf-7qgj | Moderate | No | No |
| `uuid` | transitivo (`react-scripts`) | <11.1.1 | GHSA-w5hq-g745-h8pq | Moderate | No | No |
| `jest`, `jsdom`, `sockjs`, `@tootallnate/once`, `http-proxy-agent` | transitivos (`react-scripts`) | varias | varias | Low/Mod | No | No |
| `@eslint/plugin-kit` | transitivo (`eslint`, devDep directa) | <0.3.4 | GHSA-xffm-g5w8-qvg7 | Low | No | No |

### Análisis de explotabilidad para VulnFocus

Los paquetes que **sí se cargan en el build** procesan exclusivamente **entradas
del propio repositorio**: nuestro CSS, nuestro `favicon.svg`, nuestra
configuración de webpack. Las rutas de explotación de estos advisories requieren
input hostil:

- `nth-check` / `css-select`: ReDoS con selectores CSS maliciosos — los
  selectores son los de `App.css`.
- `postcss` (path traversal, lectura arbitraria de ficheros vía source maps):
  requiere CSS malicioso; el CSS es nuestro y `GENERATE_SOURCEMAP=false`.
- `serialize-javascript` (RCE vía `RegExp.flags`): serializa opciones de
  `terser-webpack-plugin`, que son nuestra configuración.
- `svgo`: procesa `favicon.svg`, un fichero de 532 bytes que controlamos.

**Conclusión:** no existe ruta de explotación mientras las entradas del build
sean confiables. El escenario residual real es un **paquete npm malicioso** en el
árbol que use estos fallos para escalar durante el build — mitigado por el
lockfile (H-04) y por `npm ci`.

### Decisiones

| Elemento | Decisión | Justificación |
|---|---|---|
| `eslint` 9.23.0 → **9.39.5** | **FIX NOW — aplicado** | Misma major, semver-compatible. Cierra GHSA-xffm-g5w8-qvg7. **Verificado:** `npm run build` produce el mismo hash `main.d0cc8ee5.js`, salida byte-idéntica; 73/73 tests siguen en verde. |
| Cadena de `react-scripts` (28 advisories restantes) | **ACCEPT TEMPORARILY** | No hay versión corregida: 5.0.1 es la última publicada y CRA está sin mantenimiento. `npm audit fix --force` propone `react-scripts@0.0.0` — un paquete placeholder que **destruiría el build**. No alcanza producción. |
| `webpack-dev-server`, `jest`, `jsdom`, `sockjs` | **NOT APPLICABLE** | No se cargan ni en el build ni en producción. `webpack-dev-server` solo corre en `npm start`, en la máquina del desarrollador. |
| Migración CRA → **Vite** | **Fase 2, post-cutover** | Es la única solución real: elimina toda la cadena de `react-scripts`. **No se ejecuta ahora**: mezclarla con esta migración viola la prioridad nº 1 ("no romper la web"). |

**Riesgo aceptado y documentado:** mientras el proyecto siga en CRA, `npm audit`
seguirá reportando ~29 hallazgos sin ruta de actualización. Es deuda de la
herramienta de build, no de la aplicación desplegada.

**Comando prohibido:** `npm audit fix --force` en `frontend/`.

---

## 5. Base congelada (FASE 0–3)

```
commit c35b404  ·  tag v2.0.0-local-validated
63 ficheros · working tree limpio
```

| Control | Resultado |
|---|---|
| `npm test` (Vitest sobre workerd + D1 local) | **PASS** 73/73 |
| `rm -rf node_modules && npm ci && npm run build` | **PASS** |
| Bundle: 97,56 kB gzip, sin source maps | **PASS** |
| Migración D1 desde cero reproducible | **PASS** |
| Sin secretos en el repositorio | **PASS** |
| Sin bypass de Turnstile en `worker/` | **PASS** |

Desde este punto no se mezclan refactors cosméticos con cambios de despliegue.

---

## 6. FASE 4 — Staging real en Cloudflare

**Estado: UNVERIFIED.** Requiere tu cuenta de Cloudflare.

### 6.1 Crear la D1 de staging

```bash
npx wrangler login
npx wrangler d1 create vulnfocus-staging
```

Copia el UUID a `wrangler.jsonc` → `env.staging.d1_databases[0].database_id`,
sustituyendo `REEMPLAZAR_UUID_D1_STAGING`. Después:

```bash
npm run db:migrate:staging
npx wrangler d1 execute vulnfocus-staging --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Debe aparecer `contact_submissions`.

### 6.2 Turnstile de staging

En el panel: **Turnstile → Add widget**.

- Nombre: `vulnfocus-staging`
- Hostname: **solo** `staging.vulnfocus.com`
- Modo: Managed

Un widget **separado** del de producción. Así un token emitido en staging no vale
en producción y viceversa, y la allowlist de hostnames de cada entorno
(`env.*.vars.TURNSTILE_ALLOWED_HOSTNAMES`) lo refuerza en el servidor.

El **site key** va a `frontend/.env.production`… pero ese fichero es común a
ambos entornos. Para staging, pásalo en el build:

```bash
REACT_APP_TURNSTILE_SITE_KEY=<site-key-staging> npm run build
npx wrangler deploy --env staging
```

### 6.3 Secretos de staging

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging
npx wrangler secret put TELEGRAM_BOT_TOKEN   --env staging
npx wrangler secret put TELEGRAM_CHAT_ID     --env staging
```

Para staging, usa **un chat de Telegram distinto** del de producción (un grupo de
pruebas). Confirma que quedaron como secretos y no como vars:

```bash
npx wrangler secret list --env staging   # muestra nombres, nunca valores
```

### 6.4 Desplegar

```bash
npm run deploy:staging
```

Wrangler devuelve una URL `*.workers.dev`. Para usar `staging.vulnfocus.com`:
**Workers & Pages → vulnfocus-staging → Settings → Domains & Routes → Add custom
domain**. Cloudflare crea el registro DNS automáticamente.

### 6.5 Batería de validación en staging

```bash
npm run acceptance https://staging.vulnfocus.com
```

Cubre métodos, endpoints legacy, validación, rutas SPA, cabeceras y `no-store`.

**Comprobaciones manuales que el script no puede hacer:**

1. **Turnstile real.** Abre `https://staging.vulnfocus.com` en un navegador,
   rellena el formulario, resuelve el widget y envía. Debe salir el mensaje de
   éxito. Después:
   ```bash
   npx wrangler d1 execute vulnfocus-staging --remote \
     --command="SELECT id, name, email, status, created_at FROM contact_submissions ORDER BY created_at DESC LIMIT 1;"
   ```
   → **PASS — REAL TURNSTILE** solo si aparece exactamente el contacto enviado.

2. **Telegram real.** El mismo envío debe llegar al chat de pruebas. Confírmalo
   visualmente. → **PASS — REAL TELEGRAM**.

3. **CSP en DevTools.** Con la consola abierta durante todo el flujo: **0 errores
   de CSP**. Si Turnstile se queja, añade únicamente el origen que indique el
   error y que esté documentado por Cloudflare. No relajes la CSP globalmente
   para silenciar avisos, y no toques `script-src` para meter `unsafe-inline` o
   `unsafe-eval`.

4. **Rate limiting.** Turnstile de un solo uso hace incómodo repetir 6 envíos
   manuales. Dos opciones:
   - **Recomendada:** enviar 6 veces desde el navegador, resolviendo el widget
     cada vez. El 6º debe dar el mensaje de "demasiadas solicitudes".
   - **Si resulta impracticable:** el comportamiento queda respaldado por los
     4 tests de `test/rate-limit.test.js` sobre el runtime real de Workers, más
     la confirmación de que el binding está desplegado:
     ```bash
     npx wrangler deploy --env staging --dry-run | grep RATE_LIMITER
     ```
     En ese caso, clasifica el comportamiento exacto multi-PoP como
     **dependiente de la infraestructura de Cloudflare** y no como PASS medido.

   **No añadas tokens mágicos ni cabeceras de bypass para facilitar esta prueba.**

5. **Cabeceras en el edge.**
   ```bash
   curl -sI https://staging.vulnfocus.com/ | grep -iE 'strict-transport|content-security|x-content-type|referrer-policy|permissions-policy|x-frame'
   curl -si https://staging.vulnfocus.com/api/health | head -20
   curl -si -X GET https://staging.vulnfocus.com/api/contact | grep -i 'cache-control\|allow'
   ```

6. **`/api/*` nunca devuelve `index.html`.**
   ```bash
   for p in /api/random /api/contacts /api/logs /api/admin; do
     echo -n "$p -> "; curl -s https://staging.vulnfocus.com$p | head -c 60; echo
   done
   ```
   Debe salir JSON `{"status":"error",...}`, nunca HTML.

---

## 7. FASE 5 — Preparar producción

Solo cuando staging esté completamente PASS.

```bash
npx wrangler d1 create vulnfocus
# UUID → wrangler.jsonc → env.production.d1_databases[0].database_id
npm run db:migrate:production
```

Las tablas se crean **desde `migrations/`**, los mismos ficheros que staging.
Nunca a mano desde el Dashboard.

Widget de Turnstile de producción con hostnames `vulnfocus.com` y
`www.vulnfocus.com`. Su site key va a `frontend/.env.production`.

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
npx wrangler secret put TELEGRAM_BOT_TOKEN   --env production
npx wrangler secret put TELEGRAM_CHAT_ID     --env production
```

### Datos de MongoDB

En la VPS:

```bash
./scripts/mongo-inventory.sh
```

Devuelve conteos y rango de fechas **sin imprimir PII**. Si
`contact_submissions` tiene datos que conservar:

```bash
mongoexport --db=vulnfocus --collection=contact_submissions --jsonArray --out=contacts.json
node scripts/mongo-to-d1.mjs contacts.json > /tmp/import.sql
npx wrangler d1 execute vulnfocus --remote --file=/tmp/import.sql
./scripts/verify-migration.sh contacts.json vulnfocus
```

`verify-migration.sh` compara conteos **y un hash por registro**
(`id|email|created_at`, SHA-256 truncado) entre origen y destino, sin imprimir
ningún dato personal.

`access_logs` y `status_checks` **no se migran**: el primero es un log HTTP
propio sustituido por Workers Observability y lleno de IPs históricas; el segundo
son datos de un endpoint de pruebas que se elimina.

---

## 8. Release gate — pre-cutover

**No cambies el DNS hasta que esta tabla esté completa.**

| # | Control | Estado |
|---|---|---|
| **LOCAL** | | |
| 1 | 73/73 tests | **PASS** |
| 2 | `npm ci` + build limpio | **PASS** |
| **STAGING REAL** | | |
| 3 | Despliegue del Worker | UNVERIFIED |
| 4 | D1 staging con migraciones | UNVERIFIED |
| 5 | Rutas SPA | UNVERIFIED |
| 6 | API deny-by-default | UNVERIFIED |
| 7 | Turnstile real (navegador) | UNVERIFIED |
| 8 | Insert real en D1 | UNVERIFIED |
| 9 | Telegram real | UNVERIFIED |
| 10 | Cabeceras de seguridad en el edge | UNVERIFIED |
| 11 | CSP sin errores en DevTools | UNVERIFIED |
| 12 | HTTPS / TLS | UNVERIFIED |
| 13 | Sin secretos expuestos | **PASS** (repo) / UNVERIFIED (edge) |
| **PRODUCCIÓN** | | |
| 14 | D1 de producción | UNVERIFIED |
| 15 | Migraciones aplicadas | UNVERIFIED |
| 16 | Secretos configurados | UNVERIFIED |
| 17 | Migración de Mongo (si aplica) | UNVERIFIED |
| 18 | Rollback preparado | **PASS** (documentado, § 10) |

Si algún control crítico falla: **NO CUTOVER**.

---

## 9. FASE 7 — Cutover

### 9.1 Antes de tocar nada

```bash
npm run db:backup vulnfocus        # backup de D1 (vacía o ya migrada)
# En la VPS:
mongodump --db=vulnfocus --out=/root/backup-pre-cutover
tar czf /root/vulnfocus-app.tar.gz /opt/vulnfocus
```

**Anota los registros DNS actuales antes de modificarlos.** Captura o copia
exacta de los registros `A` de `@` y `www` con su IP y su estado de proxy. Sin
esto no hay rollback.

### 9.2 Bajar el TTL (24 h antes)

En **DNS → Records**, pon el TTL de `@` y `www` en **Auto** o el mínimo. Reduce
la ventana de propagación si hay que revertir.

### 9.3 Desplegar producción

```bash
npm run deploy:production
```

### 9.4 Cambiar el DNS

En **Workers & Pages → vulnfocus → Settings → Domains & Routes → Add custom
domain**, añade `vulnfocus.com` y luego `www.vulnfocus.com`.

Cloudflare pide **eliminar los registros `A` existentes** que apuntan a la VPS,
porque un custom domain crea su propio registro gestionado. Es el momento del
corte: hazlo primero con `www` para validar con tráfico real reducido, y
`vulnfocus.com` después.

### 9.5 Redirección de www

`www.vulnfocus.com` servirá el mismo contenido, no redirigirá. Para el canonical
en `https://vulnfocus.com`, crea una **Redirect Rule**:

**Rules → Redirect Rules → Create rule**

- Nombre: `www a apex`
- Si: `Hostname` `equals` `www.vulnfocus.com`
- Entonces: Dynamic redirect →
  `concat("https://vulnfocus.com", http.request.uri.path)`
- Código: **301**, preservar query string

Las Redirect Rules están disponibles en plan Free.

### 9.6 TLS y HTTPS

- **SSL/TLS → Overview → Full (strict)**. Ya no hay origen propio; el certificado
  lo gestiona Cloudflare.
- **SSL/TLS → Edge Certificates → Always Use HTTPS: On**
- **Minimum TLS Version: 1.2**
- HSTS ya lo emite `_headers`. Si lo activas también en el panel, no lo dupliques.

### 9.7 WAF recomendado (plan Free)

- **Security → WAF → Managed rules:** Cloudflare Free Managed Ruleset **On**.
- **Bot Fight Mode: On** (Free; sin excepciones configurables — si diera falsos
  positivos en el formulario, desactívalo: Turnstile ya cubre ese frente).
- **Rate limiting rules:** el plan Free da **1 regla**, con período y timeout de
  **10 s** únicamente. No permite "5 por minuto". El rate limiting real ya lo hace
  el binding del Worker; una regla WAF adicional solo tendría sentido en Pro.

### 9.8 Verificación post-cutover

```bash
npm run acceptance https://vulnfocus.com
curl -sI https://www.vulnfocus.com | head -3      # debe ser 301
curl -s https://vulnfocus.com/robots.txt | head -3
curl -s https://vulnfocus.com/sitemap.xml | head -3
```

Y un **envío real controlado** desde el navegador: Turnstile → 201 → fila en D1 →
mensaje en Telegram. Comprobar los tres, no solo que `/` devuelva 200.

Monitoriza 24–48 h: `npm run tail:production` y **Workers & Pages → vulnfocus →
Observability**.

---

## 10. Rollback

Preparado **antes** del corte. Si algo falla:

1. **DNS → Records.** Elimina los registros de custom domain creados por el
   Worker.
2. Recrea los registros `A` originales apuntando a la IP de la VPS
   (los que anotaste en § 9.1), con proxy activado.
3. Desactiva la Redirect Rule de `www`.
4. La VPS sigue encendida y sirviendo: el servicio vuelve en cuanto propague el
   DNS (minutos, con TTL bajo).

**Los contactos recibidos por Cloudflare durante la ventana fallida quedan en D1.**
No se pierden. Expórtalos con `npm run db:backup vulnfocus` para no perderlos de
vista mientras se investiga.

## 11. FASE 8 — Retirada de la VPS

**No apagues nada todavía.** Espera a que se cumpla todo:

- [ ] La VPS no recibe tráfico (revisa los logs de Nginx 48 h)
- [ ] Los contactos llegan a D1 y a Telegram
- [ ] DNS estable
- [ ] Al menos un envío real de un usuario real funcionando

Después:

1. `mongodump` final y descarga del dump a un lugar cifrado
2. `tar` de `/opt/vulnfocus` como archivo histórico
3. `systemctl stop vulnfocus-backend nginx mongod` y `disable`
4. Confirmar 48 h más de estabilidad
5. Destruir la VPS

**Limpieza de credenciales — no la olvides:**

- GitHub → Settings → Secrets: eliminar `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
  `VPS_PORT`
- Revocar la clave SSH de despliegue en el proveedor y en `authorized_keys`
- Cloudflare → DNS: eliminar registros obsoletos que apunten a la IP antigua
- Rotar `TELEGRAM_BOT_TOKEN` si estuvo en un `.env` de la VPS: ese fichero
  sobrevive en los backups
- Revocar el certificado de Let's Encrypt si quedó alguno emitido

---

## 12. CI/CD

**Modelo antiguo, eliminado:** `git push` → GitHub Actions → SSH → VPS →
`git pull` + `yarn install` + `systemctl restart`.

**Modelo nuevo: Workers Builds** (integración Git nativa de Cloudflare).

**Workers & Pages → vulnfocus → Settings → Build → Connect to Git**

| Ajuste | Valor |
|---|---|
| Repositorio | tu repo de GitHub |
| Rama de producción | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy --env production` |
| Root directory | `/` |

`npm run build` ejecuta `npm --prefix frontend ci` — **`ci`, no `install`**.
Reproducible a partir del lockfile.

Activa **non-production branch builds** para tener despliegues de vista previa por
rama y por pull request. Con `preview_urls: true` en `wrangler.jsonc`, cada PR
recibe una URL propia.

No quedan claves SSH, ni IPs de servidor, ni `VPS_HOST` en ningún sitio.

---

## 13. Coste mensual estimado

Escenario objetivo: **~30.000 visitas/mes** y **~100 formularios/mes**.
Coste esperado de la aplicación: **0 $/mes**. No incluye el dominio.

| Servicio | Consumo estimado | Límite del plan Free | Coste |
|---|---|---|---|
| **Static Assets** | 30.000 peticiones | Ilimitado y no facturable | **0 €** |
| **Workers** | ~100 invocaciones (solo `/api/*`) | 100.000/día, 10 ms CPU | **0 €** |
| **D1 — escrituras** | ~100 filas/mes | 100.000 filas/día | **0 €** |
| **D1 — lecturas** | ~0 (la app no lee) | 5.000.000 filas/día | **0 €** |
| **D1 — almacenamiento** | < 1 MB | 5 GB | **0 €** |
| **Turnstile** | ~200 verificaciones | Challenges y verification requests **ilimitados** | **0 €** |
| **Workers Logs** | mínimo | 200.000 eventos/día, 3 días de retención | **0 €** |
| **DNS · TLS · CDN · WAF Free** | — | — | **0 €** |
| **Total** | | | **0 €/mes** |

Frente a la VPS Debian actual, que cuesta lo que cueste tu proveedor.

**Qué generaría cobro:**

- Superar **100.000 invocaciones del Worker al día**. Como solo `/api/*` invoca el
  Worker, harían falta 100.000 envíos de formulario diarios. Irreal salvo ataque
  — y para eso están Turnstile, el honeypot y el rate limit.
- Superar **100.000 filas escritas al día** en D1. Mismo razonamiento.
- **Superar 5 GB en D1.** A ~1 KB por contacto, son ~5 millones de contactos.
- Querer **Rate Limiting Rules del WAF con período de 1 minuto** → plan **Pro**
  (~20 USD/mes con facturación anual). **No es necesario**: el binding del Worker
  ya lo cubre.

Si se superan los límites del Free, el plan **Workers Paid** cuesta **5 USD/mes**
e incluye 10 millones de peticiones y 25.000 millones de filas leídas al mes.

**Turnstile Free no tiene límite de volumen.** La página oficial de planes
(`developers.cloudflare.com/turnstile/plans`) lo indica explícitamente:
*"Unlimited challenges (traffic or verification requests) — Free: Yes"*. Los
límites del plan Free son estructurales, no de uso: hasta **20 widgets**, **10
hostnames por widget** y **7 días** de retención de analítica. VulnFocus usa 2
widgets (staging y producción) con 1-2 hostnames cada uno: muy holgado.

> Los precios y límites de Cloudflare cambian. Las cifras proceden de
> `developers.cloudflare.com/workers/platform/pricing`,
> `developers.cloudflare.com/d1/platform/pricing` y
> `developers.cloudflare.com/turnstile/plans`. El **coste del dominio** no está
> incluido: se paga al registrador, es independiente de esta arquitectura y ya se
> pagaba antes de la migración.

---

## 14. Riesgos y limitaciones que quedan

1. **CRA sin ruta de actualización** (H-07). Deuda de build. Solución: Vite.
2. **Rate limiting por PoP.** Un atacante distribuido geográficamente obtiene más
   de 5/min en total. Turnstile es el control primario; esto es una capa extra.
3. **Entrega de Telegram no garantizada.** `ctx.waitUntil()` da hasta 30 s tras la
   respuesta, sin reintentos. La fuente de verdad es D1: ningún contacto se pierde,
   pero podrías no recibir el aviso. Si eso llega a importar, la solución correcta
   es Cloudflare Queues, no reintentos dentro del Worker.
4. **`style-src 'unsafe-inline'`** por los estilos inline de React.
5. **Sin panel de administración.** Los contactos se consultan con
   `wrangler d1 execute`. Un futuro `admin.vulnfocus.com` detrás de Cloudflare
   Access queda fuera de esta migración, por diseño.
6. **Retención no aplicada.** `scripts/retention-purge.sql` existe pero no se
   ejecuta solo. Decide la política y refléjala en la política de privacidad.
7. **Assets SEO ausentes** (H-05).
8. **`compatibility_date` congelada** en 2026-08-25. Revisión periódica.
