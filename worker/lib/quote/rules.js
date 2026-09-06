/**
 * Evaluador de reglas del motor de cotización.
 *
 * El motor no sabe nada de negocio: sabe interpretar estos tipos de regla, y
 * los valores concretos viven en worker/config/quote-config.js. Añadir un
 * servicio o cambiar una tarifa no toca este fichero.
 *
 * Toda regla desconocida devuelve el elemento neutro (0 horas, factor 1) en
 * lugar de lanzar: una configuración con una errata no debe tumbar el endpoint.
 */

/** Redondeo a 2 decimales para evitar la deriva binaria al multiplicar factores. */
export function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Horas aportadas por una regla.
 * @param {object} rule    Regla de quote-config.
 * @param {*} value        Respuesta ya normalizada.
 * @param {object} ctx     { subtotalHours } para reglas porcentuales.
 * @returns {number} horas (nunca negativas, nunca NaN)
 */
export function evaluateHours(rule, value, ctx = {}) {
  if (!rule || typeof rule !== 'object') return 0;

  let hours = 0;

  switch (rule.type) {
    case 'perUnitAbove': {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      const units = Math.max(0, n - (rule.above ?? 0));
      hours = units * (rule.hoursPerUnit ?? 0);
      if (Number.isFinite(rule.maxHours)) hours = Math.min(hours, rule.maxHours);
      break;
    }

    case 'tiers': {
      const n = Number(value);
      if (!Number.isFinite(n) || !Array.isArray(rule.tiers)) return 0;
      // El primer tramo cuyo techo cubre el valor. `upTo: null` es el resto.
      const tier = rule.tiers.find((t) => t.upTo === null || t.upTo === undefined || n <= t.upTo);
      hours = tier ? tier.hours ?? 0 : 0;
      break;
    }

    case 'map': {
      const map = rule.map || {};
      hours = Object.prototype.hasOwnProperty.call(map, value) ? map[value] : 0;
      break;
    }

    case 'flag':
      hours = value === true ? rule.whenTrue ?? 0 : rule.whenFalse ?? 0;
      break;

    case 'perSelected': {
      if (!Array.isArray(value)) return 0;
      const table = rule.hours || {};
      hours = value.reduce(
        (acc, item) =>
          acc + (Object.prototype.hasOwnProperty.call(table, item) ? table[item] : 0),
        0,
      );
      break;
    }

    case 'percentOfSubtotal': {
      // Es una opción, no un cálculo incondicional: si la respuesta que la
      // gobierna es `false`, no aporta horas. Sin esta comprobación, desmarcar
      // "incluir retesting" seguía sumando su porcentaje.
      if (value === false) return 0;
      const subtotal = Number(ctx.subtotalHours) || 0;
      hours = subtotal * (rule.percent ?? 0);
      if (Number.isFinite(rule.minHours)) hours = Math.max(hours, rule.minHours);
      if (Number.isFinite(rule.maxHours)) hours = Math.min(hours, rule.maxHours);
      break;
    }

    default:
      return 0;
  }

  if (!Number.isFinite(hours)) return 0;
  return round2(Math.max(0, hours));
}

/**
 * Multiplicador aportado por una regla. Elemento neutro: 1.
 */
export function evaluateMultiplier(rule, value) {
  if (!rule || typeof rule !== 'object') return 1;

  let factor = 1;

  switch (rule.type) {
    case 'flagMultiplier':
      factor = value === true ? rule.whenTrue ?? 1 : rule.whenFalse ?? 1;
      break;

    case 'mapMultiplier': {
      const map = rule.map || {};
      factor = Object.prototype.hasOwnProperty.call(map, value) ? map[value] : 1;
      break;
    }

    default:
      return 1;
  }

  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return factor;
}
