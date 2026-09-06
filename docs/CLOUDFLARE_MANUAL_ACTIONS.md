# Acciones manuales en Cloudflare

Separa lo que este repositorio resuelve por sí solo de lo que **solo puede hacer
el propietario** desde el panel de Cloudflare, el registrador de DNS o el
proveedor de correo.

Ninguna acción de este documento incluye valores reales de secretos. Los
secretos se cargan con `wrangler secret put`, que los pide por entrada estándar y
nunca los escribe en disco.

---

## AUTOMÁTICO — ya resuelto en el repositorio

Se despliega solo con `GitHub → Cloudflare Workers Builds`. No requiere ninguna
intervención.

| Qué | Dónde |
|---|---|
| Configuración única de producción, sin entornos `env.*` | `wrangler.jsonc` |
| Bindings: D1, ASSETS y cuatro limitadores de tasa | `wrangler.jsonc` |
| Variables no secretas (`vars`) | `wrangler.jsonc` |
| 404 real en rutas inexistentes | `assets.not_found_handling: "404-page"` |
| Un HTML por ruta, `404.html` y `sitemap.xml` | `scripts/build-site.mjs` |
| Cabeceras de seguridad del contenido estático | `frontend/public/_headers` |
| Cabeceras de seguridad de las respuestas del Worker | `worker/lib/http.js` |
| HSTS **sin** `preload` | `frontend/public/_headers` |
| `workers_dev: false` | `wrangler.jsonc` |
| Administración deshabilitada | `vars.ADMIN_ENABLED = "false"` |
| Precios deshabilitados | `vars.PRICING_ENABLED = "false"` |
| Correo, CRM y SysReptor inertes | `vars.EMAIL_PROVIDER`, `CRM_PROVIDER`, `SYSREPTOR_ENABLED` |
| Iconos, `og-image` y `logo` | `frontend/public/`, generados por `scripts/generate-brand-assets.py` |

---

## MANUAL — requiere al propietario

### M-01 · Aplicar las migraciones de D1 · **BLOQUEANTE**

- **DÓNDE:** terminal con `wrangler` autenticado (`npx wrangler login`).
- **QUÉ:**
  ```bash
  npx wrangler d1 migrations list vulnfocus-production --remote   # ver pendientes
  npm run db:backup                                               # copia previa
  npm run db:migrate                                              # aplicar
  ```
  Pendientes de aplicar: **`0003_quote_status_events.sql`** y
  **`0004_proposal_requests.sql`**. Comprobar también que `0002_quotes.sql` está
  aplicada.
- **RESULTADO ESPERADO:** `migrations list` no devuelve ninguna pendiente y
  ```bash
  npx wrangler d1 execute vulnfocus-production --remote \
    --command "SELECT COUNT(*) FROM quote_status_events;"
  npx wrangler d1 execute vulnfocus-production --remote \
    --command "SELECT COUNT(*) FROM quote_proposal_requests;"
  ```
  responden `0` sin error.
- **RIESGO:** de la `0001` a la `0003`, ninguno: son aditivas e idempotentes
  (`CREATE TABLE IF NOT EXISTS`) y no tocan `contact_submissions` ni `quotes`.
  **La `0004` sí reconstruye `quotes`**, porque SQLite no permite ampliar un
  `CHECK` con `ALTER TABLE` y el estado `PROPOSAL_REQUESTED` tiene que entrar en
  la restricción. Conserva todas las filas de `quotes` y del histórico —el orden
  del fichero está pensado para que la cascada de `quote_status_events` no se
  dispare, y hay un test que lo fija—, pero es la primera migración del proyecto
  que no es aditiva: **la copia de seguridad del paso 2 no es opcional**. El
  rollback es restaurar esa copia (`docs/D1_SCHEMA.md` → Reconstruir `quotes`
  sin perder el histórico).
- **ESTADO:** ⛔ **NO APLICADA DESDE ESTE ENTORNO.** No hay credenciales de
  Cloudflare aquí y no se ha simulado su aplicación.

### M-02 · Secretos de ejecución · **BLOQUEANTE**

- **DÓNDE:** terminal, o **Workers & Pages → vulnfocus-v2 → Settings → Variables
  and Secrets**.
- **QUÉ:**
  ```bash
  npx wrangler secret put TURNSTILE_SECRET_KEY   # obligatorio
  npx wrangler secret put TELEGRAM_BOT_TOKEN     # obligatorio si se quiere aviso
  npx wrangler secret put TELEGRAM_CHAT_ID       # obligatorio si se quiere aviso
  ```
- **RESULTADO ESPERADO:** `npx wrangler secret list` muestra los **nombres**
  (nunca los valores). Sin `TURNSTILE_SECRET_KEY`, los formularios responden
  **503** a propósito: el Worker falla cerrado antes que aceptar envíos sin
  verificar.

### M-03 · Turnstile — gestión de hostnames · **BLOQUEANTE**

