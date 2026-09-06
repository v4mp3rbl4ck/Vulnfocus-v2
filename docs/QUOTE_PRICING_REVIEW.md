# Revisión del motor de esfuerzo y precios

> Documento de **revisión**, no de cambio. Las cifras que siguen se han extraído
> ejecutando el motor real (`worker/lib/quote/*`) sobre la configuración real
> (`worker/config/quote-config.js`) y el catálogo real
> (`frontend/src/config/quote-catalog.json`). No se ha modificado ninguna hora
> comercial: la finalidad es que el propietario pueda revisarlas con datos
> delante y decidir.
>
> Fecha de la extracción: **6 de septiembre de 2026** · motor `v1.0.0`

---

## 1. Cómo se llega a una cifra

```
respuestas del formulario
        │
        ▼
NORMALIZACIÓN   se descarta lo que no está en el catálogo
        │
        ▼
SCOPE           base + horas por volumen declarado
        │
        ▼
COMPLEXITY      multiplicadores y horas fijas por dificultad
        │
        ▼
    horas del servicio = (base + scope + complexityHoras) × complexityMultiplicador
        │
        ▼
EFFORT          suma de servicios + horas de contexto, × multiplicador de contexto,
                acotado por [minHours, maxHours] y convertido en banda y días
        │
        ▼
PRICING         horas × tarifa × margen − descuento, con mínimo comercial e impuesto
                (DESACTIVADO: no hay tarifa configurada)
```

Constantes globales vigentes:

| Parámetro | Valor | Efecto |
|---|---|---|
| `hoursPerDay` | 8 | Conversión de horas a días presentados |
| `effort.minHours` | 8 | Suelo absoluto del total |
| `effort.maxHours` | 2000 | Techo absoluto del total |
| `effort.band` | `{ lower: 0.9, upper: 1.2 }` | Banda mostrada: −10 % / +20 % |
| `effort.multiplierRange` | `{ min: 1, max: 2 }` | Acota el multiplicador **de contexto** |
| `complexityLabels.low` | ≤ 40 h **y** ≤ ×1.05 | Etiqueta LOW |
| `complexityLabels.high` | ≥ 160 h **o** ≥ ×1.2 | Etiqueta HIGH |
| `validityDays` | 30 | Vigencia de la estimación |
| `maxServices` | 3 | Servicios combinables en una cotización |

---

## 2. Tabla por servicio

`MIN HOURS` y `MAX HOURS` son las horas del servicio **antes** de contexto y de
los topes globales: el mínimo con todas las respuestas en su valor más bajo y el
máximo con todas en el más alto.

| SERVICE | BASE HOURS | SCOPE FACTORS | COMPLEXITY FACTORS | MIN HOURS | MAX HOURS | OBSERVATIONS |
|---|---:|---|---|---:|---:|---|
| **Web** | 16 | `apps` 0–120 · `roles` 0–40 · `endpoints` 0–36 · `api_asociada` 0–8 · `auth` 0–4 · `stack` 0–10 | `waf` ×1–×1.12 · `environment` ×1–×1.15 | 16 | 301 | La base es el 5 % del máximo: casi todo depende del volumen. El tope de `apps` (120 h) se alcanza en **13 aplicaciones**, y de ahí a 50 no suma nada. |
| **API** | 12 | `endpoints` 0–48 (tramos) · `roles` 0–40 · `api_type` 0–16 · `auth` 0–4 · `openapi` 0–6 · `integrations` 0–10 | `environment` ×1–×1.15 | 12 | 156 | `openapi` invertido a propósito: **no** tener especificación suma 6 h. Sin factor de complejidad por WAF/rate limiting, que en APIs sí encarece. |
| **Infra externa** | 10 | `public_ips` 0–40 · `domains` 0–18 · `exposed_services` 0–18 · `vpn` 0–4 | `hosting` ×1–×1.1 | 10 | 99 | Base más baja del catálogo (10 h) para un servicio con descubrimiento de superficie fijo. Revisar si cubre el trabajo previo real. |
| **Infra interna** | 16 | `hosts` 0–70 (tramos) · `segments` 0–30 · `servers` 0–30 · `sites` 0–48 | `access` ×1–×1.15 | 16 | 223 | Tope de `segments` en **11 segmentos** y de `sites` en **9 sedes**, muy por debajo de los máximos del catálogo (200 y 100). Una red muy segmentada queda infravalorada. |
| **Active Directory** | 24 | `users` 0–48 · `endpoints` 0–24 · `servers` 0–24 · `domains` 0–40 · `trusts` 0–8 · `sites` 0–32 | `access` ×1–×1.12 | 24 | 224 | Base más alta junto a Red Team, coherente. Tope de `domains` en **6 dominios**; un bosque grande no escala más allá. |
| **Mobile** | 8 | `platforms` 10–22 · `backend` 0–14 · `auth` 0–5 · `builds` 0–6 | *ninguno* | 18 | 55 | **Sin factores de complejidad.** No hay palanca para ofuscación, anti-tampering, root/jailbreak detection o certificate pinning, que sí cambian el esfuerzo. |
| **Cloud** | 8 | `providers` 8–24 · `accounts` 0–36 · `services` 0–18 · `iam_review` 0–10 · `access` 0–12 | *ninguno* | 16 | 108 | **Sin factores de complejidad.** `access: none` suma 12 h, que hace de sustituto parcial. Multicloud real (3 proveedores) da 24 h, revisar si basta. |
| **Red Team** | 24 | `duration_weeks` 64–768 · `objectives` 0–108 · `sites` 0–64 · `components` 0–64 | *ninguno* | 88 | 1028 | Domina la cotización: 32 h por semana ⇒ 4 h/día. **Sin factores de complejidad**: evasión de EDR o un objetivo con SOC maduro no encarecen. Mínimo 2 semanas por el catálogo. |
| **Retesting** | 4 | `findings` 1–120 · `severities` 0–6 · `original_scope` 0–4 · `previous_report` 0–8 | *ninguno* | 5 | 138 | El mínimo real es **8 h** (suelo global), no 5. Tope de `findings` en **120 hallazgos**; de 120 a 300 no suma. 1 h por hallazgo puede quedarse corto en críticos. |

