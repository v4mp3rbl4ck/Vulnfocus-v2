import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import catalog from '../../config/quote-catalog.json';
import BrandLogo from '../../components/BrandLogo';

/**
 * Cuerpo documental de la estimación: lo que convierte la pantalla de resultado
 * en algo que se puede imprimir y enviar. Se muestra también en pantalla porque
 * es información útil, no relleno para el PDF.
 *
 * Contenido fijado por el enunciado: objetivo, alcance declarado, metodología,
 * entregables, esfuerzo, duración, rango, exclusiones, validez y aviso.
 */

function serviceById(id) {
  return catalog.services.find((s) => s.id === id) || null;
}

function answerLabel(question, value, language, t) {
  if (typeof value === 'boolean') return value ? t.quote.summary.yes : t.quote.summary.no;
  if (Array.isArray(value)) {
    if (value.length === 0) return t.quote.summary.none;
    return value
      .map((v) => {
        const option = question.options?.find((o) => o.value === v);
        return option ? option.labels[language] || option.labels.es : v;
      })
      .join(', ');
  }
  if (question.type === 'select') {
    const option = question.options?.find((o) => o.value === value);
    return option ? option.labels[language] || option.labels.es : String(value);
  }
  return String(value ?? '');
}

const EstimateDocument = ({ quote }) => {
  const { t, language } = useLanguage();
  const p = t.quote.print;

  const hasScope = quote.scope && typeof quote.scope === 'object';

  return (
    <div className="estimate-document">
      {/* Cabecera solo visible al imprimir: la del sitio se oculta en @media print. */}
      <header className="print-only estimate-print-header">
        <BrandLogo size={28} />
        <div>
          <p className="estimate-print-brand">VulnFocus</p>
          <p className="estimate-print-doctype">{p.documentTitle}</p>
        </div>
      </header>

      <section className="estimate-section print-block">
        <h3 className="estimate-section-title">{p.client}</h3>
        <p className="estimate-text">
          {quote.company}
          {quote.contactName ? ` · ${quote.contactName}` : ''}
        </p>
      </section>

      <section className="estimate-section print-block">
        <h3 className="estimate-section-title">{p.objective}</h3>
        <p className="estimate-text">{p.objectiveText}</p>
      </section>

      {hasScope && (
        <section className="estimate-section print-block">
          <h3 className="estimate-section-title">{p.scope}</h3>
          {Object.entries(quote.scope).map(([serviceId, answers]) => {
            const service = serviceById(serviceId);
            if (!service) return null;
            return (
              <div key={serviceId} className="estimate-scope-block">
                <h4 className="estimate-scope-title">
                  {service.labels[language] || service.labels.es}
                </h4>
                <ul className="estimate-scope-list">
                  {service.questions.map((question) => (
                    <li key={question.id}>
                      <span>{question.labels[language] || question.labels.es}</span>
                      <strong>{answerLabel(question, answers?.[question.id], language, t)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}

      <section className="estimate-section print-block">
        <h3 className="estimate-section-title">{p.methodology}</h3>
        <p className="estimate-text">{p.methodologyText}</p>
      </section>

      <section className="estimate-section print-block">
        <h3 className="estimate-section-title">{p.exclusions}</h3>
        <p className="estimate-text">{p.exclusionsText}</p>
      </section>

      <section className="estimate-section print-block">
        <h3 className="estimate-section-title">{p.disclaimer}</h3>
        <p className="estimate-text">{p.disclaimerText}</p>
      </section>

      <footer className="print-only estimate-print-footer">{p.footer}</footer>
    </div>
  );
};

export default EstimateDocument;
