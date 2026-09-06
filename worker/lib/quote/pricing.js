/**
 * PRICING ENGINE — de horas a rango económico.
 *
 * Quinta etapa, y la única que puede quedar DESACTIVADA. Si la tarifa por hora
 * no está configurada, o si `PRICING_ENABLED` no está a "true", devuelve
 * `available: false` y la cotización se entrega igual, con esfuerzo y duración
 * pero sin importes. Es la alternativa correcta a inventar un precio.
 *
 * El cálculo es SIEMPRE server-side. Nada de lo que envíe el navegador
 * (importes, descuentos, horas) entra en esta función: solo entran las horas
 * que ha calculado el motor de esfuerzo.
 */

/** Redondeo comercial hacia arriba al múltiplo declarado. */
function roundUpTo(amount, step) {
  if (!Number.isFinite(step) || step <= 0) return Math.ceil(amount);
  return Math.ceil(amount / step) * step;
}

/** Descuento aplicable por número de servicios contratados a la vez. */
export function multiServiceDiscount(serviceCount, config) {
  const rules = config.pricing?.discounts?.multiService || [];
  return rules
    .filter((r) => serviceCount >= r.minServices)
    .reduce((best, r) => Math.max(best, r.rate || 0), 0);
}

/**
 * @param {{minHours: number, maxHours: number}} effort
 * @param {string} currency
 * @param {number} serviceCount
 * @param {object} config    QUOTE_CONFIG
 * @param {object} env       Bindings del Worker (PRICING_ENABLED)
 */
export function computePricing(effort, currency, serviceCount, config, env = {}) {
  const enabledByEnv = String(env.PRICING_ENABLED || '').toLowerCase() === 'true';
  const money = config.pricing?.currencies?.[currency];

  if (!config.pricing?.enabled || !enabledByEnv) {
    return { available: false, reason: 'disabled', currency };
  }
  if (!money || !Number.isFinite(money.hourlyRate) || money.hourlyRate <= 0) {
    // REQUIERE CONFIGURACIÓN DEL PROPIETARIO: tarifa por hora sin definir.
    return { available: false, reason: 'not-configured', currency };
  }

  const margin = Number.isFinite(config.pricing.margin) ? config.pricing.margin : 1;
  const discount = multiServiceDiscount(serviceCount, config);

  const gross = (hours) => hours * money.hourlyRate * margin;

  let minAmount = gross(effort.minHours) * (1 - discount);
  let maxAmount = gross(effort.maxHours) * (1 - discount);

  // Mínimo comercial: se aplica DESPUÉS del descuento, para que un descuento no
  // pueda dejar el proyecto por debajo del suelo de rentabilidad.
  if (Number.isFinite(money.minimumAmount) && money.minimumAmount > 0) {
    minAmount = Math.max(minAmount, money.minimumAmount);
    maxAmount = Math.max(maxAmount, money.minimumAmount);
  }

  const taxRate = Number.isFinite(money.taxRate) ? money.taxRate : 0;
  const taxIncluded = money.taxIncluded === true;
  if (!taxIncluded && taxRate > 0) {
    minAmount *= 1 + taxRate;
    maxAmount *= 1 + taxRate;
  }

  minAmount = roundUpTo(minAmount, money.roundTo);
  maxAmount = roundUpTo(maxAmount, money.roundTo);
  if (maxAmount < minAmount) maxAmount = minAmount;

  return {
    available: true,
    currency,
    min: minAmount,
    max: maxAmount,
    taxIncluded: taxRate > 0,
    taxLabel: money.taxLabel || '',
    taxRate,
    discountRate: discount,
    locale: money.locale || 'es-CL',
    decimals: money.decimals ?? 0,
  };
}
