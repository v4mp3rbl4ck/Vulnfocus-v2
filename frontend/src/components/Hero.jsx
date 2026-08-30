import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const Hero = () => {
  const { t, language } = useLanguage();

  const scrollToSection = (id) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  return (
    <section className="hero-section" aria-label={language === 'es' ? 'Sección principal' : 'Main section'}>
      <div className="hero-container">
        <div className="hero-content">
          <div className="hero-left">
            <h1 className="hero-title">{t.hero.title}</h1>
            <p className="hero-subtitle">{t.hero.subtitle}</p>
            
            <div className="hero-cta-group" role="group" aria-label={language === 'es' ? 'Acciones principales' : 'Main actions'}>
              <button 
                onClick={() => scrollToSection('contact')} 
                className="btn-primary"
                aria-label={t.hero.ctaPrimary}
              >
                {t.hero.ctaPrimary}
                <ArrowRight size={20} aria-hidden="true" />
              </button>
              <button 
                onClick={() => scrollToSection('services')} 
                className="btn-secondary"
                aria-label={t.hero.ctaSecondary}
              >
                {t.hero.ctaSecondary}
              </button>
            </div>

            <div className="hero-badges" role="list" aria-label={language === 'es' ? 'Certificaciones' : 'Certifications'}>
              {t.hero.badges.map((badge, index) => (
                <span key={index} className="badge" role="listitem">{badge}</span>
              ))}
            </div>
          </div>

          <div className="hero-right">
            <article className="benefits-card" aria-labelledby="benefits-title">
              <h2 id="benefits-title" className="benefits-title">{t.hero.whatYouGet}</h2>
              <ul className="benefits-list" aria-label={t.hero.whatYouGet}>
                {t.hero.benefits.map((benefit, index) => (
                  <li key={index} className="benefit-item">
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
