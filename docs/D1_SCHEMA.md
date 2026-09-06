# Esquema de D1

Migraciones en `migrations/`, aplicadas con `npm run db:migrate` (remoto) o
`npm run db:migrate:local`. **Todas son aditivas e idempotentes**: ninguna altera
ni borra estructuras ni datos existentes, y aplicarlas dos veces no tiene efecto.

| Fichero | Contenido | Estado en producción |
|---|---|---|
| `0001_contact_submissions.sql` | Formulario de contacto | Aplicada |
| `0002_quotes.sql` | Cotizaciones y correlativo anual | Verificar |
| `0003_quote_status_events.sql` | Histórico de cambios de estado (administración) | **Pendiente** |

## `contact_submissions`

Sin cambios respecto a la versión anterior.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | TEXT PK | UUIDv4 |
| `name`, `email`, `message` | TEXT NOT NULL | |
| `company` | TEXT | `NULL` si viene vacía |
| `ip_address` | TEXT | `NULL` salvo `STORE_IP="true"` |
| `user_agent` | TEXT | truncado a 256 |
| `status` | TEXT | CHECK `new` · `read` · `replied` · `spam` |
| `created_at` | TEXT | ISO 8601 UTC |

Índice: `created_at DESC`.

## `quotes`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | TEXT PK | UUIDv4 |
| `public_id` | TEXT UNIQUE | 32 hex. **Única vía de recuperación pública** |
| `quote_number` | TEXT UNIQUE | `VF-AAAA-NNNNNN`, correlativo por año |
| `company`, `contact_name`, `email` | TEXT NOT NULL | |
| `phone`, `notes` | TEXT | opcionales |
| `services_json` | TEXT NOT NULL | `["web","api"]` |
| `scope_json` | TEXT NOT NULL | respuestas normalizadas por servicio |
| `context_json` | TEXT NOT NULL | opciones globales |
| `breakdown_json` | TEXT | desglose interno del cálculo, para auditoría |
| `complexity` | TEXT NOT NULL | CHECK `LOW` · `MEDIUM` · `HIGH` |
| `estimated_hours`, `min_hours`, `max_hours` | INTEGER NOT NULL | |
| `currency`, `min_price`, `max_price` | TEXT / INTEGER | `NULL` si el precio está desactivado |
| `status` | TEXT NOT NULL | CHECK `NEW` · `CONTACTED` · `PROPOSAL_SENT` · `ACCEPTED` · `REJECTED` · `EXPIRED`. **Nace siempre en `NEW`** |
| `engine_version` | TEXT | versión de `quote-config.js` con la que se calculó |
| `user_agent` | TEXT | truncado a 256 |
| `created_at`, `updated_at`, `expires_at` | TEXT NOT NULL / TEXT | ISO 8601 UTC |

Índices: `public_id`, `created_at DESC`, `(status, created_at DESC)`.

### Por qué JSON y no una columna por pregunta

El catálogo del cotizador evoluciona: añadir una pregunta no debe exigir una
migración de esquema ni romper las cotizaciones ya guardadas. Los campos por los
que **sí** se filtra y ordena (estado, fecha, identificadores) son columnas
propias con índice; el resto es contenido.

### Por qué los importes son enteros

`REAL` introduce error de coma flotante en dinero. Los precios se guardan ya
redondeados, en la unidad entera de la moneda.

### Qué NO se guarda

Tokens de Turnstile, secretos, IP de la persona que cotiza y desglose de
tarifas. El `breakdown_json` contiene horas y factores, nunca importes por hora.

## `quote_counters`

| Columna | Tipo |
|---|---|
| `year` | INTEGER PK |
| `value` | INTEGER NOT NULL |

Una fila por año. El Worker hace `INSERT … ON CONFLICT DO UPDATE … RETURNING`,
una sola sentencia atómica: no puede haber dos cotizaciones con el mismo número.

## `quote_status_events`

Añadida por `migrations/0003_quote_status_events.sql`. Histórico **append-only**
de los cambios de estado que hace la administración.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `quote_id` | TEXT NOT NULL | FK → `quotes(id)` **ON DELETE CASCADE** |
| `quote_number` | TEXT NOT NULL | Redundante a propósito: permite leer el histórico sin unir |
| `from_status` | TEXT NOT NULL | Estado de origen |
| `to_status` | TEXT NOT NULL | Estado de destino |
| `actor_email` | TEXT NOT NULL | Identidad **verificada por Cloudflare Access**. Personal interno, nunca del cliente |
| `note` | TEXT | Nota interna, máximo 500 caracteres. **Nunca** se devuelve por una ruta pública |
| `created_at` | TEXT NOT NULL | ISO 8601 UTC |

