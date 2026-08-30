import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mail, Phone, Linkedin, MessageCircle, Send, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../hooks/use-toast';

const Contact = () => {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null); // 'success' | 'error' | null
  const [errorMessage, setErrorMessage] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    message: '',
    website: '' // Honeypot field - debe estar vacío
  });

  const [errors, setErrors] = useState({});

  // --- Cloudflare Turnstile -------------------------------------------------
  // El site key es público por diseño. El secret vive solo en Cloudflare Secrets
  // y se usa exclusivamente en el Worker (validación Siteverify server-side).
  const TURNSTILE_SITE_KEY = process.env.REACT_APP_TURNSTILE_SITE_KEY || '';
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);
  const [turnstileToken, setTurnstileToken] = useState('');

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return undefined;

    let cancelled = false;

    // El script se carga con render=explicit desde public/index.html. Se espera a
    // que window.turnstile exista porque este componente puede montarse antes.
    const render = () => {
      if (cancelled) return;
      if (!window.turnstile || !turnstileRef.current || turnstileWidgetId.current !== null) {
        return;
      }
      turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        language: language === 'en' ? 'en' : 'es',
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'timeout-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken('')
      });
    };

    if (window.turnstile) {
      render();
    } else {
      // turnstile.ready() se encola si la API aún no está lista.
      const poll = setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll);
          render();
        }
      }, 200);
      return () => {
        cancelled = true;
        clearInterval(poll);
      };
    }

    return () => {
      cancelled = true;
    };
    // language solo afecta al idioma del widget en el primer render; no se
    // re-renderiza el widget al cambiar de idioma para no invalidar un token válido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TURNSTILE_SITE_KEY]);

  const resetTurnstile = useCallback(() => {
    setTurnstileToken('');
    if (window.turnstile && turnstileWidgetId.current !== null) {
      window.turnstile.reset(turnstileWidgetId.current);
    }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
          }
        });
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => {
      if (sectionRef.current) {
        observer.unobserve(sectionRef.current);
      }
    };
  }, []);

  const validateForm = () => {
    const newErrors = {};
    
    // Nombre: mínimo 2 caracteres
    if (!formData.name.trim()) {
      newErrors.name = language === 'es' ? 'El nombre es requerido' : 'Name is required';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = language === 'es' ? 'El nombre debe tener al menos 2 caracteres' : 'Name must be at least 2 characters';
    }

    // Email: formato válido
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email.trim()) {
      newErrors.email = language === 'es' ? 'El email es requerido' : 'Email is required';
    } else if (!emailRegex.test(formData.email)) {
      newErrors.email = language === 'es' ? 'Email inválido' : 'Invalid email';
    }

    // Mensaje: mínimo 10 caracteres
    if (!formData.message.trim()) {
      newErrors.message = language === 'es' ? 'El mensaje es requerido' : 'Message is required';
    } else if (formData.message.trim().length < 10) {
      newErrors.message = language === 'es' ? 'El mensaje debe tener al menos 10 caracteres' : 'Message must be at least 10 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
    // Limpiar error del campo cuando el usuario escribe
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' });
    }
  };

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setSubmitStatus(null);
    setErrorMessage('');

    // Validar formulario
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Same-origin: frontend y API viven en https://vulnfocus.com, no hace falta CORS.
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...formData, turnstileToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Manejar diferentes formatos de error
        let errorMsg = language === 'es' ? 'Error al enviar el mensaje' : 'Error sending message';
        
        if (typeof data.detail === 'string') {
          errorMsg = data.detail;
        } else if (data.detail && typeof data.detail === 'object') {
          // Si detail es un objeto, intentar extraer el mensaje
          errorMsg = data.detail.message || data.detail.msg || JSON.stringify(data.detail);
        } else if (data.message) {
          errorMsg = data.message;
        }
        
        throw new Error(errorMsg);
      }

      // Éxito
      setSubmitStatus('success');
      toast({
        title: language === 'es' ? "✅ Mensaje enviado" : "✅ Message sent",
        description: language === 'es' 
          ? "Te contactaremos pronto. ¡Gracias!" 
          : "We'll contact you soon. Thank you!",
      });

      // Limpiar formulario
      setFormData({
        name: '',
        email: '',
        company: '',
        message: '',
        website: ''
      });
      resetTurnstile();

    } catch (error) {
      console.error('Contact form error:', error);
      setSubmitStatus('error');
      
      // Asegurar que siempre mostramos un string
      let errorMsg = language === 'es' 
        ? 'Error al enviar. Intenta de nuevo.' 
        : 'Error sending. Please try again.';
      
      if (error.message && typeof error.message === 'string') {
        errorMsg = error.message;
      } else if (typeof error === 'string') {
        errorMsg = error;
      }
      
      setErrorMessage(errorMsg);
      // Un token de Turnstile es de un solo uso: tras un fallo hay que pedir uno nuevo.
      resetTurnstile();
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, language, toast, turnstileToken, resetTurnstile]);

  const contactChannels = [
    {
      icon: Mail,
      label: t.contact.channels.email,
      value: 'contacto@vulnfocus.com',
      link: 'mailto:contacto@vulnfocus.com'
    },
    {
      icon: MessageCircle,
      label: t.contact.channels.whatsapp,
      value: '+56 9 6413 4886',
      link: 'https://wa.me/+56964134886'
    },
    {
      icon: Linkedin,
      label: t.contact.channels.linkedin,
      value: '/vulnfocus',
      link: 'https://linkedin.com/company/vulnfocus'
    },
    {
      icon: Send,
      label: t.contact.channels.telegram,
      value: '@vulnfocus',
      link: 'https://t.me/v4mp3rbl4ck'
    },
    {
      icon: Phone,
      label: t.contact.channels.phone,
      value: '+56 9 6413 4886',
      link: 'tel:+56964134886'
    }
  ];

  return (
    <section id="contact" className="section-container" ref={sectionRef}>
      <div className="content-wrapper">
        <div className={`contact-header ${visible ? 'fade-in-up' : ''}`}>
          <h2 className="section-title">{t.contact.title}</h2>
          <p className="contact-subtitle">{t.contact.subtitle}</p>
        </div>

        <div className="contact-container">
          <div className={`contact-form-wrapper ${visible ? 'fade-in-up' : ''}`}>
            <form onSubmit={handleSubmit} className="contact-form">
              {/* Honeypot field - oculto para usuarios, visible para bots */}
              <div className="form-group" style={{ 
                position: 'absolute', 
                left: '-9999px', 
                opacity: 0,
                height: 0,
                overflow: 'hidden'
              }} aria-hidden="true">
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
                <label htmlFor="name" className="form-label">
                  {t.contact.form.name} *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={`form-input ${errors.name ? 'input-error' : ''}`}
                  disabled={isSubmitting}
                  minLength={2}
                  maxLength={100}
                />
                {errors.name && <span className="error-text">{errors.name}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="email" className="form-label">
                  {t.contact.form.email} *
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`form-input ${errors.email ? 'input-error' : ''}`}
                  disabled={isSubmitting}
                />
                {errors.email && <span className="error-text">{errors.email}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="company" className="form-label">
                  {t.contact.form.company}
                </label>
                <input
                  type="text"
                  id="company"
                  name="company"
                  value={formData.company}
                  onChange={handleChange}
                  className="form-input"
                  disabled={isSubmitting}
                  maxLength={100}
                />
              </div>

              <div className="form-group">
                <label htmlFor="message" className="form-label">
                  {t.contact.form.message} *
                </label>
                <textarea
                  id="message"
                  name="message"
                  value={formData.message}
                  onChange={handleChange}
                  className={`form-textarea ${errors.message ? 'input-error' : ''}`}
                  rows="5"
                  disabled={isSubmitting}
                  minLength={10}
                  maxLength={5000}
                ></textarea>
                {errors.message && <span className="error-text">{errors.message}</span>}
              </div>

              {/* Cloudflare Turnstile */}
              {TURNSTILE_SITE_KEY && (
                <div className="form-group">
                  <div ref={turnstileRef} />
                </div>
              )}

              {/* Mensaje de estado */}
              {submitStatus === 'error' && (
                <div className="status-message error">
                  <AlertCircle size={18} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {submitStatus === 'success' && (
                <div className="status-message success">
                  <CheckCircle size={18} />
                  <span>{language === 'es' ? '¡Mensaje enviado correctamente!' : 'Message sent successfully!'}</span>
                </div>
              )}

              <button 
                type="submit" 
                className="btn-primary btn-full"
                disabled={isSubmitting || (Boolean(TURNSTILE_SITE_KEY) && !turnstileToken)}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    {language === 'es' ? 'Enviando...' : 'Sending...'}
                  </>
                ) : (
                  <>
                    {t.contact.form.submit}
                    <Send size={20} />
                  </>
                )}
              </button>
            </form>
          </div>

          <div className={`contact-channels ${visible ? 'fade-in-up' : ''}`}>
            {contactChannels.map((channel, index) => (
              <a
                key={index}
                href={channel.link}
                target="_blank"
                rel="noopener noreferrer"
                className="channel-item"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="channel-icon-wrapper">
                  <channel.icon size={24} className="channel-icon" />
                </div>
                <div className="channel-info">
                  <span className="channel-label">{channel.label}</span>
                  <span className="channel-value">{channel.value}</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
