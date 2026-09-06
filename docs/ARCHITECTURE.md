# Arquitectura

```
Internet
   │
   ▼
Cloudflare (DNS · TLS · CDN · WAF · Turnstile)
   │
   ├── /*          → Static Assets
   │                  · Un HTML por ruta conocida (prerenderizado en build)
   │                  · 404.html para lo demás → 404 REAL
   │                  · 0 invocaciones del Worker, tráfico no facturable
   │
   ├── /api/*      → Worker  (assets.run_worker_first)
   │                  ├── POST /api/contact
   │                  ├── POST /api/quotes
   │                  ├── GET  /api/quotes/:public_id
   │                  ├── GET  /api/quotes/:public_id/request-proposal
   │                  ├── POST /api/quotes/:public_id/request-proposal
   │                  ├── GET  /api/health
   │                  └── *  → 404 JSON (deny by default)
   │
   └── /admin*     → Worker  (assets.run_worker_first)
                      DESHABILITADO: ADMIN_ENABLED="false" → 404
                      Habilitado, exige Cloudflare Access:
                      ├── GET   /admin                              panel
                      ├── GET   /api/admin/session|stats|quotes
                      ├── GET   /api/admin/quotes/:public_id
                      └── PATCH /api/admin/quotes/:public_id/status
                                    │
                                    ▼
                             D1 · solo UPDATE de status + INSERT de auditoría
```

Integraciones salientes, todas en `ctx.waitUntil()` y todas aisladas entre sí:

```
Worker ──► D1                    fuente de verdad. Si falla: 500 y no se notifica
       │
       └──► (en segundo plano, tras el 201)
             ├── Telegram        activo
             ├── Email           EMAIL_PROVIDER="null" → inerte. Resend implementado
             ├── CRM             CRM_PROVIDER="null" → inerte. Contrato definido
             └── SysReptor       SYSREPTOR_ENABLED="false". NUNCA automático
```

**`/admin*` pasa por el Worker a propósito.** Si fuera un asset estático,
existiría como fichero y Cloudflare lo serviría con 200 a cualquiera, dejando la
protección solo en manos de Access sobre el subdominio.

Sin servidores, sin contenedores y sin base de datos que administrar. Todo el
estado persistente vive en **Cloudflare D1**.

## Árbol del proyecto

```
worker/
  index.js                     Router + POST /api/contact
  lib/
    http.js                    Respuestas JSON y cabeceras de seguridad
    request.js                 Content-Type, tamaño y parseo JSON (común)
    validate.js                Validación del formulario de contacto
    turnstile.js               Siteverify, fail closed
    telegram.js                Mensajes de contacto y de cotización
    quotes-handler.js          Cotizaciones y solicitud de propuesta formal
    access.js                  Verificación del JWT de Cloudflare Access
    admin/
      handler.js               API de administración (mini CRM)
      ui.js                    Panel HTML servido por el Worker, CSP con nonce
    quote/
      rules.js                 Evaluador de tipos de regla
      normalize.js             Validación y normalización de la entrada
      proposal.js              Campos de la solicitud de propuesta y enmascarado
      scope.js                 SCOPE ENGINE
      complexity.js            COMPLEXITY ENGINE
      effort.js                EFFORT ENGINE
      pricing.js               PRICING ENGINE
      number.js                public_id y correlativo VF-AAAA-NNNNNN
      lifecycle.js             Máquina de estados comercial
      labels.js                Nombres legibles de servicio y complejidad
      engine.js                Orquestador + vista pública
  config/
    quote-config.js            Horas, factores, tarifas, mínimos, descuentos
  integrations/
    notifications.js           NotificationService (punto único de salida)
    email/{index,null,resend,mailchannels,templates}.js
    crm/{index,null}.js
    sysreptor.js               Adaptador preparado y deshabilitado

frontend/
  public/index.html            Shell con marcadores <meta name="vf-seo">
  public/_headers              Cabeceras y CSP de los assets
  src/
    config/site.json           MANIFIESTO DE RUTAS + SEO por URL
    config/quote-catalog.json  Catálogo público de preguntas del cotizador
    data/services.js           Contenido de las páginas de servicio
    components/                Layout, Header, Footer, Seo, secciones
    features/quote/            Wizard, máquina de estados, API, estimación
    pages/                     Una por ruta
    utils/i18n/                Textos ES / EN

scripts/build-site.mjs         Post-build: 1 HTML por ruta, 404.html, sitemap
migrations/                    SQL versionado de D1
test/                          Suite Vitest sobre workerd con D1 real
```

## Decisiones estructurales

### Una fuente por cosa

| Dato | Fuente única | Quién lo consume |
|---|---|---|
| Rutas públicas y SEO | `frontend/src/config/site.json` | Router de React, `Seo.jsx`, `build-site.mjs` |
| Preguntas del cotizador | `frontend/src/config/quote-catalog.json` | Wizard **y** Worker (mismo fichero) |
| Horas, factores y tarifas | `worker/config/quote-config.js` | Solo el Worker |
| Contenido de servicios | `frontend/src/data/services.js` | Páginas de servicio |

El catálogo lo importan los dos lados **desde el mismo fichero**, así que no
pueden desincronizarse. La configuración comercial no viaja nunca al navegador:
vive dentro del bundle del Worker.

### Routing sin blacklists

El conjunto de rutas es finito y se conoce en build, así que `build-site.mjs`
materializa `build/<ruta>.html` por cada entrada del manifiesto y
`not_found_handling: "404-page"` hace que lo demás caiga en `404.html` con
código 404. Es una *allowlist por construcción*.

Se escribe `<ruta>.html` y no `<ruta>/index.html` a propósito: con la segunda
forma Cloudflare responde `307` hacia `/<ruta>/`, que no es la URL canónica.
Verificado con `wrangler dev`.

### El cálculo comercial es server-side, sin excepciones

El navegador envía respuestas de formulario. Horas, complejidad, precio y
estado los deriva el Worker. Los campos comerciales que llegaran en el cuerpo no
se leen siquiera: el normalizador solo mira claves declaradas en el catálogo.

### Notificaciones desacopladas

`createNotificationService(env)` es el único punto de salida. Los canales
(Telegram, correo) se ejecutan en paralelo y aislados: el fallo de uno no
arrastra al otro, y ninguno puede afectar a un dato ya guardado en D1.

## Preparado para `portal.vulnfocus.com`

Sin implementarlo, estas decisiones no lo bloquean:

* `quotes` ya tiene `public_id`, `status` y `expires_at`; un portal añadiría
  `clients` y `projects` referenciando `quotes.id`.
* Las integraciones son adaptadores con interfaz propia: un portal reutiliza
  `NotificationService` y `CRMAdapter` sin tocarlos.
* La API es `same-origin` y sin CORS. Un subdominio distinto necesitará su
  propio Worker o una política CORS explícita y acotada; hoy no existe superficie
  que haya que retirar primero.
* No hay endpoints administrativos que "abrir": el portal partiría de cero con
  su propia autenticación.
