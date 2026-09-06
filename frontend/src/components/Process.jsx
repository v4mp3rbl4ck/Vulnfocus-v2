import React from 'react';
import { Clock } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import useReveal from '../hooks/useReveal';

const Process = () => {
  const { t } = useLanguage();
  const [ref, visible] = useReveal();

  return (
    <section id="proceso" className="section-container section-alt" ref={ref} aria-labelledby="process-title">
      <div className="content-wrapper">
        <div className="process-header">
          <h2 id="process-title" className="section-title">{t.process.title}</h2>
          <p className="process-subtitle">{t.process.subtitle}</p>
        </div>

        <ol className="process-timeline">
          {t.process.steps.map((step, index) => (
            <li key={step.title} className={`process-step ${visible ? 'step-visible' : ''}`}>
              <div className="step-indicator" aria-hidden="true">
                <div className="step-number">{index + 1}</div>
                {index < t.process.steps.length - 1 && <div className="step-connector" />}
              </div>

              <div className="step-content">
                <div className="step-header">
                  <h3 className="step-title">{step.title}</h3>
                  <p className="step-duration">
                    <Clock size={16} aria-hidden="true" />
                    <span>{step.duration}</span>
                  </p>
                </div>
                <p className="step-description">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
};

export default Process;
