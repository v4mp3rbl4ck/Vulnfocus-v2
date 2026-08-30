# Guía de autogestión — VulnFocus en Cloudflare

Para el día a día. No hace falta ser desarrollador full-time ni saber React.

El ciclo es siempre el mismo:

```
editas un fichero → git add . → git commit -m "..." → git push → Cloudflare despliega
```

Nada más. No hay servidor, no hay SSH, no hay `systemctl restart`.

---

## Antes de empezar

Una sola vez, en tu equipo:

```bash
git clone <tu-repo> vulnfocus
cd vulnfocus
npm ci
npm --prefix frontend ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
```

Para ver los cambios antes de publicarlos:

```bash
npm run build     # compila el frontend
npm run dev       # abre http://localhost:8787
```

Deja `npm run dev` corriendo mientras trabajas. **Después de tocar `frontend/`
hay que volver a ejecutar `npm run build`** para que el cambio se vea.

---

## Cambiar textos de la web

Casi todo el texto visible está en un único fichero:

**`frontend/src/utils/translations.js`**

```js
export const translations = {
  es: {
    hero: {
      title: 'Aquí va el texto en español',
      ...
    }
  },
  en: {
    hero: {
      title: 'English text goes here',
      ...
    }
  }
};
```

Reglas:

- **Edita siempre las dos versiones**, `es` y `en`. Si solo cambias una, la web
  queda incoherente al cambiar de idioma.
- Respeta las comillas y la coma final de cada línea.
- Si el texto lleva un apóstrofo (`'`), escápalo (`\'`) o usa comillas dobles.

## Cambiar datos de contacto

**`frontend/src/components/Contact.jsx`**, array `contactChannels` (cerca de la
línea 240):

```js
{
  icon: Mail,
  label: t.contact.channels.email,
  value: 'contacto@vulnfocus.com',      // ← lo que se ve
  link: 'mailto:contacto@vulnfocus.com' // ← a dónde lleva al hacer clic
},
```

Cambia `value` y `link` a la vez. Si cambias el teléfono, aparece en tres sitios
de ese array (WhatsApp, Telegram, teléfono): revísalos todos.

El email también aparece en **`frontend/public/index.html`**, dentro del bloque
`Schema.org JSON-LD` (`"email"` y `"telephone"`). Es lo que leen Google y las
redes sociales. Si cambias el contacto, actualízalo también ahí.

## Cambiar colores

**`frontend/src/App.css`**, al principio del fichero:

```css
:root {
  --color-primary: #0080FF;    /* azul de VulnFocus */
  --color-accent:  #FF4458;    /* rojo */
  ...
}
```

Cambia el valor hexadecimal y el color se propaga a toda la web.

Dos sitios que **no** usan esas variables y hay que tocar aparte si cambias la
identidad:

- El logo del escudo bicolor: `frontend/src/components/Header.jsx`, atributos
  `stroke="#0080FF"` y `stroke="#FF4458"`.
- `<meta name="theme-color" content="#0080FF" />` en
  `frontend/public/index.html` (color de la barra del navegador en móvil).

## Añadir o cambiar un servicio

Los servicios salen de `translations.js`, dentro de `services.items`:

```js
services: {
  items: [
    {
      title: 'Pentesting de APIs',
      description: 'Descripción del servicio...'
    },
    // añade aquí otro bloque con la misma forma
  ]
}
```

Añade el bloque **en `es` y en `en`**, en el mismo orden en ambos. La web los
recorre por posición.

## Publicar los cambios

```bash
git add .
git commit -m "Actualizo textos de servicios"
git push
```

Cloudflare detecta el push, compila y despliega. Tarda 1–3 minutos. Puedes seguir
el progreso en **Workers & Pages → vulnfocus → Deployments**.

**Truco:** si trabajas en una rama en vez de en `main`, Cloudflare genera una URL
de vista previa. Así ves el cambio publicado sin tocar `vulnfocus.com`:

```bash
git checkout -b nuevos-textos
git push -u origin nuevos-textos
```

La URL aparece en el pull request y en el panel.

---

## Ver los contactos recibidos

No hay panel de administración: es deliberado, un panel es superficie de ataque
adicional. Los contactos se consultan desde tu terminal.

**Los últimos 20:**

```bash
npx wrangler d1 execute vulnfocus --remote \
  --command="SELECT created_at, name, email, company FROM contact_submissions ORDER BY created_at DESC LIMIT 20;"
```

**Un contacto completo, con su mensaje:**

```bash
npx wrangler d1 execute vulnfocus --remote \
  --command="SELECT * FROM contact_submissions WHERE id = 'el-uuid-que-llegó-por-telegram';"
```

**Cuántos van este mes:**

```bash
npx wrangler d1 execute vulnfocus --remote \
  --command="SELECT COUNT(*) AS total FROM contact_submissions WHERE created_at >= strftime('%Y-%m-01T00:00:00.000Z','now');"
```

**Marcar uno como respondido:**

```bash
npx wrangler d1 execute vulnfocus --remote \
  --command="UPDATE contact_submissions SET status='replied' WHERE id='...';"
```

Estados válidos: `new`, `read`, `replied`, `spam`.

## Backups

```bash
npm run db:backup
```

Deja un `.sql.gz` en `backups/`. Ese fichero **contiene datos personales**: no lo
subas a Git (ya está en `.gitignore`) y guárdalo cifrado.

Restaurar:

```bash
gunzip -c backups/vulnfocus-XXXX.sql.gz > restore.sql
npx wrangler d1 execute vulnfocus --remote --file=restore.sql
```

Hazlo una vez al mes. Cloudflare tiene Time Travel (30 días), pero eso no te
protege de "borré la base entera".

