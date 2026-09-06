/**
 * Plantillas de correo.
 *
 * Dos destinatarios y dos criterios distintos:
 *
 *  · **Cliente** (`quoteConfirmation`, `contactConfirmation`,
 *    `proposalRequestConfirmation`). Solo lo que necesita para reconocer su
 *    solicitud y saber qué pasa después. NO se envía el alcance declarado, ni el
 *    desglose del cálculo, ni las notas internas: es información técnica de su
 *    propia infraestructura y el correo es un canal que atraviesa servidores de
 *    terceros y se queda archivado años.
 *  · **Interno** (`internalQuoteAlert`, `internalProposalRequestAlert`). El
 *    resumen comercial suficiente para decidir si llamar, sin sustituir a la
 *    ficha del panel, que es la fuente de verdad.
 *
 * Reglas comunes:
 *
 *  · Texto plano como contenido principal; HTML como alternativa. Muchos
 *    clientes de correo corporativos siguen degradando a texto.
 *  · Todo lo que proviene del usuario (empresa, nombre, notas) se escapa antes de
 *    entrar en el HTML. Es entrada no confiable aunque el destinatario sea el
 *    propio cliente: un nombre con `<script>` no debe llegar a renderizarse en
 *    la bandeja de nadie.
 *  · El importe se incluye **solo** si el motor lo calculó (`pricing.available`).
 *    Con PRICING_ENABLED="false" no aparece ninguna cifra ni ningún hueco: no se
 *    insinúa un precio que no existe.
 *  · Sin adjuntos y sin píxeles de seguimiento.
 */

import { complexityLabel, serviceList } from '../../lib/quote/labels.js';

const SIGNATURE_EMAIL = 'contacto@vulnfocus.com';
const SITE_URL = 'https://vulnfocus.com';

/** Aviso legal exigido en todo documento de estimación. Una sola definición. */
export const ESTIMATE_DISCLAIMER =
  'Estimación referencial sujeta a validación final del alcance.';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Separador de miles sin depender de Intl ni de la moneda. */
function amount(value) {
  return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Rango económico, o null si el motor no lo calculó. */
function priceRange(quote) {
  if (!quote.pricing?.available) return null;
  const range = `${amount(quote.pricing.min)} – ${amount(quote.pricing.max)} ${quote.pricing.currency}`;
  return quote.pricing.taxIncluded && quote.pricing.taxLabel
    ? `${range} (${quote.pricing.taxLabel} incluido)`
    : range;
}

function effortLine(quote) {
  return `${quote.minDays}–${quote.maxDays} días hábiles (${quote.minHours}–${quote.maxHours} h)`;
}

/** Filas "clave: valor" en texto plano, omitiendo las vacías. */
function textRows(rows) {
  return rows.filter(([, value]) => value !== null && value !== undefined && value !== '').map(
    ([label, value]) => `${label}: ${value}`,
  );
}

/** Las mismas filas en una tabla HTML mínima, ya escapadas. */
function htmlRows(rows) {
  return rows
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 14px 4px 0;color:#555;vertical-align:top">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td></tr>`,
    )
    .join('');
}

const HTML_OPEN =
  '<!doctype html><html lang="es"><body style="margin:0;padding:24px;' +
  'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;' +
  'line-height:1.6;color:#111;background:#ffffff">';
const HTML_CLOSE = '</body></html>';

/**
 * Acuse al cliente que acaba de solicitar una estimación.
 *
 * Asunto fijado: "Solicitud recibida — VulnFocus VF-AAAA-NNNNNN".
 */
