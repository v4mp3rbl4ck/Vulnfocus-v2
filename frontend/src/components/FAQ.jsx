import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import useReveal from '../hooks/useReveal';

const FAQ = () => {
  const { t } = useLanguage();
  const [openIndex, setOpenIndex] = useState(null);
  const [ref, visible] = useReveal();

  return (
    <section id="faq" className="section-container section-alt" ref={ref} aria-labelledby="faq-title">
      <div className="content-wrapper-narrow">
        <h2 id="faq-title" className={`section-title ${visible ? 'fade-in-up' : ''}`}>
          {t.faq.title}
        </h2>

        <div className="faq-list">
          {t.faq.items.map((item, index) => {
            const open = openIndex === index;
            const panelId = `faq-panel-${index}`;
            const buttonId = `faq-button-${index}`;
            return (
              <div key={item.question} className={`faq-item ${visible ? 'fade-in-up' : ''}`}>
                <h3 className="faq-heading">
                  <button
                    type="button"
                    id={buttonId}
                    className={`faq-question ${open ? 'faq-open' : ''}`}
                    onClick={() => setOpenIndex(open ? null : index)}
                    aria-expanded={open}
                    aria-controls={panelId}
                  >
                    <span>{item.question}</span>
                    <ChevronDown
                      size={20}
                      className={`faq-icon ${open ? 'faq-icon-rotated' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className={`faq-answer ${open ? 'faq-answer-open' : ''}`}
                  hidden={!open}
                >
                  <p>{item.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default FAQ;
