# STAGING RELEASE GATE — runbook

Este documento se ejecuta **contra la cuenta real de Cloudflare**. Cada bloque
termina con una línea de resultado que hay que rellenar. Al final está la tabla
del gate.

Baseline aprobado: **`v2.0.0-ready-for-staging`**. No se hacen refactors salvo
que staging revele un defecto.

**Producción sigue apuntando a la VPS durante todo este proceso.**

---

## 0. Prerrequisitos

```bash
git checkout v2.0.0-ready-for-staging
npm ci && npm --prefix frontend ci
npm test          # debe dar 73/73 antes de empezar
npx wrangler login
```

---

## 1. D1 de staging

```bash
npx wrangler d1 create vulnfocus-staging
```

Copia el UUID devuelto a `wrangler.jsonc`, **solo** en
`env.staging.d1_databases[0].database_id` (sustituye
`REEMPLAZAR_UUID_D1_STAGING`). No toques `env.production`.

```bash
npm run db:migrate:staging

npx wrangler d1 execute vulnfocus-staging --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Esperado: aparece `contact_submissions` (además de las tablas internas
`d1_migrations` y `_cf_METADATA`). El esquema procede **íntegramente** de
`migrations/0001_contact_submissions.sql`; no se crea ninguna tabla a mano.

```bash
npx wrangler d1 migrations list vulnfocus-staging --remote
```

Esperado: `0001_contact_submissions.sql` aplicada, ninguna pendiente.

**RESULTADO — D1 staging:** `______`

---

## 2. Turnstile de staging

Panel → **Turnstile → Add widget**

| Campo | Valor |
|---|---|
| Nombre | `vulnfocus-staging` |
| Hostname | `staging.vulnfocus.com` — **solo este** |
| Modo | **Managed** |

Managed es el modo por defecto y el adecuado aquí: adapta la fricción al riesgo y
solo pide interacción cuando hace falta. No hay razón para Invisible o
Non-Interactive en un formulario de contacto de bajo volumen.

El widget es **independiente** del de producción. Un token emitido en staging no
sirve en producción, y `env.staging.vars.TURNSTILE_ALLOWED_HOSTNAMES` ya está
fijado a `staging.vulnfocus.com`, así que el Worker lo rechazaría en el servidor
aunque alguien lo intentara.

Recuerda las propiedades del token, que no cambian: **de un solo uso**, **expira
a los 300 segundos**, **validación Siteverify obligatoria**.

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging
```

El **site key** es público y se pasa en el build (paso 4). El **secret** solo
existe en Cloudflare Secrets, nunca en el repositorio.

**RESULTADO — Turnstile staging configurado:** `______`

---

## 3. Telegram de staging

Crea un **chat de pruebas** distinto del de producción (un grupo propio, o un
segundo bot). Así ninguna prueba se mezcla con avisos reales.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN --env staging
npx wrangler secret put TELEGRAM_CHAT_ID   --env staging
```

`wrangler secret put` pide el valor por teclado: no queda en el historial del
shell, ni en `wrangler.jsonc`, ni en GitHub, ni en los logs.

Comprobación de que quedaron como **secrets** y no como vars públicas:

```bash
npx wrangler secret list --env staging
```

Esperado: los tres nombres (`TURNSTILE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`), **sin valores**.

```bash
npx wrangler deploy --env staging --dry-run 2>&1 | grep -i "Environment Variable"
```

Esperado: solo `STORE_IP` y `TURNSTILE_ALLOWED_HOSTNAMES`. Si aparece cualquiera
de los tres secretos en esta lista, están mal configurados como `vars`: **para y
corrígelo**.

**RESULTADO — Secrets separados:** `______`

---

## 4. Despliegue de staging

```bash
REACT_APP_TURNSTILE_SITE_KEY=<site-key-de-staging> npm --prefix frontend run build
npx wrangler deploy --env staging
```

> El site key se pasa en la línea de comandos porque `frontend/.env.production`
> lleva el de producción y es común a ambos entornos.

Asociar el dominio: **Workers & Pages → vulnfocus-staging → Settings → Domains &
Routes → Add custom domain → `staging.vulnfocus.com`**. Cloudflare crea el
registro DNS solo.

Comprueba que **producción sigue intacta**:

```bash
dig +short vulnfocus.com        # debe seguir devolviendo la IP de la VPS
curl -sI https://vulnfocus.com | head -1
```

**RESULTADO — Deployment real:** `______`

---

## 5. Test de aceptación

Todo lo automatizable de los puntos 5, 6, 7, 8 y 12 lo cubre un único comando:

```bash
npm run acceptance https://staging.vulnfocus.com
```

Ejecuta 60+ comprobaciones automáticas, después guía las fases manuales
(Turnstile real, D1, Telegram, DevTools, observabilidad), consulta D1 por ti y
emite la tabla final más un informe `acceptance-report-<fecha>.md`.

Para ejecutar solo la parte automática (por ejemplo en CI):

```bash
npm run smoke https://staging.vulnfocus.com
```

Las comprobaciones sueltas de abajo siguen sirviendo para diagnosticar un fallo
concreto:

```bash
BASE=https://staging.vulnfocus.com

