# VULNFOCUS PRODUCTION RELEASE GATE

Evaluado el **6 de septiembre de 2026**, sobre el estado real del repositorio.
Solo se marca PASS lo ejecutado con salida comprobada en este entorno.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  VULNFOCUS PRODUCTION RELEASE GATE                                       │
├──────────────────────────────────────────────────────────────────────────┤
│  Frontend Build             PASS      exit 0 · Compiled successfully      │
│                                       132,39 kB gzip · 16 rutas + 404     │
│  Worker Tests               PASS      406/406 · 14 ficheros · exit 0      │
│  Quote Tests                PASS      42 motor + 50 API + 20 ciclo        │
│  Security Tests             PASS      35 seguridad + 46 admin + 32 config │
│  Routing                    PASS      24 rutas → 200 · 31 fuzz → 404      │
│                                       verificado con wrangler dev real    │
│  D1 Schema                  PASS*     3 migraciones aditivas e idempot.   │
│                                       *0003 SIN APLICAR en remoto (M-01)  │
│  Turnstile                  PASS*     server-side, fail closed, allowlist │
│                                       *site key real pendiente (M-10)     │
│  Rate Limit                 PASS      4 limitadores · namespaces únicos   │
│  Telegram                   PASS      timeout, límites, sin secretos      │
│  Email                      NOT CONFIGURED   adaptadores listos           │
│                                       EMAIL_PROVIDER="null" (M-07)        │
│  CRM                        DISABLED  contrato definido e invocado        │
│                                       CRM_PROVIDER="null"                 │
│  Admin                      DISABLED  implementado y probado (46 tests)   │
│                                       ADMIN_ENABLED="false" · falta M-05  │
│  SysReptor                  DISABLED  adaptador y flujo documentados      │
│                                       SYSREPTOR_ENABLED="false"           │
│  SEO                        PASS      7 assets creados · 0 referencias    │
│                                       rotas · sin datos inventados        │
│  Secret Scan                PASS      11 patrones · 0 hallazgos reales    │
│  Documentation              PASS      15 documentos, verificados          │
├──────────────────────────────────────────────────────────────────────────┤
│  OVERALL:  CONDITIONAL                                                    │
│                                                                           │
│  Todo lo resoluble mediante código está hecho y verificado.               │
│  Quedan 6 acciones que solo puede ejecutar el propietario.                │
│  NO hay ningún P0 ni P1 abierto en el código.                            │
└──────────────────────────────────────────────────────────────────────────┘
```

## Por qué CONDITIONAL y no READY

READY exigiría que el sistema estuviera desplegado y funcionando. No lo está, y
lo que falta **no es código**:

| # | Acción | Sin ella pasa esto |
|---|---|---|
| **M-01** | Aplicar `0003_quote_status_events.sql` | La administración fallaría al cambiar un estado. El cotizador público **no se ve afectado** |
| **M-02** | Secretos en producción | Sin `TURNSTILE_SECRET_KEY`, los formularios devuelven **503** (fail closed, deliberado) |
| **M-03** | Hostnames de Turnstile | Incoherencia entre el panel y la allowlist del Worker |
| **M-04** | Confirmar el dominio propio **antes** de `workers_dev: false` | Si el dominio no estuviera asociado, el sitio quedaría inalcanzable |
| **M-10** | Site key real de Turnstile | El widget no carga: **ningún formulario se puede enviar** |
| **M-12** | Prueba de humo tras desplegar | Sin evidencia de que el despliegue real funciona |

Ninguna requiere escribir código. Detalle completo, con *dónde*, *qué* y
*resultado esperado*, en [CLOUDFLARE_MANUAL_ACTIONS.md](CLOUDFLARE_MANUAL_ACTIONS.md).

## Por qué no es NOT READY

- **No hay ningún P0 abierto.** Los tres detectados (scripts de despliegue rotos,
  base de datos inexistente en un script, copia pública en workers.dev) están
  corregidos y con tests que impiden que vuelvan.
- **No hay ningún P1 abierto.** Los ocho están resueltos.
- **No hay regresiones.** Los 178 tests originales siguen verdes, uno por uno.
- **Todo lo no configurado está deshabilitado explícitamente**, no a medias:
  correo, CRM, administración, SysReptor y precios devuelven un estado conocido
  en lugar de fallar o de inventar valores.

## Evidencia

```
npm test                  →  406 passed (14 files)        exit 0
npm run build             →  Compiled successfully        exit 0
                             16 rutas + 404.html + sitemap
npm run build:site:check  →  OK — 16 rutas + 404.html     exit 0
npm run deploy:dry-run    →  129,69 KiB · 38 assets       exit 0
                             D1 + 4 limitadores + 18 vars
wrangler dev (real)       →  24 rutas legítimas → 200
                             31 rutas de fuzzing → 404 (0 fallos)
                             HSTS sin preload, CSP, nosniff, XFO verificados
sqlite3 (migraciones)     →  3 ficheros aplicados 2 veces sin error
escaneo de secretos       →  11 patrones · 0 hallazgos reales
```

## Qué NO se ha verificado, y por qué

| No verificado | Motivo |
|---|---|
| Migraciones en la D1 remota | Este entorno no tiene credenciales de Cloudflare. **No se ha simulado que lo estuvieran** |
| Envío real de Telegram | Requiere token real. La integración está probada con `fetch` interceptado |
| Envío real de correo | No hay proveedor contratado |
| Cloudflare Access | Requiere configuración en el panel. El JWT se prueba con pares RSA generados en el test |
| Resolución DNS y certificados | Fuera del alcance de este entorno |
| Revisión visual en navegadores reales | Ver `docs/QA_CHECKLIST.md` |