## Borrar contactos antiguos

Si adoptas la retención de 12 meses:

```bash
# Primero mira cuántos se verían afectados (no borra nada):
npx wrangler d1 execute vulnfocus --remote \
  --command="SELECT COUNT(*) FROM contact_submissions WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 months');"

# Si el número cuadra:
npx wrangler d1 execute vulnfocus --remote --file=scripts/retention-purge.sql
```

Borrar un contacto concreto (por ejemplo, si alguien ejerce su derecho de
supresión):

```bash
npx wrangler d1 execute vulnfocus --remote \
  --command="DELETE FROM contact_submissions WHERE email='persona@ejemplo.com';"
```

---

## Ver qué está pasando

**Logs en vivo** (déjalo abierto y envía el formulario desde otra ventana):

```bash
npm run tail:production
```

Verás líneas como:

```json
{"event":"contact_saved","id":"..."}
{"event":"telegram_sent","id":"..."}
{"event":"turnstile_rejected","reason":"invalid-input-response"}
{"event":"rate_limited","path":"/api/contact"}
{"event":"honeypot_triggered","path":"/api/contact"}
```

Qué significan:

| Evento | Qué pasó |
|---|---|
| `contact_saved` | Contacto guardado correctamente |
| `telegram_sent` | Aviso entregado |
| `telegram_failed` | El contacto **está** en D1, pero no te llegó el aviso |
| `turnstile_rejected` | Turnstile rechazó el envío (a menudo un bot) |
| `honeypot_triggered` | Bot detectado por el campo trampa |
| `rate_limited` | Alguien envió más de 5 veces en un minuto |
| `validation_failed` | Formulario mal rellenado |
| `d1_insert_failed` | **Problema real.** Revísalo. |

**Histórico y métricas:** Workers & Pages → vulnfocus → **Observability**. Los
logs se guardan 3 días en el plan Free.

## Cambiar secretos

Si rotas el token del bot de Telegram o la clave de Turnstile:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN --env production
```

Te lo pide por teclado, no queda en el historial del shell. Tiene efecto
inmediato, sin necesidad de redesplegar.

Ver qué secretos existen (solo los nombres, nunca los valores):

```bash
npx wrangler secret list --env production
```

## Probar Turnstile sin tocar producción

En local, `.dev.vars` ya trae las claves de prueba oficiales de Cloudflare. Para
probar los distintos escenarios, cambia el valor en `.dev.vars`:

| Clave secreta | Comportamiento |
|---|---|
| `1x0000000000000000000000000000000AA` | Siempre válida |
| `2x0000000000000000000000000000000AA` | Siempre rechaza |
| `3x0000000000000000000000000000000AA` | Simula "token ya usado" |

Y en `frontend/.env`, el site key:

| Site key | Comportamiento |
|---|---|
| `1x00000000000000000000AA` | El widget siempre pasa |
| `2x00000000000000000000AB` | El widget siempre falla |
| `3x00000000000000000000FF` | Fuerza un desafío interactivo |

Reinicia `npm run dev` después de cambiarlas.

---

## Si algo se rompe

### El formulario da error

1. `npm run tail:production` y envía el formulario. Mira qué evento sale.
2. `turnstile_rejected` con `not-configured` → falta `TURNSTILE_SECRET_KEY`.
   Vuelve a ponerlo con `wrangler secret put`.
3. `turnstile_rejected` con `hostname-mismatch` → el hostname del widget de
   Turnstile no coincide con `TURNSTILE_ALLOWED_HOSTNAMES` en `wrangler.jsonc`.
4. `d1_insert_failed` → problema con la base. Comprueba que las migraciones están
   aplicadas: `npx wrangler d1 migrations list vulnfocus --remote`.

### No llegan avisos a Telegram pero sí se guardan contactos

Es el comportamiento previsto ante fallo de Telegram: **el contacto no se pierde
nunca**. Consúltalos con las queries de arriba. Para diagnosticar el aviso:

```bash
 TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm run telegram:check
```

(el espacio antes de `TELEGRAM` evita que quede en el historial del shell).

### La web no carga o se ve mal tras un despliegue

**Volver a la versión anterior en 30 segundos:**

Workers & Pages → vulnfocus → **Deployments** → busca el despliegue anterior que
funcionaba → **Rollback**.

Es instantáneo y no toca la base de datos. Después arregla el código con calma y
haz `git push`.

### Antes de publicar algo que te preocupe

```bash
npm test                              # 73 comprobaciones automáticas
npm run acceptance https://vulnfocus.com   # comprobación del sitio publicado
```

Si `npm test` falla, **no hagas push**: algo se rompió.

---

## Lo que no deberías hacer

- **No ejecutes `npm audit fix --force`** en `frontend/`. Propone
  `react-scripts@0.0.0`, que rompe el build. Ver `MIGRACION_CLOUDFLARE.md` § 4.
- **No pongas secretos en ficheros del repositorio.** Solo `wrangler secret put`.
  El *site key* de Turnstile sí es público y va en `frontend/.env.production`.
- **No borres `frontend/.env.production`.** Contiene `INLINE_RUNTIME_CHUNK=false`,
  necesario para que la política de seguridad de contenido no se rompa.
- **No añadas `unsafe-inline` ni `unsafe-eval` a `script-src`** en
  `frontend/public/_headers` para silenciar un error de consola. Si algo necesita
  un origen nuevo, añade ese origen concreto.
- **No crees endpoints "por si acaso"** en el Worker. Todo lo que no sea
  `/api/contact` ni `/api/health` devuelve 404 a propósito.
- **No ejecutes `wrangler deploy` sin `--env`.** No tiene base de datos asignada
  y fallaría. Usa `npm run deploy:production`.
