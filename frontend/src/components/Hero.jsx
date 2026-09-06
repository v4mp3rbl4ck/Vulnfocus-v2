import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const Hero = () => {
  const { t, language } = useLanguage();

  return (
    <section
      className="hero-section"
      aria-label={language === 'es' ? 'Presentación' : 'Introduction'}
    >
      <div className="hero-container">
        <div className="hero-content">
          <div className="hero-left">
            <p className="hero-eyebrow">{t.hero.eyebrow}</p>
            <h1 className="hero-title">{t.hero.title}</h1>
            <p className="hero-subtitle">{t.hero.subtitle}</p>

            <div
              className="hero-cta-group"
              role="group"
              aria-label={language === 'es' ? 'Acciones principales' : 'Main actions'}
            >
              <Link to="/cotizar" className="btn-primary">
                {t.hero.ctaSecondary}
                <ArrowRight size={20} aria-hidden="true" />
              </Link>
              <Link to="/#contacto" className="btn-secondary">
                {t.hero.ctaPrimary}
              </Link>
            </div>

            <ul className="hero-badges" aria-label={language === 'es' ? 'Áreas de trabajo' : 'Practice areas'}>
              {t.hero.badges.map((badge) => (
                <li key={badge} className="badge">{badge}</li>
              ))}
            </ul>
          </div>

          <div className="hero-right">
            <article className="benefits-card" aria-labelledby="benefits-title">
              <h2 id="benefits-title" className="benefits-title">{t.hero.whatYouGet}</h2>
              <ul className="benefits-list">
                {t.hero.benefits.map((benefit) => (
                  <li key={benefit} className="benefit-item">
                    <CheckCircle2 size={20} className="benefit-icon" aria-hidden="true" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
              <p className="benefits-timeframe">{t.hero.timeframe}</p>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