echo "--- rutas SPA (esperado 200) ---"
for p in / /proceso /recursos /certificaciones; do
  printf '%-22s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' $BASE$p)"
done

echo "--- health (200) y API cerrada (404) ---"
for p in /api/health /api/contacts /api/logs /api/status /api/admin /api/random; do
  printf '%-22s %s  %s\n' "$p" \
    "$(curl -s -o /dev/null -w '%{http_code}' $BASE$p)" \
    "$(curl -s $BASE$p | head -c 40)"
done

echo "--- métodos en /api/contact (esperado 405 + Allow: POST) ---"
for m in GET PUT DELETE PATCH OPTIONS HEAD; do
  printf '%-8s %s  Allow=%s\n' "$m" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X $m $BASE/api/contact)" \
    "$(curl -sI -X $m $BASE/api/contact | grep -i '^allow' | tr -d '\r' | cut -d' ' -f2)"
done
```

Lo importante de `/api/*`: la respuesta debe ser **JSON**
(`{"status":"error",...}`), nunca HTML. Si sale `<!doctype html>`, el routing está
mal y `run_worker_first` no se está aplicando.

**RESULTADO — SPA routes:** `______`
**RESULTADO — API deny-by-default:** `______`

---

## 6. Tests negativos de seguridad

```bash
BASE=https://staging.vulnfocus.com
J='Content-Type: application/json'

printf 'text/plain        -> %s (esperado 415)\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: text/plain' -d x $BASE/api/contact)"

printf 'JSON malformado   -> %s (esperado 400)\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -d '{malo' $BASE/api/contact)"

printf 'body 20KB         -> %s (esperado 413)\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" \
     -d "{\"message\":\"$(head -c 20000 /dev/zero | tr '\0' a)\"}" $BASE/api/contact)"

printf 'sin Turnstile     -> %s (esperado 403)\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" \
     -d '{"name":"Ana Lopez","email":"a@b.com","message":"mensaje valido de prueba"}' $BASE/api/contact)"

printf 'Turnstile falso   -> %s (esperado 403)\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" \
     -d '{"name":"Ana Lopez","email":"a@b.com","message":"mensaje valido de prueba","turnstileToken":"inventado"}' $BASE/api/contact)"
```

Sin fuzzing agresivo. Estas cinco peticiones bastan.

**RESULTADO — Negative tests:** `______`

---

## 7. Cabeceras desde Internet

```bash
curl -sSI https://staging.vulnfocus.com/ | grep -iE \
  'strict-transport|content-security|x-content-type|referrer-policy|permissions-policy|x-frame|x-robots'
```

Esperado, las siete:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Content-Security-Policy: ...` con `frame-ancestors 'none'`, sin `unsafe-eval`
  y sin `unsafe-inline` en `script-src`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=(), ...`
- `X-Frame-Options: DENY`
- `X-Robots-Tag: noindex, nofollow` ← solo en staging

```bash
curl -si https://staging.vulnfocus.com/api/health | head -20
curl -si -X GET https://staging.vulnfocus.com/api/contact | grep -i 'cache-control'
```

Esperado en las respuestas del Worker: `Cache-Control: no-store`, tanto en el 200
de `/api/health` como en los errores.

**RESULTADO — Headers edge:** `______`
**RESULTADO — HTTPS/TLS:** `______`

---

## 8. Static Assets: comprobar que no pasan por el Worker

Ya está verificado en local con instrumentación (10 peticiones estáticas → **0**
invocaciones del Worker). Confirmación en el edge:

```bash
npx wrangler tail --env staging --format pretty
```

En otra terminal, navega por `https://staging.vulnfocus.com`, recorre las cuatro
rutas y recarga forzando la descarga de CSS/JS. En `wrangler tail` **no debe
aparecer ninguna petición** salvo cuando envíes el formulario.

Configuración efectiva (`wrangler.jsonc`):

```jsonc
"assets": {
  "directory": "./frontend/build/",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]     // ← acotado, NO global
}
```

`run_worker_first` recibe un **array de patrones**, no `true`. Con `true` cada
visita invocaría el Worker y consumiría cuota; con `["/api/*"]` solo lo hace la
API. Las peticiones a Static Assets son gratuitas e ilimitadas.

**RESULTADO — Static Assets:** `______`

---

## 9. Happy path real

Desde un navegador de verdad, con **DevTools abierto** (Console + Network +
Security) durante todo el flujo:

1. Abre `https://staging.vulnfocus.com`
2. Ve al formulario de contacto
3. Rellena nombre, email, empresa y un mensaje de más de 10 caracteres
4. Resuelve el widget de Turnstile
5. Envía

Esperado: mensaje de éxito en la página, **HTTP 201** en la pestaña Network.

### 9.1 Verificar D1

```bash
npx wrangler d1 execute vulnfocus-staging --remote \
  --command="SELECT id, name, email, company, status, created_at FROM contact_submissions ORDER BY created_at DESC LIMIT 1;"
```

Rellena esto en el informe **sin copiar la PII**:

```
row present            ____   (YES/NO)
UUID valid             ____   (formato UUIDv4)
status                 ____   (esperado: new)
timestamp valid        ____   (ISO 8601 UTC, coherente con el envío)
expected fields        ____   (PASS/FAIL)
ip_address NULL        ____   (esperado: YES, por STORE_IP="false")
```

### 9.2 Verificar Telegram

El mismo envío debe aparecer en el chat de pruebas, en texto plano, con nombre,
empresa, email, fecha, ID y mensaje. Confírmalo visualmente.

**RESULTADO — Turnstile real:** `______`
**RESULTADO — D1 real INSERT:** `______`
**RESULTADO — Telegram real:** `______`

---

## 10. DevTools

Con la consola abierta durante todo el flujo del punto 9:

```
CSP violations                  ____   (requerido: 0)
Mixed content                   ____   (requerido: 0)
Failed production resources     ____   (requerido: 0)
Turnstile errors                ____   (requerido: 0)
Unexpected CORS errors          ____   (requerido: 0)
JS runtime errors               ____   (requerido: 0)
```

**Si aparece una violación de CSP:** no añadas comodines ni relajes la política
globalmente. Lee el mensaje: indica la **directiva** y el **origen bloqueado**.
Añade únicamente ese origen concreto a esa directiva concreta en
`frontend/public/_headers`.

Orígenes ya permitidos, y por qué:

| Origen | Directiva | Motivo |
|---|---|---|
| `challenges.cloudflare.com` | `script-src`, `frame-src`, `connect-src` | Widget de Turnstile |
| `fonts.googleapis.com` | `style-src` | Hoja de estilos de Inter |
| `fonts.gstatic.com` | `font-src` | Ficheros de la fuente |

Bajo ningún concepto añadas `unsafe-eval`, ni `unsafe-inline` en `script-src`.

**RESULTADO — CSP navegador:** `______`

---

## 11. Rate limit

Intenta la validación natural: envía el formulario **6 veces seguidas** desde el
navegador, resolviendo el widget cada vez (el token es de un solo uso).

Esperado: envíos 1-5 → éxito; el 6º → mensaje de "demasiadas solicitudes"
(HTTP 429 con `Retry-After: 60` en la pestaña Network).

```bash
# Después, contar lo que realmente entró:
npx wrangler d1 execute vulnfocus-staging --remote \
  --command="SELECT COUNT(*) AS n FROM contact_submissions;"
```

**Si resulta impracticable** por los tokens de un solo uso, **no añadas ningún
bypass**. Clasifícalo así y adjunta la evidencia:

```
Cloudflare production multi-PoP behavior: INFRASTRUCTURE-DEPENDENT

Evidencia conservada:
  - 4 tests sobre el runtime real de Workers (workerd): PASS
      · 1-5 -> 201, 6º -> 429
      · 429 con Retry-After: 60 y Cache-Control: no-store
      · el límite es por IP, otra IP no queda afectada
      · el rate limit se evalúa antes de gastar una verificación de Turnstile
  - Binding desplegado y confirmado:
      npx wrangler deploy --env staging --dry-run | grep RATE_LIMITER
  - Documentación oficial: el binding se apoya en la misma infraestructura que
    las Rate Limiting Rules del WAF; contadores por PoP y eventualmente
    consistentes.
```

**RESULTADO — Rate limit:** `______`

---

## 12. SEO de staging

```bash
curl -sI https://staging.vulnfocus.com/ | grep -i x-robots
# esperado: x-robots-tag: noindex, nofollow

curl -s https://staging.vulnfocus.com/robots.txt | head -5
curl -s https://staging.vulnfocus.com/sitemap.xml | head -5
curl -s https://staging.vulnfocus.com/manifest.json | head -3
curl -sI https://staging.vulnfocus.com/favicon.svg | head -1

curl -s https://staging.vulnfocus.com/ | grep -i 'rel="canonical"'
# esperado: href="https://vulnfocus.com/"  <- apunta a PRODUCCIÓN
```

La protección es por **cabecera acotada al hostname**, definida en
`frontend/public/_headers`:

```
https://staging.vulnfocus.com/*
  X-Robots-Tag: noindex, nofollow
```

Deliberadamente **no** se modifican `robots.txt`, `sitemap.xml` ni las etiquetas
`canonical`: esos ficheros son idénticos en ambos entornos y deben seguir
describiendo la configuración SEO de producción. Verificado en local: la regla se
aplica en `staging.vulnfocus.com` y **no** en `vulnfocus.com`.

Refuerzo adicional: `index.html` declara `canonical` hacia
`https://vulnfocus.com/`, así que aunque un rastreador llegara a staging, la
página se declara copia de la de producción y no compite con ella.

**RESULTADO — SEO staging protection:** `______`

---

## 13. Observabilidad y no exposición de secretos

```bash
npx wrangler tail --env staging --format json > /tmp/staging-logs.json
# envía el formulario una vez, luego Ctrl-C
```

Comprobación automática (no imprime valores, solo indica si hay coincidencias):

```bash
for pat in TURNSTILE_SECRET TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  printf '%-22s %s\n' "$pat" \
    "$(grep -c "$pat" /tmp/staging-logs.json) coincidencias (esperado 0)"
done

# Ningún token de Turnstile completo ni cuerpo del formulario:
grep -cE '"turnstileToken"|"message":"' /tmp/staging-logs.json   # esperado 0
```

Eventos esperados en el happy path, y nada más:

```json
{"event":"contact_saved","id":"<uuid>"}
{"event":"telegram_sent","id":"<uuid>"}
```

Solo se registra el **UUID** de la fila. Ni nombre, ni email, ni mensaje, ni IP,
ni User-Agent, ni tokens. En `telegram_failed` solo se guarda el código HTTP,
nunca el cuerpo de error de Telegram, porque puede reflejar la URL y con ella el
token.

Revisa también el panel: **Workers & Pages → vulnfocus-staging →
Observability**.

**RESULTADO — Observability:** `______`
**RESULTADO — Secrets exposure:** `______`

---

## 14. Tabla del gate

Rellena y devuelve esto. **No cambies el DNS de producción hasta aprobarlo.**

```
STAGING RELEASE GATE

Control                        Resultado
-----------------------------  ---------
Deployment real                ____
Static Assets                  ____
SPA routes                     ____
API deny-by-default            ____
D1 staging                     ____
Turnstile real                 ____
D1 real INSERT                 ____
Telegram real                  ____
Headers edge                   ____
CSP navegador                  ____
HTTPS                          ____
Secrets exposure               ____
SEO staging protection         ____
Observability                  ____

Adicionales
-----------------------------  ---------
Negative tests                 ____
Rate limit                     ____   (PASS | INFRASTRUCTURE-DEPENDENT)

Contexto
-----------------------------  ---------
LOCAL TESTS                    73/73 PASS
H-07                           CLOSED / ACCEPTED RESIDUAL RISK
CUTOVER                        NOT EXECUTED
```

Si algún control crítico sale FAIL: **no se hace cutover**. Reporta el fallo y se
corrige sobre el baseline.
