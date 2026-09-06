# Integraciones

```
VulnFocus (Worker)
   │
   ├── D1                fuente de verdad
   ├── Telegram          activo
   ├── Email             adaptador seleccionable (por defecto: inerte)
   ├── CRM               adaptador (por defecto: inerte)
   └── SysReptor         preparado y DESHABILITADO
```

Ningún fichero de negocio menciona un proveedor. Todo pasa por
`worker/integrations/notifications.js`, que es el **único punto de salida** de
avisos. Dos garantías que no se pueden romper:

1. **Nada lanza.** Todo se invoca desde `ctx.waitUntil()`. Un fallo de
   notificación no puede perder un dato ya guardado.
2. **Los canales son independientes.** Que Telegram falle no impide el correo.

## Telegram — activo

Se conserva la integración existente. `sendTelegramNotification()` sigue
funcionando igual y se ha extraído `sendTelegramText()` para reutilizar el
envío en las cotizaciones.

Sigue **sin `parse_mode`**: sin Markdown ni HTML no hay superficie de inyección
de formato desde contenido no confiable. Solo se registra el código HTTP de la
respuesta, nunca su cuerpo, que puede reflejar la URL y con ella el token.

Aviso de cotización:

```
Nueva oportunidad VulnFocus

ID: VF-2026-000042
Empresa: ACME SpA
Contacto: Ana López
Email: ana@acme.cl
Telefono: +56 9 ...

Servicio: web + api
Complejidad: HIGH
Esfuerzo: 21-28 dias (164-219 h)
Estimacion: (sin precio: tarifa no configurada)

Fecha: 2026-09-05T03:12:44.101Z
```

No se envían las notas libres del cliente ni el desglose interno: la fuente de
verdad es D1 y Telegram es solo un aviso.

## Email — adaptador seleccionable

`vars.EMAIL_PROVIDER` decide la implementación:

| Valor | Adaptador | Estado |
|---|---|---|
| `null` (por defecto) | `email/null.js` | Registra `email_skipped` y no envía |
| `resend` | `email/resend.js` | Implementado |
| `mailchannels` | `email/mailchannels.js` | Implementado |

Un valor desconocido cae en el adaptador inerte en lugar de fallar.

Mensajes definidos en `email/templates.js`. Texto plano como contenido principal
y HTML como alternativa: muchos clientes corporativos siguen degradando a texto.

#### `quoteConfirmation()` — al cliente

```
Asunto: Solicitud recibida — VulnFocus VF-2026-000042

Hola Beatriz Soto,

Gracias por confiar en VulnFocus. Hemos recibido tu solicitud de estimación y
la tenemos registrada con este resumen:

Número de solicitud: VF-2026-000042
Servicios solicitados: Pentesting Web + Pentesting de API
Complejidad estimada: Media
Duración aproximada: 9–11 días hábiles (65–87 h)
[Estimación económica: 3.200.000 – 4.100.000 CLP (IVA incluido)]   ← solo si hay tarifa

Puedes consultarla en cualquier momento aquí:
https://vulnfocus.com/estimacion?id=<public_id>

El siguiente paso es una conversación breve para confirmar el alcance. Con el
alcance cerrado te enviamos la propuesta formal, que incluye la propuesta
económica.

Estimación referencial sujeta a validación final del alcance.
```

Reglas que se prueban en `test/email.test.js`:

* La línea de importe **no aparece en absoluto** si `pricing.available` es
  `false`. No hay hueco, ni "por confirmar", ni ninguna cifra: no se insinúa un
  precio que no existe.
* El texto del siguiente paso **cambia** según haya precio o no.
* Se usan los **nombres del catálogo** ("Pentesting Web"), no los
  identificadores internos (`web`).
* **No** se incluye el alcance declarado, ni las notas del cliente, ni el
  desglose interno del cálculo: es información técnica de la infraestructura del
  cliente y el correo se archiva durante años en servidores de terceros.

#### `internalQuoteAlert()` — a VulnFocus

```
Asunto: Nueva oportunidad VF-2026-000042 — Contoso Chile SpA

NUEVA OPORTUNIDAD

VF-2026-000042

Empresa: Contoso Chile SpA
Contacto: Beatriz Soto
Email: beatriz@contoso.cl
Teléfono: +56 9 1234 5678
Servicio: Pentesting Web + Pentesting de API
Complejidad: Media
Horas estimadas: 72
Duración: 9–11 días hábiles (65–87 h)
Rango comercial: (sin precio: tarifa no configurada)
Fecha: 2026-09-06T12:00:00.000Z
```

