-- INFORME DE RETENCIÓN — SOLO LECTURA. No modifica ni una fila.
--
-- Se ejecuta antes de cualquier purga para saber exactamente qué se vería
-- afectado. Ver docs/DATA_RETENTION.md.
--
--   npx wrangler d1 execute vulnfocus-production --remote --file=scripts/retention-report.sql
--
-- Los cortes usan los plazos PROPUESTOS en docs/DATA_RETENTION.md, que todavía
-- NO están aprobados. Cambiar aquí si se aprueban otros.

SELECT 'contact_submissions: spam > 30 dias' AS concepto, COUNT(*) AS filas
  FROM contact_submissions
 WHERE status = 'spam'
   AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days');

SELECT 'contact_submissions: respondidos > 12 meses' AS concepto, COUNT(*) AS filas
  FROM contact_submissions
 WHERE status = 'replied'
   AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months');

SELECT 'contact_submissions: sin atender > 24 meses' AS concepto, COUNT(*) AS filas
  FROM contact_submissions
 WHERE status IN ('new', 'read')
   AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 months');

SELECT 'quotes: cerradas > 12 meses (candidatas a anonimizar)' AS concepto, COUNT(*) AS filas
  FROM quotes
 WHERE status IN ('REJECTED', 'EXPIRED')
   AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months');

SELECT 'quotes: abiertas y vencidas (candidatas a EXPIRED)' AS concepto, COUNT(*) AS filas
  FROM quotes
 WHERE status IN ('NEW', 'CONTACTED', 'PROPOSAL_SENT')
   AND expires_at IS NOT NULL
   AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

SELECT 'quotes: ACCEPTED (NUNCA se purgan automaticamente)' AS concepto, COUNT(*) AS filas
  FROM quotes
 WHERE status = 'ACCEPTED';

SELECT status AS concepto, COUNT(*) AS filas FROM quotes GROUP BY status;
