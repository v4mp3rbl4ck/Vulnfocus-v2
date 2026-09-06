/**
 * Persistencia temporal del borrador del cotizador.
 *
 * Decisiones deliberadas:
 *
 *  · **sessionStorage, no localStorage.** El borrador sobrevive a una
 *    navegación accidental o a una recarga, y desaparece al cerrar la pestaña.
 *    No queda residuo en un equipo compartido.
 *  · **Los datos de contacto NUNCA se guardan.** Empresa, nombre, email y
 *    teléfono son datos personales; el alcance técnico no lo es. Solo se
 *    persiste lo que se puede perder sin consecuencias.
 *  · **Caducidad corta.** Un borrador viejo se descarta en lugar de repoblar el
 *    formulario con datos que ya no vienen a cuento.
 */

const KEY = 'vulnfocus.quote.draft.v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 horas

function getStore(storage) {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    // Navegación privada o almacenamiento bloqueado: se sigue sin persistencia.
    return null;
  }
}

export function saveDraft(state, storage) {
  const store = getStore(storage);
  if (!store) return false;
  try {
    // `contact` se omite a propósito: ver cabecera del fichero.
    const { services, scope, context, step } = state;
    store.setItem(KEY, JSON.stringify({ savedAt: Date.now(), services, scope, context, step }));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(storage) {
  const store = getStore(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return null;
    if (!Array.isArray(draft.services) || draft.services.length === 0) return null;
    if (typeof draft.savedAt !== 'number' || Date.now() - draft.savedAt > MAX_AGE_MS) {
      store.removeItem(KEY);
      return null;
    }
    return {
      services: draft.services,
      scope: draft.scope && typeof draft.scope === 'object' ? draft.scope : {},
      context: draft.context && typeof draft.context === 'object' ? draft.context : {},
      step: Number.isInteger(draft.step) ? draft.step : 0,
    };
  } catch {
    return null;
  }
}

export function clearDraft(storage) {
  const store = getStore(storage);
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    /* sin efecto */
  }
}

export const DRAFT_KEY = KEY;
