# QA — comprobaciones visuales y de accesibilidad

Lo automatizable vive en `npm test`. Aquí queda lo que necesita ojos.

## Cómo reproducir el entorno de revisión

```bash
npm run build
npx wrangler dev --port 8787 --local     # assets + Worker + D1 local
# o solo los assets, sin API:
python3 -m http.server 8099 --directory frontend/build
```

## Resoluciones revisadas

| Escenario | Resolución | Estado |
|---|---|---|
| Escritorio | 1920 × 1080 | Revisado |
| Portátil | 1366 × 768 | Revisado |
| Tablet / intermedio | 1024 y 768 de ancho | Revisado por breakpoints |
| Móvil | 390 × 844 | Revisado |

Capturas tomadas con Chromium headless en `/`, `/servicios`,
`/servicios/active-directory`, `/proceso`, `/recursos`, `/cotizar`,
`/estimacion?id=…` y `404.html`.

## Resultado

| Comprobación | Estado | Nota |
|---|---|---|
| Sin desbordamiento horizontal | OK | Ninguna vista provoca scroll lateral en 390 px |
| Navbar en móvil | OK | Menú desplegable a pantalla completa; se cierra al navegar y con `Escape` |
| Tarjetas | OK | Rejillas `auto-fit`; colapsan a una columna sin recortes |
| Formularios | OK | Etiquetas asociadas, errores con `role="alert"` y `aria-describedby` |
| Wizard | OK | Cinco pasos, barra de progreso con `role="progressbar"`, foco al encabezado al cambiar de paso |
| Estimación | OK | Documento completo legible en móvil; tablas de alcance se apilan |
| Pie | OK | Cuatro columnas → dos → una |
| CTA | OK | "Cotizar pentest" presente en cabecera, hero, cada servicio y banda de conversión |
| Textos | OK | Sin cortes ni solapamientos |
| Contraste | OK | Texto principal `#FFFFFF` sobre `#000000`; secundario `rgba(255,255,255,.85)`; el gris apagado (`#808080`, ratio ≈ 5,3:1) solo en texto de apoyo, nunca en el único texto de un control |
| Foco de teclado | OK | Anillo `2px` visible y uniforme en todo control interactivo |
| Enlace de salto | OK | "Saltar al contenido" aparece al primer `Tab` |
| Movimiento reducido | OK | `prefers-reduced-motion` desactiva animaciones de entrada |

## Comprobaciones manuales antes de cada despliegue

**Cotizador**

- [ ] Entrar en `/cotizar`: se muestran los 9 servicios y ninguno preseleccionado
- [ ] Entrar desde una página de servicio: llega con ese servicio elegido y en el paso 2
- [ ] Seleccionar 3 servicios: el cuarto queda deshabilitado con aviso
- [ ] Avanzar sin elegir servicio: mensaje de error, no avanza
- [ ] Escribir un número fuera de rango: error en el campo, no avanza
- [ ] Recargar en el paso 3: el alcance se conserva, los datos de contacto **no**
- [ ] Volver atrás y adelante: las respuestas se mantienen
- [ ] Enviar sin Turnstile resuelto: el botón está deshabilitado
- [ ] Envío correcto: aparece la estimación con número `VF-AAAA-NNNNNN`
- [ ] "Descargar estimación en PDF": el diálogo de impresión muestra el
      documento completo, sin cabecera ni pie del sitio, con fondo blanco
- [ ] Abrir el enlace de la estimación en otra pestaña: se recupera igual
- [ ] Cambiar un carácter del `id` en la URL: mensaje de no encontrada

**Sitio**

- [ ] La consola del navegador no muestra errores en `/` ni en `/cotizar`
- [ ] Cambiar a inglés: la URL pasa a `?lang=en` y el contenido cambia
- [ ] El formulario de contacto sigue enviando y mostrando el mensaje de éxito
- [ ] Navegar entre rutas deja el scroll arriba
- [ ] `/#contacto` desde otra página lleva a la sección de contacto

## Limitaciones declaradas

* **No hay tests de componentes con DOM.** La lógica del wizard (máquina de
  estados, validación, persistencia, construcción del cuerpo) está extraída en
  módulos puros y probada en la suite. Renderizar componentes exigiría añadir
  `jsdom` y `@testing-library/react` a las dependencias del frontend; se ha
  preferido no ampliar la cadena de build de CRA, que ya es deuda conocida.
  La cobertura visual y de interacción es la de esta lista.
* **Sin tests de accesibilidad automatizados** (axe, Lighthouse CI). Lo
  comprobado son las reglas estructurales: landmarks, etiquetas, `aria-*`,
  orden de encabezados y foco visible.
