/* Textos ES del cotizador y de la estimación. */
export const quoteEs = {
  title: 'Cotiza tu pentest',
  subtitle:
    'Responde el alcance y obtén una estimación referencial de esfuerzo y duración. Toma unos minutos y no compromete a nada.',

  steps: [
    { key: 'service', label: 'Servicio' },
    { key: 'scope', label: 'Alcance' },
    { key: 'context', label: 'Contexto' },
    { key: 'contact', label: 'Contacto' },
    { key: 'estimate', label: 'Estimación' },
  ],
  progress: 'Paso {current} de {total}',

  actions: {
    next: 'Continuar',
    back: 'Atrás',
    submit: 'Ver mi estimación',
    submitting: 'Calculando…',
    restart: 'Empezar de nuevo',
    edit: 'Modificar',
  },

  service: {
    title: '¿Qué necesitas evaluar?',
    help: 'Puedes combinar hasta {max} servicios. Si no lo tienes claro, elige el más cercano: el alcance se afina después.',
    selected: '{count} seleccionado(s)',
    limitReached: 'Has alcanzado el máximo de servicios combinables.',
    empty: 'Selecciona al menos un servicio para continuar.',
  },

  scope: {
    title: 'Alcance',
    help: 'Cifras aproximadas. Sirven para dimensionar, no son un compromiso.',
    sectionFor: 'Alcance de {service}',
  },

  context: {
    title: 'Contexto del proyecto',
    help: 'Estas opciones cambian el esfuerzo y el precio, así que conviene decidirlas ahora.',
  },

  contact: {
    title: '¿A quién enviamos la estimación?',
    help: 'Necesitamos un contacto para enviarte el número de cotización y poder validar el alcance.',
    privacy:
      'Usamos estos datos únicamente para responder a tu solicitud. No incluyas credenciales, datos personales de terceros ni información clasificada.',
    captchaPending: 'Completa la verificación para poder enviar.',
  },

  summary: {
    title: 'Resumen antes de enviar',
    services: 'Servicios',
    scope: 'Alcance declarado',
    context: 'Contexto',
    contact: 'Contacto',
    yes: 'Sí',
    no: 'No',
    none: '(sin selección)',
  },

  estimate: {
    badge: 'Estimación',
    title: 'Tu estimación preliminar',
    number: 'Número',
    date: 'Fecha',
    service: 'Servicio',
    complexity: 'Complejidad',
    effort: 'Esfuerzo',
    duration: 'Duración estimada',
    days: 'días',
    hours: 'horas',
    includes: 'Incluye',
    priceTitle: 'Rango estimado',
    priceUnavailable:
      'El rango económico se confirma al validar el alcance. Escríbenos y te lo enviamos con la propuesta formal.',
    taxNote: 'Impuestos incluidos.',
    validity: 'Validez de la estimación: {days} días.',
    disclaimer: 'Estimación referencial sujeta a validación final del alcance.',
    ctaProposal: 'Solicitar propuesta formal',
    ctaPdf: 'Descargar estimación en PDF',
    ctaPdfHint:
      'Se abre el diálogo de impresión de tu navegador; elige "Guardar como PDF" para conservar una copia.',
    shareTitle: 'Guarda este enlace',
    shareHelp: 'Con él puedes volver a consultar esta estimación o compartirla internamente.',
    copied: 'Enlace copiado',
    lookupError: 'No encontramos esa estimación. Es posible que el enlace sea incorrecto o haya caducado.',
    loading: 'Recuperando la estimación…',
  },

  proposal: {
    title: 'Solicitar propuesta formal',
    summaryTitle: 'Tu estimación',
    help: 'Ya tenemos tu alcance y tus datos de contacto. Solo necesitamos lo que falte por saber; todo lo de abajo es opcional.',
    prefilledNote:
      'Estos datos vienen de tu cotización. No hace falta que los vuelvas a escribir.',
    loading: 'Recuperando tu cotización…',
    sending: 'Enviando…',
    submit: 'Enviar solicitud',
    cancel: 'Cancelar',
    close: 'Cerrar',
    closeAction: 'Entendido',
    requestedBadge: 'Propuesta solicitada',
    success: 'Hemos recibido tu solicitud de propuesta formal.',
    alreadyRequested: 'Ya habíamos recibido esta solicitud. No hemos creado una segunda.',
    nextSteps:
      'Revisaremos el alcance y te contactaremos para confirmarlo antes de enviarte la propuesta formal. Te llegará un acuse al correo de la cotización.',
    privacy:
      'Estos datos se asocian a tu cotización existente. No incluyas credenciales, datos personales de terceros ni información clasificada.',

    captcha: {
      loading: 'Cargando la verificación…',
      pending: 'Completa la verificación para poder enviar.',
      solved: 'Verificación completada.',
    },

    fields: {
      quoteNumber: 'Número de cotización',
      company: 'Empresa',
      contactName: 'Contacto',
      email: 'Email',
      phone: 'Teléfono',
      scope: 'Alcance',
      complexity: 'Complejidad',
      effort: 'Esfuerzo estimado',
      price: 'Rango estimado',
    },

    form: {
      notes: 'Comentarios adicionales',
      notesHelp: 'Cualquier cosa que debamos tener en cuenta al preparar la propuesta.',
      targetDate: 'Fecha objetivo de inicio',
      targetDateHelp: 'Si tienes una fecha en mente, la tenemos en cuenta al planificar.',
      scopeNotes: 'Información adicional de alcance',
      scopeNotesHelp:
        'Sistemas, ventanas de prueba, restricciones o cualquier detalle que no cupiera en el formulario.',
    },

    errors: {
      generic: 'No fue posible enviar la solicitud. Inténtalo de nuevo.',
      network: 'No hay conexión con el servidor. Comprueba tu red e inténtalo de nuevo.',
      notFound: 'No encontramos esa cotización. Es posible que el enlace sea incorrecto o haya caducado.',
      rateLimited: 'Has hecho demasiados intentos. Espera un minuto e inténtalo de nuevo.',
      verification: 'No fue posible verificar la solicitud. Recarga la página e inténtalo de nuevo.',
      inProgress:
        'Esta cotización ya está en curso con nuestro equipo. Escríbenos y la retomamos.',
    },
  },

  includes: {
    manual_testing: 'Testing manual, no solo escaneo automatizado',
    executive_report: 'Informe ejecutivo',
    technical_report: 'Informe técnico con pasos de reproducción',
    evidence: 'Evidencias por hallazgo',
    cvss: 'Severidad CVSS y priorización',
    recommendations: 'Recomendaciones de remediación',
    closing_meeting: 'Reunión de cierre',
    retesting: 'Retesting de las correcciones',
  },

  complexityLabels: {
    LOW: 'Baja',
    MEDIUM: 'Media',
    HIGH: 'Alta',
  },

  errors: {
    required: 'Este campo es obligatorio',
    invalidEmail: 'Introduce un email válido',
    invalidPhone: 'Introduce un teléfono válido',
    tooLong: 'El texto es demasiado largo',
    generic: 'No fue posible generar la estimación. Inténtalo de nuevo.',
    rateLimited: 'Has hecho demasiados intentos. Espera un minuto e inténtalo de nuevo.',
    network: 'No hay conexión con el servidor. Comprueba tu red e inténtalo de nuevo.',
  },

  print: {
    documentTitle: 'Propuesta / Estimación preliminar',
    client: 'Cliente',
    contact: 'Contacto',
    objective: 'Objetivo',
    objectiveText:
      'Determinar el nivel de exposición real de los activos declarados mediante una evaluación manual, y entregar una remediación priorizada por impacto.',
    scope: 'Alcance declarado',
    methodology: 'Metodología',
    methodologyText:
      'Evaluación manual sobre marcos reconocidos: PTES y NIST SP 800-115 como estructura de ejecución, las guías OWASP correspondientes al tipo de activo y MITRE ATT&CK en ejercicios de simulación adversaria. Severidad puntuada con CVSS.',
    deliverables: 'Entregables',
    effort: 'Esfuerzo estimado',
    duration: 'Duración estimada',
    price: 'Rango económico',
    exclusions: 'Exclusiones',
    exclusionsText:
      'Quedan fuera del alcance: pruebas de denegación de servicio, ingeniería social no acordada expresamente, remediación de las vulnerabilidades por parte de VulnFocus, y cualquier activo no declarado en este documento.',
    validity: 'Validez',
    disclaimer: 'Aviso',
    disclaimerText:
      'Estimación preliminar basada en la información declarada por el cliente. Está sujeta a la validación final del alcance y no constituye una oferta contractual.',
    footer: 'VulnFocus · contacto@vulnfocus.com · vulnfocus.com',
  },
};