Índices: `(quote_id, created_at DESC)` para la ficha, y `(created_at DESC)` para
la actividad reciente.

### Por qué una tabla y no una columna más en `quotes`

`quotes.status` responde *en qué estado está*; esta tabla responde *quién lo
movió, cuándo y por qué*. La segunda pregunta no se contesta sobrescribiendo un
campo. El Worker solo hace `INSERT` sobre ella: no existe ninguna ruta que la
modifique ni que la borre.

### Cascade

La clave foránea es `ON DELETE CASCADE`: si algún día se purga una cotización
(`docs/DATA_RETENTION.md`), su histórico se va con ella. Un evento huérfano no
aporta nada y sí conserva una dirección de correo.

## Aplicar las migraciones en producción

Las tres son **aditivas e idempotentes** (`CREATE TABLE IF NOT EXISTS`). Ninguna
altera ni borra datos existentes; aplicarlas dos veces no tiene efecto.

```bash
# 1. Ver qué falta por aplicar. No modifica nada.
npx wrangler d1 migrations list vulnfocus-production --remote

# 2. Copia de seguridad ANTES de tocar la base.
npm run db:backup

# 3. Aplicar.
npm run db:migrate
#    = npx wrangler d1 migrations apply vulnfocus-production --remote

# 4. Verificar.
npx wrangler d1 execute vulnfocus-production --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
# → contact_submissions, quote_counters, quote_status_events, quotes

npx wrangler d1 execute vulnfocus-production --remote --command \
  "SELECT COUNT(*) FROM quote_status_events;"
# → 0, sin error
```

En local, contra la D1 de Miniflare:

```bash
npm run db:migrate:local
```

> **MANUAL CLOUDFLARE ACTION REQUIRED.** Este entorno de desarrollo no tiene
> credenciales de Cloudflare: las migraciones **no** se han aplicado a la base
> remota desde aquí, y no se ha simulado que lo estuvieran. Ver
> `docs/CLOUDFLARE_MANUAL_ACTIONS.md` → **M-01**.

## Consultas habituales

```bash
# Últimas oportunidades
npx wrangler d1 execute vulnfocus-production --remote --command \
  "SELECT quote_number, company, complexity, estimated_hours, status, created_at
     FROM quotes ORDER BY created_at DESC LIMIT 20;"

# Cambiar el estado comercial.
#
# La vía recomendada es el panel de administración (docs/ADMIN.md): valida la
# transición contra la máquina de estados y deja constancia en
# quote_status_events. Este UPDATE directo NO hace ninguna de las dos cosas, así
# que solo tiene sentido con la administración deshabilitada.
npx wrangler d1 execute vulnfocus-production --remote --command \
  "UPDATE quotes SET status='CONTACTED', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE quote_number='VF-2026-000042';"

# Histórico de una cotización
npx wrangler d1 execute vulnfocus-production --remote --command \
  "SELECT from_status, to_status, actor_email, created_at
     FROM quote_status_events WHERE quote_number='VF-2026-000042'
    ORDER BY created_at DESC;"

# Caducar las vencidas
npx wrangler d1 execute vulnfocus-production --remote --command \
  "UPDATE quotes SET status='EXPIRED', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE status='NEW' AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now');"
```

## Retención

Política completa, con plazos propuestos y estrategia de anonimización, en
**`docs/DATA_RETENTION.md`**. Resumen operativo:

* `scripts/retention-report.sql` — **solo lectura**. Cuenta qué se vería afectado.
* `scripts/retention-purge.sql` — **destructivo**. Expira, anonimiza y borra según
  los plazos propuestos.

**Nada se purga automáticamente.** No hay Cron Trigger ni TTL: los plazos son una
propuesta que **REQUIERE APROBACIÓN DEL PROPIETARIO** y su publicación en la
política de privacidad antes de ejecutarse. Siempre con `npm run db:backup`
delante: D1 remoto no tiene deshacer.