Se envía solo si `EMAIL_INTERNAL_TO` está configurado; si no, se registra
`internal-recipient-not-configured` y sigue. El aviso de Telegram se mantiene en
cualquier caso: son canales independientes.

#### `contactConfirmation()` — acuse del formulario de contacto

No repite el mensaje del usuario: un acuse que devuelve el texto original
convierte el formulario en un reflector de correo hacia cualquier dirección.

#### Orden de escritura, y por qué importa

```
D1  ──►  201 al usuario  ──►  ctx.waitUntil( Telegram ‖ Email cliente ‖ Email interno ‖ CRM )
 ▲                                                    │
 └── fuente de verdad                                 └── ninguno puede lanzar,
     si falla: 500 y NO se notifica a nadie               ninguno bloquea la respuesta
```

Una cotización guardada **no se pierde** porque falle un canal, y no se devuelve
error de creación si D1 ya la almacenó. Cada canal está aislado de los demás:
que Telegram caiga no impide el correo, y al revés. Todo lo que viene del usuario
se escapa antes de entrar en el HTML.

### REQUIERE CONFIGURACIÓN DEL PROPIETARIO

**Resend** (recomendado por compatibilidad con Workers y por tener plan gratuito):

```bash
# 1. Verificar el dominio en Resend (registros DNS de SPF y DKIM).
# 2. Configurar el Worker:
npx wrangler secret put RESEND_API_KEY
# 3. En wrangler.jsonc → vars:
#      "EMAIL_PROVIDER": "resend"
#      "EMAIL_FROM": "VulnFocus <no-reply@vulnfocus.com>"
#      "EMAIL_INTERNAL_TO": "comercial@vulnfocus.com"
```

**MailChannels**: MailChannels retiró en 2024 el envío gratuito desde Workers.
Hoy requiere cuenta de pago y `MAILCHANNELS_API_KEY`, además de SPF, DKIM y
Domain Lockdown. Implementado, pero no es la recomendación por defecto.

Mientras `EMAIL_PROVIDER` valga `null` no se envía ningún correo y el resto del
sistema funciona con normalidad.

## CRM — abstracción sin proveedor elegido

`worker/integrations/crm/`. Contrato que debe cumplir cualquier implementación:

```js
createLead({ quoteNumber, publicId, company, contactName, email, phone,
             services, complexity, estimatedHours, currency, minPrice, maxPrice })
updateLead({ quoteNumber, status })
markWon({ quoteNumber })
markLost({ quoteNumber, reason })
```

Activo: `NullCRMAdapter`, que registra `crm_noop` y devuelve
`{ ok: false, reason: 'provider-null' }`.

El contrato **ya se invoca de verdad**, no es decorativo. La administración
(`docs/ADMIN.md`) llama al adaptador en cada cambio de estado, en segundo plano y
sin que su fallo revierta nada:

| Transición | Llamada |
|---|---|
| → `ACCEPTED` | `markWon({ quoteNumber })` |
| → `REJECTED` | `markLost({ quoteNumber, reason })` |
| cualquier otra | `updateLead({ quoteNumber, status })` |

Y `createLead()` se invoca al crear la cotización. Con `CRM_PROVIDER="null"` todo
eso deja una línea de log y nada más, pero el día que exista un CRM real solo hay
que implementar el adaptador: no hay que buscar dónde engancharlo.

### Mini CRM interno

Antes de conectar un CRM externo existe la opción de usar el panel interno:
listado, búsqueda, ficha, ciclo de vida y auditoría sobre la propia D1. Está
implementado y **deshabilitado** (`ADMIN_ENABLED="false"`). Ver `docs/ADMIN.md`.

**No se ha elegido CRM.** HubSpot, Zoho y Odoo tienen modelos de datos y
autenticaciones distintas; comprometerse con uno sin decisión expresa ataría las
manos del propietario. Cuando haya decisión: implementar el adaptador contra
esta interfaz y cambiar `vars.CRM_PROVIDER`.

### REQUIERE CONFIGURACIÓN DEL PROPIETARIO
CRM destino · credencial de API · mapeo de estados de `quotes` a los del CRM.

## SysReptor — preparado y deshabilitado

`worker/integrations/sysreptor.js`. Objetivo futuro:

```
Cotización aceptada → Cliente → Proyecto → SysReptor
```

**No se han inventado endpoints ni formato de autenticación.** La API de
SysReptor no se ha podido verificar desde este repositorio, y escribir llamadas
a ciegas produciría código que parece funcionar y no funciona.

Lo que sí está resuelto:

* `buildProjectDraft(quoteRow)` — la forma del dato que habría que enviar,
  derivada de lo que ya hay en D1: nombre, referencia, cliente, servicios,
  alcance declarado, horas estimadas y fecha.
