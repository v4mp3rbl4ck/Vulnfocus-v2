/**
 * CONFIGURACIÓN COMERCIAL DEL COTIZADOR.
 *
 * Este fichero es el ÚNICO sitio donde se tocan horas, factores, tarifas,
 * mínimos, descuentos, impuestos y moneda. El motor
 * (worker/lib/quote/*) no contiene ni un número de negocio: solo sabe
 * interpretar los tipos de regla declarados aquí. Cambiar precios NO requiere
 * tocar código, ni del Worker ni de React.
 *
 * NUNCA llega al navegador: vive dentro del bundle del Worker y solo se usa
 * server-side. El frontend recibe el resultado ya calculado.
 *
 * -------------------------------------------------------------------------
 * REQUIERE CONFIGURACIÓN DEL PROPIETARIO
 *
 *   pricing.currencies.CLP.hourlyRate     → tarifa por hora en CLP
 *   pricing.currencies.CLP.minimumAmount  → mínimo comercial en CLP
 *   pricing.currencies.USD.hourlyRate     → tarifa por hora en USD
 *   pricing.currencies.USD.minimumAmount  → mínimo comercial en USD
 *
 * Mientras estén a `null`, o mientras la variable de entorno PRICING_ENABLED
 * no valga "true", la API devuelve esfuerzo y duración pero OMITE el rango
 * económico. Es deliberado: inventar un precio sería peor que no darlo.
 *
 * Las HORAS sí traen valores de partida razonables para que el motor funcione
 * desde el primer día. Son revisables: son estimaciones de esfuerzo técnico,
 * no compromisos comerciales.
 * -------------------------------------------------------------------------
 *
 * Tipos de regla admitidos por el motor:
 *
 *   HORAS
 *     { type: 'perUnitAbove', above, hoursPerUnit, maxHours }  número
 *     { type: 'tiers', tiers: [{ upTo, hours }] }              número (upTo null = resto)
 *     { type: 'map', map: { valor: horas } }                   select
 *     { type: 'flag', whenTrue, whenFalse }                    boolean
 *     { type: 'perSelected', hours: { valor: horas } }         multiselect
 *     { type: 'percentOfSubtotal', percent, minHours, maxHours }
 *
 *   MULTIPLICADORES
 *     { type: 'flagMultiplier', whenTrue, whenFalse }          boolean
 *     { type: 'mapMultiplier', map: { valor: factor } }        select
 */

