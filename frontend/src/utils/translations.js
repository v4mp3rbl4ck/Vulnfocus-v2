export const translations = {
  es: {
    nav: {
      services: 'Servicios',
      methodology: 'Metodología',
      resources: 'Recursos',
      process: 'Proceso',
      certifications: 'Certificaciones',
      contact: 'Contactar'
    },
    hero: {
      title: 'Pentesting profesional para Web, API e Infraestructura',
      subtitle: 'Simulaciones realistas, reportes accionables, priorización por riesgo y acompañamiento en remediación.',
      ctaPrimary: 'Solicitar propuesta',
      ctaSecondary: 'Ver servicios',
      badges: ['OWASP Top 10', 'APIs', 'Infraestructura', 'Pentesting', 'Ethical Hacking'],
      whatYouGet: 'Lo que obtienes',
      benefits: [
        'Alcance y reglas claras',
        'Evidencias y pasos de reproducción',
        'Severidad (CVSS/impacto)',
        'Recomendaciones concretas',
        'Re-test incluido (opcional)'
      ],
      timeframe: 'Tiempo típico: 3–15 días según alcance.'
    },
    services: {
      title: 'Servicios',
      items: [
        {
          title: 'Pentesting de APIs',
          description: 'Evaluación de APIs REST y GraphQL para detectar fallas de acceso indebido a datos, problemas de autenticación, validaciones incorrectas y debilidades que puedan comprometer la información de tu negocio.'
        },
        {
          title: 'Ethical Hacking (Web & Apps)',
          description: 'Simulación de ataques reales para evaluar seguridad y privacidad en aplicaciones web y móviles.'
        },
        {
          title: 'Ethical Hacking (Infraestructura)',
          description: 'Evaluación de entornos On-Premise y Cloud para identificar riesgos en red, servidores y configuraciones críticas.'
        },
        {
          title: 'Phishing e Ingeniería Social Controlada',
          description: 'Simulaciones realistas para medir la exposición humana al riesgo, generar métricas accionables y fortalecer la cultura de ciberseguridad.'
        },
        {
          title: 'Threat Hunting',
          description: 'Búsqueda proactiva de amenazas desconocidas y en curso en tu red. Identificamos indicadores de compromiso (IoC), movimientos laterales y actividad maliciosa que evade las defensas tradicionales.'
        }
      ]
    },
    methodology: {
      title: 'Metodologías',
      intro: 'Los servicios de evaluación de seguridad se ejecutan bajo marcos metodológicos reconocidos internacionalmente, garantizando un enfoque estructurado, reproducible y alineado a estándares de la industria.',
      frameworks: [
        {
          name: 'PTES (Penetration Testing Execution Standard)',
          description: 'Marco integral que define las fases y buenas prácticas para la ejecución profesional de pruebas de penetración.'
        },
        {
          name: 'OWASP Testing Guide',
          description: 'Referencia internacional para evaluación de aplicaciones web y APIs, enfocada en vulnerabilidades críticas y riesgos actuales.'
        },
        {
          name: 'OWASP Top 10',
          description: 'Clasificación de las vulnerabilidades más críticas en aplicaciones web, utilizada como base de priorización de riesgos.'
        },
        {
          name: 'OWASP API Security Top 10',
          description: 'Estándar específico para la evaluación de APIs modernas (REST y GraphQL).'
        },
        {
          name: 'NIST SP 800-115',
          description: 'Guía técnica para pruebas de seguridad y evaluación de controles.'
        }
      ],
      footer: 'Las pruebas se realizan bajo reglas de enfrentamiento (RoE) definidas por contrato, con enfoque ético, controlado y orientado a la reducción real del riesgo.'
    },
    deliverables: {
      title: 'Entregables',
      items: [
        {
          title: 'Reporte Ejecutivo',
          description: 'Impacto, riesgos y roadmap para dirección.'
        },
        {
          title: 'Reporte Técnico',
          description: 'PoC, evidencias, pasos reproducibles, mitigaciones.'
        },
        {
          title: 'Matriz de Riesgos',
          description: 'Severidad, prioridad, responsable, estado.'
        },
        {
          title: 'Sesión de cierre',
          description: 'Walkthrough del reporte y recomendaciones.'
        }
      ]
    },
    faq: {
      title: 'FAQ',
      items: [
        {
          question: '¿Necesito dar acceso a producción?',
          answer: 'Depende del alcance. Idealmente se trabaja sobre ambientes de staging o QA, pero si el objetivo es evaluar el entorno real, se coordinan accesos controlados con reglas de enfrentamiento claras para minimizar impacto.'
        },
        {
          question: '¿Trabajas con NDA?',
          answer: 'Sí, todos los proyectos incluyen acuerdos de confidencialidad (NDA) para proteger la información sensible de tu organización.'
        },
        {
          question: '¿Cómo calculas el precio?',
          answer: 'El precio se calcula según el alcance: cantidad de endpoints, sistemas, complejidad técnica y tiempo estimado. Solicita una propuesta personalizada sin compromiso.'
        }
      ]
    },
    contact: {
      title: 'Contacto',
      subtitle: 'Cuéntame tu alcance y te envío una propuesta.',
      form: {
        name: 'Nombre',
        email: 'Email',
        company: 'Empresa (opcional)',
        message: 'Mensaje',
        submit: 'Enviar'
      },
      channels: {
        email: 'Email',
        whatsapp: 'WhatsApp',
        linkedin: 'LinkedIn',
        telegram: 'Telegram',
        phone: 'Teléfono'
      }
    },
    footer: {
      rights: 'Todos los derechos reservados.',
      tagline: 'Puede que no tengas nada que ocultar. Pero sí tienes todo que proteger. — Kevin D. Mitnick'
    },
    process: {
      title: 'Proceso de Implementación',
      subtitle: 'Proceso claro y estructurado en 5 fases para garantizar resultados efectivos',
      steps: [
        {
          title: 'Contacto Inicial',
          description: 'Nos contactas a través del formulario, email o WhatsApp. Agendamos una llamada para entender tu contexto, necesidades y objetivos de seguridad.',
          duration: '1-2 días'
        },
        {
          title: 'Definición de Alcance',
          description: 'Definimos juntos el alcance: sistemas a evaluar, credenciales necesarias, reglas de enfrentamiento (RoE) y objetivos específicos. Firmamos NDA y contrato.',
          duration: '2-3 días'
        },
        {
          title: 'Ejecución del Pentesting',
          description: 'Realizamos las pruebas de penetración siguiendo metodologías reconocidas (PTES, OWASP). Documentamos cada hallazgo con evidencias y pasos de reproducción.',
          duration: '3-15 días'
        },
        {
          title: 'Entrega de Reportes',
          description: 'Entregamos reporte ejecutivo y técnico con hallazgos priorizados por severidad (CVSS), recomendaciones específicas y roadmap de remediación.',
          duration: '2-3 días'
        },
        {
          title: 'Remediación y Re-test',
          description: 'Te acompañamos en la implementación de fixes. Una vez aplicados, realizamos re-testing para validar que las vulnerabilidades fueron corregidas efectivamente.',
          duration: '5-10 días'
        }
      ]
    }
  },
  en: {
    nav: {
      services: 'Services',
      methodology: 'Methodology',
      resources: 'Resources',
      process: 'Process',
      certifications: 'Certifications',
      contact: 'Contact'
    },
    hero: {
      title: 'Professional Pentesting for Web, API & Infrastructure',
      subtitle: 'Realistic simulations, actionable reports, risk prioritization and remediation support.',
      ctaPrimary: 'Request proposal',
      ctaSecondary: 'View services',
      badges: ['OWASP Top 10', 'APIs', 'Infrastructure', 'Pentesting', 'Ethical Hacking'],
      whatYouGet: 'What you get',
      benefits: [
        'Clear scope and rules',
        'Evidence and reproduction steps',
        'Severity (CVSS/impact)',
        'Concrete recommendations',
        'Re-test included (optional)'
      ],
      timeframe: 'Typical time: 3–15 days depending on scope.'
    },
    services: {
      title: 'Services',
      items: [
        {
          title: 'API Pentesting',
          description: 'Evaluation of REST and GraphQL APIs to detect unauthorized data access, authentication issues, incorrect validations and weaknesses that could compromise your business information.'
        },
        {
          title: 'Ethical Hacking (Web & Apps)',
          description: 'Real attack simulation to evaluate security and privacy in web and mobile applications.'
        },
        {
          title: 'Ethical Hacking (Infrastructure)',
          description: 'Evaluation of On-Premise and Cloud environments to identify risks in network, servers and critical configurations.'
        },
        {
          title: 'Controlled Phishing & Social Engineering',
          description: 'Realistic simulations to measure human exposure to risk, generate actionable metrics and strengthen cybersecurity culture.'
        },
        {
          title: 'Threat Hunting',
          description: 'Proactive search for unknown and ongoing threats in your network. We identify indicators of compromise (IoC), lateral movements and malicious activity that evades traditional defenses.'
        }
      ]
    },
    methodology: {
      title: 'Methodologies',
      intro: 'Security assessment services are executed under internationally recognized methodological frameworks, ensuring a structured, reproducible approach aligned with industry standards.',
      frameworks: [
        {
          name: 'PTES (Penetration Testing Execution Standard)',
          description: 'Comprehensive framework that defines the phases and best practices for professional penetration testing execution.'
        },
        {
          name: 'OWASP Testing Guide',
          description: 'International reference for web application and API assessment, focused on critical vulnerabilities and current risks.'
        },
        {
          name: 'OWASP Top 10',
          description: 'Classification of the most critical vulnerabilities in web applications, used as a basis for risk prioritization.'
        },
        {
          name: 'OWASP API Security Top 10',
          description: 'Specific standard for evaluating modern APIs (REST and GraphQL).'
        },
        {
          name: 'NIST SP 800-115',
          description: 'Technical guide for security testing and control evaluation.'
        }
      ],
      footer: 'Tests are conducted under Rules of Engagement (RoE) defined by contract, with an ethical, controlled approach oriented to real risk reduction.'
    },
    deliverables: {
      title: 'Deliverables',
      items: [
        {
          title: 'Executive Report',
          description: 'Impact, risks and roadmap for management.'
        },
        {
          title: 'Technical Report',
          description: 'PoC, evidence, reproducible steps, mitigations.'
        },
        {
          title: 'Risk Matrix',
          description: 'Severity, priority, responsible, status.'
        },
        {
          title: 'Closing Session',
          description: 'Report walkthrough and recommendations.'
        }
      ]
    },
    faq: {
      title: 'FAQ',
      items: [
        {
          question: 'Do I need to provide production access?',
          answer: 'It depends on the scope. Ideally we work on staging or QA environments, but if the objective is to evaluate the real environment, controlled access is coordinated with clear rules of engagement to minimize impact.'
        },
        {
          question: 'Do you work with NDA?',
          answer: 'Yes, all projects include non-disclosure agreements (NDA) to protect your organization\'s sensitive information.'
        },
        {
          question: 'How do you calculate pricing?',
          answer: 'Pricing is calculated based on scope: number of endpoints, systems, technical complexity and estimated time. Request a personalized proposal with no obligation.'
        }
      ]
    },
    contact: {
      title: 'Contact',
      subtitle: 'Tell me about your scope and I\'ll send you a proposal.',
      form: {
        name: 'Name',
        email: 'Email',
        company: 'Company (optional)',
        message: 'Message',
        submit: 'Send'
      },
      channels: {
        email: 'Email',
        whatsapp: 'WhatsApp',
        linkedin: 'LinkedIn',
        telegram: 'Telegram',
        phone: 'Phone'
      }
    },
    footer: {
      rights: 'All rights reserved.',
      tagline: 'You may have nothing to hide. But you have everything to protect. — Kevin D. Mitnick'
    },
    process: {
      title: 'Implementation Process',
      subtitle: 'Clear and structured 5-phase process to ensure effective results',
      steps: [
        {
          title: 'Initial Contact',
          description: 'Contact us through the form, email, or WhatsApp. We schedule a call to understand your context, needs, and security objectives.',
          duration: '1-2 days'
        },
        {
          title: 'Scope Definition',
          description: 'We jointly define the scope: systems to evaluate, required credentials, rules of engagement (RoE), and specific objectives. We sign NDA and contract.',
          duration: '2-3 days'
        },
        {
          title: 'Pentesting Execution',
          description: 'We perform penetration testing following recognized methodologies (PTES, OWASP). We document each finding with evidence and reproduction steps.',
          duration: '3-15 days'
        },
        {
          title: 'Report Delivery',
          description: 'We deliver executive and technical reports with findings prioritized by severity (CVSS), specific recommendations, and remediation roadmap.',
          duration: '2-3 days'
        },
        {
          title: 'Remediation & Re-test',
          description: 'We support you in implementing fixes. Once applied, we perform re-testing to validate that vulnerabilities were effectively corrected.',
          duration: '5-10 days'
        }
      ]
    }
  }
};