* El punto exacto del flujo donde se invocaría.
* El interruptor `vars.SYSREPTOR_ENABLED` (por defecto `"false"`).

**Nunca se envía nada automáticamente.** Aunque se active el flag,
`createProjectFromQuote()` no se llama desde la creación de cotizaciones **ni
desde la transición a `ACCEPTED`**: crear un proyecto debe seguir siendo una
acción deliberada. Un test lo comprueba (`test/email.test.js` → "SysReptor está
deshabilitado y no hace red ni con el flag activo").

### Flujo previsto, cuando llegue el momento

```
Cotización (NEW)
      │  el cliente rellena el cotizador
      ▼
CONTACTED ─► PROPOSAL_SENT
      │  propuesta formal enviada y aceptada por el cliente
      ▼
  ACCEPTED
      │
      ▼
APROBACIÓN MANUAL   ← una persona decide, en el panel, crear el proyecto.
      │                NO es automático. Nunca lo será por defecto.
      ▼
createProjectFromQuote(quoteRow)
      │
      ▼
  Proyecto en SysReptor
```

Por qué la aprobación manual es un requisito y no una precaución excesiva:

* Cotizar es gratis y público. Si `ACCEPTED` creara proyectos por sí solo, un
  error de operación en el panel crearía proyectos reales en la plataforma de
  informes.
* Los datos que saldrían de D1 (empresa, alcance declarado: número de hosts,
  dominios, usuarios de AD, proveedores cloud) son **información de seguridad de
  un tercero**. Que salgan de la base debe ser una decisión, no un efecto
  secundario.
* `ACCEPTED` es terminal en la máquina de estados, así que no puede entrar y
  salir de ese estado creando proyectos duplicados.

### Datos que se enviarían

Exactamente lo que devuelve `buildProjectDraft(quoteRow)`, y nada más:

| Campo | Origen | Contiene datos personales |
|---|---|---|
| `name` | `company` + `quote_number` | Razón social |
| `reference` | `quote_number` | No |
| `client` | `company` | Razón social |
| `services` | `services_json` | No |
| `scope` | `scope_json` | **Información de infraestructura del cliente** |
| `estimatedHours` | `estimated_hours` | No |
| `createdAt` | `created_at` | No |

**No se envían** email, teléfono, notas del cliente, importes, ni el desglose
interno del cálculo.

### Controles de seguridad exigidos antes de activarlo

1. Token con el **mínimo privilegio** posible (crear proyecto; no leer ni borrar).
2. Token en **Cloudflare Secrets**, nunca en `vars` ni en el repositorio.
3. Instancia accesible por **HTTPS con certificado válido**; si es autoalojada y
   no es pública, hará falta un túnel — el Worker no tiene acceso a redes privadas.
4. Timeout y fallo aislado, como el resto de integraciones: que SysReptor no
   responda no puede afectar a lo ya guardado en D1.
5. Registrar en `quote_status_events` que se creó el proyecto, con quién lo hizo.
6. Nunca reintentar en bucle: un reintento ciego crea proyectos duplicados.

### REQUIERE CONFIGURACIÓN DEL PROPIETARIO
1. URL de la instancia y si es alcanzable desde Internet.
2. Método de autenticación y ámbito del token.
3. Identificador de la plantilla de proyecto.
4. Decisión explícita sobre qué datos del cliente pueden salir de D1.

## Analytics

`frontend/src/lib/analytics.js`. Privacy-first por construcción:

* **Allowlist de eventos**: `quote_started`, `quote_service_selected`,
  `quote_scope_completed`, `quote_completed`, `quote_pdf_downloaded`,
  `formal_proposal_requested`, `contact_submitted`. Un nombre no declarado se
  descarta.
* **Allowlist de propiedades**: `service`, `services_count`, `step`, `currency`,
  `complexity`. Solo escalares cortos con formato de identificador. Mensajes,
  correos, nombres, alcances e identificadores de cotización **no pueden salir**,
  aunque alguien los pase por error.
* **Sin proveedor por defecto**: no hace ninguna petición de red mientras no se
  configure uno. Los eventos se emiten como `CustomEvent` en `window` y se
  pasan a `window.vulnfocusAnalytics` si existe.

Recomendación: **Cloudflare Web Analytics**, sin cookies y sin datos personales,
que se activa desde el panel y cubre páginas vistas sin necesitar este módulo.
Estos eventos son la capa de conversión que aquel no cubre.

### REQUIERE CONFIGURACIÓN DEL PROPIETARIO
Si se activa un proveedor con script propio, hay que añadir su origen a
`script-src` y `connect-src` en `frontend/public/_headers`.