---

## 3. Opciones de contexto

Se aplican al conjunto, no a un servicio.

| Opción | Tipo | Valores | Observaciones |
|---|---|---|---|
| `retest` | horas | 15 % del subtotal, mín. 4 h, máx. 40 h | Se omite si el único servicio es Retesting. El tope de 40 h se alcanza con un subtotal de 267 h. |
| `executive_session` | horas | 0 / 3 h | Reunión de cierre. |
| `report_language` | horas | es 0 · en 4 · ambos 10 | Coste de traducción del informe. |
| `urgency` | multiplicador | normal ×1 · soon ×1.05 · urgent ×1.15 | |
| `out_of_hours` | multiplicador | ×1 / ×1.1 | Acumula con `urgency`: máximo combinado ×1.265. |

---

## 4. Escenarios calculados

### 4.1 Todas las respuestas en su valor por defecto

Es lo que ve alguien que abre `/cotizar`, elige un servicio y pulsa siguiente sin
tocar nada. Es el número que más se va a mostrar.

| Servicio | Horas | Banda | Duración | Etiqueta |
|---|---:|---|---|---|
| Pentesting Web | 27 | 25–33 h | 4–5 días | LOW |
| Pentesting de API | 36 | 33–44 h | 5–6 días | LOW |
| Infraestructura externa | 17 | 16–21 h | 2–3 días | LOW |
| Infraestructura interna | 49 | 45–59 h | 6–8 días | MEDIUM |
| Active Directory | 47 | 43–57 h | 6–8 días | MEDIUM |
| Mobile | 40 | 36–48 h | 5–6 días | LOW |
| Cloud | 33 | 30–40 h | 4–5 días | LOW |
| Red Team | 210 | 189–252 h | 24–32 días | HIGH |
| Retesting | 20 | 18–24 h | 3 días | LOW |

**Punto de revisión.** Mobile sale LOW con 40 h porque el umbral es "≤ 40 h **y**
≤ ×1.05" y cae justo en el límite. Un cambio mínimo en `platforms` lo mueve a
MEDIUM. Si Mobile debe leerse como MEDIUM, la palanca es `complexityLabels.low.maxHours`.

### 4.2 Máximo teórico

Tres servicios (Red Team + Infra interna + Active Directory), todas las
respuestas al máximo, urgente, fuera de horario, informe bilingüe, retest y
sesión ejecutiva:

```
1926 h  →  banda 1734 – 2000 h  →  HIGH  →  multiplicador de contexto ×1.26
```

El techo global (`maxHours: 2000`) **se alcanza** en el extremo superior de la
banda. 2000 h ≈ 250 días-persona. **Decisión pendiente del propietario:** si un
proyecto así debe cotizarse automáticamente o derivarse a una conversación.

---

## 5. Hallazgos para revisión

Ninguno es un error de programación. Son decisiones de negocio que el motor está
aplicando y conviene confirmar.

