import { readFileSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
// readD1Migrations se exporta desde el entry principal en @cloudflare/vitest-plugin v1.x
// (el subpath "/config" del antiguo vitest-pool-workers ya no existe).
import { defineConfig } from "vitest/config";

// readD1Migrations() se ejecuta en Node (lado config) y el resultado se pasa al
// runtime como binding, para que setup.js pueda aplicarlo dentro de workerd.
const migrations = await readD1Migrations("./migrations");

// `import "...App.css?raw"` devuelve cadena vacía: el plugin de CSS de Vite
// reclama la extensión antes de que el sufijo cuente. Se lee aquí, en Node, y se
// pasa al runtime como binding — el mismo mecanismo que ya se usa para las
// migraciones. Lo necesita test/print-document.test.js para verificar las reglas
// `@media print`, que deciden qué sale en el PDF de la estimación y que ningún
// test funcional cubre.
const appCss = readFileSync("./frontend/src/App.css", "utf8");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // D1 propia y efímera para los tests. wrangler.jsonc no declara D1 en el
        // nivel raíz (ver el comentario allí), así que la suite define la suya y
        // nunca puede tocar staging ni producción.
        d1Databases: { DB: "vulnfocus-test" },
        bindings: {
          STORE_IP: "false",
          TURNSTILE_ALLOWED_HOSTNAMES: "vulnfocus.com,www.vulnfocus.com",
          TEST_MIGRATIONS: migrations,
          TEST_APP_CSS: appCss,
          // Valores de prueba. Los secretos reales viven en Cloudflare Secrets
          // y nunca en el repositorio.
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          TELEGRAM_BOT_TOKEN: "000000:token-de-prueba",
          TELEGRAM_CHAT_ID: "-100123456789",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.js"],
    // El Worker emite logs estructurados por diseño; en la suite solo estorban.
    silent: "passed-only",
  },
});