- **DÓNDE:** **Turnstile → tu widget → Settings → Hostname Management**.
- **QUÉ:** que la lista sea exactamente
  ```
  vulnfocus.com
  www.vulnfocus.com
  ```
  **Eliminar `vulnfocus-v2.<subdominio>.workers.dev`** si sigue ahí.
- **POR QUÉ:** el Worker compara el `hostname` que devuelve Siteverify contra
  `vars.TURNSTILE_ALLOWED_HOSTNAMES`, que ya solo contiene esos dos. Un hostname
  de más en el panel permitiría emitir tokens válidos desde un origen que la
  aplicación va a rechazar igualmente: incoherencia sin ninguna ventaja.
- **RESULTADO ESPERADO:** el formulario funciona en `vulnfocus.com` y en
  `www.vulnfocus.com`. Los envíos desde cualquier otro origen dan **403**.
- **ADEMÁS:** el **site key** (público) debe estar en
  `frontend/.env.production` → `REACT_APP_TURNSTILE_SITE_KEY`. Hoy contiene el
  marcador `REEMPLAZAR_CON_TU_SITE_KEY_DE_TURNSTILE`. Ver **M-10**.

### M-04 · Dominio propio y retirada de workers.dev · **BLOQUEANTE**

- **DÓNDE:** **Workers & Pages → vulnfocus-v2 → Settings → Domains & Routes**.
- **QUÉ, POR ESTE ORDEN:**
  1. **Verificar primero** que `vulnfocus.com` y `www.vulnfocus.com` están como
     *Custom Domain* y responden.
  2. Solo entonces desplegar el cambio `workers_dev: false` de `wrangler.jsonc`.
- **POR QUÉ EL ORDEN IMPORTA:** si el dominio propio no estuviera asociado,
  `workers.dev` sería el único acceso y desactivarlo dejaría el sitio
  inalcanzable.
- **RESULTADO ESPERADO:** `https://vulnfocus.com` responde 200 y
  `https://vulnfocus-v2.<subdominio>.workers.dev` deja de resolver.
- **ROLLBACK:** `"workers_dev": true` y desplegar.

### M-05 · Cloudflare Access para la administración · **BLOQUEANTE si se activa el panel**

- **DÓNDE:** **Zero Trust → Access → Applications**.
- **QUÉ:** aplicación *Self-hosted* para `admin.vulnfocus.com`, política `Allow`
  con las direcciones concretas del equipo (**nunca `Everyone`**) y MFA exigido.
  Anotar el **AUD tag** y el **team domain**.
- **RESULTADO ESPERADO:** `https://admin.vulnfocus.com/admin` redirige a Access;
  tras autenticarse, muestra el panel. `https://vulnfocus.com/admin` sigue
  devolviendo **404**.
- **DESPUÉS:** poner `ADMIN_ENABLED="true"`, `CF_ACCESS_TEAM_DOMAIN` y
  `CF_ACCESS_AUD` en `wrangler.jsonc` y desplegar. Procedimiento completo en
  `docs/ADMIN.md` §7.
- **ESTADO:** ⛔ **NO CONFIGURADO.** El panel queda deshabilitado hasta que lo esté.

### M-06 · DNS del subdominio de administración · Solo si se activa el panel

- **DÓNDE:** **DNS → Records** de la zona `vulnfocus.com`.
- **QUÉ:** registro para `admin` apuntando al Worker, con la nube **naranja**
  (proxied). En gris, Access no intercepta y el panel quedaría solo detrás de la
  verificación del JWT.
- **RESULTADO ESPERADO:** `dig admin.vulnfocus.com` resuelve a IP de Cloudflare y
  la petición pasa por Access.

### M-07 · Proveedor de correo (Resend) · No bloqueante

