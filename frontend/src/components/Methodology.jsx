import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import useReveal from '../hooks/useReveal';
import BrandLogo from './BrandLogo';

const Methodology = () => {
  const { t } = useLanguage();
  const [ref, visible] = useReveal();

  return (
    <section id="metodologia" className="section-container section-alt" ref={ref} aria-labelledby="methodology-title">
      <div className="content-wrapper">
        <h2 id="methodology-title" className={`section-title ${visible ? 'fade-in-up' : ''}`}>
          {t.methodology.title}
        </h2>

        <p className={`methodology-intro ${visible ? 'fade-in-up' : ''}`}>{t.methodology.intro}</p>

        <div className="methodology-list">
          {t.methodology.frameworks.map((framework) => (
            <article key={framework.name} className={`methodology-item ${visible ? 'fade-in-up' : ''}`}>
              <div className="methodology-header">
                <BrandLogo size={20} className="methodology-icon" />
                <h3 className="methodology-name">{framework.name}</h3>
              </div>
              <p className="methodology-description">{framework.description}</p>
            </article>
          ))}
        </div>

        <p className={`methodology-footer ${visible ? 'fade-in-up' : ''}`}>{t.methodology.footer}</p>
      </div>
    </section>
  );
};

export default Methodology;