| # | Prioridad | Hallazgo | Dónde se cambia |
|---|---|---|---|
| R-01 | Media | **Cuatro servicios sin factores de complejidad**: Mobile, Cloud, Red Team y Retesting. El mismo volumen cuesta lo mismo con o sin EDR, ofuscación o un SOC maduro delante. | `effort.services.<id>.complexity` |
| R-02 | Media | **Los topes `maxHours` de las reglas `perUnitAbove` se alcanzan mucho antes del máximo del catálogo**: 13 apps web, 11 roles, 11 segmentos internos, 9 sedes, 6 dominios AD, 120 hallazgos. A partir de ahí, declarar más volumen no cambia la cifra. | `effort.services.*.scope.*.maxHours` o los `max` del catálogo |
| R-03 | Media | **Red Team a 32 h/semana** (4 h/día). Si el ejercicio es a dedicación completa la cifra se queda a la mitad. | `red_team.scope.duration_weeks.hoursPerUnit` |
| R-04 | Baja | **`multiplierRange` solo acota el multiplicador de contexto**, no el de cada servicio. Hoy el máximo por servicio es ×1.288 (Web), así que no hay riesgo práctico, pero el nombre del parámetro sugiere lo contrario. | `worker/lib/quote/effort.js` (comportamiento) o el comentario de la configuración |
| R-05 | Baja | **El mínimo real de Retesting es 8 h**, no las 5 h que salen de su configuración: lo eleva el suelo global. | `effort.minHours` o `retesting.baseHours` |
| R-06 | Baja | **Banda asimétrica −10 % / +20 %.** Es una decisión comercial razonable (proteger frente a subestimar), conviene que sea consciente. | `effort.band` |
| R-07 | Baja | **Infra externa parte de 10 h**, la base más baja, para un servicio con descubrimiento de superficie de coste fijo. | `infra_externa.baseHours` |
| R-08 | Informativo | **El techo de 2000 h es alcanzable** con tres servicios al máximo. | `effort.maxHours` |

---

## 6. Precios — PENDIENTE DEL PROPIETARIO

El motor de precios está **implementado y probado**, y **desactivado**. Hacen
falta dos condiciones a la vez para que emita importes, y hoy no se cumple
ninguna:

1. `vars.PRICING_ENABLED = "true"` en `wrangler.jsonc` — hoy `"false"`.
2. Tarifas en `worker/config/quote-config.js` — hoy `null`.

```js
pricing: {
  currencies: {
    CLP: {
      hourlyRate:    null,   // ← REQUIERE VALOR DEL PROPIETARIO
      minimumAmount: null,   // ← REQUIERE VALOR DEL PROPIETARIO
      taxRate: 0.19, taxIncluded: false, taxLabel: 'IVA',
      roundTo: 10000, decimals: 0, locale: 'es-CL',
    },
    USD: {
      hourlyRate:    null,   // ← REQUIERE VALOR DEL PROPIETARIO
      minimumAmount: null,   // ← REQUIERE VALOR DEL PROPIETARIO
      taxRate: 0, roundTo: 50, decimals: 0, locale: 'en-US',
    },
  },
  margin: 1,                 // 1 = sin margen adicional sobre la tarifa
  discounts: { multiService: [ { minServices: 2, rate: 0.05 },
                               { minServices: 3, rate: 0.08 } ] },
}
```

**No se ha inventado ninguna tarifa.** Con `hourlyRate: null` el motor devuelve
`{ available: false, reason: 'not-configured' }` incluso con `PRICING_ENABLED="true"`,
y la estimación sale con esfuerzo y duración pero sin importes. Hay un test que
lo fija (`test/security.test.js` → "activar PRICING_ENABLED sin tarifas
configuradas NO produce precios").

### Orden de aplicación del cálculo

Importa, porque cambia el resultado:

```
importe = horas × hourlyRate × margin
importe = importe × (1 − descuento por nº de servicios)
importe = max(importe, minimumAmount)          ← el mínimo va DESPUÉS del descuento
importe = importe × (1 + taxRate)              ← solo si taxIncluded es false
importe = redondeo al alza a roundTo
```

El mínimo comercial se aplica **después** del descuento a propósito: un descuento
no puede dejar el proyecto por debajo del suelo de rentabilidad.

### Para activarlo

1. Definir las cuatro cifras (`CLP.hourlyRate`, `CLP.minimumAmount`, y las de USD
   si se va a ofrecer).
2. Confirmar `margin`, `roundTo` y los descuentos multi-servicio.
3. Comprobar con `npm test` que la suite sigue verde.
4. Poner `PRICING_ENABLED="true"` y desplegar.
5. Verificar en producción con una cotización de prueba y borrarla.

---

## 7. Cómo reproducir estas cifras

Las tablas se obtuvieron ejecutando el motor, no leyéndolo. Para repetirlo tras
un cambio de configuración, la vía soportada es la propia suite:

```bash
npm test -- test/quote-engine.test.js
```

y, para los escenarios concretos de este documento, un script de un solo uso que
importe `worker/lib/quote/effort.js` y le pase el catálogo. No se versiona porque
es una herramienta de análisis puntual, no parte del build.
