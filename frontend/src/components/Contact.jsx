import React, { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, CheckCircle, Linkedin, Loader2, Mail, MessageCircle, Phone, Send,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { toast } from './ui/sonner';
import useReveal from '../hooks/useReveal';
import useTurnstile from '../hooks/useTurnstile';
import { track } from '../lib/analytics';

const CONTACT_CHANNELS = [
  { key: 'email', icon: Mail, value: 'contacto@vulnfocus.com', link: 'mailto:contacto@vulnfocus.com' },
  { key: 'whatsapp', icon: MessageCircle, value: '+56 9 6413 4886', link: 'https://wa.me/+56964134886' },
  { key: 'linkedin', icon: Linkedin, value: '/vulnfocus', link: 'https://linkedin.com/company/vulnfocus' },
  { key: 'telegram', icon: Send, value: '@vulnfocus', link: 'https://t.me/v4mp3rbl4ck' },
  { key: 'phone', icon: Phone, value: '+56 9 6413 4886', link: 'tel:+56964134886' },
];

const EMPTY_FORM = { name: '', email: '', company: '', message: '', website: '' };

const Contact = () => {
  const { t, language } = useLanguage();
  const [ref, visible] = useReveal();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null); // 'success' | 'error' | null
  const [errorMessage, setErrorMessage] = useState('');
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  // Turnstile: el widget y su token los gestiona un hook compartido con el
  // cotizador, para que ambos formularios se comporten igual.
  const turnstile = useTurnstile({ language });

  const validateForm = useCallback(() => {
    const next = {};
    const es = language === 'es';

    if (!formData.name.trim()) next.name = es ? 'El nombre es obligatorio' : 'Name is required';
    else if (formData.name.trim().length < 2) {
      next.name = es ? 'El nombre debe tener al menos 2 caracteres' : 'Name must be at least 2 characters';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email.trim()) next.email = es ? 'El email es obligatorio' : 'Email is required';
    else if (!emailRegex.test(formData.email)) next.email = es ? 'Email no válido' : 'Invalid email';

    if (!formData.message.trim()) next.message = es ? 'El mensaje es obligatorio' : 'Message is required';
    else if (formData.message.trim().length < 10) {
      next.message = es ? 'El mensaje debe tener al menos 10 caracteres' : 'Message must be at least 10 characters';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [formData, language]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev));
  };

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitStatus(null);
      setErrorMessage('');

      if (!validateForm()) return;

      setIsSubmitting(true);

      try {
        // Same-origin: frontend y API viven en el mismo host, no hace falta CORS.
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, turnstileToken: turnstile.token }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            typeof data.message === 'string' && data.message
              ? data.message
              : t.contact.form.genericError,
          );
        }

        setSubmitStatus('success');
        toast.success(t.contact.form.success);
        track('contact_submitted');
        setFormData(EMPTY_FORM);
        turnstile.reset();
      } catch (error) {
        setSubmitStatus('error');
        setErrorMessage(
          error && typeof error.message === 'string' && error.message
            ? error.message
            : t.contact.form.genericError,
        );
        // Un token de Turnstile es de un solo uso: tras un fallo hay que pedir otro.
        turnstile.reset();
      } finally {
        setIsSubmitting(false);
      }
    },
    [formData, t, turnstile, validateForm],
  );

  const fieldProps = (name) => ({
    id: name,
    name,
    value: formData[name],
    onChange: handleChange,
    disabled: isSubmitting,
    'aria-invalid': errors[name] ? 'true' : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  });

  return (
    <section id="contacto" className="section-container" ref={ref} aria-labelledby="contact-title">
      <div className="content-wrapper">
        <div className={`contact-header ${visible ? 'fade-in-up' : ''}`}>
          <h2 id="contact-title" className="section-title">{t.contact.title}</h2>
          <p className="contact-subtitle">{t.contact.subtitle}</p>
          <p className="contact-quote-hint">
            {t.contact.quoteHint}{' '}
            <Link to="/cotizar" className="inline-link">{t.contact.quoteHintCta}</Link>
          </p>
        </div>

        <div className="contact-container">
          <div className={`contact-form-wrapper ${visible ? 'fade-in-up' : ''}`}>
            <form onSubmit={handleSubmit} className="contact-form" noValidate>
              {/* Honeypot: oculto para personas, visible para bots. El estilo vive
                  en App.css y no como atributo inline, para no depender de
                  style-src 'unsafe-inline'. */}
              <div className="honeypot-field" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input
                  type="text"
                  id="website"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              <div className="form-group">
                <label htmlFor="name" className="form-label">{t.contact.form.name} *</label>
                <input
                  type="text"
                  className={`form-input ${errors.name ? 'input-error' : ''}`}
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  {...fieldProps('name')}
                />
                {errors.name && <span id="name-error" className="error-text">{errors.name}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="email" className="form-label">{t.contact.form.email} *</label>
                <input
                  type="email"
                  className={`form-input ${errors.email ? 'input-error' : ''}`}
                  maxLength={254}
                  autoComplete="email"
                  {...fieldProps('email')}
                />
                {errors.email && <span id="email-error" className="error-text">{errors.email}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="company" className="form-label">{t.contact.form.company}</label>
                <input
                  type="text"
                  className="form-input"
                  maxLength={100}
                  autoComplete="organization"
                  {...fieldProps('company')}
                />
              </div>

              <div className="form-group">
                <label htmlFor="message" className="form-label">{t.contact.form.message} *</label>
                <textarea
                  className={`form-textarea ${errors.message ? 'input-error' : ''}`}
                  rows="5"
                  minLength={10}
                  maxLength={5000}
                  {...fieldProps('message')}
                />
                {errors.message && <span id="message-error" className="error-text">{errors.message}</span>}
              </div>

              {turnstile.enabled && (
                <div className="form-group">
                  <div ref={turnstile.containerRef} />
                </div>
              )}

              <div aria-live="polite">
                {submitStatus === 'error' && (
                  <p className="status-message error">
                    <AlertCircle size={18} aria-hidden="true" />
                    <span>{errorMessage}</span>
                  </p>
                )}
                {submitStatus === 'success' && (
                  <p className="status-message success">
                    <CheckCircle size={18} aria-hidden="true" />
                    <span>{t.contact.form.success}</span>
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="btn-primary btn-full"
                disabled={isSubmitting || (turnstile.enabled && !turnstile.token)}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={20} className="animate-spin" aria-hidden="true" />
                    {t.contact.form.sending}
                  </>
                ) : (
                  <>
                    {t.contact.form.submit}
                    <Send size={20} aria-hidden="true" />
                  </>
                )}
              </button>

              {turnstile.enabled && !turnstile.token && !isSubmitting && (
                <p className="form-hint">{t.contact.form.captchaPending}</p>
              )}
            </form>
          </div>

          <ul className={`contact-channels ${visible ? 'fade-in-up' : ''}`}>
            {CONTACT_CHANNELS.map((channel) => (
              <li key={channel.key}>
                <a href={channel.link} target="_blank" rel="noopener noreferrer" className="channel-item">
                  <span className="channel-icon-wrapper">
                    <channel.icon size={22} className="channel-icon" aria-hidden="true" />
                  </span>
                  <span className="channel-info">
                    <span className="channel-label">{t.contact.channels[channel.key]}</span>
                    <span className="channel-value">{channel.value}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default Contact;
