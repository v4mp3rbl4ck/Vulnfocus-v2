/**
 * COMPLEXITY ENGINE — factores que encarecen el mismo volumen de trabajo.
 *
 * Tercera etapa. Devuelve un multiplicador y las horas fijas asociadas a
 * condiciones concretas (un WAF sin lista blanca, pruebas en producción, acceso
 * presencial…). El multiplicador se acota en el motor de esfuerzo, no aquí.
 */

import { evaluateHours, evaluateMultiplier, round2 } from './rules.js';

/**
 * @returns {{multiplier: number, extraHours: number, factors: Array}}
 */
export function computeComplexity(serviceId, answers, config) {
  const serviceConfig = config.effort.services[serviceId];
  if (!serviceConfig) return { multiplier: 1, extraHours: 0, factors: [] };

  const factors = [];
  let multiplier = 1;
  let extraHours = 0;

  for (const [questionId, rule] of Object.entries(serviceConfig.complexity || {})) {
    const value = answers[questionId];

    if (rule.type === 'flagMultiplier' || rule.type === 'mapMultiplier') {
      const factor = evaluateMultiplier(rule, value);
      if (factor !== 1) factors.push({ key: questionId, multiplier: factor });
      multiplier *= factor;
    } else {
      const hours = evaluateHours(rule, value);
      if (hours > 0) factors.push({ key: questionId, hours });
      extraHours += hours;
    }
  }

  return {
    // Dos decimales: 1.12 * 1.15 en coma flotante da 1.2879999…
    multiplier: round2(multiplier),
    extraHours: round2(extraHours),
    factors,
  };
}
