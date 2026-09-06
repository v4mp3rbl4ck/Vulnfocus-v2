# Administración — mini CRM interno

> **Estado: implementado y DESHABILITADO.** `ADMIN_ENABLED="false"` en
> `wrangler.jsonc`. Con el interruptor apagado, `/admin` y todo `/api/admin/*`
> devuelven **404**, indistinguible de cualquier ruta inexistente.
>
> **No activar hasta completar la configuración de Cloudflare Access**:
> `docs/CLOUDFLARE_MANUAL_ACTIONS.md` → **M-05**.

---

## 1. Para qué existe

Las cotizaciones se guardan en D1 desde el primer día, pero hasta ahora la única
forma de verlas era `wrangler d1 execute` con SQL a mano. Este panel resuelve lo
mínimo de un CRM: listar, buscar, abrir la ficha y mover el estado comercial.

Deliberadamente **no** es un CRM completo. No hay pipeline visual, ni tareas, ni
recordatorios, ni facturación. Cuando esas cosas hagan falta, se conecta un CRM
de verdad por `worker/integrations/crm/` — el contrato ya está definido y este
panel ya lo invoca en cada cambio de estado.

---

## 2. Arquitectura de seguridad

```
Internet
   │
   ▼
Cloudflare Access ─── política de identidad (SSO, MFA, expiración, revocación)
   │                  ↑ AQUÍ está la autenticación. No la implementa VulnFocus.
   ▼
admin.vulnfocus.com
   │
   ▼
Worker  ┌─ candado 1: ADMIN_ENABLED === "true"        → si no, 404
        ├─ candado 2: Cf-Access-Jwt-Assertion válido   → si no, 404
        │             · firma RS256 contra el JWKS del equipo
        │             · iss, aud, exp, nbf, iat
        │             · algoritmo fijado: nunca "none", nunca HMAC
        ├─ candado 3: allowlist propia ADMIN_ALLOWED_EMAILS (opcional)
        └─ candado 4: ADMIN_RATE_LIMITER, 60 req/min por identidad
   │
   ▼
  D1   ── solo UPDATE de `status` + INSERT en `quote_status_events`
```

### Por qué no hay usuario y contraseña

Implementar autenticación propia significaría almacenar credenciales, rotarlas,
resolver el segundo factor, la expiración de sesión, el bloqueo por intentos y la
recuperación de cuenta. Cloudflare Access ya hace todo eso, delante del Worker, y
sin que ningún secreto de sesión llegue a este repositorio.

### Por qué 404 y no 401 o 403

