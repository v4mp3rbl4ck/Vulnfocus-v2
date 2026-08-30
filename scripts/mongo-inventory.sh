#!/usr/bin/env bash
#
# Inventario de la MongoDB actual ANTES del cutover.
#
# Solo cuenta y resume. NO imprime nombres, emails ni mensajes: la salida está
# pensada para poder pegarse en un informe sin exponer datos personales.
#
# Ejecutar EN LA VPS:
#   ./scripts/mongo-inventory.sh
#
# Salida esperada (ejemplo):
#   contact_submissions   42   rango: 2025-07-03 .. 2026-08-14
#   status_checks          7   -> NO se migra (datos de prueba)
#   access_logs        19834   -> NO se migra (log HTTP propio, sustituido por
#                                Workers Observability)

set -euo pipefail

DB="${MONGO_DB:-vulnfocus}"
MONGO_BIN="$(command -v mongosh || command -v mongo)"

if [ -z "$MONGO_BIN" ]; then
  echo "No se encontró mongosh ni mongo en el PATH." >&2
  exit 1
fi

echo "== Inventario MongoDB: base '$DB' =="
echo

"$MONGO_BIN" "$DB" --quiet --eval '
const nombres = db.getCollectionNames().sort();
print("Colecciones encontradas: " + nombres.join(", "));
print("");

const contar = (c) => db.getCollection(c).countDocuments();

const total = nombres.includes("contact_submissions") ? contar("contact_submissions") : 0;
print("contact_submissions : " + total + "   -> SE MIGRA");

if (total > 0) {
  const primero = db.contact_submissions.find({}, {timestamp:1,_id:0}).sort({timestamp:1}).limit(1).toArray()[0];
  const ultimo  = db.contact_submissions.find({}, {timestamp:1,_id:0}).sort({timestamp:-1}).limit(1).toArray()[0];
  print("    rango de fechas : " + (primero?.timestamp ?? "?") + "  ..  " + (ultimo?.timestamp ?? "?"));

  // Reparto por estado: útil para verificar la migración sin ver contenido.
  const porEstado = db.contact_submissions.aggregate([
    {$group: {_id: "$status", n: {$sum: 1}}}, {$sort: {_id: 1}}
  ]).toArray();
  print("    por estado      : " + porEstado.map(x => (x._id ?? "sin estado") + "=" + x.n).join(", "));

  // Documentos que la tabla D1 rechazaría (campos NOT NULL vacíos).
  const incompletos = db.contact_submissions.countDocuments({
    $or: [
      {name:    {$in: [null, ""]}},
      {email:   {$in: [null, ""]}},
      {message: {$in: [null, ""]}},
    ]
  });
  print("    incompletos     : " + incompletos + " (se descartarán en la migración)");
  print("    migrables       : " + (total - incompletos));
}

print("");
for (const c of ["status_checks", "access_logs"]) {
  if (nombres.includes(c)) {
    print(c + " : " + contar(c) + "   -> NO SE MIGRA");
  }
}
print("");
print("Justificación de lo que no se migra:");
print("  status_checks : endpoint de pruebas eliminado en la migración; sin valor de negocio.");
print("  access_logs   : log HTTP propio, sustituido por Workers Observability. Contiene IPs");
print("                  y User-Agents históricos; no migrarlo reduce PII almacenada.");
'

echo
echo "Siguiente paso, si contact_submissions tiene datos que conservar:"
echo "  mongoexport --db=$DB --collection=contact_submissions --jsonArray --out=contacts.json"
echo "  node scripts/mongo-to-d1.mjs contacts.json > /tmp/import.sql"
echo "  npx wrangler d1 execute vulnfocus --remote --file=/tmp/import.sql"
echo "  ./scripts/verify-migration.sh contacts.json"
