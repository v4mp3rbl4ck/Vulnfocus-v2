-- 0003_quote_status_events.sql
-- Histórico de cambios de estado de las cotizaciones (auditoría del mini CRM).
--
-- Migración ESTRICTAMENTE ADITIVA e IDEMPOTENTE: solo CREATE ... IF NOT EXISTS.
-- No altera `contact_submissions`, ni `quotes`, ni `quote_counters`, y no borra
-- ni reescribe ninguna fila existente. Aplicarla dos veces no tiene efecto.
--
-- Por qué una tabla y no una columna más en `quotes`:
--
--  * `quotes.status` responde "en qué estado está"; esta tabla responde "quién
--    lo movió, cuándo y desde dónde". Son preguntas distintas y la segunda no se
--    puede contestar sobrescribiendo un campo.
--  * Un histórico es append-only: la API de administración solo inserta. No hay
--    UPDATE ni DELETE sobre esta tabla en ninguna ruta del Worker.
--
-- Sobre datos personales:
--
--  * `actor_email` es la identidad que Cloudflare Access ya verificó, es decir
--    personal INTERNO de VulnFocus. Es el mínimo imprescindible para que el
--    histórico sirva de algo, y está sujeto a la política de docs/DATA_RETENTION.md.
--  * NO se almacena IP, ni user agent, ni token de Access, ni ningún secreto.
--  * `note` es texto interno opcional y acotado por la aplicación. Nunca se
--    devuelve por ninguna ruta pública.

CREATE TABLE IF NOT EXISTS quote_status_events (
    id            TEXT PRIMARY KEY,
    quote_id      TEXT NOT NULL,
    quote_number  TEXT NOT NULL,
    from_status   TEXT NOT NULL,
    to_status     TEXT NOT NULL,
    actor_email   TEXT NOT NULL,
    note          TEXT,
    created_at    TEXT NOT NULL,

    -- Si alguna vez se purga una cotización (retención), su histórico se va con
    -- ella: un evento huérfano no aporta nada y sí conserva un correo.
    FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE CASCADE
);

-- La consulta real es "historial de ESTA cotización, del más reciente al más
-- antiguo", que es exactamente lo que muestra la ficha de administración.
CREATE INDEX IF NOT EXISTS idx_quote_status_events_quote
    ON quote_status_events (quote_id, created_at DESC);

-- Y "qué se ha movido últimamente", para el panel y para revisar actividad.
CREATE INDEX IF NOT EXISTS idx_quote_status_events_created_at
    ON quote_status_events (created_at DESC);
