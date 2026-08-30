#!/usr/bin/env bash
#
# Verifica que la migración MongoDB -> D1 fue completa y fiel, SIN exponer PII.
#
# Compara conteos y un hash por registro (id + email + created_at) entre el export
# de Mongo y lo que hay en D1. El hash permite detectar filas ausentes o alteradas
# sin imprimir ningún dato personal.
#
# Uso:
#   ./scripts/verify-migration.sh contacts.json [nombre-db-d1]

set -euo pipefail
EXPORT="${1:?Uso: ./scripts/verify-migration.sh contacts.json [db]}"
DB="${2:-vulnfocus}"

echo "== Verificación de migración: $EXPORT -> D1 '$DB' =="

# --- Lado Mongo (desde el fichero exportado) --------------------------------
node -e '
const fs = require("fs");
const crypto = require("crypto");
const docs = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const h = [];
for (const d of docs) {
  const id = d.id || d._id?.$oid || d._id;
  const name = (d.name || "").trim();
  const email = (d.email || "").trim().toLowerCase();
  const message = (d.message || "").trim();
  if (!id || !name || !email || !message) continue;   // mismos descartes que mongo-to-d1.mjs
  const raw = d.timestamp ?? d.created_at;
  const v = typeof raw === "object" && raw !== null && "$date" in raw ? raw.$date : raw;
  const dt = new Date(typeof v === "number" ? v : String(v));
  const created = isNaN(dt.getTime()) ? new Date(0).toISOString() : dt.toISOString();
  h.push(crypto.createHash("sha256").update(`${id}|${email}|${created}`).digest("hex").slice(0, 16));
}
h.sort();
fs.writeFileSync("/tmp/mongo-hashes.txt", h.join("\n") + "\n");
console.log("  Mongo  : " + h.length + " registros migrables");
' "$EXPORT"

# --- Lado D1 ----------------------------------------------------------------
npx wrangler d1 execute "$DB" --remote --json \
  --command="SELECT id, email, created_at FROM contact_submissions ORDER BY id;" 2>/dev/null \
| node -e '
const crypto = require("crypto");
const fs = require("fs");
let raw = "";
process.stdin.on("data", c => raw += c);
process.stdin.on("end", () => {
  const rows = JSON.parse(raw)[0].results;
  const h = rows
    .map(r => crypto.createHash("sha256").update(`${r.id}|${r.email}|${r.created_at}`).digest("hex").slice(0, 16))
    .sort();
  fs.writeFileSync("/tmp/d1-hashes.txt", h.join("\n") + "\n");
  console.log("  D1     : " + h.length + " registros");
});
'

# --- Comparación ------------------------------------------------------------
echo
if diff -q /tmp/mongo-hashes.txt /tmp/d1-hashes.txt >/dev/null; then
  echo "PASS: conteos y hashes coinciden exactamente."
  RC=0
else
  echo "FAIL: hay diferencias."
  echo "  Solo en Mongo (no llegaron a D1) : $(comm -23 /tmp/mongo-hashes.txt /tmp/d1-hashes.txt | wc -l)"
  echo "  Solo en D1 (sobran o difieren)   : $(comm -13 /tmp/mongo-hashes.txt /tmp/d1-hashes.txt | wc -l)"
  echo "  (Se comparan hashes truncados; no se imprime ningún dato personal.)"
  RC=1
fi

shred -u /tmp/mongo-hashes.txt /tmp/d1-hashes.txt 2>/dev/null || rm -f /tmp/mongo-hashes.txt /tmp/d1-hashes.txt
exit $RC
