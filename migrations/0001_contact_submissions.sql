-- 0001_contact_submissions.sql
-- Tabla única de la aplicación. Sustituye a la colección `contact_submissions` de MongoDB.
--
-- Notas de diseño:
--  * `id` es un UUIDv4 generado con crypto.randomUUID() en el Worker.
--  * `created_at` es texto ISO 8601 en UTC ("2026-08-29T14:03:00.000Z"). SQLite no
--    tiene tipo fecha nativo; el formato ISO ordena lexicográficamente igual que
--    cronológicamente, así que el índice sirve para rangos sin conversiones.
--  * `ip_address` admite NULL: con STORE_IP="false" (por defecto) no se almacena.
--  * `status` queda con CHECK para que un valor inesperado falle en la base y no
--    silenciosamente en la aplicación.

CREATE TABLE IF NOT EXISTS contact_submissions (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    company     TEXT,
    message     TEXT NOT NULL,
    ip_address  TEXT,
    user_agent  TEXT,
    status      TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'read', 'replied', 'spam')),
    created_at  TEXT NOT NULL
);

-- Único índice creado. Justificación: las dos operaciones reales sobre esta tabla son
-- "listar los últimos contactos" y "borrar los anteriores a X" (retención). Ambas
-- filtran/ordenan por created_at. Índices sobre email o status no aportan nada con
-- volúmenes de decenas o cientos de filas, y cada índice añade una fila escrita
-- adicional por INSERT (cuenta para el límite de 100.000 escrituras/día del plan Free).
CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at
    ON contact_submissions (created_at DESC);
