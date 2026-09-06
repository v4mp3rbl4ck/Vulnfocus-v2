/* EN copy for the quoting wizard and the estimate. */
export const quoteEn = {
  title: 'Quote your pentest',
  subtitle:
    'Describe the scope and get a referential effort and duration estimate. It takes a few minutes and commits you to nothing.',

  steps: [
    { key: 'service', label: 'Service' },
    { key: 'scope', label: 'Scope' },
    { key: 'context', label: 'Context' },
    { key: 'contact', label: 'Contact' },
    { key: 'estimate', label: 'Estimate' },
  ],
  progress: 'Step {current} of {total}',

  actions: {
    next: 'Continue',
    back: 'Back',
    submit: 'See my estimate',
    submitting: 'Calculating…',
    restart: 'Start over',
    edit: 'Edit',
  },

  service: {
    title: 'What do you need assessed?',
    help: 'You can combine up to {max} services. If you are unsure, pick the closest one: scope is refined later.',
    selected: '{count} selected',
    limitReached: 'You have reached the maximum number of combinable services.',
    empty: 'Select at least one service to continue.',
  },

  scope: {
    title: 'Scope',
    help: 'Approximate figures. They are used for sizing and are not a commitment.',
    sectionFor: '{service} scope',
  },

  context: {
    title: 'Project context',
    help: 'These options change effort and price, so they are worth deciding now.',
  },

  contact: {
    title: 'Where do we send the estimate?',
    help: 'We need a contact to send you the quote number and to validate the scope.',
    privacy:
      'We use this data only to answer your request. Do not include credentials, third-party personal data or classified information.',
    captchaPending: 'Complete the verification to submit.',
  },

  summary: {
    title: 'Review before sending',
    services: 'Services',
    scope: 'Declared scope',
    context: 'Context',
    contact: 'Contact',
    yes: 'Yes',
    no: 'No',
    none: '(nothing selected)',
  },

  estimate: {
    badge: 'Estimate',
    title: 'Your preliminary estimate',
    number: 'Number',
    date: 'Date',
    service: 'Service',
    complexity: 'Complexity',
    effort: 'Effort',
    duration: 'Estimated duration',
    days: 'days',
    hours: 'hours',
    includes: 'Includes',
    priceTitle: 'Estimated range',
    priceUnavailable:
      'The price range is confirmed once the scope is validated. Get in touch and we will send it with the formal proposal.',
    taxNote: 'Taxes included.',
    validity: 'Estimate validity: {days} days.',
    disclaimer: 'Referential estimate, subject to final scope validation.',
    ctaProposal: 'Request a formal proposal',
    ctaPdf: 'Download estimate as PDF',
    ctaPdfHint: 'Your browser print dialog opens; choose "Save as PDF" to keep a copy.',
    shareTitle: 'Save this link',
    shareHelp: 'Use it to look this estimate up again or to share it internally.',
    copied: 'Link copied',
    lookupError: 'We could not find that estimate. The link may be incorrect or expired.',
    loading: 'Retrieving the estimate…',
  },

  proposal: {
    title: 'Request a formal proposal',
    summaryTitle: 'Your estimate',
    help: 'We already have your scope and contact details. We only need what is still missing — everything below is optional.',
    prefilledNote: 'This comes from your quote. There is no need to type it again.',
    loading: 'Retrieving your quote…',
    sending: 'Sending…',
    submit: 'Send request',
    cancel: 'Cancel',
    close: 'Close',
    closeAction: 'Got it',
    requestedBadge: 'Proposal requested',
    success: 'We have received your formal proposal request.',
    alreadyRequested:
      'This formal proposal was already requested earlier. No second one was created.',
    nextSteps:
      'We will review the scope and contact you to confirm it before sending the formal proposal. A receipt is on its way to the email on the quote.',
    privacy:
      'This information is attached to your existing quote. Do not include credentials, third-party personal data or classified information.',

    captcha: {
      loading: 'Loading verification…',
      pending: 'Complete the verification to send.',
      solved: 'Verification complete.',
    },

    fields: {
      quoteNumber: 'Quote number',
      company: 'Company',
      contactName: 'Contact',
      email: 'Email',
      phone: 'Phone',
      scope: 'Scope',
      complexity: 'Complexity',
      effort: 'Estimated effort',
      price: 'Estimated range',
    },

    form: {
      notes: 'Additional comments',
      notesHelp: 'Anything we should take into account when preparing the proposal.',
      targetDate: 'Target start date',
      targetDateHelp: 'If you have a date in mind, we factor it into planning.',
      scopeNotes: 'Additional scope information',
      scopeNotesHelp:
        'Systems, testing windows, restrictions or any detail that did not fit in the form.',
    },

    errors: {
      generic: 'The request could not be sent. Please try again.',
      network: 'No connection to the server. Check your network and try again.',
      notFound: 'We could not find that quote. The link may be incorrect or expired.',
      rateLimited: 'You have made too many attempts. Please try again in a few minutes.',
      verification: 'We could not verify the request. Reload the page and try again.',
      unavailable: 'The form is temporarily unavailable. Please try again in a few minutes.',
      inProgress: 'This quote is already being handled by our team. Write to us and we will pick it up.',
    },

    fieldErrors: {
      targetDate: {
        format: 'Use the YYYY-MM-DD format.',
        past: 'The target date cannot be earlier than today.',
        'too-far': 'The target date cannot be later than {max}.',
      },
      notes: {
        'too-long': 'Your comments are too long.',
        type: 'Please check the contents of your comments.',
      },
      scopeNotes: {
        'too-long': 'The scope information is too long.',
        type: 'Please check the contents of the scope information.',
      },
    },
  },

  includes: {
    manual_testing: 'Manual testing, not just automated scanning',
    executive_report: 'Executive report',
    technical_report: 'Technical report with reproduction steps',
    evidence: 'Evidence per finding',
    cvss: 'CVSS severity and prioritization',
    recommendations: 'Remediation recommendations',
    closing_meeting: 'Closing meeting',
    retesting: 'Retesting of the fixes',
  },

  complexityLabels: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' },

  errors: {
    required: 'This field is required',
    invalidEmail: 'Enter a valid email',
    invalidPhone: 'Enter a valid phone number',
    tooLong: 'The text is too long',
    generic: 'The estimate could not be generated. Please try again.',
    rateLimited: 'Too many attempts. Wait a minute and try again.',
    network: 'No connection to the server. Check your network and try again.',
  },

  print: {
    documentTitle: 'Proposal / Preliminary estimate',
    client: 'Client',
    contact: 'Contact',
    objective: 'Objective',
    objectiveText:
      'Determine the real exposure level of the declared assets through a manual assessment, and deliver remediation prioritized by impact.',
    scope: 'Declared scope',
    methodology: 'Methodology',
    methodologyText:
      'Manual assessment on recognized frameworks: PTES and NIST SP 800-115 as the execution structure, the OWASP guides matching the asset type, and MITRE ATT&CK in adversary simulation engagements. Severity scored with CVSS.',
    deliverables: 'Deliverables',
    effort: 'Estimated effort',
    duration: 'Estimated duration',
    price: 'Price range',
    exclusions: 'Exclusions',
    exclusionsText:
      'Out of scope: denial of service testing, social engineering not expressly agreed, remediation of vulnerabilities by VulnFocus, and any asset not declared in this document.',
    validity: 'Validity',
    disclaimer: 'Notice',
    disclaimerText:
      'Preliminary estimate based on information declared by the client. It is subject to final scope validation and does not constitute a contractual offer.',
    footer: 'VulnFocus · contacto@vulnfocus.com · vulnfocus.com',
  },
};