export function quoteConfirmation(quote, links = {}) {
  const subject = `Solicitud recibida — VulnFocus ${quote.quoteNumber}`;
  const price = priceRange(quote);

  const rows = [
    ['Número de solicitud', quote.quoteNumber],
    ['Servicios solicitados', serviceList(quote.services)],
    ['Complejidad estimada', complexityLabel(quote.complexity)],
    ['Duración aproximada', effortLine(quote)],
    // Solo si el motor calculó importes.
    ['Estimación económica', price],
  ];

  const nextStep = price
    ? 'El siguiente paso es una conversación breve para confirmar el alcance y emitir la propuesta formal con el precio definitivo.'
    : 'El siguiente paso es una conversación breve para confirmar el alcance. Con el alcance cerrado te enviamos la propuesta formal, que incluye la propuesta económica.';

  const text = [
    `Hola ${quote.contactName},`,
    '',
    'Gracias por confiar en VulnFocus. Hemos recibido tu solicitud de estimación y',
    'la tenemos registrada con este resumen:',
    '',
    ...textRows(rows),
    '',
    links.estimate ? `Puedes consultarla en cualquier momento aquí:\n${links.estimate}` : '',
    links.estimate ? '' : '',
    nextStep,
    '',
    ESTIMATE_DISCLAIMER,
    '',
    'VulnFocus',
    SIGNATURE_EMAIL,
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');

  const html =
    HTML_OPEN +
    `<p>Hola ${escapeHtml(quote.contactName)},</p>` +
    '<p>Gracias por confiar en VulnFocus. Hemos recibido tu solicitud de estimación y la tenemos registrada con este resumen:</p>' +
    `<table role="presentation" style="border-collapse:collapse;margin:0 0 18px">${htmlRows(rows)}</table>` +
    (links.estimate
      ? `<p><a href="${escapeHtml(links.estimate)}" style="color:#0060c0">Consultar la estimación</a></p>`
      : '') +
    `<p>${escapeHtml(nextStep)}</p>` +
    `<p style="color:#555;font-size:13px">${escapeHtml(ESTIMATE_DISCLAIMER)}</p>` +
    `<p style="color:#555;font-size:13px">VulnFocus · ${escapeHtml(SIGNATURE_EMAIL)}</p>` +
    HTML_CLOSE;

  return { kind: 'quote_confirmation', to: quote.email, subject, text, html };
}

/** Aviso interno de nueva oportunidad. */
export function internalQuoteAlert(quote, to) {
  const subject = `Nueva oportunidad ${quote.quoteNumber} — ${quote.company}`;

  const rows = [
    ['Empresa', quote.company],
    ['Contacto', quote.contactName],
    ['Email', quote.email],
    ['Teléfono', quote.phone || '(no indicado)'],
    ['Servicio', serviceList(quote.services)],
    ['Complejidad', complexityLabel(quote.complexity)],
    ['Horas estimadas', quote.estimatedHours ?? `${quote.minHours}–${quote.maxHours}`],
    ['Duración', effortLine(quote)],
    ['Rango comercial', priceRange(quote) || '(sin precio: tarifa no configurada)'],
    ['Fecha', quote.createdAt],
  ];

  const text = [
    'NUEVA OPORTUNIDAD',
    '',
    quote.quoteNumber,
    '',
    ...textRows(rows),
  ].join('\n');

  const html =
    HTML_OPEN +
    '<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#555">Nueva oportunidad</p>' +
    `<h1 style="margin:0 0 18px;font-size:20px">${escapeHtml(quote.quoteNumber)}</h1>` +
    `<table role="presentation" style="border-collapse:collapse">${htmlRows(rows)}</table>` +
    HTML_CLOSE;

  return { kind: 'internal_quote_alert', to, subject, text, html };
}

/**
 * Acuse al cliente que acaba de pedir la propuesta formal.
 *
 * No repite la estimación entera —ya la tiene, y el enlace sigue vivo—: confirma
 * que la solicitud se recibió, con qué número, y qué pasa a continuación. No
 * incluye importes aunque existan: la propuesta formal es el documento que fija
 * el precio, y adelantarlo aquí solo sirve para que dos cifras se contradigan.
 */
export function proposalRequestConfirmation(request, links = {}) {
  const subject = `Solicitud de propuesta formal recibida — VulnFocus ${request.quoteNumber}`;

  const rows = [
    ['Número de cotización', request.quoteNumber],
    ['Servicios', serviceList(request.services)],
    ['Duración estimada', effortLine(request)],
    ['Fecha objetivo indicada', request.targetDate],
  ];

  const nextStep =
    'Revisaremos el alcance declarado y te contactaremos para confirmarlo antes de emitir la propuesta formal, que incluye la propuesta económica y las condiciones del servicio.';

  const text = [
    `Hola ${request.contactName},`,
    '',
    'Hemos recibido tu solicitud de propuesta formal para esta cotización:',
    '',
    ...textRows(rows),
    '',
    nextStep,
    '',
    links.estimate ? `Tu estimación sigue disponible aquí:\n${links.estimate}` : '',
    '',
    ESTIMATE_DISCLAIMER,
    '',
    'VulnFocus',
    SIGNATURE_EMAIL,
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');

  const html =
    HTML_OPEN +
    `<p>Hola ${escapeHtml(request.contactName)},</p>` +
    '<p>Hemos recibido tu solicitud de propuesta formal para esta cotización:</p>' +
    `<table role="presentation" style="border-collapse:collapse;margin:0 0 18px">${htmlRows(rows)}</table>` +
    `<p>${escapeHtml(nextStep)}</p>` +
    (links.estimate
      ? `<p><a href="${escapeHtml(links.estimate)}" style="color:#0060c0">Consultar la estimación</a></p>`
      : '') +
    `<p style="color:#555;font-size:13px">${escapeHtml(ESTIMATE_DISCLAIMER)}</p>` +
    `<p style="color:#555;font-size:13px">VulnFocus · ${escapeHtml(SIGNATURE_EMAIL)}</p>` +
    HTML_CLOSE;

  return { kind: 'proposal_request_confirmation', to: request.email, subject, text, html };
}

/**
 * Aviso interno: alguien ha pedido la propuesta formal.
 *
 * Este SÍ lleva el texto libre del cliente. Es el canal donde tiene sentido: va
 * a una dirección propia, no a un servicio de mensajería de terceros, y es
 * justamente lo que hay que leer antes de redactar la propuesta.
 */
export function internalProposalRequestAlert(request, to, links = {}) {
  const subject = `Propuesta formal solicitada ${request.quoteNumber} — ${request.company}`;

  const rows = [
    ['Empresa', request.company],
    ['Contacto', request.contactName],
    ['Email', request.email],
    ['Teléfono', request.phone || '(no indicado)'],
    ['Servicio', serviceList(request.services)],
    ['Alcance resumido', request.scopeSummary],
    ['Complejidad', complexityLabel(request.complexity)],
    ['Duración', effortLine(request)],
    ['Rango comercial', priceRange(request) || '(sin precio: tarifa no configurada)'],
    ['Fecha objetivo', request.targetDate || '(no indicada)'],
    ['Solicitada', request.requestedAt],
    ['Ficha', links.estimate],
  ];

  const freeText = [
    ['Comentarios del cliente', request.notes],
    ['Información adicional de alcance', request.scopeNotes],
  ].filter(([, value]) => Boolean(value));

  const text = [
    'PROPUESTA FORMAL SOLICITADA',
    '',
    request.quoteNumber,
    '',
    ...textRows(rows),
    ...freeText.flatMap(([label, value]) => ['', `${label}:`, value]),
  ].join('\n');

  const html =
    HTML_OPEN +
    '<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#555">Propuesta formal solicitada</p>' +
    `<h1 style="margin:0 0 18px;font-size:20px">${escapeHtml(request.quoteNumber)}</h1>` +
    `<table role="presentation" style="border-collapse:collapse">${htmlRows(rows)}</table>` +
    freeText
      .map(
        ([label, value]) =>
          `<h2 style="margin:18px 0 4px;font-size:15px">${escapeHtml(label)}</h2>` +
          `<p style="white-space:pre-wrap;margin:0">${escapeHtml(value)}</p>`,
      )
      .join('') +
    HTML_CLOSE;

  return { kind: 'internal_proposal_request_alert', to, subject, text, html };
}

/** Confirmación de recepción de un mensaje del formulario de contacto. */
export function contactConfirmation(contact) {
  const subject = 'Hemos recibido tu mensaje — VulnFocus';

  const text = [
    `Hola ${contact.name},`,
    '',
    'Hemos recibido tu mensaje y te responderemos en breve.',
    '',
    'Si necesitas dimensionar una evaluación mientras tanto, puedes usar el',
    `cotizador en ${SITE_URL}/cotizar`,
    '',
    'VulnFocus',
    SIGNATURE_EMAIL,
  ].join('\n');

  const html =
    HTML_OPEN +
    `<p>Hola ${escapeHtml(contact.name)},</p>` +
    '<p>Hemos recibido tu mensaje y te responderemos en breve.</p>' +
    `<p>Si necesitas dimensionar una evaluación mientras tanto, puedes usar el ` +
    `<a href="${SITE_URL}/cotizar" style="color:#0060c0">cotizador</a>.</p>` +
    `<p style="color:#555;font-size:13px">VulnFocus · ${escapeHtml(SIGNATURE_EMAIL)}</p>` +
    HTML_CLOSE;

  return { kind: 'contact_confirmation', to: contact.email, subject, text, html };
}
