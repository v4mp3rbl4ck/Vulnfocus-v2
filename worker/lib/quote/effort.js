/**
 * EFFORT ENGINE — de alcance y complejidad a horas, banda y duración.
 *
 * Cuarta etapa. Aquí se aplican los límites globales: mínimo comercial de
 * horas, techo absoluto y acotado del multiplicador. Sin ellos, una respuesta
 * extrema del formulario podría producir una cifra absurda.
 */

import { computeComplexity } from './complexity.js';
import { computeScope } from './scope.js';
import { evaluateHours, evaluateMultiplier, round2 } from './rules.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Etiqueta mostrada al cliente: LOW | MEDIUM | HIGH. */
export function complexityLabel(totalHours, multiplier, config) {
  const { low, high } = config.effort.complexityLabels;
  if (totalHours >= high.minHours || multiplier >= high.minMultiplier) return 'HIGH';
  if (totalHours <= low.maxHours && multiplier <= low.maxMultiplier) return 'LOW';
  return 'MEDIUM';
}

/**
 * @param {object} input   Salida de normalizeQuoteInput().data
 * @param {object} config  QUOTE_CONFIG
 */
export function computeEffort(input, config) {
  // --- Por servicio -------------------------------------------------------
  const perService = input.services.map((serviceId) => {
    const answers = input.scope[serviceId] || {};
    const scope = computeScope(serviceId, answers, config);
    const complexity = computeComplexity(serviceId, answers, config);
    const hours = round2((scope.subtotalHours + complexity.extraHours) * complexity.multiplier);
    return { serviceId, scope, complexity, hours };
  });

  const servicesSubtotal = round2(perService.reduce((acc, s) => acc + s.hours, 0));

  // --- Contexto: horas y multiplicadores globales -------------------------
  const onlyServices = new Set(input.services);
  const contextHours = [];
  let contextExtra = 0;
  let contextMultiplier = 1;

  for (const [key, entry] of Object.entries(config.effort.context || {})) {
    // Una opción puede no tener sentido para la combinación elegida (por
    // ejemplo, retesting de un retesting).
    if (
      Array.isArray(entry.skipWhenOnlyServices) &&
      entry.skipWhenOnlyServices.length > 0 &&
      onlyServices.size === entry.skipWhenOnlyServices.length &&
      entry.skipWhenOnlyServices.every((s) => onlyServices.has(s))
    ) {
      continue;
    }

    const value = input.context[key];

    if (entry.appliesTo === 'multiplier') {
      const factor = evaluateMultiplier(entry.rule, value);
      if (factor !== 1) contextHours.push({ key, multiplier: factor });
      contextMultiplier *= factor;
    } else {
      const hours = evaluateHours(entry.rule, value, { subtotalHours: servicesSubtotal });
      if (hours > 0) contextHours.push({ key, hours });
      contextExtra += hours;
    }
  }

  contextExtra = round2(contextExtra);
  contextMultiplier = round2(contextMultiplier);

  // --- Total --------------------------------------------------------------
  const { min: minMul, max: maxMul } = config.effort.multiplierRange;
  const aggregateMultiplier = clamp(contextMultiplier, minMul, maxMul);

  let totalHours = (servicesSubtotal + contextExtra) * aggregateMultiplier;
  totalHours = clamp(Math.ceil(totalHours), config.effort.minHours, config.effort.maxHours);

  // Multiplicador efectivo agregado, útil para la etiqueta de complejidad.
  const effectiveMultiplier = round2(
    perService.reduce((acc, s) => Math.max(acc, s.complexity.multiplier), 1) * aggregateMultiplier,
  );

  const { lower, upper } = config.effort.band;
  const minHours = clamp(Math.ceil(totalHours * lower), config.effort.minHours, totalHours);
  const maxHours = clamp(Math.ceil(totalHours * upper), totalHours, config.effort.maxHours);

  const hoursPerDay = config.hoursPerDay || 8;
  const minDays = Math.max(1, Math.ceil(minHours / hoursPerDay));
  const maxDays = Math.max(minDays, Math.ceil(maxHours / hoursPerDay));

  return {
    perService,
    servicesSubtotal,
    contextExtra,
    contextMultiplier: aggregateMultiplier,
    contextBreakdown: contextHours,
    totalHours,
    minHours,
    maxHours,
    minDays,
    maxDays,
    complexity: complexityLabel(totalHours, effectiveMultiplier, config),
  };
}
