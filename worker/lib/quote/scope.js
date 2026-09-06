/**
 * SCOPE ENGINE — horas derivadas del volumen declarado.
 *
 * Segunda etapa. Solo mira el "cuánto": aplicaciones, endpoints, hosts,
 * usuarios… Todo lo que es "qué tan difícil" pertenece al motor de complejidad.
 * Separarlos permite explicar al cliente por qué su cotización sube.
 */

import { evaluateHours, round2 } from './rules.js';

/**
 * @param {string} serviceId
 * @param {object} answers   Respuestas ya normalizadas de ese servicio.
 * @param {object} config    QUOTE_CONFIG.
 * @returns {{baseHours: number, scopeHours: number, subtotalHours: number, breakdown: Array}}
 */
export function computeScope(serviceId, answers, config) {
  const serviceConfig = config.effort.services[serviceId];
  if (!serviceConfig) {
    return { baseHours: 0, scopeHours: 0, subtotalHours: 0, breakdown: [] };
  }

  const baseHours = serviceConfig.baseHours || 0;
  const breakdown = [{ key: 'base', hours: baseHours }];

  let scopeHours = 0;
  for (const [questionId, rule] of Object.entries(serviceConfig.scope || {})) {
    const hours = evaluateHours(rule, answers[questionId]);
    if (hours > 0) breakdown.push({ key: questionId, hours });
    scopeHours += hours;
  }

  scopeHours = round2(scopeHours);
  return {
    baseHours,
    scopeHours,
    subtotalHours: round2(baseHours + scopeHours),
    breakdown,
  };
}