export const QUOTE_CONFIG = {
  version: '1.0.0',

  /** Conversión de horas a días de trabajo para la duración presentada. */
  hoursPerDay: 6,

  /** Días naturales que la estimación se considera vigente. */
  validityDays: 30,

  effort: {
    /** Suelo y techo del resultado final, en horas. */
    minHours: 16,
    maxHours: 200,

    /** Límites del multiplicador de complejidad agregado. */
    multiplierRange: { min: 1, max: 2 },

    /** Banda presentada al cliente alrededor del esfuerzo calculado. */
    band: { lower: 0.7, upper: 1.2 },

    /** Umbrales de la etiqueta de complejidad mostrada. */
    complexityLabels: {
      low: { maxHours: 45, maxMultiplier: 1.05 },
      high: { minHours: 100, minMultiplier: 1.2 },
    },

    services: {
      web: {
        baseHours: 16,
        scope: {
          apps: { type: 'perUnitAbove', above: 1, hoursPerUnit: 10, maxHours: 120 },
          roles: { type: 'perUnitAbove', above: 1, hoursPerUnit: 4, maxHours: 40 },
          endpoints: { type: 'map', map: { lt50: 0, '50_150': 8, '150_400': 20, gt400: 36 } },
          api_asociada: { type: 'flag', whenTrue: 8, whenFalse: 0 },
          auth: { type: 'map', map: { none: 0, password: 0, mfa: 2, sso: 4 } },
          stack: {
            type: 'perSelected',
            hours: { spa: 0, server_rendered: 0, cms: 2, legacy: 4, microservices: 4 },
          },
        },
        complexity: {
          waf: { type: 'flagMultiplier', whenTrue: 1.12, whenFalse: 1 },
          environment: { type: 'mapMultiplier', map: { staging: 1, production: 1.1, both: 1.15 } },
        },
      },

      api: {
        baseHours: 12,
        scope: {
          endpoints: {
            type: 'tiers',
            tiers: [
              { upTo: 20, hours: 0 },
              { upTo: 50, hours: 6 },
              { upTo: 150, hours: 16 },
              { upTo: 400, hours: 30 },
              { upTo: null, hours: 48 },
            ],
          },
          roles: { type: 'perUnitAbove', above: 1, hoursPerUnit: 4, maxHours: 40 },
          api_type: { type: 'perSelected', hours: { rest: 0, graphql: 6, grpc: 6, soap: 4 } },
          auth: { type: 'map', map: { none: 0, apikey: 0, token: 2, mtls: 4 } },
          openapi: { type: 'flag', whenTrue: 0, whenFalse: 6 },
          integrations: { type: 'map', map: { none: 0, few: 4, many: 10 } },
        },
        complexity: {
          environment: { type: 'mapMultiplier', map: { staging: 1, production: 1.1, both: 1.15 } },
        },
      },

      infra_externa: {
        baseHours: 10,
        scope: {
          public_ips: {
            type: 'tiers',
            tiers: [
              { upTo: 8, hours: 0 },
              { upTo: 32, hours: 6 },
              { upTo: 128, hours: 14 },
              { upTo: 512, hours: 26 },
              { upTo: null, hours: 40 },
            ],
          },
          domains: {
            type: 'tiers',
            tiers: [
              { upTo: 3, hours: 0 },
              { upTo: 10, hours: 4 },
              { upTo: 50, hours: 10 },
              { upTo: null, hours: 18 },
            ],
          },
          exposed_services: { type: 'map', map: { lt20: 0, '20_100': 8, gt100: 18 } },
          vpn: { type: 'flag', whenTrue: 4, whenFalse: 0 },
        },
        complexity: {
          hosting: { type: 'mapMultiplier', map: { cloud: 1, onprem: 1.05, hybrid: 1.1 } },
        },
      },

      infra_interna: {
        baseHours: 16,
        scope: {
          hosts: {
            type: 'tiers',
            tiers: [
              { upTo: 50, hours: 0 },
              { upTo: 250, hours: 10 },
              { upTo: 1000, hours: 24 },
              { upTo: 5000, hours: 44 },
              { upTo: null, hours: 70 },
            ],
          },
          segments: { type: 'perUnitAbove', above: 1, hoursPerUnit: 3, maxHours: 30 },
          servers: {
            type: 'tiers',
            tiers: [
              { upTo: 10, hours: 0 },
              { upTo: 50, hours: 8 },
              { upTo: 200, hours: 18 },
              { upTo: null, hours: 30 },
            ],
          },
          sites: { type: 'perUnitAbove', above: 1, hoursPerUnit: 6, maxHours: 48 },
        },
        complexity: {
          access: { type: 'mapMultiplier', map: { vpn: 1, device: 1, onsite: 1.15 } },
        },
      },

      active_directory: {
        baseHours: 20,
        scope: {
          users: {
            type: 'tiers',
            tiers: [
              { upTo: 200, hours: 0 },
              { upTo: 1000, hours: 8 },
              { upTo: 5000, hours: 18 },
              { upTo: 20000, hours: 32 },
              { upTo: null, hours: 48 },
            ],
          },
          endpoints: {
            type: 'tiers',
            tiers: [
              { upTo: 200, hours: 0 },
              { upTo: 1000, hours: 6 },
              { upTo: 5000, hours: 14 },
              { upTo: null, hours: 24 },
            ],
          },
          servers: {
            type: 'tiers',
            tiers: [
              { upTo: 10, hours: 0 },
              { upTo: 50, hours: 6 },
              { upTo: 200, hours: 14 },
              { upTo: null, hours: 24 },
            ],
          },
          domains: { type: 'perUnitAbove', above: 1, hoursPerUnit: 8, maxHours: 40 },
          trusts: { type: 'flag', whenTrue: 8, whenFalse: 0 },
          sites: { type: 'perUnitAbove', above: 1, hoursPerUnit: 4, maxHours: 32 },
        },
        complexity: {
          access: { type: 'mapMultiplier', map: { vpn: 1, device: 1, onsite: 1.12 } },
        },
      },

      mobile: {
        baseHours: 8,
        scope: {
          platforms: { type: 'perSelected', hours: { android: 10, ios: 12 } },
          backend: { type: 'flag', whenTrue: 14, whenFalse: 0 },
          auth: { type: 'map', map: { none: 0, password: 0, mfa: 3, biometric: 5 } },
          builds: { type: 'map', map: { package: 0, store: 6, source: 0 } },
        },
        complexity: {},
      },

      cloud: {
        baseHours: 8,
        scope: {
          providers: { type: 'perSelected', hours: { aws: 8, azure: 8, gcp: 8 } },
          accounts: {
            type: 'tiers',
            tiers: [
              { upTo: 2, hours: 0 },
              { upTo: 10, hours: 8 },
              { upTo: 50, hours: 20 },
              { upTo: null, hours: 36 },
            ],
          },
          services: { type: 'map', map: { lt15: 0, '15_40': 8, gt40: 18 } },
          iam_review: { type: 'flag', whenTrue: 10, whenFalse: 0 },
          access: { type: 'map', map: { readonly: 0, limited: 6, none: 12 } },
        },
        complexity: {},
      },

      red_team: {
        baseHours: 24,
        scope: {
          duration_weeks: { type: 'perUnitAbove', above: 0, hoursPerUnit: 32, maxHours: 768 },
          objectives: { type: 'perUnitAbove', above: 1, hoursPerUnit: 12, maxHours: 108 },
          sites: { type: 'perUnitAbove', above: 1, hoursPerUnit: 8, maxHours: 64 },
          components: {
            type: 'perSelected',
            hours: {
              osint: 4,
              phishing: 12,
              physical: 16,
              evasion: 12,
              lateral: 8,
              persistence: 6,
              exfiltration: 6,
            },
          },
        },
        complexity: {},
      },

      retesting: {
        baseHours: 4,
        scope: {
          findings: { type: 'perUnitAbove', above: 0, hoursPerUnit: 1, maxHours: 120 },
          severities: { type: 'perSelected', hours: { critical: 3, high: 2, medium: 1, low: 0 } },
          original_scope: {
            type: 'map',
            map: { web: 0, api: 0, infra: 2, ad: 4, mobile: 2, cloud: 2, other: 2 },
          },
          previous_report: { type: 'flag', whenTrue: 0, whenFalse: 8 },
        },
        complexity: {},
      },
    },

    /**
     * Opciones y contexto: se aplican al conjunto, no a un servicio concreto.
     * `appliesTo: 'subtotal'` = horas; `appliesTo: 'multiplier'` = factor.
     */
    context: {
      retest: {
        appliesTo: 'subtotal',
        rule: { type: 'percentOfSubtotal', percent: 0.15, minHours: 4, maxHours: 40 },
        // Cotizar un retest sobre un retest no tiene sentido.
        skipWhenOnlyServices: ['retesting'],
      },
      executive_session: {
        appliesTo: 'subtotal',
        rule: { type: 'flag', whenTrue: 3, whenFalse: 0 },
      },
      report_language: {
        appliesTo: 'subtotal',
        rule: { type: 'map', map: { es: 0, en: 4, both: 10 } },
      },
      urgency: {
        appliesTo: 'multiplier',
        rule: { type: 'mapMultiplier', map: { normal: 1, soon: 1.05, urgent: 1.15 } },
      },
      out_of_hours: {
        appliesTo: 'multiplier',
        rule: { type: 'flagMultiplier', whenTrue: 1.1, whenFalse: 1 },
      },
    },
  },

  pricing: {
    /**
     * Interruptor maestro. La variable de entorno PRICING_ENABLED = "true"
     * también debe estar activa: hacen falta las dos, para que activar precios
     * sea siempre una decisión consciente y por entorno.
     */
    enabled: true,

    defaultCurrency: 'CLP',

    /** Margen comercial global aplicado antes del mínimo. 1 = sin margen extra. */
    margin: 1,

    currencies: {
      CLP: {
        // REQUIERE CONFIGURACIÓN DEL PROPIETARIO
        hourlyRate: 45000,
        minimumAmount: 2125000,
        taxRate: 0.19,
        taxIncluded: false,
        taxLabel: 'IVA',
        roundTo: 10000,
        decimals: 0,
        locale: 'es-CL',
      },
      USD: {
        // REQUIERE CONFIGURACIÓN DEL PROPIETARIO
        hourlyRate: 50,
        minimumAmount: 2500,
        taxRate: 0.19,
        taxIncluded: false,
        taxLabel: 'IVA',
        roundTo: 100,
        decimals: 0,
        locale: 'en-US',
      },
    },

    /**
     * Descuentos. Se aplican al importe, nunca a las horas: el esfuerzo técnico
     * es el que es, el descuento es una decisión comercial.
     */
    discounts: {
      multiService: [
        { minServices: 2, rate: 0.05 },
        { minServices: 3, rate: 0.08 },
      ],
    },
  },
};

export default QUOTE_CONFIG;
