# Seguridad

Prioridad declarada del proyecto: **seguridad > estabilidad > conversión > UX >
funcionalidades nuevas.** Este documento recoge los controles vigentes y el
resultado de la revisión de la superficie añadida por el cotizador.

## Superficie pública completa

| Método | Ruta | Autenticación | Anti-abuso |
|---|---|---|---|
| POST | `/api/contact` | — | Turnstile + rate limit 5/60s + honeypot |
| POST | `/api/quotes` | — | Turnstile + rate limit 3/60s + honeypot |
| GET | `/api/quotes/:public_id` | `public_id` de 128 bits | rate limit 30/60s |
| GET | `/api/health` | — | — |
| * | resto de `/api/*` | — | 404 (deny by default) |

## Superficie privada — deshabilitada por defecto

| Método | Ruta | Autenticación | Anti-abuso |
|---|---|---|---|
| GET | `/admin` | Cloudflare Access | `ADMIN_ENABLED` + JWT verificado |
| GET | `/api/admin/session\|stats\|quotes` | Cloudflare Access | + rate limit 60/60 s |
| GET | `/api/admin/quotes/:public_id` | Cloudflare Access | idem |
| PATCH | `/api/admin/quotes/:public_id/status` | Cloudflare Access | idem |

**En el repositorio, `ADMIN_ENABLED="false"`: todas esas rutas devuelven 404**,
byte a byte el mismo 404 que `/api/no-existe` — mismo cuerpo, mismo
`Content-Type`, mismo `Cache-Control`, sin `WWW-Authenticate`. Un 401 confirmaría
que ahí hay algo que proteger.

Cuatro candados, en orden, y ninguno opcional:

1. `ADMIN_ENABLED === "true"`, o 404 sin mirar la petición.
2. Aserción `Cf-Access-Jwt-Assertion` **verificada criptográficamente**: firma
   RS256 contra el JWKS del equipo, `iss`, `aud`, `exp`, `nbf`, `iat`. Algoritmo
   fijado: `alg: "none"` y los HMAC se rechazan. Si no, 404.
3. Allowlist propia opcional `ADMIN_ALLOWED_EMAILS`, además de la política de Access.
4. `ADMIN_RATE_LIMITER`, 60/60 s **por identidad**, no por IP: una sesión
   legítima tampoco puede barrer la tabla paginando a toda velocidad.

**No se implementa autenticación propia** (usuario, contraseña, sesiones, tokens
emitidos por nosotros): sería superficie nueva que mantener y rotar, y Access ya
resuelve SSO, MFA, expiración y revocación. El Worker verifica el JWT **además**
porque "está detrás de Access" es una suposición sobre configuración externa que
puede cambiar sin tocar este repositorio.

Lo que la administración **no** puede hacer, y es por diseño: borrar
cotizaciones, editar importes, horas, alcance o datos de contacto. Solo escribe
`status` y `updated_at`, y solo por transiciones declaradas en la máquina de
estados. Hay un test que compara todas las columnas antes y después de una
transición. Detalle completo en `docs/ADMIN.md`.

## Controles por petición

Mismo orden en los dos endpoints que escriben, y es deliberado:

```
rate limit → Content-Type → tamaño declarado → tamaño real → JSON
  → honeypot → validación → Turnstile → D1 → 201 → notificaciones
```

* El rate limit va **primero**: corta antes de gastar nada.
* Turnstile va **después de la validación**: no se gasta una verificación en un
  cuerpo que ya sabemos inválido.
* El honeypot responde un 201 indistinguible de un envío correcto, sin tocar D1
  ni gastar Turnstile: un bot no puede distinguir "aceptado" de "descartado".
* Límites de cuerpo: 16 KB en contacto, 32 KB en cotizaciones. Se comprueba el
  `Content-Length` **y** los bytes reales, porque la cabecera puede mentir.

## Revisión del cotizador

