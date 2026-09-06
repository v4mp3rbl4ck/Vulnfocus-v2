/* EN copy. Mirrors the ES structure key by key. */
export const en = {
  nav: {
    services: 'Services',
    process: 'Process',
    resources: 'Deliverables',
    certifications: 'Frameworks',
    contact: 'Contact',
    quote: 'Get a quote',
    menu: 'Open menu',
    close: 'Close menu',
  },

  common: {
    quoteCta: 'Get a quote',
    contactCta: 'Request an assessment',
    viewService: 'View service',
    viewAllServices: 'View all services',
    backToServices: 'Back to services',
    loading: 'Loading…',
    required: 'required',
    optional: 'optional',
    skipToContent: 'Skip to content',
  },

  hero: {
    eyebrow: 'Offensive Security',
    title: 'We show how a vulnerability turns into real impact',
    subtitle:
      'Manual penetration testing and adversary simulation for organizations that need to validate their real exposure, not a list of findings without context.',
    ctaPrimary: 'Request an assessment',
    ctaSecondary: 'Get a quote',
    badges: ['Web', 'API', 'Active Directory', 'Cloud', 'Red Team'],
    whatYouGet: 'What you get',
    benefits: [
      'Scope and rules of engagement in writing',
      'Validated exploitation, not theoretical findings',
      'Attack paths all the way to business impact',
      'CVSS severity and prioritization by real risk',
      'Retesting of the fixes you apply',
    ],
    timeframe: 'Effort estimate in minutes, no call required first.',
  },

  valueProps: {
    title: 'Why a manual assessment',
    items: [
      {
        title: 'Validation, not noise',
        description:
          'Every finding is reproduced by hand before it is reported. What cannot be demonstrated is not reported as a vulnerability.',
      },
      {
        title: 'Chaining',
        description:
          'Three medium weaknesses that together reach customer data matter more than twenty isolated informational ones.',
      },
      {
        title: 'Business impact',
        description:
          'The report explains what would happen if an attacker did this tomorrow, in terms management can act on.',
      },
      {
        title: 'Traceability',
        description:
          'Evidence, reproduction steps and references to recognized methodologies so your team can reproduce and verify.',
      },
    ],
  },

  servicesSection: {
    title: 'Services',
    subtitle: 'Each service states its objective, what is assessed, the methodology and the deliverables.',
    intro:
      'Pick the type of assessment you need. If you are not sure, the quoting wizard guides you based on what you want to protect.',
    detail: {
      objective: 'Objective',
      evaluates: 'What is assessed',
      methodology: 'Methodology',
      tests: 'Example tests',
      deliverables: 'Deliverables',
      duration: 'Approximate duration',
      frameworks: 'Reference frameworks',
      durationNote:
        'Indicative. Actual duration depends on the agreed scope and is fixed in writing before starting.',
      ctaTitle: 'Need an estimate for this service?',
      ctaText:
        'The wizard computes effort and duration from the scope you declare. It takes a few minutes and commits you to nothing.',
    },
  },

  scanVsPentest: {
    title: 'Vulnerability scanning and manual pentesting are not the same thing',
    intro:
      'A scanner enumerates the known. A manual assessment demonstrates what can actually be done with it. VulnFocus does not stop at running tools: scanning is the starting point, not the deliverable.',
    scanTitle: 'Automated scanning',
    scanItems: [
      'Detects known patterns and vulnerable versions',
      'Does not understand your application business logic',
      'Cannot tell a wrong permission from a correct one',
      'Produces false positives someone has to triage',
      'Stops at the finding, never reaches impact',
    ],
    pentestTitle: 'Manual pentesting',
    pentestItems: [
      'Starts from the scan and continues where the tool stops',
      'Tests access control across real roles and users',
      'Chains weaknesses into a complete attack path',
      'Every finding is reproduced before being reported',
      'Ends at business impact and its remediation',
    ],
    flowTitle: 'From surface to impact',
    flow: [
      { step: 'Discovery', description: 'Enumeration of everything reachable, not only what was declared.' },
      { step: 'Attack Surface', description: 'What is exposed, with which privileges and to whom.' },
      { step: 'Manual Validation', description: 'False positives discarded and every candidate tested by hand.' },
      { step: 'Exploitation', description: 'Controlled exploitation within the rules of engagement.' },
      { step: 'Attack Path', description: 'Weaknesses chained together towards the objective.' },
      { step: 'Impact', description: 'Which data, processes or accounts end up compromised.' },
      { step: 'Remediation', description: 'Specific, prioritized and applicable fixes.' },
      { step: 'Retesting', description: 'Verification that the fix actually closes the finding.' },
    ],
    footer:
      'Testing runs under contractually agreed rules of engagement, controlled and aimed at reducing real risk.',
  },

  deliverables: {
    title: 'What the client receives',
    subtitle: 'The deliverable is a report that reads well in the boardroom and executes well in engineering.',
    items: [
      {
        title: 'Executive report',
        description:
          'Exposure summary, aggregated risk and recommended decisions. Written for whoever approves budget, not for whoever patches.',
      },
      {
        title: 'Technical report',
        description:
          'One section per finding: description, root cause, reproduction steps, evidence and a concrete fix.',
      },
      {
        title: 'Evidence',
        description:
          'Screenshots, requests and responses, and enough data for your team to reproduce the finding without depending on us.',
      },
      {
        title: 'CVSS severity',
        description:
          'A CVSS vector per finding plus prioritization that also weighs exploitability and business context.',
      },
      {
        title: 'Attack paths',
        description: 'A diagram of how weaknesses chain from the entry point to the final impact.',
      },
      {
        title: 'Recommendations',
        description:
          'Fixes specific to your stack, with alternatives when the ideal fix is not viable in the short term.',
      },
      {
        title: 'Closing meeting',
        description:
          'Report walkthrough with the technical and business teams, and remediation questions answered.',
      },
      {
        title: 'Retesting',
        description:
          'Verification of applied fixes and a closure record per finding, when included in the scope.',
      },
    ],
    sampleTitle: 'Sample report',
    sampleText:
      'An anonymized sample report lets you review format, depth and level of detail before engaging. Request it stating your organization and the type of assessment you are considering.',
    sampleCta: 'Request a sample report',
    samplePending: 'Available on request.',
  },

  methodology: {
    title: 'Methodological frameworks',
    intro:
      'Assessments run on internationally recognized frameworks so that coverage is reproducible and auditable rather than dependent on one person judgement.',
    frameworks: [
      { name: 'PTES', description: 'Penetration Testing Execution Standard: phases and good practice for running an intrusion test.' },
      { name: 'OWASP WSTG', description: 'Web Security Testing Guide: test catalogue for web applications, from authentication to business logic.' },
      { name: 'OWASP ASVS', description: 'Application Security Verification Standard: verification levels used as a coverage criterion.' },
      { name: 'OWASP API Security Top 10', description: 'Risks specific to modern APIs: BOLA, BFLA, data exposure and unrestricted consumption.' },
      { name: 'OWASP MASVS / MASTG', description: 'Verification standard and testing guide for Android and iOS applications.' },
      { name: 'MITRE ATT&CK', description: 'Adversary tactics and techniques matrix, used to structure Red Team exercises and measure detection.' },
      { name: 'NIST SP 800-115', description: 'Technical guide to security testing and control assessment.' },
      { name: 'CIS Benchmarks', description: 'Secure configuration baselines for systems, services and cloud providers.' },
      { name: 'CVSS', description: 'Severity scoring system used as the basis for finding prioritization.' },
    ],
    footer:
      'Applying a framework is a coverage decision, not a certification. Team professional certifications are declared separately and only while current.',
  },

  process: {
    title: 'How we work',
    subtitle: 'Five phases, each with a deliverable and an exit criterion.',
    steps: [
      {
        title: 'Contact and context',
        description:
          'Initial conversation to understand what you protect, what worries you and which decision the result should enable.',
        duration: '1–2 days',
      },
      {
        title: 'Scope and rules of engagement',
        description:
          'Written agreement on what is in, what is out, execution windows, escalation contacts and data handling. NDA and contract.',
        duration: '2–3 days',
      },
      {
        title: 'Execution',
        description:
          'Discovery, manual validation and controlled exploitation. Critical findings are reported as they appear, not at the end.',
        duration: 'Scope dependent',
      },
      {
        title: 'Report and closing',
        description: 'Executive and technical report delivery, plus a review meeting with the teams involved.',
        duration: '2–3 days',
      },
      {
        title: 'Remediation and retesting',
        description:
          'Support during remediation and later verification that the finding is effectively closed.',
        duration: 'Findings dependent',
      },
    ],
  },

  faq: {
    title: 'Frequently asked questions',
    items: [
      {
        question: 'Do I need to provide production access?',
        answer:
          'It depends on the objective. If a production-equivalent environment exists, we work there. If the goal is to measure real exposure, access and execution windows are agreed with rules of engagement that bound the impact.',
      },
      {
        question: 'Do you work under NDA?',
        answer: 'Yes. The confidentiality agreement is signed before receiving any technical detail of the scope.',
      },
      {
        question: 'How is pricing calculated?',
        answer:
          'From estimated effort: scope volume, number of roles, technical complexity and optional services. The wizard gives a referential estimate in minutes; the formal proposal follows scope validation.',
      },
      {
        question: 'Is the wizard estimate the final price?',
        answer:
          'No. It is a preliminary estimate based on what you declare. It is meant for sizing and budgeting, and remains subject to scope validation before becoming a formal proposal.',
      },
      {
        question: 'How is this different from a vulnerability scan?',
        answer:
          'A scan enumerates what is already known and does not understand your business logic. A manual assessment validates each candidate, chains weaknesses and reaches real impact. Scanning is part of the work, not the work.',
      },
      {
        question: 'Is retesting included?',
        answer:
          'It is included when part of the agreed scope. In the wizard it is an explicit option so its cost is visible from the start.',
      },
    ],
  },

  contact: {
    title: 'Contact',
    subtitle: 'Tell us what you need to assess and we will reply with the next steps.',
    quoteHint: 'Prefer an effort estimate before talking?',
    quoteHintCta: 'Use the wizard',
    form: {
      name: 'Name',
      email: 'Email',
      company: 'Company (optional)',
      message: 'Message',
      submit: 'Send',
      sending: 'Sending…',
      success: 'Message sent successfully. We will contact you soon.',
      genericError: 'The message could not be sent. Please try again.',
      captchaPending: 'Complete the verification to send.',
    },
    channels: {
      email: 'Email',
      whatsapp: 'WhatsApp',
      linkedin: 'LinkedIn',
      telegram: 'Telegram',
      phone: 'Phone',
    },
  },

  footer: {
    rights: 'All rights reserved.',
    tagline: 'You may have nothing to hide. But you have everything to protect. — Kevin D. Mitnick',
    servicesTitle: 'Services',
    companyTitle: 'VulnFocus',
    contactTitle: 'Contact',
  },

  notFound: {
    code: '404',
    title: 'This page does not exist',
    description:
      'The requested address does not match any VulnFocus resource. If you got here from one of our links, let us know.',
    home: 'Go to home',
    services: 'View services',
  },
};
