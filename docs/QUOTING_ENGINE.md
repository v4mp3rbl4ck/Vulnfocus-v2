# Motor de cotización

```
INPUT (JSON del wizard)
  ↓ NORMALIZATION     worker/lib/quote/normalize.js
  ↓ SCOPE ENGINE      worker/lib/quote/scope.js
  ↓ COMPLEXITY ENGINE worker/lib/quote/complexity.js
  ↓ EFFORT ENGINE     worker/lib/quote/effort.js
  ↓ PRICING ENGINE    worker/lib/quote/pricing.js
  ↓ QUOTE             worker/lib/quote/engine.js
```

Cada etapa es una función pura con sus tests. El motor **no contiene ni un
número de negocio**: solo sabe interpretar los tipos de regla declarados en
`worker/config/quote-config.js`.

## Cómo cambiar precios sin tocar código

Todo lo comercial está en `worker/config/quote-config.js`:

| Quiero cambiar | Dónde |
|---|---|
| Horas base de un servicio | `effort.services.<id>.baseHours` |
| Cuánto suma una respuesta | `effort.services.<id>.scope.<pregunta>` |
| Multiplicadores de complejidad | `effort.services.<id>.complexity.<pregunta>` |
| Opciones globales (retest, idioma, urgencia) | `effort.context` |
| Suelo y techo de horas | `effort.minHours` / `effort.maxHours` |
| Amplitud del rango mostrado | `effort.band` |
| Umbrales BAJA/MEDIA/ALTA | `effort.complexityLabels` |
| **Tarifa por hora** | `pricing.currencies.<CLP\|USD>.hourlyRate` |
| **Mínimo comercial** | `pricing.currencies.<...>.minimumAmount` |
| Impuesto y su etiqueta | `pricing.currencies.<...>.taxRate` / `taxLabel` |
| Redondeo comercial | `pricing.currencies.<...>.roundTo` |
| Margen global | `pricing.margin` |
| Descuentos por varios servicios | `pricing.discounts.multiService` |

Ningún componente de React contiene horas ni precios. El navegador recibe el
resultado, nunca los parámetros.

## Tipos de regla

**Horas**

| Tipo | Para | Parámetros |
|---|---|---|
| `perUnitAbove` | números que escalan linealmente | `above`, `hoursPerUnit`, `maxHours` |
| `tiers` | números que escalan por tramos | `tiers: [{upTo, hours}]`, último `upTo: null` |
| `map` | `select` | `map: { valor: horas }` |
| `flag` | `boolean` | `whenTrue`, `whenFalse` |
| `perSelected` | `multiselect` | `hours: { valor: horas }` |
| `percentOfSubtotal` | opciones proporcionales | `percent`, `minHours`, `maxHours` |

**Multiplicadores**: `flagMultiplier` y `mapMultiplier`.

Una regla desconocida o mal escrita devuelve el elemento neutro (0 horas,
factor 1) en lugar de lanzar: una errata de configuración no puede tumbar el
endpoint. Un multiplicador ≤ 0 se ignora, para que nadie pueda anular el
esfuerzo por accidente.

## Ejemplo trazado

Web · 1 aplicación · 3 roles · API asociada · 50–150 endpoints · sin WAF · staging:

```
base                          16 h
roles (2 adicionales × 4)      8 h
API asociada                   8 h
endpoints 50–150               8 h
                            ──────
subtotal de alcance           40 h
complejidad (staging, sin WAF)  × 1,00
retesting (15 % del subtotal)  6 h
reunión de cierre              3 h
                            ──────
TOTAL                         49 h  →  banda 45–59 h  →  6–8 días
```

## Precios: por qué pueden salir vacíos

`computePricing()` devuelve `{ available: false }` si:

* `PRICING_ENABLED` no vale `"true"`, **o**
* la moneda no tiene `hourlyRate` configurada.

En ese caso la estimación se entrega igual, con esfuerzo y duración, y la
interfaz explica que el rango se confirma al validar el alcance. **Es
deliberado: inventar un precio sería peor que no darlo.**

Orden de cálculo, que importa:

```
horas × tarifa × margen
  → descuento por varios servicios
  → mínimo comercial            (después del descuento: el suelo no se puede perforar)
  → impuesto
  → redondeo comercial hacia arriba
```

## Identificadores

| Campo | Formato | Visible | Sirve para recuperar |
|---|---|---|---|
| `id` | UUIDv4 | no | no |
| `quote_number` | `VF-2026-000042` | sí | **no** |
| `public_id` | 32 hex (128 bits) | en el enlace | **sí** |

El correlativo es cómodo para hablar por teléfono y **por eso mismo no sirve
como credencial**: es enumerable. La recuperación va siempre por `public_id`,
generado con `crypto.getRandomValues`.

El correlativo se reserva con una única sentencia atómica:

```sql
INSERT INTO quote_counters (year, value) VALUES (?, 1)
ON CONFLICT(year) DO UPDATE SET value = value + 1
RETURNING value
```

Sin lectura previa y sin transacción explícita, así que dos cotizaciones
simultáneas no pueden obtener el mismo número. Verificado con 12 peticiones
concurrentes en la suite.

## PDF: por qué se imprime en el navegador y no se genera en el Worker

**Decisión: la descarga en PDF se hace con el diálogo de impresión del
navegador sobre una vista con `@media print` dedicada.**

Se evaluó generarlo server-side y se descartó:

| Opción | Por qué no |
|---|---|
| `pdfkit` | Depende de streams y del sistema de ficheros de Node. No funciona en Workers. |
| `jsPDF` | Necesita DOM y `canvas`. No existen en Workers. |
| `pdf-lib` | Sí funciona en Workers, pero pesa cientos de KB comprimidos contra el límite de tamaño del Worker, y las fuentes estándar obligan a incrustar una tipografía propia para que los acentos y la "ñ" salgan bien. Un coste alto y permanente para un documento de una página. |
| Servicio externo de render | Reintroduce un tercero, una credencial y una salida de datos del cliente hacia fuera. Contradice el objetivo de no ampliar superficie. |

Lo que se obtiene imprimiendo desde el navegador:

* Tipografía correcta con acentos, texto **seleccionable** y no una imagen.
* Cero dependencias nuevas, cero bytes en el Worker, cero coste por documento.
* Mismo contenido exigido a un PDF: número, fecha, cliente, servicio, objetivo,
  alcance declarado, metodología, entregables, esfuerzo, duración, rango
  económico, exclusiones, validez y aviso legal.
* Cabecera y pie de marca que solo aparecen al imprimir (`.print-only`).

Limitación aceptada: no se puede enviar el PDF por correo automáticamente,
porque el fichero se genera en el equipo del cliente. El correo de confirmación
incluye el enlace a la estimación, que se puede imprimir en cualquier momento.
Si en el futuro hiciera falta adjuntarlo, la ruta natural es un servicio de
render aparte, no meter una librería de PDF en el Worker.
