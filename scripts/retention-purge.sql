-- Purga de retención de datos personales.
--
-- Política SUGERIDA (no impuesta): 12 meses. El propietario debe confirmarla y
-- reflejarla en la política de privacidad antes de ejecutar esto.
--
-- Ejecutar:
--   npx wrangler d1 execute vulnfocus --remote --file=scripts/retention-purge.sql
--
-- Comprobar primero cuántas filas se verían afectadas (no destructivo):
--   npx wrangler d1 execute vulnfocus --remote \
--     --command="SELECT COUNT(*) FROM contact_submissions WHERE created_at < datetime('now','-12 months');"

DELETE FROM contact_submissions
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months');
