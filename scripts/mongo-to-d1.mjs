#!/usr/bin/env node
/**
 * Convierte una exportación de MongoDB (contact_submissions) en un fichero SQL
 * listo para cargar en Cloudflare D1.
 *
 * Uso:
 *   1) En la VPS, exportar solo la colección que importa:
 *        mongoexport --db=vulnfocus --collection=contact_submissions \
 *                    --jsonArray --out=contacts.json
 *      (NO exportar access_logs ni status_checks: se descartan en la migración.)
 *
 *   2) node scripts/mongo-to-d1.mjs contacts.json > migrations/data/0002_import.sql
 *
 *   3) npx wrangler d1 execute vulnfocus --remote --file=migrations/data/0002_import.sql
 *
 *   4) Verificar el conteo:
 *        npx wrangler d1 execute vulnfocus --remote \
 *            --command="SELECT COUNT(*) AS total FROM contact_submissions;"
 *      Debe coincidir con:
 *        mongosh --eval 'db.contact_submissions.countDocuments()' vulnfocus
 *
 * El fichero generado usa INSERT OR IGNORE, así que es idempotente: relanzarlo
 * no duplica filas.
 */

import { readFileSync } from "node:fs";

const VALID_STATUS = new Set(["new", "read", "replied", "spam"]);

/** Escapa una cadena para un literal SQL de SQLite. Solo se usa para migración
 *  puntual de datos ya existentes, no en la ruta de peticiones del Worker. */
function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Normaliza el timestamp de Mongo a ISO 8601 UTC. Acepta string ISO,
 *  { $date: ... } de extended JSON, y epoch en milisegundos. */
function toIsoUtc(value) {
  if (!value) return new Date(0).toISOString();
  const raw =
    typeof value === "object" && value !== null && "$date" in value ? value.$date : value;
  const date = new Date(typeof raw === "number" ? raw : String(raw));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Uso: node scripts/mongo-to-d1.mjs <contacts.json>");
  process.exit(1);
}

let docs;
try {
  docs = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (err) {
  console.error(`No se pudo leer o parsear ${inputPath}: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(docs)) {
  console.error("El fichero debe ser un array JSON (usa mongoexport --jsonArray).");
  process.exit(1);
}

const rows = [];
let skipped = 0;

for (const doc of docs) {
  const id = doc.id || doc._id?.$oid || doc._id;
  const name = (doc.name || "").trim();
  const email = (doc.email || "").trim().toLowerCase();
  const message = (doc.message || "").trim();

  // Se descartan documentos incompletos: la tabla D1 tiene NOT NULL en estos campos.
  if (!id || !name || !email || !message) {
    skipped += 1;
    continue;
  }

  const status = VALID_STATUS.has(doc.status) ? doc.status : "new";

  rows.push(
    `INSERT OR IGNORE INTO contact_submissions ` +
      `(id, name, email, company, message, ip_address, user_agent, status, created_at) VALUES (` +
      [
        sqlString(id),
        sqlString(name),
        sqlString(email),
        sqlString((doc.company || "").trim()),
        sqlString(message),
        sqlString(doc.ip_address),
        sqlString((doc.user_agent || "").slice(0, 256)),
        sqlString(status),
        sqlString(toIsoUtc(doc.timestamp ?? doc.created_at)),
      ].join(", ") +
      ");",
  );
}

console.log("-- Importación de contactos MongoDB -> D1");
console.log(`-- Origen: ${inputPath}`);
console.log(`-- Documentos leídos: ${docs.length}`);
console.log(`-- Filas a insertar: ${rows.length}`);
console.log(`-- Descartados por campos obligatorios vacíos: ${skipped}`);
console.log("");
console.log(rows.join("\n"));

console.error(
  `Generadas ${rows.length} filas (${skipped} descartadas de ${docs.length} documentos).`,
);
