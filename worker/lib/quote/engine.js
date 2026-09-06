/**
 * MOTOR DE COTIZACIÓN — orquestador.
 *
 *   INPUT → NORMALIZATION → SCOPE → COMPLEXITY → EFFORT → PRICING → QUOTE
 *
 * Todo ocurre en el Worker. El navegador solo envía respuestas del formulario;
 * horas, precios, descuentos y estado que llegaran en el cuerpo se ignoran por
 * construcción (el normalizador no los lee).
 *
 * La salida está pensada para ser mostrada tal cual: NO incluye tarifas,
 * multiplicadores, horas base ni el desglose interno. Ese desglose sí se guarda
 * en D1 para poder auditar por qué salió una cifra.
 */

import { QUOTE_CONFIG } from '../../config/quote-config.js';
import { computeEffort } from './effort.js';
import { computePricing } from './pricing.js';
import { normalizeQuoteInput } from './normalize.js';

/** Monedas admitidas por la configuración actual. */
export function allowedCurrencies(config = QUOTE_CONFIG) {
  return Object.keys(config.pricing?.currencies || { CLP: {} });
}

/**
 * Qué incluye la propuesta. Son claves, no frases: el texto lo pone el
 * frontend en el idioma del visitante.
 */
function buildIncludes(input) {
  const includes = [
    'manual_testing',
    'executive_report',
    'technical_report',
    'evidence',
    'cvss',
    'recommendations',
  ];
  if (input.context.executive_session) includes.push('closing_meeting');
  if (input.context.retest) includes.push('retesting');
  return includes;
}

/**
 * Calcula una cotización completa a partir de una entrada YA normalizada.
 * @param {object} input   normalizeQuoteInput().data
 * @param {object} env     Bindings del Worker
 * @param {object} config  QUOTE_CONFIG (inyectable para tests)
 */
export function buildQuote(input, env = {}, config = QUOTE_CONFIG) {
  const effort = computeEffort(input, config);
  const pricing = computePricing(effort, input.currency, input.services.length, config, env);

  return {
    services: input.services,
    complexity: effort.complexity,
    effort: {
      minHours: effort.minHours,
      maxHours: effort.maxHours,
      minDays: effort.minDays,
      maxDays: effort.maxDays,
    },
    pricing,
    includes: buildIncludes(input),
    validityDays: config.validityDays,
    engineVersion: config.version,

    /**
     * Desglose interno. Se persiste en D1 y se usa en las notificaciones
     * internas, pero NO se devuelve al navegador: lo recorta
     * `publicQuoteView()` antes de responder.
     */
    internal: {
      totalHours: effort.totalHours,
      servicesSubtotal: effort.servicesSubtotal,
      contextExtra: effort.contextExtra,
      contextMultiplier: effort.contextMultiplier,
      contextBreakdown: effort.contextBreakdown,
      perService: effort.perService.map((s) => ({
        serviceId: s.serviceId,
        baseHours: s.scope.baseHours,
        scopeHours: s.scope.scopeHours,
        complexityMultiplier: s.complexity.multiplier,
        complexityExtraHours: s.complexity.extraHours,
        hours: s.hours,
        breakdown: s.scope.breakdown,
        factors: s.complexity.factors,
      })),
    },
  };
}

/** Vista que sí puede viajar al navegador. */
export function publicQuoteView(quote, meta = {}) {
  const { internal, ...rest } = quote;
  return {
    ...rest,
    ...meta,
    // El rango económico se recalcula siempre en el servidor; el navegador solo
    // recibe el resultado, nunca los parámetros con los que se obtuvo.
    pricing: quote.pricing.available
      ? {
          available: true,
          currency: quote.pricing.currency,
          min: quote.pricing.min,
          max: quote.pricing.max,
          taxIncluded: quote.pricing.taxIncluded,
          taxLabel: quote.pricing.taxLabel,
          locale: quote.pricing.locale,
          decimals: quote.pricing.decimals,
        }
      : { available: false },
  };
}

export { normalizeQuoteInput, QUOTE_CONFIG };
