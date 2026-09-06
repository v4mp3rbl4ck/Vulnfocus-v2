import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Send, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import useTurnstile from '../../hooks/useTurnstile';
import { track } from '../../lib/analytics';
import { fetchProposalPrefill, requestFormalProposal } from './quoteApi';

/** Importe con separadores locales. El servidor ya lo devuelve redondeado. */
function formatAmount(value, language) {
  try {
    return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'es-CL', {
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return String(value);
  }
}

/**
 * SOLICITUD DE PROPUESTA FORMAL desde /estimacion?id=<public_id>.
 *
 * Sustituye al enlace que llevaba al formulario de contacto genérico. Aquel
 * perdía la cotización: el visitante llegaba a un formulario en blanco y tenía
 * que volver a describir lo que acababa de responder, y por el otro extremo
 * llegaba un mensaje suelto que nadie podía asociar a la estimación.
 *
 * Aquí no se vuelve a pedir nada que ya esté en la base:
 *
 *  · Los datos de la cotización se recuperan del servidor con el `public_id`.
 *    D1 es la fuente de verdad. No se usa localStorage ni sessionStorage: el
 *    enlace puede abrirse en otro dispositivo o semanas después, y lo que
 *    guardara el navegador no tendría por qué seguir siendo cierto.
 *  · El correo y el teléfono llegan enmascarados. Sirven para que el cliente
 *    confirme a dónde va la propuesta, que es lo único que necesita; el enlace
 *    de una estimación se comparte, y no debe convertirse en una ficha de
 *    contacto para quien lo reciba reenviado.
 *  · Horas, complejidad, alcance y precio se muestran, pero no se envían. El
 *    servidor los lee de D1 e ignora cualquier cosa que llegue en el cuerpo:
 *    tocarlos desde las herramientas del navegador no cambia nada.
 *
 * El único campo obligatorio es la verificación. Todo lo demás es opcional
 * porque, de verdad, ya lo sabemos.
 */
const ProposalRequestForm = ({ quote, onClose, onRequested }) => {
  const { t, language } = useLanguage();
  const p = t.quote.proposal;
  const turnstile = useTurnstile({ language });

  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);

  const [status, setStatus] = useState('loading'); // loading | ready | sending | done | error
  const [prefill, setPrefill] = useState(null);
  const [alreadyRequested, setAlreadyRequested] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ notes: '', targetDate: '', scopeNotes: '', website: '' });

  const publicId = quote?.publicId || '';

  // --- Datos reales, desde el servidor --------------------------------------
  useEffect(() => {
    let cancelled = false;

    if (!/^[0-9a-f]{32}$/.test(publicId)) {
      setStatus('error');
      setError(p.errors.notFound);
      return () => {
        cancelled = true;
      };
    }

    fetchProposalPrefill(publicId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setStatus('error');
        setError(p.errors[result.error] || p.errors.generic);
        return;
      }
      setPrefill(result.quote);
      setAlreadyRequested(Boolean(result.proposal.requested));
      setStatus(result.proposal.requested ? 'done' : 'ready');
    });

    return () => {
      cancelled = true;
    };
  }, [publicId, p]);

  // --- Diálogo: escape, foco inicial y foco atrapado -------------------------
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      // Sin esto el tabulador se escapa a la página de detrás, que está oculta
      // para el lector de pantalla: el foco desaparecería sin explicación.
      const focusable = dialogRef.current.querySelectorAll(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (status === 'ready' && firstFieldRef.current) firstFieldRef.current.focus();
  }, [status]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setStatus('sending');
      setError('');

      // Solo los tres campos adicionales y la verificación. Nada de horas, ni
      // precio, ni alcance: el servidor los toma de D1.
      const result = await requestFormalProposal(publicId, {
        notes: form.notes.trim() || undefined,
        targetDate: form.targetDate || undefined,
        scopeNotes: form.scopeNotes.trim() || undefined,
        website: form.website,
        turnstileToken: turnstile.token,
      });

      turnstile.reset();

      if (!result.ok) {
        setStatus('ready');
        setError(p.errors[result.error] || p.errors.generic);
        return;
      }

      setAlreadyRequested(Boolean(result.proposal.alreadyRequested));
      setStatus('done');
      track('formal_proposal_submitted');
      if (onRequested) onRequested(result.proposal);
    },
    [form, publicId, turnstile, p, onRequested],
  );

  const summary = prefill || quote;

  return (
    <div className="proposal-overlay no-print" role="presentation" onMouseDown={onClose}>
      <div
        className="proposal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-title"
        ref={dialogRef}
        // El clic dentro no debe cerrar: solo el del fondo.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="proposal-header">
          <h2 id="proposal-title" className="proposal-title">{p.title}</h2>
          <button type="button" className="proposal-close" onClick={onClose} aria-label={p.close}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {status === 'loading' && (
          <p className="proposal-loading" aria-live="polite">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            {p.loading}
          </p>
        )}

        {status === 'error' && (
          <p className="status-message error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        {/* El resumen de la estimación acompaña al formulario en todo momento:
            quien la pide tiene que ver qué está pidiendo, sin cambiar de página. */}
        {summary && status !== 'loading' && status !== 'error' && (
          <section className="proposal-summary" aria-labelledby="proposal-summary-title">
            <h3 id="proposal-summary-title" className="proposal-summary-title">
              {p.summaryTitle}
            </h3>
            <dl className="proposal-summary-list">
              <div>
                <dt>{p.fields.quoteNumber}</dt>
                <dd>{summary.quoteNumber}</dd>
              </div>
              <div>
                <dt>{p.fields.company}</dt>
                <dd>{summary.company}</dd>
              </div>
              <div>
                <dt>{p.fields.contactName}</dt>
                <dd>{summary.contactName}</dd>
              </div>
              {prefill?.email && (
                <div>
                  <dt>{p.fields.email}</dt>
                  <dd>{prefill.email}</dd>
                </div>
              )}
              {prefill?.phone && (
                <div>
                  <dt>{p.fields.phone}</dt>
                  <dd>{prefill.phone}</dd>
                </div>
              )}
              {prefill?.scopeSummary && (
                <div>
                  <dt>{p.fields.scope}</dt>
                  <dd>{prefill.scopeSummary}</dd>
                </div>
              )}
              <div>
                <dt>{p.fields.complexity}</dt>
                <dd>{t.quote.complexityLabels[summary.complexity] || summary.complexity}</dd>
              </div>
              <div>
                <dt>{p.fields.effort}</dt>
                <dd>
                  {summary.effort.minHours}–{summary.effort.maxHours} {t.quote.estimate.hours}
                </dd>
              </div>
              {/* El importe solo aparece si el servidor lo devuelve, y el
                  servidor solo lo devuelve con el precio habilitado. */}
              {prefill?.pricing?.available && (
                <div>
                  <dt>{p.fields.price}</dt>
                  <dd>
                    {formatAmount(prefill.pricing.min, language)}–
                    {formatAmount(prefill.pricing.max, language)} {prefill.pricing.currency}
                  </dd>
                </div>
              )}
            </dl>
            <p className="proposal-prefilled-note">{p.prefilledNote}</p>
          </section>
        )}

        {status === 'done' && (
          <div className="proposal-done" role="status">
            <p className="status-message success">
              <Check size={18} aria-hidden="true" />
              <span>{alreadyRequested ? p.alreadyRequested : p.success}</span>
            </p>
            <p className="proposal-next">{p.nextSteps}</p>
            <button type="button" className="btn-primary" onClick={onClose}>
              {p.closeAction}
            </button>
          </div>
        )}

        {(status === 'ready' || status === 'sending') && (
          <form className="proposal-form" onSubmit={handleSubmit} noValidate>
            <p className="proposal-help">{p.help}</p>

            {/* Honeypot: mismo mecanismo que en el resto de formularios. */}
            <div className="honeypot-field" aria-hidden="true">
              <label htmlFor="proposal-website">Website</label>
              <input
                type="text"
                id="proposal-website"
                name="website"
                value={form.website}
                onChange={update('website')}
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="proposal-notes" className="form-label">{p.form.notes}</label>
              <textarea
                id="proposal-notes"
                className="form-textarea"
                rows={3}
                maxLength={1000}
                value={form.notes}
                onChange={update('notes')}
                disabled={status === 'sending'}
                ref={firstFieldRef}
              />
              <p className="quote-field-help">{p.form.notesHelp}</p>
            </div>

            <div className="form-group">
              <label htmlFor="proposal-target-date" className="form-label">
                {p.form.targetDate}
              </label>
              <input
                type="date"
                id="proposal-target-date"
                className="form-input"
                value={form.targetDate}
                onChange={update('targetDate')}
                disabled={status === 'sending'}
              />
              <p className="quote-field-help">{p.form.targetDateHelp}</p>
            </div>

            <div className="form-group">
              <label htmlFor="proposal-scope-notes" className="form-label">
                {p.form.scopeNotes}
              </label>
              <textarea
                id="proposal-scope-notes"
                className="form-textarea"
                rows={3}
                maxLength={1000}
                value={form.scopeNotes}
                onChange={update('scopeNotes')}
                disabled={status === 'sending'}
              />
              <p className="quote-field-help">{p.form.scopeNotesHelp}</p>
            </div>

            {turnstile.enabled && (
              <div className="form-group">
                <div ref={turnstile.containerRef} />
                {!turnstile.token && <p className="form-hint">{t.quote.contact.captchaPending}</p>}
              </div>
            )}

            <p className="quote-privacy">{p.privacy}</p>

            <div aria-live="polite">
              {error && (
                <p className="status-message error" role="alert">
                  <AlertCircle size={18} aria-hidden="true" />
                  <span>{error}</span>
                </p>
              )}
            </div>

            <div className="proposal-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={status === 'sending' || (turnstile.enabled && !turnstile.token)}
              >
                {status === 'sending' ? (
                  <>
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                    {p.sending}
                  </>
                ) : (
                  <>
                    {p.submit}
                    <Send size={18} aria-hidden="true" />
                  </>
                )}
              </button>
              <button type="button" className="btn-secondary" onClick={onClose}>
                {p.cancel}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ProposalRequestForm;
