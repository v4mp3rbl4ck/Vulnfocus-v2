#!/usr/bin/env bash
#
# Backup de la base D1 de VulnFocus.
#
# D1 es un servicio gestionado con Time Travel (restauración a un punto de los
# últimos 30 días), pero eso NO cubre el escenario "borré la base por error" ni
# "quiero los datos fuera de Cloudflare". Este script produce un export local.
#
# Uso:   ./scripts/d1-backup.sh
# Cron:  ejecutar mensualmente desde tu equipo. No requiere servidor.
#
# ATENCIÓN: el fichero resultante contiene datos personales (nombre, email,
# mensaje). Guárdalo cifrado y aplícale la misma retención que a la base.

set -euo pipefail

DB_NAME="${1:-vulnfocus-production}"   # única base real; ver docs/CLOUDFLARE_DEPLOYMENT.md
BACKUP_DIR="backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${BACKUP_DIR}/${DB_NAME}-${STAMP}.sql"

mkdir -p "$BACKUP_DIR"

echo "==> Exportando ${DB_NAME} desde D1 (remoto)..."
npx wrangler d1 export "$DB_NAME" --remote --output "$OUTPUT"

echo "==> Comprimiendo..."
gzip -9 "$OUTPUT"

echo "==> Listo: ${OUTPUT}.gz"
echo
echo "Restauración:"
echo "  gunzip -c ${OUTPUT}.gz > restore.sql"
echo "  npx wrangler d1 execute ${DB_NAME} --remote --file=restore.sql"
echo
echo "Retención sugerida: conservar los 12 últimos backups mensuales y borrar el resto."
