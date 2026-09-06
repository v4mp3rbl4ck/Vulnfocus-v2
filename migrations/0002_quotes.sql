-- 0002_quotes.sql
-- Cotizaciones del cotizador automático.
--
-- Migración ESTRICTAMENTE ADITIVA: no toca `contact_submissions` ni ninguna
-- estructura existente. Si hubiera que revertirla basta con no consultar estas
-- tablas; el flujo de contacto no depende de ellas.
--
-- Notas de diseño:
--  * `id` es un UUIDv4 (crypto.randomUUID) generado en el Worker.
--  * `public_id` son 32 hex (128 bits aleatorios). Es el ÚNICO identificador
--    con el que se puede recuperar una cotización desde Internet: `quote_number`
--    es correlativo y por tanto enumerable, así que no sirve para eso.
--  * `services_json` y `scope_json` guardan el alcance declarado ya normalizado.
--    Se guarda el JSON y no columnas por pregunta porque el catálogo evoluciona:
--    una pregunta nueva no debe exigir una migración de esquema.
--  * `breakdown_json` es el desglose interno del cálculo. Existe para poder
--    auditar meses después por qué una cotización dio la cifra que dio.
--  * NO se almacena el token de Turnstile, ni la IP, ni ningún secreto.
--  * Los importes se guardan como enteros en la unidad menor entera de la
--    moneda ya redondeada; REAL introduciría error de coma flotante en dinero.

CREATE TABLE IF NOT EXISTS quotes (
    id                TEXT PRIMARY KEY,
    public_id         TEXT NOT NULL UNIQUE,
    quote_number      TEXT NOT NULL UNIQUE,

    company           TEXT NOT NULL,
    contact_name      TEXT NOT NULL,
    email             TEXT NOT NULL,
    phone             TEXT,
    notes             TEXT,

    services_json     TEXT NOT NULL,
    scope_json        TEXT NOT NULL,
    context_json      TEXT NOT NULL,
    breakdown_json    TEXT,

    complexity        TEXT NOT NULL
                      CHECK (complexity IN ('LOW', 'MEDIUM', 'HIGH')),
    estimated_hours   INTEGER NOT NULL,
    min_hours         INTEGER NOT NULL,
    max_hours         INTEGER NOT NULL,

    currency          TEXT,
    min_price         INTEGER,
    max_price         INTEGER,

    status            TEXT NOT NULL DEFAULT 'NEW'
                      CHECK (status IN ('NEW', 'CONTACTED', 'PROPOSAL_SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED')),

    engine_version    TEXT,
    user_agent        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    expires_at        TEXT
);

-- Recuperación pública por identificador no predecible. UNIQUE ya crea índice,
-- pero se declara explícito para dejar constancia de que es la ruta de acceso.
CREATE INDEX IF NOT EXISTS idx_quotes_public_id ON quotes (public_id);

-- Listados comerciales: "últimas oportunidades" y "abiertas por antigüedad".
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status_created ON quotes (status, created_at DESC);

-- Correlativo anual. Una fila por año; el Worker hace UPSERT con RETURNING, que
-- es una única sentencia atómica y por tanto no puede producir dos cotizaciones
-- con el mismo número aunque lleguen a la vez.
CREATE TABLE IF NOT EXISTS quote_counters (
    year   INTEGER PRIMARY KEY,
    value  INTEGER NOT NULL DEFAULT 0
);