Un 401 confirma que en esa URL hay algo que proteger. El 404 del panel es
byte a byte el mismo que el de `/api/no-existe`: mismo cuerpo, mismo
`Content-Type`, mismo `Cache-Control`, sin `WWW-Authenticate`. Hay un test que lo
compara literalmente (`test/admin-api.test.js` → "el 404 de la administración es
idéntico al de una ruta inexistente").

### Por qué el Worker verifica el JWT si Access ya protege el hostname

Porque "está detrás de Access" es una suposición sobre configuración externa que
puede cambiar sin tocar este repositorio: alguien retira la política del panel,
se añade un route nuevo, o el Worker recibe tráfico por otro hostname. Verificar
la aserción convierte la suposición en un requisito comprobado en cada petición.
Es la razón de que `workers_dev` esté a `false`: sin ese hostname alternativo,
hay una vía menos que no pasa por Access.

---

## 3. Superficie

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/admin` | Panel HTML (una página, sin dependencias externas) |
| `GET` | `/api/admin/session` | Identidad verificada y estados disponibles |
| `GET` | `/api/admin/stats` | Recuento por estado |
| `GET` | `/api/admin/quotes` | Listado. Filtros: `status`, `q`, `limit`, `cursor` |
| `GET` | `/api/admin/quotes/:public_id` | Ficha completa + histórico |
| `PATCH` | `/api/admin/quotes/:public_id/status` | Transición de estado |

**No existe** ninguna ruta que borre una cotización, ni que edite importes,
horas, alcance o datos de contacto. El cálculo lo hace el motor y los datos los
envió el cliente: cambiarlos a mano dejaría una cotización que no se corresponde
con nada. Hay test que lo comprueba columna por columna.

### Listado

```
GET /api/admin/quotes?status=NEW&q=contoso&limit=25&cursor=<opaco>
```

- `status` — allowlist estricta; un valor desconocido devuelve 400.
- `q` — busca en empresa, contacto, email y número. Máximo 100 caracteres. Los
  comodines de `LIKE` (`%`, `_`, `\`) se escapan: buscar `%` busca el carácter,
  no todas las filas.
- `limit` — 25 por defecto, 100 máximo.
- `cursor` — paginación por clave sobre `(created_at, id)`. Opaco y validado: un
  cursor manipulado devuelve 400 y no llega a la consulta.

Toda la SQL usa sentencias preparadas con parámetros. Ningún valor de la petición
se concatena en la consulta.

### Cambio de estado

```
PATCH /api/admin/quotes/<public_id>/status
Content-Type: application/json

{ "status": "CONTACTED", "note": "Llamada inicial, envían diagrama de red" }
```

- La transición se valida contra la máquina de estados
  (`worker/lib/quote/lifecycle.js`). Una transición no declarada devuelve **409**
  con la razón y la lista de transiciones posibles.
- El `UPDATE` va condicionado al estado leído (`WHERE id = ? AND status = ?`): si
  otra sesión mueve la misma cotización entre la lectura y la escritura, no se
  pisa el cambio ajeno, se devuelve 409.
- El cambio y su registro de auditoría van en el mismo `batch`.
- `note` se recorta a 500 caracteres y **nunca** se devuelve por una ruta pública.

---

## 4. Ciclo de vida

```
NEW ──► CONTACTED ──► PROPOSAL_SENT ──► ACCEPTED   (terminal)
 │          │               │
 └──────────┴───────────────┴─────────► REJECTED   (terminal)
 │          │               │
 └──────────┴───────────────┴─────────► EXPIRED
                                            │
                                            └────► CONTACTED  (se retoma)
```

| Estado | Significado |
|---|---|
| `NEW` | Recién creada por el cotizador. Único estado inicial posible. |
| `CONTACTED` | Se ha hablado con el cliente. |
| `PROPOSAL_SENT` | Propuesta formal enviada. |
| `ACCEPTED` | Ganada. **Terminal.** Es el disparador previsto de SysReptor. |
| `REJECTED` | Perdida. **Terminal.** |
| `EXPIRED` | Caducada. Se puede retomar como `CONTACTED`. |

Reglas y su porqué:

- **`ACCEPTED` solo se alcanza desde `PROPOSAL_SENT`.** Es el disparador de
  SysReptor: no debe llegarse por atajo.
- **`ACCEPTED` y `REJECTED` no tienen salida.** Corregir un error se hace
  dejando constancia, no volviendo atrás en silencio.
- **Quedarse en el mismo estado no es una transición**: devuelve 409 en lugar de
  escribir una fila de auditoría vacía de contenido.
- Los seis estados coinciden con el `CHECK` de la columna en
  `migrations/0002_quotes.sql`. Hay un test que compara ambas listas: si divergen,
  una transición válida en la aplicación fallaría en la base.

---

## 5. Auditoría

Cada transición escribe una fila en `quote_status_events`
(`migrations/0003_quote_status_events.sql`):

| Columna | Contenido |
|---|---|
| `quote_id`, `quote_number` | Cotización afectada |
| `from_status` → `to_status` | Qué se movió |
| `actor_email` | Identidad **verificada por Access**, no declarada por el cliente |
| `note` | Nota interna, máximo 500 caracteres |
| `created_at` | ISO 8601 UTC |

La tabla es **append-only**: no hay `UPDATE` ni `DELETE` sobre ella en ninguna
ruta del Worker. La clave foránea es `ON DELETE CASCADE`, así que si algún día se
purga una cotización (`docs/DATA_RETENTION.md`) su histórico se va con ella y no
quedan correos huérfanos.

---

## 6. El panel

Una única página HTML servida por el Worker, sin build y sin dependencias
externas. Muestra recuento por estado, tabla con filtro y búsqueda, paginación,
ficha en diálogo (datos, alcance declarado, desglose del cálculo e histórico) y
el control de cambio de estado, que solo ofrece transiciones válidas.

**Por qué no está en la SPA de React:** `/admin` debe devolver 404 en
`vulnfocus.com` (`docs/SECURITY.md`). Si el panel fuera un asset estático más,
existiría como fichero y Cloudflare lo serviría con 200 a cualquiera, dejando la
protección solo en manos de Access sobre el subdominio. Por eso `wrangler.jsonc`
incluye `/admin` y `/admin/*` en `assets.run_worker_first`.

**Seguridad de la página:** CSP con `nonce` distinto en cada respuesta, sin
`unsafe-inline`; `default-src 'none'`; `X-Frame-Options: DENY`; `Cache-Control:
no-store`; `X-Robots-Tag: noindex`. Todo lo que viene de D1 se inserta con
`textContent`, nunca con `innerHTML`: los nombres de empresa y las notas son
entrada de terceros ya almacenada, y ese es el punto donde se detiene un XSS
almacenado. La página no guarda nada: ni `localStorage`, ni cookies propias.

---

## 7. Activación — REQUIERE ACCIÓN MANUAL

En este orden. Saltarse el paso 1 deja la administración expuesta.

### Paso 1 · Cloudflare Access (**obligatorio y previo**)

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. Dominio de la aplicación: `admin.vulnfocus.com`. Añadir también la ruta
   `/api/admin` si se prefiere cubrirla explícitamente.
3. Política: `Allow` · `Emails` con las direcciones concretas del equipo. **No**
   usar `Everyone`, ni `Emails ending in` sobre un dominio de correo público.
4. Exigir MFA en la política de identidad del equipo.
5. Anotar el **Application Audience (AUD) Tag** de la pestaña *Overview*.
6. Anotar el **team domain**: `<equipo>.cloudflareaccess.com`.

### Paso 2 · DNS

Registro `CNAME` (o `A` proxied) para `admin.vulnfocus.com` apuntando al Worker,
con la nube **naranja** (proxied). Si es gris, Access no intercepta.

> `_headers` envía `Strict-Transport-Security` con `includeSubDomains`: el
> subdominio **debe** servir HTTPS con certificado válido. Proxied lo cumple.

### Paso 3 · Configuración del Worker

En `wrangler.jsonc`:

```jsonc
"ADMIN_ENABLED": "true",
"CF_ACCESS_TEAM_DOMAIN": "<equipo>.cloudflareaccess.com",
"CF_ACCESS_AUD": "<AUD tag del paso 1.5>",
"ADMIN_ALLOWED_EMAILS": "persona@vulnfocus.com"   // opcional, defensa en profundidad
```

Ninguno es secreto: el AUD tag es un identificador público, no una credencial. Va
en `vars` y no en Secrets a propósito, para que sea visible y revisable.

### Paso 4 · Verificación

```bash
# 1. Con Access configurado y sesión iniciada:
curl -sS -o /dev/null -w '%{http_code}\n' https://admin.vulnfocus.com/admin
# → 302 hacia Access, y 200 tras autenticarse en el navegador.

# 2. SIN sesión, y esto es lo importante:
curl -sS -o /dev/null -w '%{http_code}\n' https://vulnfocus.com/admin
curl -sS -o /dev/null -w '%{http_code}\n' https://vulnfocus.com/api/admin/quotes
# → 404 en ambos. Si sale 200, 401 o 403: PARAR y volver a ADMIN_ENABLED="false".
```

---

## 8. Desactivación de emergencia

```jsonc
"ADMIN_ENABLED": "false"
```

y desplegar. Vuelve a 404 en todas las rutas administrativas. No se pierde ningún
dato: `quotes` y `quote_status_events` siguen intactas y el cotizador público no
depende de nada de esto.

---

## 9. Qué queda fuera, y por qué

| No implementado | Motivo |
|---|---|
| Borrado de cotizaciones desde el panel | La retención se decide en `docs/DATA_RETENTION.md`, no con un botón |
| Edición de importes u horas | Los calcula el motor; editarlos a mano rompe la trazabilidad |
| Creación manual de cotizaciones | Entrarían sin pasar por normalización ni por el motor |
| Exportación a CSV | Fácil de añadir; hoy se resuelve con `wrangler d1 execute --json` |
| Roles y permisos | Access ya decide quién entra. Un segundo modelo de permisos sin necesidad real es superficie de más |
| Creación de proyectos en SysReptor | Debe seguir siendo una acción deliberada. Ver `docs/INTEGRATIONS.md` |
