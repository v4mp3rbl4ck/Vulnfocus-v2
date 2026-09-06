-- ===========================================================================
--  PURGA DE RETENCIÓN — **DESTRUCTIVO E IRREVERSIBLE**
-- ===========================================================================
--
--  ANTES DE EJECUTAR ESTE FICHERO, LAS TRES COSAS:
--
--    1. La política de docs/DATA_RETENTION.md §2 está APROBADA por el
--       propietario y publicada en la política de privacidad.
--    2. Hay copia de seguridad reciente:   npm run db:backup
--    3. Se ha revisado el recuento:
--       npx wrangler d1 execute vulnfocus-production --remote \
--         --file=scripts/retention-report.sql
--
--  Ejecutar:
--    npx wrangler d1 execute vulnfocus-production --remote --file=scripts/retention-purge.sql
--
--  D1 remoto NO tiene deshacer. Si el recuento del informe no cuadra con lo
--  esperado, PARAR.
--
--  Orden deliberado: primero se marca lo vencido, después se anonimiza y solo
--  al final se borra. Anonimizar conserva el valor estadístico (qué se cotiza,
--  con qué alcance, qué convierte) sin conservar a la persona.
-- ===========================================================================

-- 1. Cotizaciones abiertas cuya validez ha vencido → EXPIRED.
--    NO borra nada. Es reversible desde el panel (EXPIRED → CONTACTED).
UPDATE quotes
   SET status = 'EXPIRED',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE status IN ('NEW', 'CONTACTED', 'PROPOSAL_SENT')
   AND expires_at IS NOT NULL
   AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- 2. Cotizaciones cerradas hace más de 12 meses → anonimizar.
--    Se conservan servicios, complejidad, horas y fechas: no identifican a
--    nadie y son lo que permite revisar el motor. ACCEPTED queda intacto.
UPDATE quotes
   SET company      = 'ANONIMIZADO',
       contact_name = 'ANONIMIZADO',
       email        = 'anonimizado@invalid',
       phone        = NULL,
       notes        = NULL,
       user_agent   = NULL,
       updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE status IN ('REJECTED', 'EXPIRED')
   AND email <> 'anonimizado@invalid'
   AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months');

-- 3. Contactos marcados como spam con más de 30 días. No tienen valor y son
--    íntegramente datos personales.
DELETE FROM contact_submissions
 WHERE status = 'spam'
   AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days');

-- 4. Contactos ya respondidos con más de 12 meses.
DELETE FROM contact_submissions
 WHERE status = 'replied'
   AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months');

-- 5. Contactos nunca atendidos con más de 24 meses.
DELETE FROM contact_submissions
 WHERE status IN ('new', 'read')
   AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 months');

-- Ni el histórico de estados ni las solicitudes de propuesta necesitan purga
-- propia: quote_status_events y quote_proposal_requests tienen su clave foránea
-- ON DELETE CASCADE, así que se van con la cotización a la que pertenecen.
