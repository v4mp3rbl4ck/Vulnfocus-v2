# BASELINE — comportamiento antes de la reestructuración

Copia lógica del comportamiento observado **antes** de tocar código, para poder
comparar antes/después. Fecha de captura: primera sesión de la reestructuración.

Snapshot binario del árbol (sin `node_modules` ni `build`) generado antes del
primer cambio en el directorio temporal de la sesión:
`vulnfocus-baseline-<fecha>.tar.gz`. **No hay repositorio git local** (P-03),
así que este documento y ese snapshot son el único punto de retorno.

## 1. Verificaciones ejecutadas sobre el estado original

| Comando | Resultado |
|---|---|
| `npx vitest run` | **73 tests, 3 ficheros, todos verdes** (1,46 s) |
| `npm --prefix frontend run build` | **Compiled successfully** — `main.949a15c5.js` 97,38 kB gzip · `main.0a3c9067.css` 5,58 kB gzip |

## 2. Contrato HTTP original (debe seguir cumpliéndose)

### POST /api/contact

| Situación | Código | Cuerpo |
|---|---|---|
| Envío válido | `201` | `{status:"success", message:"Mensaje recibido correctamente", submission_id:<uuid v4>}` — exactamente 3 claves |
| Honeypot `website` relleno | `201` | Idéntico, con UUID **sintético**; sin fila en D1, sin Siteverify, sin Telegram |
| Honeypot solo con espacios | `201` | Envío **real** (se guarda) |
| Método ≠ POST | `405` | `Allow: POST` |
| `Content-Type` no JSON | `415` | genérico |
| `Content-Length` o bytes > 16384 | `413` | genérico |
| JSON malformado | `400` | `"No fue posible procesar la solicitud"` |
| Validación fallida | `400` | `"Revisa los datos del formulario e inténtalo de nuevo"` — **no revela el campo** |
| Turnstile inválido/ausente/caído/hostname | `403` | `"No fue posible verificar la solicitud…"` — **no filtra `error-codes`** |
| `TURNSTILE_SECRET_KEY` ausente | `503` | `"El formulario no está disponible temporalmente"` |
| 6.ª petición en 60 s desde la misma IP | `429` | `Retry-After: 60` |
| Fallo de D1 | `500` | `"No fue posible enviar el mensaje"`; **no se notifica a Telegram** |
| Fallo de Telegram | `201` | El contacto permanece en D1 |

### Otras rutas

| Ruta | Código |
|---|---|
| `GET`/`HEAD` `/api/health` | `200` `{"status":"ok"}` |
| Otro método en `/api/health` | `405` `Allow: GET` |
| `/api/contacts`, `/api/logs`, `/api/admin`, `/api/…` | `404` `{"status":"error","message":"Recurso no encontrado"}` |
| `/`, `/recursos`, `/proceso`, `/certificaciones` | `200` (asset) |
| **Cualquier otra ruta** (`/wp-admin`, `/.env`, …) | **`200` + index.html** ← comportamiento que se corrige (P-01) |

### Cabeceras de toda respuesta del Worker

`Content-Type: application/json; charset=utf-8` · `Cache-Control: no-store` ·
`X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` ·
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'` ·
`Cross-Origin-Resource-Policy: same-origin` · **sin cabeceras CORS**.

## 3. Reglas de negocio del contacto

* `email` se normaliza a minúsculas y se recorta.
* `company` vacía ⇒ `NULL` (no cadena vacía).
* `user_agent` truncado a 256 caracteres.
* `ip_address` `NULL` salvo `STORE_IP="true"`.
* `created_at` ISO 8601 UTC con milisegundos.
* Telegram: texto plano, **sin `parse_mode`**, truncado a 3500 caracteres.
* Orden garantizado: rate limit → Content-Type → tamaño → JSON → honeypot →
  validación → Turnstile → D1 → 201 → Telegram en background.

## 4. Datos personales

Se recogen nombre, email, empresa (opcional) y mensaje. No se almacena IP.
Retención sugerida 12 meses vía `scripts/retention-purge.sql` (no automática).

## 5. Cómo comparar después

```bash
npx vitest run                      # los 73 tests originales siguen presentes y verdes
npm run build                       # compila sin errores
bash scripts/acceptance-test.sh https://staging.vulnfocus.com --auto-only
```

Cualquier diferencia respecto a las tablas de §2 y §3 es una **regresión**.
