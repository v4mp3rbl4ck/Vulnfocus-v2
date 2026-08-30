/** Validación del formulario de contacto. Se repite íntegra en el servidor:
 *  la validación de React no es un control de seguridad. */

export const LIMITS = {
  name: { min: 2, max: 100 },
  email: { min: 5, max: 254 }, // RFC 5321: 254 es el máximo de una dirección
  company: { min: 0, max: 100 },
  message: { min: 10, max: 5000 },
};

// Pragmático: rechaza lo obviamente inválido sin intentar implementar RFC 5322.
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;

export function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Devuelve { ok: true, data } o { ok: false, field }. */
export function validateContact(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, field: "body" };
  }

  const name = asTrimmedString(payload.name);
  const email = asTrimmedString(payload.email).toLowerCase();
  const company = asTrimmedString(payload.company);
  const message = asTrimmedString(payload.message);

  if (name.length < LIMITS.name.min || name.length > LIMITS.name.max) {
    return { ok: false, field: "name" };
  }
  // Debe contener al menos una letra Unicode, no solo dígitos o símbolos.
  if (!/\p{L}/u.test(name)) return { ok: false, field: "name" };

  if (
    email.length < LIMITS.email.min ||
    email.length > LIMITS.email.max ||
    !EMAIL_RE.test(email)
  ) {
    return { ok: false, field: "email" };
  }

  if (company.length > LIMITS.company.max) return { ok: false, field: "company" };

  if (message.length < LIMITS.message.min || message.length > LIMITS.message.max) {
    return { ok: false, field: "message" };
  }

  return { ok: true, data: { name, email, company, message } };
}
