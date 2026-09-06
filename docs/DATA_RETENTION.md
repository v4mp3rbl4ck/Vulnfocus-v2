# Retención y minimización de datos

> **Estado: propuesta.** Nada se borra automáticamente todavía. Este documento
> define qué se guarda, por qué, cuánto tiempo se propone conservarlo y qué hay
> que aprobar antes de activar la purga. **REQUIERE DECISIÓN DEL PROPIETARIO.**

---

## 1. Qué se guarda hoy

### `contact_submissions` — formulario de contacto

| Columna | Dato personal | Por qué existe |
|---|---|---|
| `id` | no | UUID v4 |
| `name` | **sí** | Responder al mensaje |
| `email` | **sí** | Responder al mensaje |
| `company` | posible | Contexto comercial |
| `message` | **posible** | Es texto libre: puede contener cualquier cosa |
| `ip_address` | **sí** | **NULL por defecto** — `STORE_IP="false"` |
| `user_agent` | pseudoidentificador | Diagnóstico de envíos anómalos, truncado a 256 caracteres |
| `status` | no | `new` · `read` · `replied` · `spam` |
| `created_at` | no | ISO 8601 UTC |

### `quotes` — cotizaciones

| Columna | Dato personal | Por qué existe |
|---|---|---|
| `id`, `public_id`, `quote_number` | no | Identificadores |
| `company`, `contact_name`, `email`, `phone` | **sí** | Contacto comercial |
| `notes` | **posible** | Texto libre del cliente |
| `services_json`, `scope_json`, `context_json` | **sensible por otra vía** | Describe la infraestructura del cliente: nº de hosts, dominios, usuarios de AD, proveedores cloud. No es dato personal, es **información de seguridad de un tercero**. |
| `breakdown_json` | no | Auditoría del cálculo |
| `complexity`, horas, importes, `currency` | no | Resultado del motor |
| `status` | no | Ciclo comercial |
| `engine_version` | no | Reproducibilidad |
| `user_agent` | pseudoidentificador | Truncado a 256 caracteres |
| `created_at`, `updated_at`, `expires_at` | no | Fechas |

### `quote_status_events` — auditoría de administración

| Columna | Dato personal | Por qué existe |
|---|---|---|
| `actor_email` | **sí, INTERNO** | Es personal de VulnFocus, no del cliente. Sin él el histórico no sirve. |
| `note` | posible | Nota interna, máximo 500 caracteres |
| resto | no | Cotización, estados y fecha |

### Lo que NO se guarda, y es deliberado

- **La IP del visitante.** `STORE_IP="false"` por defecto. Se usa en memoria para
  el rate limit y para Siteverify, y no se persiste.
- **El token de Turnstile.** Se verifica y se descarta.
- **Cualquier secreto.** Ni tokens de Telegram, ni claves de correo, ni el JWT de
  Cloudflare Access.
- **Cookies de seguimiento.** El sitio no pone ninguna cookie propia.
- **Analítica con datos personales.** `frontend/src/lib/analytics.js` tiene
  allowlist de eventos y de propiedades: solo pasan identificadores de servicio,
  números de paso y códigos de moneda.

---

## 2. Retención propuesta

| Dato | Propuesta | Razón |
|---|---|---|
| `contact_submissions` con `status = 'spam'` | **30 días** | No tiene valor y es todo dato personal |
| `contact_submissions` atendidos (`replied`) | **12 meses** | Trazabilidad comercial |
| `contact_submissions` sin atender (`new`, `read`) | **24 meses** | Puede reactivarse; pasado ese plazo es ruido |
| `quotes` en `REJECTED` o `EXPIRED` | **12 meses** | Análisis de conversión |
| `quotes` en `ACCEPTED` | **conservar** mientras dure la relación + lo que exija la normativa contable | Respaldo del contrato |
| `quotes` en `NEW`, `CONTACTED`, `PROPOSAL_SENT` | **24 meses** sin actividad → `EXPIRED`, y luego el plazo anterior | |
| `quote_status_events` | **igual que su cotización** (cascade) | Un evento huérfano solo conserva un correo |
| `scope_json` de cotizaciones cerradas | **anonimizar a los 12 meses** | Describe infraestructura de terceros; su valor pasado ese plazo es estadístico |
| Copias de `npm run db:backup` | **90 días**, cifradas | Contienen todo lo anterior |

> Los plazos son una **propuesta técnica**, no asesoramiento legal. La Ley 19.628
> chilena y el RGPD (si hay clientes en la UE) imponen sus propios criterios.
> **Confirmar con asesoría antes de activar la purga.**

---

## 3. Estrategia: anonimizar antes que borrar

Borrar una cotización pierde también su valor estadístico (qué se cotiza, con qué
alcance, qué se convierte). La secuencia propuesta tiene tres escalones:

```
1. EXPIRAR      status → EXPIRED. No se toca ningún dato. Reversible.
2. ANONIMIZAR   se vacían los campos personales; se conservan horas,
                complejidad, servicios y fechas. Irreversible pero conserva
                el valor analítico.
3. ELIMINAR     DELETE de la fila. Solo cuando ni siquiera el agregado
                justifica conservarla.
```

Anonimizar significa exactamente esto, y nada más:

