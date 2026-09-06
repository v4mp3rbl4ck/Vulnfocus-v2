import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import useTurnstile from '../../hooks/useTurnstile';
import { track } from '../../lib/analytics';
import QuoteField from './QuoteField';
import EstimateResult from './EstimateResult';
import { createQuote } from './quoteApi';
import { clearDraft, loadDraft, saveDraft } from './storage';
import {
  MAX_SERVICES,
  STEPS,
  buildPayload,
  catalog,
  defaultScopeFor,
  getService,
  goToStep,
  initialState,
  nextStep,
  prevStep,
  setContactField,
  setContextAnswer,
  setScopeAnswer,
  toggleService,
  validateStep,
} from './wizardMachine';

const CURRENCY = 'CLP';

/**
 * Cotizador por pasos.
 *
 * Divulgación progresiva: nunca se muestran las 49 preguntas del catálogo a la
 * vez, solo las del servicio elegido y del paso actual. El borrador técnico se
 * guarda en sessionStorage para no perder el progreso al navegar sin querer;
 * los datos de contacto NO se guardan (ver storage.js).
 */
const QuoteWizard = () => {
  const { t, language } = useLanguage();
  const [searchParams] = useSearchParams();
  const preselected = searchParams.get('servicio');

  const [state, setState] = useState(() => {
    const base = initialState(preselected);
    // Un servicio preseleccionado desde una página de servicio manda sobre el
    // borrador: es una intención explícita y reciente.
    if (base.services.length > 0) return { ...base, step: 1 };
    const draft = loadDraft();
    if (!draft) return base;
    const services = draft.services.filter((id) => getService(id));
    if (services.length === 0) return base;
    const scope = {};
    for (const id of services) scope[id] = { ...defaultScopeFor(id), ...(draft.scope[id] || {}) };
    return { ...base, services, scope, context: { ...base.context, ...draft.context }, step: draft.step };
  });

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [quote, setQuote] = useState(null);
  const headingRef = useRef(null);
  const startedRef = useRef(false);

  const turnstile = useTurnstile({ language });

  const messages = useMemo(
    () => ({
      required: t.quote.errors.required,
      invalidEmail: t.quote.errors.invalidEmail,
      invalidPhone: t.quote.errors.invalidPhone,
      tooLong: t.quote.errors.tooLong,
      serviceEmpty: t.quote.service.empty,
      numberRange: language === 'es' ? 'Introduce un número entre {min} y {max}' : 'Enter a number between {min} and {max}',
    }),
    [t, language],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    track('quote_started');
  }, []);

  // El borrador se guarda en cada cambio del alcance técnico.
  useEffect(() => {
    if (quote) return;
    saveDraft(state);
  }, [state, quote]);

  // Al cambiar de paso, el foco va al encabezado: sin esto, quien navega con
  // teclado o lector de pantalla se queda en el botón anterior sin saber que la
  // página cambió.
  useEffect(() => {
    if (headingRef.current) headingRef.current.focus();
  }, [state.step]);

  const stepKey = STEPS[state.step];
  const isEstimate = stepKey === 'estimate';

  const handleNext = useCallback(() => {
    const result = validateStep(state, state.step, messages);
    setErrors(result.errors);
    if (!result.ok) return;

    if (stepKey === 'service') {
      track('quote_service_selected', {
        service: state.services[0],
        services_count: state.services.length,
      });
    }
    if (stepKey === 'scope') track('quote_scope_completed', { services_count: state.services.length });

    setState((s) => nextStep(s));
  }, [state, stepKey, messages]);

  const handleBack = useCallback(() => {
    setErrors({});
    setState((s) => prevStep(s));
  }, []);

  const handleSubmit = useCallback(async () => {
    const result = validateStep(state, state.step, messages);
    setErrors(result.errors);
    if (!result.ok) return;

    setSubmitting(true);
    setSubmitError('');

    const response = await createQuote(
      buildPayload(state, { turnstileToken: turnstile.token, currency: CURRENCY }),
    );

    setSubmitting(false);
    turnstile.reset();

    if (!response.ok) {
      setSubmitError(t.quote.errors[response.error] || t.quote.errors.generic);
      return;
    }

    clearDraft();
    setQuote(response.quote);
    setState((s) => goToStep(s, STEPS.indexOf('estimate')));
    track('quote_completed', {
      services_count: state.services.length,
      complexity: response.quote.complexity,
      currency: CURRENCY,
    });
  }, [state, messages, turnstile, t]);

  // ---------------------------------------------------------------- pasos ---

  const renderService = () => (
    <>
      <p className="quote-step-help">{t.quote.service.help.replace('{max}', MAX_SERVICES)}</p>
      <div className="quote-service-grid" role="group" aria-label={t.quote.service.title}>
        {catalog.services.map((service) => {
          const selected = state.services.includes(service.id);
          const disabled = !selected && state.services.length >= MAX_SERVICES;
          return (
            <button
              key={service.id}
              type="button"
              className={`quote-service-card ${selected ? 'quote-service-selected' : ''}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => setState((s) => toggleService(s, service.id))}
            >
              <span className="quote-service-name">
                {service.labels[language] || service.labels.es}
              </span>
              <span className="quote-service-summary">
                {service.summary[language] || service.summary.es}
              </span>
              {selected && <Check size={18} className="quote-service-check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {state.services.length >= MAX_SERVICES && (
        <p className="quote-step-note">{t.quote.service.limitReached}</p>
      )}
      {errors.services && (
        <p className="error-text" role="alert">{errors.services}</p>
      )}
    </>
  );

  const renderScope = () => (
    <>
      <p className="quote-step-help">{t.quote.scope.help}</p>
      {state.services.map((serviceId) => {
        const service = getService(serviceId);
        return (
          <fieldset key={serviceId} className="quote-fieldset">
            <legend className="quote-legend">
              {t.quote.scope.sectionFor.replace(
                '{service}',
                service.labels[language] || service.labels.es,
              )}
            </legend>
            {service.questions.map((question) => (
              <QuoteField
                key={question.id}
                question={question}
                idPrefix={`scope-${serviceId}`}
                value={state.scope[serviceId]?.[question.id]}
                error={errors[`${serviceId}.${question.id}`]}
                onChange={(value) => setState((s) => setScopeAnswer(s, serviceId, question.id, value))}
              />
            ))}
          </fieldset>
        );
      })}
    </>
  );

  const renderContext = () => (
    <>
      <p className="quote-step-help">{t.quote.context.help}</p>
      <fieldset className="quote-fieldset">
        <legend className="quote-legend">{t.quote.context.title}</legend>
        {catalog.context.questions.map((question) => (
          <QuoteField
            key={question.id}
            question={question}
            idPrefix="context"
            value={state.context[question.id]}
            error={errors[question.id]}
            onChange={(value) => setState((s) => setContextAnswer(s, question.id, value))}
          />
        ))}
      </fieldset>
    </>
  );

  const contactField = (field, type = 'text') => {
    const definition = catalog.contact.fields.find((f) => f.id === field);
    const label = definition.labels[language] || definition.labels.es;
    const help = definition.help ? definition.help[language] || definition.help.es : null;
    const Tag = type === 'textarea' ? 'textarea' : 'input';

    return (
      <div className="form-group" key={field}>
        <label className="form-label" htmlFor={`contact-${field}`}>
          {label}
          {definition.required ? ' *' : ''}
        </label>
        <Tag
          id={`contact-${field}`}
          name={field}
          {...(type === 'textarea' ? { rows: 4 } : { type })}
          className={`${type === 'textarea' ? 'form-textarea' : 'form-input'} ${errors[field] ? 'input-error' : ''}`}
          value={state.contact[field]}
          maxLength={definition.maxLength}
          disabled={submitting}
          aria-invalid={errors[field] ? 'true' : undefined}
          aria-describedby={
            [help ? `contact-${field}-help` : null, errors[field] ? `contact-${field}-error` : null]
              .filter(Boolean)
              .join(' ') || undefined
          }
          onChange={(e) => setState((s) => setContactField(s, field, e.target.value))}
        />
        {help && (
          <p className="quote-field-help" id={`contact-${field}-help`}>{help}</p>
        )}
        {errors[field] && (
          <p className="error-text" id={`contact-${field}-error`} role="alert">{errors[field]}</p>
        )}
      </div>
    );
  };

  const renderContact = () => (
    <>
      <p className="quote-step-help">{t.quote.contact.help}</p>

      {contactField('company')}
      {contactField('name')}
      {contactField('email', 'email')}
      {contactField('phone', 'tel')}
      {contactField('notes', 'textarea')}

      <p className="quote-privacy">{t.quote.contact.privacy}</p>

      <section className="quote-summary" aria-labelledby="quote-summary-title">
        <h3 id="quote-summary-title" className="quote-summary-title">{t.quote.summary.title}</h3>

        <dl className="quote-summary-list">
          <div>
            <dt>{t.quote.summary.services}</dt>
            <dd>
              {state.services
                .map((id) => {
                  const service = getService(id);
                  return service.labels[language] || service.labels.es;
                })
                .join(' + ')}
            </dd>
          </div>

          {state.services.map((serviceId) => {
            const service = getService(serviceId);
            return (
              <div key={serviceId}>
                <dt>{service.labels[language] || service.labels.es}</dt>
                <dd>
                  <ul className="quote-summary-answers">
                    {service.questions.map((question) => (
                      <li key={question.id}>
                        <span className="quote-summary-key">
                          {question.labels[language] || question.labels.es}
                        </span>
                        <span className="quote-summary-value">
                          {formatAnswer(state.scope[serviceId]?.[question.id], question, language, t)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            );
          })}

          <div>
            <dt>{t.quote.summary.context}</dt>
            <dd>
              <ul className="quote-summary-answers">
                {catalog.context.questions.map((question) => (
                  <li key={question.id}>
                    <span className="quote-summary-key">
                      {question.labels[language] || question.labels.es}
                    </span>
                    <span className="quote-summary-value">
                      {formatAnswer(state.context[question.id], question, language, t)}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>

        <button type="button" className="btn-link" onClick={() => setState((s) => goToStep(s, 1))}>
          {t.quote.actions.edit}
        </button>
      </section>

      {turnstile.enabled && (
        <div className="form-group">
          <div ref={turnstile.containerRef} />
          {!turnstile.token && <p className="form-hint">{t.quote.contact.captchaPending}</p>}
        </div>
      )}

      <div aria-live="polite">
        {submitError && (
          <p className="status-message error">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{submitError}</span>
          </p>
        )}
      </div>
    </>
  );

  // ---------------------------------------------------------------------------

  if (isEstimate && quote) {
    return (
      <div className="quote-wizard quote-wizard-result">
        <EstimateResult quote={quote} />
        <p className="quote-restart no-print">
          <Link to="/cotizar" onClick={() => window.location.reload()} className="btn-link">
            {t.quote.actions.restart}
          </Link>
        </p>
      </div>
    );
  }

  const total = STEPS.length - 1; // el resultado no es un paso a rellenar
  const current = state.step + 1;
  const percent = Math.round((state.step / total) * 100);

  return (
    <div className="quote-wizard">
      <ol className="quote-steps" aria-label={t.quote.title}>
        {t.quote.steps.slice(0, total).map((step, index) => (
          <li
            key={step.key}
            className={`quote-step-chip ${index === state.step ? 'is-current' : ''} ${index < state.step ? 'is-done' : ''}`}
            aria-current={index === state.step ? 'step' : undefined}
          >
            <span className="quote-step-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="quote-step-label">{step.label}</span>
          </li>
        ))}
      </ol>

      <div
        className="quote-progress"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t.quote.progress.replace('{current}', current).replace('{total}', total)}
      >
        <div className="quote-progress-bar" style={{ width: `${percent}%` }} />
      </div>

      <h2 className="quote-step-title" tabIndex={-1} ref={headingRef}>
        {t.quote[stepKey]?.title || t.quote.title}
      </h2>

      <div className="quote-step-body">
        {stepKey === 'service' && renderService()}
        {stepKey === 'scope' && renderScope()}
        {stepKey === 'context' && renderContext()}
        {stepKey === 'contact' && renderContact()}
      </div>

      <div className="quote-nav">
        {state.step > 0 && (
          <button type="button" className="btn-secondary" onClick={handleBack} disabled={submitting}>
            <ArrowLeft size={18} aria-hidden="true" />
            {t.quote.actions.back}
          </button>
        )}

        {stepKey === 'contact' ? (
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting || (turnstile.enabled && !turnstile.token)}
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                {t.quote.actions.submitting}
              </>
            ) : (
              <>
                {t.quote.actions.submit}
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={handleNext}>
            {t.quote.actions.next}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

/** Representación legible de una respuesta en el resumen. */
function formatAnswer(value, question, language, t) {
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

export default QuoteWizard;
