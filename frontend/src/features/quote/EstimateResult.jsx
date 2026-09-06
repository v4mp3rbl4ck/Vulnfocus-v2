import React, { useState } from 'react';
import { Check, Download, Printer, Send } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import catalog from '../../config/quote-catalog.json';
import { track } from '../../lib/analytics';
import EstimateDocument from './EstimateDocument';
import ProposalRequestForm from './ProposalRequestForm';

/** Etiqueta de un servicio en el idioma actual. */
function serviceLabel(id, language) {
  const service = catalog.services.find((s) => s.id === id);
  if (!service) return id;
  return service.labels[language] || service.labels.es;
}

/** Importe con separadores locales. Intl está disponible en todos los navegadores objetivo. */
function formatAmount(value, pricing, language) {
  try {
    return new Intl.NumberFormat(pricing.locale || (language === 'en' ? 'en-US' : 'es-CL'), {
      maximumFractionDigits: pricing.decimals ?? 0,
    }).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Resultado de la estimación.
 *
 * Se usa en el último paso del wizard y en /estimacion. La versión imprimible
 * es esta misma página con `@media print`: ver docs/QUOTING_ENGINE.md para la
 * justificación de no generar el PDF en el Worker.
 */
const EstimateResult = ({ quote, showShare = true }) => {
  const { t, language } = useLanguage();
  const q = t.quote.estimate;

  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalRequested, setProposalRequested] = useState(false);

  const shareUrl =
    typeof window !== 'undefined' && quote.publicId
      ? `${window.location.origin}/estimacion?id=${quote.publicId}`
      : null;

  const handlePrint = () => {
    track('quote_pdf_downloaded');
    window.print();
  };

  const created = quote.createdAt ? new Date(quote.createdAt) : new Date();
  const dateLabel = created.toLocaleDateString(language === 'en' ? 'en-US' : 'es-CL');

  return (
    <article className="estimate" aria-labelledby="estimate-title">
      <header className="estimate-header">
        <p className="estimate-badge">{q.badge}</p>
        <h2 id="estimate-title" className="estimate-number">{quote.quoteNumber}</h2>
        <p className="estimate-date">
          {q.date}: {dateLabel}
        </p>
      </header>

      <dl className="estimate-facts">
        <div className="estimate-fact">
          <dt>{q.service}</dt>
          <dd>{quote.services.map((id) => serviceLabel(id, language)).join(' + ')}</dd>
        </div>
        <div className="estimate-fact">
          <dt>{q.complexity}</dt>
          <dd>
            <span className={`complexity-pill complexity-${quote.complexity.toLowerCase()}`}>
              {t.quote.complexityLabels[quote.complexity] || quote.complexity}
            </span>
          </dd>
        </div>
        <div className="estimate-fact">
          <dt>{q.duration}</dt>
          <dd>
            {quote.effort.minDays}–{quote.effort.maxDays} {q.days}
          </dd>
        </div>
        <div className="estimate-fact">
          <dt>{q.effort}</dt>
          <dd>
            {quote.effort.minHours}–{quote.effort.maxHours} {q.hours}
          </dd>
        </div>
      </dl>

      {Array.isArray(quote.includes) && quote.includes.length > 0 && (
        <section className="estimate-section" aria-labelledby="estimate-includes">
          <h3 id="estimate-includes" className="estimate-section-title">{q.includes}</h3>
          <ul className="check-list">
            {quote.includes.map((key) => (
              <li key={key}>
                <Check size={16} aria-hidden="true" />
                <span>{t.quote.includes[key] || key}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="estimate-price" aria-labelledby="estimate-price-title">
        <h3 id="estimate-price-title" className="estimate-section-title">{q.priceTitle}</h3>
        {quote.pricing?.available ? (
          <>
            <p className="estimate-amount">
              {formatAmount(quote.pricing.min, quote.pricing, language)} –{' '}
              {formatAmount(quote.pricing.max, quote.pricing, language)}{' '}
              <span className="estimate-currency">{quote.pricing.currency}</span>
            </p>
            {quote.pricing.taxIncluded && <p className="estimate-tax">{q.taxNote}</p>}
          </>
        ) : (
          <p className="estimate-price-pending">{q.priceUnavailable}</p>
        )}
      </section>

      <EstimateDocument quote={quote} />

      <p className="estimate-disclaimer">{q.disclaimer}</p>
      {quote.expiresAt && (
        <p className="estimate-validity">
          {q.validity.replace(
            '{days}',
            Math.max(
              0,
              Math.round(
                (new Date(quote.expiresAt) - new Date(quote.createdAt || Date.now())) / 86400000,
              ),
            ),
          )}
        </p>
      )}

      <div className="estimate-actions no-print">
        {/* La propuesta formal se pide SOBRE esta cotización, no por el
            formulario de contacto genérico: aquel perdía el `public_id` y
            obligaba al cliente a volver a describir lo que ya había respondido.
            El botón abre el formulario específico; quien cambia el estado
            comercial es el servidor, tras verificar la solicitud. */}
        <button
          type="button"
          className="btn-primary"
          disabled={!quote.publicId || proposalRequested}
          onClick={() => {
            track('formal_proposal_requested');
            setProposalOpen(true);
          }}
        >
          {proposalRequested ? t.quote.proposal.requestedBadge : q.ctaProposal}
          <Send size={18} aria-hidden="true" />
        </button>
        <button type="button" className="btn-secondary" onClick={handlePrint}>
          <Printer size={18} aria-hidden="true" />
          {q.ctaPdf}
        </button>
      </div>
      <p className="estimate-hint no-print">{q.ctaPdfHint}</p>

      {proposalOpen && quote.publicId && (
        <ProposalRequestForm
          quote={quote}
          onClose={() => setProposalOpen(false)}
          onRequested={() => setProposalRequested(true)}
        />
      )}

      {showShare && shareUrl && (
        <aside className="estimate-share no-print" aria-labelledby="estimate-share-title">
          <h3 id="estimate-share-title" className="estimate-section-title">
            <Download size={16} aria-hidden="true" /> {q.shareTitle}
          </h3>
          <p className="estimate-share-help">{q.shareHelp}</p>
          <code className="estimate-share-url">{shareUrl}</code>
        </aside>
      )}
    </article>
  );
};

export default EstimateResult;