```sql
-- PROPUESTA. NO EJECUTAR sin aprobación explícita del propietario.
UPDATE quotes
   SET company      = 'ANONIMIZADO',
       contact_name = 'ANONIMIZADO',
       email        = 'anonimizado@invalid',
       phone        = NULL,
       notes        = NULL,
       user_agent   = NULL
 WHERE status IN ('REJECTED', 'EXPIRED')
   AND created_at < :corte;
```

Se conservan `services_json`, `complexity`, `estimated_hours`, `min_hours`,
`max_hours` y las fechas: son las columnas que permiten revisar el motor meses
después (`docs/QUOTE_PRICING_REVIEW.md`) y no identifican a nadie.

`scope_json` es el caso delicado: no identifica personas, pero describe la
infraestructura de una empresa. La propuesta es sustituirlo por su forma agregada
(`{"web":{"apps":"1-5"}}`) en lugar de conservarlo o borrarlo entero.

---

## 4. Por qué NO hay purga automática todavía

Tres razones, en orden:

1. **No está aprobada.** Los plazos de arriba son una propuesta. Un `DELETE`
   programado sobre datos de clientes reales sin aprobación explícita es
   exactamente el tipo de acción que este proyecto no ejecuta por su cuenta.
2. **No hay política de privacidad publicada que los respalde.** Anunciar una
   retención y aplicar otra es peor que no anunciar ninguna.
3. **D1 no tiene TTL nativo.** Haría falta un Cron Trigger en el Worker, es
   decir, código nuevo con permiso de borrado sobre la base de producción. Se
   añade cuando la política esté aprobada, no antes.

### Qué está preparado

- **`scripts/retention-purge.sql`** — sentencias de purga parametrizadas, para
  ejecutar a mano y de forma consciente.
- **`scripts/d1-backup.sh`** — copia previa. `backups/` está en `.gitignore`
  porque contiene datos personales.
- **`expires_at`** en `quotes` — ya se calcula al crear la cotización
  (`validityDays`, hoy 30 días). Es la señal para pasar a `EXPIRED`.
- **`quote_status_events`** con `ON DELETE CASCADE` — el histórico se va con su
  cotización, sin dejar correos huérfanos.
- **Estado `EXPIRED`** en la máquina de estados, con vuelta a `CONTACTED` si el
  cliente reaparece.

### Qué falta para activarla (REQUIERE DECISIÓN DEL PROPIETARIO)

1. Aprobar los plazos de la sección 2.
2. Publicar la política de privacidad que los declare.
3. Decidir si la purga es manual (trimestral, con copia previa) o automática
   (Cron Trigger). **Se recomienda manual durante el primer año**: el volumen es
   bajo y un borrado automático mal parametrizado no tiene vuelta atrás.
4. Si se elige automática: implementar el Cron Trigger, con `--dry-run` que
   cuente filas antes de tocarlas.

---

## 5. Procedimiento manual, mientras tanto

```bash
# 1. Copia de seguridad ANTES de cualquier borrado.
npm run db:backup

# 2. Contar lo que se vería afectado, SIN modificar nada.
npx wrangler d1 execute vulnfocus-production --remote --command \
  "SELECT status, COUNT(*) FROM quotes WHERE created_at < '2025-09-06' GROUP BY status;"

# 3. Revisar el recuento con el propietario.

# 4. Solo entonces, ejecutar la sentencia acordada.
```

Nunca al revés. Un `DELETE` en D1 remoto no se deshace.

---

## 6. Derechos de las personas

| Solicitud | Cómo se atiende hoy |
|---|---|
| **Acceso** | Consulta por `email` en `contact_submissions` y `quotes`. Con la administración habilitada, la búsqueda del panel lo resuelve. |
| **Rectificación** | `UPDATE` manual sobre la fila. No hay endpoint público que edite datos. |
| **Supresión** | `DELETE` manual, previa copia de seguridad. La cascade limpia el histórico. |
| **Oposición** | No hay perfilado ni decisiones automatizadas sobre personas: el motor calcula esfuerzo sobre infraestructura declarada. |
| **Portabilidad** | Exportación con `wrangler d1 execute --json`. |

**Pendiente:** una dirección de contacto para estas solicitudes y su publicación
en la política de privacidad.

---

## 7. Minimización ya aplicada

Cosas que ya no se recogen o ya se recortan, y por qué:

| Medida | Dónde |
|---|---|
| IP no persistida | `STORE_IP="false"`, `worker/index.js` |
| User agent truncado a 256 caracteres | `worker/lib/request.js` → `truncate()` |
| Notas del cliente acotadas a 1000 caracteres | `worker/lib/quote/normalize.js` |
| Notas internas acotadas a 500 caracteres | `worker/lib/admin/handler.js` |
| Teléfono con allowlist de caracteres | `worker/lib/quote/normalize.js` |
| La lectura pública de una estimación **no** devuelve email, teléfono ni notas | `worker/lib/quotes-handler.js` → `handleQuoteRead` |
| El acuse por correo **no** incluye el alcance declarado | `worker/integrations/email/templates.js` |
| El aviso de Telegram **no** incluye las notas libres | `worker/lib/telegram.js` |
| La analítica tiene allowlist de eventos y propiedades | `frontend/src/lib/analytics.js` |
| Ningún log incluye cuerpo de petición, tokens ni secretos | `worker/lib/http.js` → `logEvent()` |
