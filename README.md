# VulnFocus — React + Cloudflare Workers + D1

Sitio de VulnFocus SPA. Frontend React servido como Static Assets de Cloudflare y
una API serverless en un Worker. Sin servidores que administrar.

```
Internet
   │
   ▼
Cloudflare (DNS · TLS · CDN · WAF · Turnstile)
   │
   ├── /*        → Static Assets  (React compilado, no facturable)
   │
   └── /api/*    → Worker
                     ├── POST /api/contact ──┬── Turnstile Siteverify
                     │                       ├── D1 (contact_submissions)
                     │                       └── Telegram Bot API
                     └── GET  /api/health
```

## Puesta en marcha

```bash
npm ci                       # raíz (wrangler + vitest)
npm --prefix frontend ci     # frontend
cp .dev.vars.example .dev.vars
npm run db:migrate:local     # crea la tabla en la D1 local
npm run build                # compila el frontend a frontend/build/
npm run dev                  # http://localhost:8787
```

`.dev.vars` trae las claves de **prueba** públicas de Turnstile documentadas por
Cloudflare. Con ellas el formulario funciona en local sin tocar producción.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Suite Vitest sobre `workerd` con D1 local (73 tests) |
| `npm run dev` | Worker + assets + D1 en local |
| `npm run build` | Compila el frontend |
| `npm run deploy:staging` | Build y despliegue a staging |
| `npm run deploy:production` | Build y despliegue a producción |
| `npm run db:migrate:staging` / `:production` | Aplica `migrations/` |
| `npm run db:backup [db]` | Export de D1 a `backups/` |
| `npm run acceptance <url>` | Test de aceptación E2E (`smoke` = solo automático) |
| `npm run tail:staging` / `:production` | Logs en vivo |

## Estructura

```
worker/
  index.js            Routing y handler de /api/contact
  lib/turnstile.js    Verificación Siteverify
  lib/telegram.js     Notificación
  lib/validate.js     Validación de campos
  lib/http.js         Respuestas y cabeceras de seguridad
frontend/             React (CRA + CRACO)
  public/_headers     Cabeceras de los assets
migrations/           SQL versionado de D1
test/                 Suite Vitest
scripts/              Backup, migración desde Mongo, smoke test
wrangler.jsonc        Configuración de Cloudflare
```

---

## Decisiones de diseño

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

### Rate limiting

Binding nativo `ratelimits` de Workers: **5 solicitudes / 60 s por
`CF-Connecting-IP`**.

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

### Separación staging / producción

`wrangler.jsonc` **no declara `d1_databases` en el nivel raíz**, a propósito. Un
`wrangler deploy` sin `--env` queda sin binding `DB` y por tanto no puede escribir
en ninguna base: es imposible que un despliegue mal invocado meta contactos de
prueba en producción. Cada entorno declara su D1, sus `vars` y su allowlist de
hostnames de Turnstile explícitamente.

## Secretos

Nunca en el repositorio. Se cargan por entorno:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging
npx wrangler secret put TELEGRAM_BOT_TOKEN   --env staging
npx wrangler secret put TELEGRAM_CHAT_ID     --env staging
# y lo mismo con --env production
```

El **site key** de Turnstile sí es público y vive en `frontend/.env.production`.

## Deuda técnica conocida

1. **CRA sin mantenimiento.** `react-scripts` 5.0.1 es la última versión publicada
   y arrastra 29 advisories sin parche disponible. Ninguno llega al navegador
   (verificado), pero la cadena de build no tiene ruta de actualización. Migrar a
   Vite es la solución real. Ver `MIGRACION_CLOUDFLARE.md` § Dependencias.
2. **`style-src 'unsafe-inline'`**, por los estilos inline de React.
3. **Toasts inertes.** `Contact.jsx` usa `useToast()` (Radix) pero `App.js`
   renderiza el `<Toaster />` de sonner, así que esos toasts no se muestran. El
   `<div className="status-message success">` sí funciona, de modo que el usuario
   no percibe nada roto. Se conserva tal cual para no cambiar comportamiento
   durante la migración.
4. **Assets SEO ausentes.** `index.html` referencia `og-image.png`, `logo.png`,
   `favicon-32x32.png` y `apple-touch-icon.png`, que no existen en `public/`. Las
   previsualizaciones en redes sociales salen sin imagen.