| Riesgo | Estado | Cómo se evita |
|---|---|---|
| **Mass assignment** | Cubierto | El normalizador solo lee claves declaradas en el catálogo público. `estimated_hours`, `min_price`, `status`, `discount`… ni se miran. |
| **Manipulación de precio** | Cubierto | El precio se calcula server-side a partir de las horas que calcula el servidor. Nada del cuerpo entra en `computePricing()`. |
| **Manipulación de horas** | Cubierto | Igual: `buildQuote()` parte de la entrada normalizada, no de campos del cliente. |
| **Manipulación de estado** | Cubierto | `status` se fija a `'NEW'` en el `INSERT`. No hay endpoint que lo cambie. |
| **Parameter tampering** | Cubierto | Números: entero dentro de `[min,max]` o 400. Selects y multiselects: allowlist del catálogo. Moneda: allowlist de la configuración. |
| **IDOR** | Cubierto | La única lectura pública va por `public_id` de 128 bits aleatorios. |
| **Enumeración de cotizaciones** | Cubierto | `quote_number` es correlativo pero **no sirve para recuperar**: `GET /api/quotes/VF-2026-000001` devuelve 404. Formato inválido e inexistente responden lo mismo. Rate limit de 30/60s sobre la lectura. |
| **SQL injection** | Cubierto | Prepared statements con `bind()` en todas las consultas. Verificado: una empresa llamada `'); DROP TABLE quotes;--` se almacena literal y la tabla sigue en pie. |
| **XSS (reflejado, almacenado, DOM)** | Cubierto | React escapa por defecto. No hay `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `document.write` en todo el código. `Seo.jsx` usa `setAttribute`, no HTML. |
| **Prototype pollution** | Cubierto | `__proto__` y `constructor` en el cuerpo no tienen efecto: no se hace merge recursivo, solo lectura de claves conocidas, y se usa `Object.prototype.hasOwnProperty.call()` al consultar los mapas de reglas. Verificado con payloads reales. |
| **CSRF** | No aplica | La API no usa cookies ni sesiones: no hay autoridad ambiental que suplantar. Además exige `Content-Type: application/json` y un token de Turnstile de un solo uso. |
| **SSRF** | No aplica | El Worker solo llama a destinos fijos y codificados: Siteverify, Telegram y, si se configura, el proveedor de correo. Ninguna URL procede de la entrada del usuario. |
| **Open redirect** | No aplica | No hay ninguna redirección basada en parámetros. |
| **Payloads desmesurados** | Cubierto | 413 por tamaño; token de Turnstile limitado a 2048 caracteres; `notes` a 1000; JSON profundo no afecta porque solo se leen claves conocidas. |
| **JSON malformado** | Cubierto | 400 genérico. |
| **Bypass de Turnstile** | Cubierto | No existe variable, cabecera ni parámetro que salte la verificación. Fail closed ante secreto ausente, red caída, timeout, 5xx o JSON inválido. Allowlist de hostname **exacta**, nunca por sufijo. |
| **Bypass de rate limit** | Mitigado | Binding nativo de Cloudflare por `CF-Connecting-IP`, no un contador en memoria. Es local por PoP y eventualmente consistente: es una defensa anti-abuso, no un contador exacto. Turnstile es el control anti-bot primario. |
| **Errores verbosos** | Cubierto | Todos los errores al cliente son genéricos. El campo que falló se registra, nunca se devuelve. |
| **Exposición de datos** | Cubierto | La respuesta pública no lleva tarifas, multiplicadores, horas base ni desglose. La lectura por `public_id` no devuelve email, teléfono, notas, estado ni cálculo interno. |
| **Exposición de secretos** | Cubierto | Ningún secreto en el repositorio. De Telegram y del proveedor de correo solo se registra el código HTTP, nunca el cuerpo de la respuesta. |
| **XSS almacenado vía JSON** | Reforzado | `json()` escapa `<`, `>`, `&`, U+2028 y U+2029 como `\uXXXX`. No era explotable (`Content-Type` estricto, `nosniff`, CSP `default-src 'none'`), pero el cuerpo de una API acaba incrustado en sitios que no controlamos. `JSON.parse` devuelve el mismo texto, así que ningún cliente lo nota. |
| **XSS almacenado en el panel** | Cubierto | Todo lo que viene de D1 se inserta con `textContent`, nunca `innerHTML`. La página va con CSP de `nonce` por respuesta y `default-src 'none'`, sin `unsafe-inline`. |
| **Falsificación de identidad de Access** | Cubierto | Firma verificada contra el JWKS del equipo. Se rechazan `alg: "none"`, firma de otra clave, payload manipulado con firma original, `iss` o `aud` ajenos, caducados y emitidos en el futuro. Sin JWKS alcanzable: no se autoriza. Probado con pares RSA reales generados en el test. |
| **Transiciones de estado inválidas** | Cubierto | Máquina de estados explícita. `ACCEPTED` solo desde `PROPOSAL_SENT`; `ACCEPTED` y `REJECTED` son terminales; el mismo estado no es transición. `UPDATE` condicionado al estado leído: dos sesiones simultáneas no se pisan (409). |
| **Inyección en la búsqueda del panel** | Cubierto | Sentencias preparadas y escapado explícito de los comodines de `LIKE` (`%`, `_`, `\`): buscar `%` busca el carácter, no todas las filas. El cursor de paginación se valida antes de llegar a la consulta. |
| **`/admin` servido como asset estático** | Cubierto | `assets.run_worker_first` incluye `/admin` y `/admin/*`: el panel no existe como fichero, así que no puede servirse con 200 sin pasar por los candados. |
| **Copia pública en workers.dev** | Cubierto | `workers_dev: false` y el hostname fuera de `TURNSTILE_ALLOWED_HOSTNAMES`. Antes existía una copia navegable del sitio en un dominio que Access no protege. |

### Verificaciones ejecutadas

Contra un despliegue real con `wrangler dev`, además de los 308 tests de la suite:

```
precio y horas inyectados                201  → valores ignorados, status NEW, precio NULL
prototype pollution __proto__            201  → sin efecto
prototype pollution constructor          201  → sin efecto
scope con __proto__                      201  → sin efecto
services no array                        400
services con 500 elementos               400
JSON anidado 200 niveles                 201  → campo desconocido ignorado
currency con SQLi                        400
email con salto de línea (inyección)     400
XSS en el nombre de empresa              201  → almacenado literal, escapado al renderizar
apps negativo / desmesurado              400
GET /api/quotes/<32 hex inexistente>     404
GET /api/quotes/VF-2026-000001           404
GET /api/quotes/../../etc/passwd         404
POST|PUT|DELETE|PATCH sobre una cotización 405  → el estado sigue en NEW
```

## Routing

`assets.not_found_handling: "404-page"` más un HTML por ruta conocida. Lo que
no está declarado en el manifiesto **no existe como asset** y devuelve 404 real.
No es una lista negra de nombres comunes: es una allowlist por construcción.

Verificado: `/admin`, `/phpmyadmin`, `/wp-admin`, `/.env`, `/.git/config`,
`/backup`, `/random`, `/servicios/inventado` y `/cotizar/algo` → **404**.
Las 16 rutas legítimas → **200**, sin redirección intermedia.

`/admin` es un caso aparte: no lo resuelve Static Assets sino el Worker
(`run_worker_first`), y devuelve 404 tanto con `ADMIN_ENABLED="false"` como, con
el interruptor encendido, ante cualquier petición sin aserción válida de
Cloudflare Access. El panel solo se sirve en `admin.vulnfocus.com` y solo tras
autenticarse.

`test/routing.test.js` fija este comportamiento con 29 rutas de fuzzing y
comprueba, además, que ninguna ruta del manifiesto coincide con ellas: la
garantía es la allowlist, no la lista de nombres del test.

## Datos personales

| Dato | Contacto | Cotización |
|---|---|---|
| Nombre, email | se guarda | se guarda |
| Empresa | opcional | obligatorio |
| Teléfono | no se pide | opcional |
| Mensaje / notas | se guarda | opcional, máx. 1000 |
| IP | **no** (`STORE_IP="false"`) | **no** |
| User-Agent | truncado a 256 | truncado a 256 |
| Token de Turnstile | **nunca** | **nunca** |

El borrador del cotizador se guarda en `sessionStorage` y **excluye los datos de
contacto**: solo persiste el alcance técnico, que no es dato personal. Caduca a
las 12 horas y desaparece al cerrar la pestaña.

El campo de notas avisa explícitamente de no incluir credenciales, datos de
terceros ni información clasificada.

## Cabeceras

Los assets llevan las de `frontend/public/_headers`; las respuestas del Worker
las suyas, en `worker/lib/http.js`, porque `_headers` **no se aplica** a lo que
genera el Worker.

Deuda conocida: `style-src 'unsafe-inline'` sigue siendo necesario por los
estilos inline de React (la barra de progreso del wizard tiene un `width`
dinámico que no puede vivir en la hoja). El honeypot, que antes usaba un
atributo `style`, ya se oculta desde CSS. El riesgo de `unsafe-inline` en
`style-src` es muy inferior al de su equivalente en `script-src`, que **no**
está presente.

## Riesgos abiertos

1. **Rate limit por IP.** NAT y redes móviles comparten IP. Aceptado: Turnstile
   es el control primario.
2. **Sin idempotencia.** Un doble envío del wizard crearía dos cotizaciones. El
   token de Turnstile es de un solo uso y el botón se deshabilita mientras se
   envía, así que en la práctica no ocurre; un duplicado ocasional es un coste
   operativo trivial frente a gestionar ventanas de deduplicación.
3. **CRA sin mantenimiento** (`react-scripts` 5.0.1). Ningún advisory llega al
   navegador, pero la cadena de build no tiene ruta de actualización. Migrar a
   Vite sigue siendo la solución real.
4. **Retención de `quotes` sin automatizar.** Pendiente de decisión del
   propietario.
