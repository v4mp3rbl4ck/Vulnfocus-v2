import React from 'react';
import { ShieldCheck, GitMerge, Target, FileSearch } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import useReveal from '../hooks/useReveal';

const ICONS = [ShieldCheck, GitMerge, Target, FileSearch];

const ValueProps = () => {
  const { t } = useLanguage();
  const [ref, visible] = useReveal();

  return (
    <section className="section-container section-alt" ref={ref} aria-labelledby="value-props-title">
      <div className="content-wrapper">
        <h2 id="value-props-title" className={`section-title ${visible ? 'fade-in-up' : ''}`}>
          {t.valueProps.title}
        </h2>

        <div className="value-grid">
          {t.valueProps.items.map((item, index) => {
            const Icon = ICONS[index % ICONS.length];
            return (
              <article key={item.title} className={`value-card ${visible ? 'card-visible' : ''}`}>
                <Icon size={26} className="value-icon" aria-hidden="true" />
                <h3 className="value-title">{item.title}</h3>
                <p className="value-description">{item.description}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default ValueProps;
