#!/usr/bin/env node
/**
 * Prueba de integración REAL con Telegram (una sola vez, ambiente no productivo).
 *
 * Envía exactamente el mismo mensaje que produciría el Worker, usando el bot y el
 * chat reales, sin pasar por el formulario. Sirve para validar que el token y el
 * chat_id son correctos ANTES del cutover.
 *
 * Uso:
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... node scripts/telegram-check.mjs
 *
 * El token se lee del entorno y NUNCA se imprime. Ejecuta el comando con un
 * espacio inicial para que no quede en el historial del shell.
 */

import { buildTelegramText } from "../worker/lib/telegram.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.error("Faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID en el entorno.");
  process.exit(1);
}

const contacto = {
  id: crypto.randomUUID(),
  name: "Prueba de integración",
  email: "prueba@vulnfocus.com",
  company: "VulnFocus SPA",
  message:
    "Mensaje de verificación de la migración a Cloudflare. " +
    "Si lo recibes, el bot y el chat_id están correctamente configurados.",
  created_at: new Date().toISOString(),
};

const text = buildTelegramText(contacto);
console.log("Mensaje que se va a enviar:\n---\n" + text + "\n---\n");

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
});

// Se imprime solo el código HTTP y el campo ok: el cuerpo de error de Telegram
// puede reflejar la URL completa (y con ella el token).
const body = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status} — ok=${body.ok === true}`);

if (res.ok && body.ok) {
  console.log("PASS: Telegram recibió el mensaje. Compruébalo en el chat.");
  process.exit(0);
}
console.error(`FAIL: error_code=${body.error_code ?? "?"} description=${body.description ?? "?"}`);
process.exit(1);
