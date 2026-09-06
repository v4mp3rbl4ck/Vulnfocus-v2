-- 0004_proposal_requests.sql
-- Solicitud de propuesta formal desde la estimación pública (/estimacion?id=…).
--
-- Añade tres cosas:
--
--  1. El estado comercial `PROPOSAL_REQUESTED` al CHECK de `quotes.status`.
--  2. `quote_proposal_requests`: los datos adicionales que el cliente aporta al
--     pedir la propuesta, con UNIQUE(quote_id) como garantía de que una
--     cotización no puede generar dos solicitudes.
--  3. `quote_status_events.actor_source`: hasta ahora todo cambio de estado lo
--     hacía una identidad interna verificada por Access. Con esta migración un
--     evento puede originarse en el propio cliente, y el histórico tiene que
--     poder distinguirlos sin interpretar el correo.
--
-- POR QUÉ SE RECONSTRUYE `quotes` EN LUGAR DE UN ALTER TABLE
--
-- SQLite no permite modificar un CHECK con ALTER TABLE. El estado nuevo tiene
-- que entrar en la restricción o la base rechazaría una transición que la
-- aplicación considera válida (es justo lo que fija el test de coherencia entre
-- este CHECK y worker/lib/quote/lifecycle.js). La única vía es recrear la tabla.
--
-- ORDEN DE LAS OPERACIONES, Y POR QUÉ ESTE Y NO OTRO
--
-- `quote_status_events` tiene FOREIGN KEY … ON DELETE CASCADE contra `quotes`.
-- Con las claves foráneas activas, un DROP TABLE ejecuta un DELETE implícito, y
-- ese DELETE dispararía la cascada: soltar `quotes` con el histórico todavía
-- apuntando a ella BORRARÍA la auditoría entera. Por eso el histórico se copia
-- primero a una tabla sin restricciones, se suelta, se reconstruye `quotes`, y
-- solo entonces se recrea el histórico y se restauran sus filas. Ninguna fila se
-- pierde y en ningún momento hay una cascada armada.
--
-- No es idempotente —una reconstrucción no puede serlo— y no hace falta que lo
-- sea: D1 registra las migraciones aplicadas y no vuelve a ejecutarlas.
--
-- ROLLBACK: restaurar la copia previa a la migración (npm run db:backup, ver
-- docs/CLOUDFLARE_DEPLOYMENT.md). Volver atrás con SQL exigiría reconstruir otra
-- vez `quotes` para devolver el CHECK a su forma anterior, y solo sería posible
-- si ninguna fila estuviera ya en PROPOSAL_REQUESTED.

-- ---------------------------------------------------------------------------
-- 1. El histórico se pone a salvo, fuera del alcance de la cascada.
CREATE TABLE quote_status_events_backup AS SELECT * FROM quote_status_events;

DROP TABLE quote_status_events;

-- ---------------------------------------------------------------------------
-- 2. `quotes` con el CHECK ampliado. El resto de la definición es idéntico al
--    de 0002_quotes.sql: esta migración cambia la restricción, nada más.
CREATE TABLE quotes_rebuilt (
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
                      CHECK (status IN ('NEW', 'CONTACTED', 'PROPOSAL_REQUESTED', 'PROPOSAL_SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED')),

    engine_version    TEXT,
    user_agent        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    expires_at        TEXT
);

INSERT INTO quotes_rebuilt (
    id, public_id, quote_number, company, contact_name, email, phone, notes,
    services_json, scope_json, context_json, breakdown_json,
    complexity, estimated_hours, min_hours, max_hours,
    currency, min_price, max_price, status, engine_version, user_agent,
    created_at, updated_at, expires_at
)
SELECT
    id, public_id, quote_number, company, contact_name, email, phone, notes,
    services_json, scope_json, context_json, breakdown_json,
    complexity, estimated_hours, min_hours, max_hours,
    currency, min_price, max_price, status, engine_version, user_agent,
    created_at, updated_at, expires_at
FROM quotes;

DROP TABLE quotes;

ALTER TABLE quotes_rebuilt RENAME TO quotes;

CREATE INDEX IF NOT EXISTS idx_quotes_public_id ON quotes (public_id);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status_created ON quotes (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. El histórico vuelve, con `actor_source` para distinguir quién movió el
--    estado. Los eventos anteriores a esta migración son todos de administración
--    (era la única ruta que escribía aquí), así que 'admin' es su valor correcto,
--    no un relleno.
CREATE TABLE quote_status_events (
    id            TEXT PRIMARY KEY,
    quote_id      TEXT NOT NULL,
    quote_number  TEXT NOT NULL,
    from_status   TEXT NOT NULL,
    to_status     TEXT NOT NULL,
    actor_email   TEXT NOT NULL,
    actor_source  TEXT NOT NULL DEFAULT 'admin'
                  CHECK (actor_source IN ('admin', 'client', 'system')),
    note          TEXT,
    created_at    TEXT NOT NULL,

    FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE CASCADE
);

INSERT INTO quote_status_events (
    id, quote_id, quote_number, from_status, to_status, actor_email, actor_source,
    note, created_at
)
SELECT
    id, quote_id, quote_number, from_status, to_status, actor_email, 'admin',
    note, created_at
FROM quote_status_events_backup;

DROP TABLE quote_status_events_backup;

CREATE INDEX IF NOT EXISTS idx_quote_status_events_quote
    ON quote_status_events (quote_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_status_events_created_at
    ON quote_status_events (created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. La solicitud de propuesta formal.
--
--  * `quote_id` es UNIQUE: la idempotencia no depende de que el Worker se
--    acuerde de comprobarla. Dos peticiones simultáneas sobre la misma
--    cotización no pueden producir dos solicitudes ni dos avisos, porque la
--    segunda rompe la restricción y su lote entero se deshace.
--  * Solo se guardan los campos que el cliente puede aportar de verdad. Horas,
--    complejidad, alcance y precio NO se copian aquí: viven en `quotes`, los
--    calculó el motor, y duplicarlos permitiría que divergieran.
--  * `source` deja constancia del canal. Hoy solo existe uno; si mañana se pide
--    una propuesta desde otro sitio, el histórico seguirá sabiendo de dónde vino.
CREATE TABLE IF NOT EXISTS quote_proposal_requests (
    id            TEXT PRIMARY KEY,
    quote_id      TEXT NOT NULL UNIQUE,
    quote_number  TEXT NOT NULL,

    notes         TEXT,
    target_date   TEXT,
    scope_notes   TEXT,

    source        TEXT NOT NULL DEFAULT 'public_estimate',
    created_at    TEXT NOT NULL,

    FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quote_proposal_requests_created_at
    ON quote_proposal_requests (created_at DESC);
