import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// Aplica migrations/*.sql sobre la base D1 local antes de la suite.
// Cumple el requisito "migración reproducible desde cero, sin pasos manuales ocultos".
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
