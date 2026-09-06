import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Send, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import useTurnstile from '../../hooks/useTurnstile';
import { TURNSTILE_STATUS } from '../../lib/turnstileWidget';
import {
  PROPOSAL_TEXT_LIMITS,
  targetDateBounds,
  validateTargetDate,
} from '../../config/proposal-request';
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
/** Campos con un hueco propio bajo el que mostrar su error. */
const FORM_FIELDS = ['notes', 'targetDate', 'scopeNotes'];

const ProposalRequestForm = ({ quote, onClose, onRequested }) => {
  const { t, language } = useLanguage();
  const p = t.quote.proposal;
  const turnstile = useTurnstile({ language });

  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);

  const [status, setStatus] = useState('loading'); // loading | ready | sending | done | error
  const [prefill, setPrefill] = useState(null);
  const [alreadyRequested, setAlreadyRequested] = useState(false);
  // `error` es el aviso general; `fieldErrors` va debajo del campo culpable.
  // Separados a propósito: un error de un campo concreto mostrado solo como
  // banner obliga a adivinar cuál de los tres hay que corregir.
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [form, setForm] = useState({ notes: '', targetDate: '', scopeNotes: '', website: '' });

  // Los límites del calendario salen de la MISMA regla que aplica el Worker
  // (config/proposal-request.js). Se calculan una vez por apertura: el diálogo
  // no vive lo bastante como para que cambie el día.
  const bounds = useMemo(() => targetDateBounds(), []);

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

  /**
   * Texto para un error de campo.
   *
   * Prioridad: traducción propia por (campo, motivo) → mensaje del servidor →
   * genérico. El servidor responde siempre en español; su texto es la reserva
   * para códigos que esta versión de la interfaz todavía no conozca, no la
   * primera opción.
   */
  const fieldErrorText = useCallback(
    (field, reason, serverMessage) => {
      const plantilla = p.fieldErrors?.[field]?.[reason];
      if (plantilla) return plantilla.replace('{max}', bounds.max);
      return serverMessage || p.errors.generic;
    },
    [p, bounds],
  );

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  /**
   * La fecha se valida al cambiarla, no solo al enviar: el error desaparece en
   * cuanto se elige una válida, en lugar de quedarse en pantalla contradiciendo
   * a lo que se ve en el campo.
   */
  const updateTargetDate = (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, targetDate: value }));

    const check = validateTargetDate(value);
    setFieldErrors((current) => {
      const next = { ...current };
      if (check.ok) delete next.targetDate;
      else next.targetDate = fieldErrorText('targetDate', check.reason);
      return next;
    });
  };

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();

      // Validación local ANTES de enviar. No sustituye a la del servidor —que
      // vuelve a comprobarlo todo— pero evita un viaje de ida y vuelta para
      // decirle a alguien algo que ya se sabía aquí.
      const fecha = validateTargetDate(form.targetDate);
      if (!fecha.ok) {
        setFieldErrors({ targetDate: fieldErrorText('targetDate', fecha.reason) });
        setError('');
        return;
      }

      setStatus('sending');
      setError('');
      setFieldErrors({});

      // Solo los tres campos adicionales y la verificación. Nada de horas, ni
      // precio, ni alcance: el servidor los toma de D1.
      const result = await requestFormalProposal(publicId, {
        notes: form.notes.trim() || undefined,
        targetDate: form.targetDate || undefined,
        scopeNotes: form.scopeNotes.trim() || undefined,
        website: form.website,
        turnstileToken: turnstile.token,
      });

      // El token es de un solo uso: se pide otro tanto si el envío salió bien
      // como si no. Sin esto, un reintento tras un error reenviaría un token ya
      // gastado y el Worker lo rechazaría con un 403 inexplicable.
      turnstile.reset();

      if (!result.ok) {
        setStatus('ready');

        // Un 400 sobre un campo concreto se pinta bajo ese campo. El banner
        // queda para lo que no pertenece a ninguno: red, verificación, límite de
        // intentos, cotización en curso o fallo del servidor.
        if (result.error === 'validation' && FORM_FIELDS.includes(result.field)) {
          setFieldErrors({
            [result.field]: fieldErrorText(result.field, result.reason, result.message),
          });
          return;
        }

        if (result.error === 'validation') {
          setError(result.message || p.errors.generic);
          return;
        }

        setError(p.errors[result.error] || p.errors.generic);
        return;
      }

      setAlreadyRequested(Boolean(result.proposal.alreadyRequested));
      setStatus('done');
      track('formal_proposal_submitted');
      if (onRequested) onRequested(result.proposal);
    },
    [form, publicId, turnstile, p, onRequested, fieldErrorText],
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
                className={`form-textarea ${fieldErrors.notes ? 'input-error' : ''}`}
                rows={3}
                maxLength={PROPOSAL_TEXT_LIMITS.notes}
                value={form.notes}
                onChange={update('notes')}
                disabled={status === 'sending'}
                aria-invalid={fieldErrors.notes ? 'true' : undefined}
                ref={firstFieldRef}
              />
              {fieldErrors.notes ? (
                <p className="error-text" role="alert">{fieldErrors.notes}</p>
              ) : (
                <p className="quote-field-help">{p.form.notesHelp}</p>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="proposal-target-date" className="form-label">
                {p.form.targetDate}
              </label>
              <input
                type="date"
                id="proposal-target-date"
                className={`form-input ${fieldErrors.targetDate ? 'input-error' : ''}`}
                value={form.targetDate}
                onChange={updateTargetDate}
                disabled={status === 'sending'}
                // Los mismos límites que aplica el Worker: el calendario del
                // navegador ni siquiera deja elegir una fecha que se iba a
                // rechazar después.
                min={bounds.min}
                max={bounds.max}
                aria-invalid={fieldErrors.targetDate ? 'true' : undefined}
                aria-describedby={
                  fieldErrors.targetDate
                    ? 'proposal-target-date-error'
                    : 'proposal-target-date-help'
                }
              />
              {fieldErrors.targetDate ? (
                <p className="error-text" id="proposal-target-date-error" role="alert">
                  {fieldErrors.targetDate}
                </p>
              ) : (
                <p className="quote-field-help" id="proposal-target-date-help">
                  {p.form.targetDateHelp}
                </p>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="proposal-scope-notes" className="form-label">
                {p.form.scopeNotes}
              </label>
              <textarea
                id="proposal-scope-notes"
                className={`form-textarea ${fieldErrors.scopeNotes ? 'input-error' : ''}`}
                rows={3}
                maxLength={PROPOSAL_TEXT_LIMITS.scopeNotes}
                value={form.scopeNotes}
                onChange={update('scopeNotes')}
                disabled={status === 'sending'}
                aria-invalid={fieldErrors.scopeNotes ? 'true' : undefined}
              />
              {fieldErrors.scopeNotes ? (
                <p className="error-text" role="alert">{fieldErrors.scopeNotes}</p>
              ) : (
                <p className="quote-field-help">{p.form.scopeNotesHelp}</p>
              )}
            </div>

            {turnstile.enabled && (
              <div className="form-group">
                <div ref={turnstile.containerRef} />

                {/* Tres estados, y el primero es el que faltaba: pedirle a
                    alguien que complete una verificación que todavía no ha
                    aparecido en pantalla es lo que obligaba a recargar. */}
                {turnstile.status === TURNSTILE_STATUS.LOADING && (
                  <p className="form-hint">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    {p.captcha.loading}
                  </p>
                )}
                {turnstile.ready && !turnstile.solved && (
                  <p className="form-hint">{p.captcha.pending}</p>
                )}
                {turnstile.solved && (
                  <p className="form-hint form-hint-ok">
                    <Check size={14} aria-hidden="true" />
                    {p.captcha.solved}
                  </p>
                )}
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
                // Sin widget montado no hay nada que resolver, y con un token
                // gastado o caducado el envío moriría en un 403 del Worker.
                disabled={
                  status === 'sending' ||
                  Object.keys(fieldErrors).length > 0 ||
                  (turnstile.enabled && !turnstile.solved)
                }
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