- **DÓNDE:** panel de [Resend](https://resend.com) + DNS de la zona.
- **QUÉ:**
  1. Verificar el dominio en Resend y publicar los registros **SPF**, **DKIM** y
     **DMARC** que indique.
  2. Crear una API key con permiso de *sending* únicamente.
  3. `npx wrangler secret put RESEND_API_KEY`
  4. En `wrangler.jsonc`:
     ```jsonc
     "EMAIL_PROVIDER": "resend",
     "EMAIL_FROM": "VulnFocus <no-reply@vulnfocus.com>",
     "EMAIL_INTERNAL_TO": "<dirección interna>"
     ```
- **RESULTADO ESPERADO:** una cotización de prueba produce acuse al cliente y
  aviso interno. Los logs muestran `email_sent`.
- **HOY:** `EMAIL_PROVIDER="null"`. El adaptador inerte registra `email_skipped`
  y no hace ninguna petición de red. **Nada se rompe sin esto.**

### M-08 · Verificación de HSTS y subdominios · No bloqueante

- **DÓNDE:** **DNS → Records** y **SSL/TLS → Edge Certificates**.
- **QUÉ:** `_headers` envía `Strict-Transport-Security: max-age=31536000;
  includeSubDomains`. Revisar que **todo** subdominio de `vulnfocus.com` sirve
  HTTPS con certificado válido. Un registro gris (DNS-only) hacia un servicio sin
  TLS quedaría inaccesible.
- **RESULTADO ESPERADO:**
  ```bash
  curl -sI https://vulnfocus.com | grep -i strict-transport-security
  # strict-transport-security: max-age=31536000; includeSubDomains
  ```
  **Sin `preload`.** Es deliberado: ver el comentario en `frontend/public/_headers`.
- **NO HACER:** registrar `vulnfocus.com` en `hstspreload.org`. La lista va
  compilada en los navegadores y salir de ella tarda meses.

### M-09 · Tarifas del cotizador · No bloqueante

- **DÓNDE:** `worker/config/quote-config.js` (no es una acción de Cloudflare,
  pero es la decisión pendiente más visible).
- **QUÉ:** `pricing.currencies.CLP.hourlyRate`, `CLP.minimumAmount` y sus
  equivalentes en USD si se ofrece. Después, `PRICING_ENABLED="true"`.
- **RESULTADO ESPERADO:** las estimaciones incluyen rango económico.
- **HOY:** `null` y `PRICING_ENABLED="false"`. Las estimaciones salen con
  esfuerzo y duración, sin importes. **No se ha inventado ninguna tarifa.**
  Análisis completo en `docs/QUOTE_PRICING_REVIEW.md`.

### M-10 · Site key de Turnstile en el build · **BLOQUEANTE**

- **DÓNDE:** `frontend/.env.production` del repositorio.
- **QUÉ:** sustituir `REACT_APP_TURNSTILE_SITE_KEY=REEMPLAZAR_CON_TU_SITE_KEY_DE_TURNSTILE`
  por el site key real del widget. Es **público** por diseño: se incrusta en el
  bundle y no es un secreto.
- **RESULTADO ESPERADO:** el widget se renderiza en `/` y en `/cotizar`. Con el
  marcador, el widget no carga y los formularios no se pueden enviar.

### M-11 · Assets de marca definitivos · No bloqueante

- **DÓNDE:** `frontend/public/`.
- **QUÉ:** `og-image.png` y `logo.png` son **assets técnicos** generados a partir
  del escudo real de `favicon.svg`. Cumplen su función y evitan los 404 que había,
  pero son sustituibles por piezas de diseño.
- **RESULTADO ESPERADO:** previsualización correcta al compartir el enlace.
  Verificar en [opengraph.xyz](https://www.opengraph.xyz).
- Detalle en `docs/SEO_ASSETS.md`.

### M-12 · Prueba de humo en producción · **BLOQUEANTE**

- **DÓNDE:** terminal, tras desplegar.
- **QUÉ:**
  ```bash
  bash scripts/acceptance-test.sh https://vulnfocus.com --db vulnfocus-production
  ```
  Y a mano, porque necesitan navegador con el widget:
  - Enviar el formulario de contacto → 201, fila en D1, aviso en Telegram.
  - Completar el cotizador → `VF-AAAA-NNNNNN`, fila en `quotes`, aviso.
  - Abrir `/estimacion?id=<public_id>` → muestra la estimación.
  - Imprimir la estimación → PDF sin menú, sin botones y sin el enlace privado.
- **RESULTADO ESPERADO:** todo lo anterior, y `404` en `/admin`, `/wp-admin`,
  `/.env`, `/backup`, `/api/admin/quotes`.
- **DESPUÉS:** borrar las filas de prueba.

---

## Resumen

| # | Acción | Bloqueante | Estado |
|---|---|---|---|
| M-01 | Migraciones D1 `0003` y `0004` (la `0004` reconstruye `quotes`: copia previa obligatoria) | **Sí** | ⛔ Pendiente |
| M-02 | Secretos de ejecución | **Sí** | ⛔ Pendiente de verificar |
| M-03 | Hostnames de Turnstile | **Sí** | ⛔ Pendiente |
| M-04 | Dominio propio y `workers_dev: false` | **Sí** | ⛔ Verificar antes de desplegar |
| M-05 | Cloudflare Access | Sí, si se activa el panel | ⛔ Pendiente |
| M-06 | DNS `admin.` | Solo con panel | ⛔ Pendiente |
| M-07 | Resend | No | ⏸ Opcional |
| M-08 | Verificación de HSTS | No | ⏸ Recomendado |
| M-09 | Tarifas | No | ⏸ Decisión comercial |
| M-10 | Site key de Turnstile | **Sí** | ⛔ Marcador sin sustituir |
| M-11 | Assets de marca definitivos | No | ⏸ Hay assets técnicos válidos |
| M-12 | Prueba de humo | **Sí** | ⛔ Tras desplegar |
