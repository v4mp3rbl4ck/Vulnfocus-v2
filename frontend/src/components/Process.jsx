import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const Process = () => {
  const { t } = useLanguage();
  const [visibleSteps, setVisibleSteps] = useState([]);
  const stepsRef = useRef([]);

  useEffect(() => {
    const observers = stepsRef.current.map((step, index) => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setTimeout(() => {
                setVisibleSteps((prev) => [...new Set([...prev, index])]);
              }, index * 150);
            }
          });
        },
        { threshold: 0.1 }
      );

      if (step) observer.observe(step);
      return observer;
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);

  return (
    <section id="process" className="section-container section-alt">
      <div className="content-wrapper">
        <div className="process-header">
          <h2 className="section-title">{t.process.title}</h2>
          <p className="process-subtitle">{t.process.subtitle}</p>
        </div>

        <div className="process-timeline">
          {t.process.steps.map((step, index) => (
            <div
              key={index}
              ref={(el) => (stepsRef.current[index] = el)}
              className={`process-step ${visibleSteps.includes(index) ? 'step-visible' : ''}`}
            >
              <div className="step-indicator">
                <div className="step-number">{index + 1}</div>
                {index < t.process.steps.length - 1 && (
                  <div className="step-connector"></div>
                )}
              </div>
              
              <div className="step-content">
                <div className="step-header">
                  <h3 className="step-title">{step.title}</h3>
                  <div className="step-duration">
                    <Clock size={16} />
                    <span>{step.duration}</span>
                  </div>
                </div>
                <p className="step-description">{step.description}</p>
                <div className="step-check">
                  <CheckCircle2 size={20} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Process;
