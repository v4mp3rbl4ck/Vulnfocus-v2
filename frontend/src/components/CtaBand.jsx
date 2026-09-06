import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

/**
 * Banda de conversión reutilizable. Existe una sola para que el CTA principal
 * tenga la misma forma y el mismo texto en todo el sitio.
 */
const CtaBand = ({ title, text }) => {
  const { t } = useLanguage();

  return (
    <section className="cta-band" aria-labelledby="cta-band-title">
      <div className="content-wrapper cta-band-inner">
        <div>
          <h2 id="cta-band-title" className="cta-band-title">
            {title || t.servicesSection.detail.ctaTitle}
          </h2>
          <p className="cta-band-text">{text || t.servicesSection.detail.ctaText}</p>
        </div>
        <div className="cta-band-actions">
          <Link to="/cotizar" className="btn-primary">
            {t.common.quoteCta}
            <ArrowRight size={20} aria-hidden="true" />
          </Link>
          <Link to="/#contacto" className="btn-secondary">
            {t.common.contactCta}
          </Link>
        </div>
      </div>
    </section>
  );
};

export default CtaBand;
