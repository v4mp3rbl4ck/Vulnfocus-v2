/* Textos ES. Fuente única del contenido en castellano de la interfaz. */
export const es = {
  nav: {
    services: 'Servicios',
    process: 'Proceso',
    resources: 'Entregables',
    certifications: 'Marcos',
    contact: 'Contacto',
    quote: 'Cotizar pentest',
    menu: 'Abrir menú',
    close: 'Cerrar menú',
  },

  common: {
    quoteCta: 'Cotizar pentest',
    contactCta: 'Solicitar evaluación',
    viewService: 'Ver servicio',
    viewAllServices: 'Ver todos los servicios',
    backToServices: 'Volver a servicios',
    loading: 'Cargando…',
    required: 'obligatorio',
    optional: 'opcional',
    skipToContent: 'Saltar al contenido',
  },

  hero: {
    eyebrow: 'Offensive Security',
    title: 'Identificamos cómo una vulnerabilidad se convierte en impacto real',
    subtitle:
      'Pentesting manual y simulación adversaria para organizaciones que necesitan validar su exposición real, no una lista de hallazgos sin contexto.',
    ctaPrimary: 'Solicitar evaluación',
    ctaSecondary: 'Cotizar pentest',
    badges: ['Web', 'API', 'Active Directory', 'Cloud', 'Red Team'],
    whatYouGet: 'Lo que recibes',
    benefits: [
      'Alcance y reglas de enfrentamiento por escrito',
      'Explotación validada, no solo hallazgos teóricos',
      'Rutas de ataque hasta el impacto de negocio',
      'Severidad con CVSS y priorización por riesgo real',
      'Retesting de las correcciones aplicadas',
    ],
    timeframe: 'Estimación de esfuerzo en minutos, sin llamada previa.',
  },

  valueProps: {
    title: 'Por qué una evaluación manual',
    items: [
      {
        title: 'Validación, no ruido',
        description:
          'Cada hallazgo se reproduce a mano antes de reportarse. Lo que no se puede demostrar no se reporta como vulnerabilidad.',
      },
      {
        title: 'Encadenamiento',
        description:
          'Tres debilidades medias que juntas dan acceso a datos de clientes valen más que veinte informativas aisladas.',
      },
      {
        title: 'Impacto de negocio',
        description:
          'El informe explica qué pasaría si un atacante hiciera esto mismo mañana, en términos que dirección puede decidir.',
      },
      {
        title: 'Trazabilidad',
        description:
          'Evidencias, pasos de reproducción y referencias a metodologías reconocidas para que tu equipo pueda reproducir y verificar.',
      },
    ],
  },

  servicesSection: {
    title: 'Servicios',
    subtitle:
      'Cada servicio define su objetivo, qué se evalúa, la metodología aplicada y los entregables.',
    intro:
      'Selecciona el tipo de evaluación que necesitas. Si no lo tienes claro, el cotizador te orienta según lo que quieras proteger.',
    detail: {
      objective: 'Objetivo',
      evaluates: 'Qué se evalúa',
      methodology: 'Metodología',
      tests: 'Ejemplos de pruebas',
      deliverables: 'Entregables',
      duration: 'Duración aproximada',
      frameworks: 'Marcos de referencia',
      durationNote:
        'Referencial. La duración real depende del alcance acordado y se fija por escrito antes de empezar.',
      ctaTitle: '¿Necesitas una estimación para este servicio?',
      ctaText:
        'El cotizador calcula esfuerzo y duración a partir del alcance que declares. Toma unos minutos y no compromete a nada.',
    },
  },

  scanVsPentest: {
    title: 'Escaneo de vulnerabilidades y pentesting manual no son lo mismo',
    intro:
      'Un escáner enumera lo conocido. Una evaluación manual demuestra qué se puede llegar a hacer con ello. VulnFocus no se limita a ejecutar herramientas: el escaneo es el punto de partida, no el entregable.',
    scanTitle: 'Escaneo automatizado',
    scanItems: [
      'Detecta patrones conocidos y versiones vulnerables',
      'No entiende la lógica de negocio de tu aplicación',
      'No distingue un permiso mal puesto de uno correcto',
      'Genera falsos positivos que alguien tiene que descartar',
      'Se detiene en el hallazgo, no llega al impacto',
    ],
    pentestTitle: 'Pentesting manual',
    pentestItems: [
      'Parte del escaneo y sigue donde la herramienta se detiene',
      'Prueba control de acceso entre roles y usuarios reales',
      'Encadena debilidades hasta una ruta de ataque completa',
      'Cada hallazgo se reproduce antes de reportarse',
      'Concluye en el impacto de negocio y su remediación',
    ],
    flowTitle: 'De la superficie al impacto',
    flow: [
      { step: 'Discovery', description: 'Enumeración de todo lo alcanzable, no solo de lo declarado.' },
      { step: 'Attack Surface', description: 'Qué está expuesto, con qué privilegios y para quién.' },
      { step: 'Manual Validation', description: 'Descarte de falsos positivos y prueba manual de cada candidato.' },
      { step: 'Exploitation', description: 'Explotación controlada dentro de las reglas de enfrentamiento.' },
      { step: 'Attack Path', description: 'Encadenamiento de debilidades hasta el objetivo.' },
      { step: 'Impact', description: 'Qué datos, procesos o cuentas quedan comprometidos.' },
      { step: 'Remediation', description: 'Corrección concreta, priorizada y aplicable.' },
      { step: 'Retesting', description: 'Verificación de que el arreglo cierra el hallazgo.' },
    ],
    footer:
      'Las pruebas se ejecutan bajo reglas de enfrentamiento acordadas por contrato, con enfoque controlado y orientado a reducir riesgo real.',
  },

  deliverables: {
    title: 'Qué recibe el cliente',
    subtitle:
      'El entregable de una evaluación es un informe que se puede leer en dirección y ejecutar en ingeniería.',
    items: [
      {
        title: 'Informe ejecutivo',
        description:
          'Resumen de exposición, riesgo agregado y decisiones recomendadas. Escrito para quien aprueba presupuesto, no para quien parchea.',
      },
      {
        title: 'Informe técnico',
        description:
          'Un apartado por hallazgo: descripción, causa raíz, pasos de reproducción, evidencia y corrección concreta.',
      },
      {
        title: 'Evidencias',
        description:
          'Capturas, peticiones y respuestas, y datos suficientes para que tu equipo reproduzca el hallazgo sin depender de nosotros.',
      },
      {
        title: 'Severidad CVSS',
        description:
          'Vector CVSS por hallazgo y una priorización que además considera explotabilidad y contexto de negocio.',
      },
      {
        title: 'Rutas de ataque',
        description:
          'Diagrama de cómo se encadenan las debilidades desde el punto de entrada hasta el impacto final.',
      },
      {
        title: 'Recomendaciones',
        description:
          'Corrección específica para tu tecnología, con alternativas cuando el arreglo ideal no sea viable a corto plazo.',
      },
      {
        title: 'Reunión de cierre',
        description:
          'Sesión de revisión del informe con los equipos técnicos y de negocio, y resolución de dudas de remediación.',
      },
      {
        title: 'Retesting',
        description:
          'Verificación de las correcciones aplicadas y acta de cierre por hallazgo, cuando el alcance lo incluye.',
      },
    ],
    sampleTitle: 'Informe de ejemplo',
    sampleText:
      'Un informe de ejemplo anonimizado permite revisar formato, profundidad y nivel de detalle antes de contratar. Solicítalo indicando tu organización y el tipo de evaluación que te interesa.',
    sampleCta: 'Solicitar informe de ejemplo',
    samplePending: 'Disponible bajo petición.',
  },

  methodology: {
    title: 'Marcos metodológicos',
    intro:
      'Las evaluaciones se ejecutan sobre marcos reconocidos internacionalmente, de modo que el alcance sea reproducible y auditable y no dependa del criterio de una sola persona.',
    frameworks: [
      {
        name: 'PTES',
        description:
          'Penetration Testing Execution Standard: fases y buenas prácticas de ejecución de una prueba de intrusión.',
      },
      {
        name: 'OWASP WSTG',
        description:
          'Web Security Testing Guide: catálogo de pruebas para aplicaciones web, de autenticación a lógica de negocio.',
      },
      {
        name: 'OWASP ASVS',
        description:
          'Application Security Verification Standard: niveles de verificación usados como criterio de cobertura.',
      },
      {
        name: 'OWASP API Security Top 10',
        description: 'Riesgos específicos de APIs modernas: BOLA, BFLA, exposición de datos y consumo sin límites.',
      },
      {
        name: 'OWASP MASVS / MASTG',
        description: 'Verificación y guía de pruebas para aplicaciones móviles Android e iOS.',
      },
      {
        name: 'MITRE ATT&CK',
        description:
          'Matriz de tácticas y técnicas adversarias, usada para estructurar ejercicios Red Team y medir detección.',
      },
      {
        name: 'NIST SP 800-115',
        description: 'Guía técnica de pruebas de seguridad y evaluación de controles.',
      },
      {
        name: 'CIS Benchmarks',
        description: 'Líneas base de configuración segura para sistemas, servicios y proveedores cloud.',
      },
      {
        name: 'CVSS',
        description: 'Sistema de puntuación de severidad usado como base de la priorización de hallazgos.',
      },
    ],
    footer:
      'Aplicar un marco es una decisión de cobertura, no una certificación. Las certificaciones profesionales del equipo se declaran por separado y solo cuando están vigentes.',
  },

  process: {
    title: 'Cómo trabajamos',
    subtitle: 'Cinco fases, con entregable y criterio de cierre en cada una.',
    steps: [
      {
        title: 'Contacto y contexto',
        description:
          'Conversación inicial para entender qué proteges, qué te preocupa y qué decisión quieres poder tomar con el resultado.',
        duration: '1–2 días',
      },
      {
        title: 'Alcance y reglas de enfrentamiento',
        description:
          'Se fija por escrito qué entra, qué queda fuera, ventanas de ejecución, contactos de escalado y tratamiento de datos. NDA y contrato.',
        duration: '2–3 días',
      },
      {
        title: 'Ejecución',
        description:
          'Descubrimiento, validación manual y explotación controlada. Los hallazgos críticos se comunican en el momento, no al final.',
        duration: 'Según alcance',
      },
      {
        title: 'Informe y cierre',
        description:
          'Entrega del informe ejecutivo y técnico, y reunión de revisión con los equipos implicados.',
        duration: '2–3 días',
      },
      {
        title: 'Remediación y retesting',
        description:
          'Acompañamiento durante la corrección y verificación posterior de que el hallazgo queda efectivamente cerrado.',
        duration: 'Según hallazgos',
      },
    ],
  },

  faq: {
    title: 'Preguntas frecuentes',
    items: [
      {
        question: '¿Necesito dar acceso a producción?',
        answer:
          'Depende del objetivo. Si existe un entorno equivalente a producción, se trabaja allí. Si el objetivo es medir la exposición real, se acuerdan accesos y ventanas de ejecución con reglas de enfrentamiento que acotan el impacto.',
      },
      {
        question: '¿Trabajan con NDA?',
        answer:
          'Sí. El acuerdo de confidencialidad se firma antes de recibir cualquier detalle técnico del alcance.',
      },
      {
        question: '¿Cómo se calcula el precio?',
        answer:
          'A partir del esfuerzo estimado: volumen del alcance, número de roles, complejidad técnica y servicios opcionales. El cotizador da una estimación referencial en minutos; la propuesta formal se emite tras validar el alcance.',
      },
      {
        question: '¿La estimación del cotizador es el precio final?',
        answer:
          'No. Es una estimación preliminar basada en lo que declaras. Sirve para dimensionar y presupuestar, y queda sujeta a validación del alcance antes de convertirse en propuesta formal.',
      },
      {
        question: '¿Qué diferencia hay con un escaneo de vulnerabilidades?',
        answer:
          'Un escaneo enumera lo que ya se conoce y no entiende tu lógica de negocio. Una evaluación manual valida cada candidato, encadena debilidades y llega hasta el impacto real. El escaneo forma parte del trabajo, pero no es el trabajo.',
      },
      {
        question: '¿El retesting está incluido?',
        answer:
          'Se incluye cuando forma parte del alcance acordado. En el cotizador es una opción explícita para que su coste sea visible desde el principio.',
      },
    ],
  },

  contact: {
    title: 'Contacto',
    subtitle: 'Cuéntanos qué necesitas evaluar y te respondemos con los siguientes pasos.',
    quoteHint: '¿Prefieres una estimación de esfuerzo antes de hablar?',
    quoteHintCta: 'Usa el cotizador',
    form: {
      name: 'Nombre',
      email: 'Email',
      company: 'Empresa (opcional)',
      message: 'Mensaje',
      submit: 'Enviar',
      sending: 'Enviando…',
      success: 'Mensaje enviado correctamente. Te contactaremos pronto.',
      genericError: 'No fue posible enviar el mensaje. Inténtalo de nuevo.',
      captchaPending: 'Completa la verificación para poder enviar.',
    },
    channels: {
      email: 'Email',
      whatsapp: 'WhatsApp',
      linkedin: 'LinkedIn',
      telegram: 'Telegram',
      phone: 'Teléfono',
    },
  },

  footer: {
    rights: 'Todos los derechos reservados.',
    tagline: 'Puede que no tengas nada que ocultar. Pero sí tienes todo que proteger. — Kevin D. Mitnick',
    servicesTitle: 'Servicios',
    companyTitle: 'VulnFocus',
    contactTitle: 'Contacto',
  },

  notFound: {
    code: '404',
    title: 'Esta página no existe',
    description:
      'La dirección solicitada no corresponde a ningún recurso de VulnFocus. Si llegaste desde un enlace nuestro, cuéntanoslo.',
    home: 'Ir al inicio',
    services: 'Ver servicios',
  },
};
