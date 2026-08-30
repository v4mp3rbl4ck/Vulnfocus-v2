import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const FAQ = () => {
  const { t } = useLanguage();
  const [openIndex, setOpenIndex] = useState(null);
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef(null);

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

  const toggleQuestion = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="section-container section-alt" ref={sectionRef}>
      <div className="content-wrapper-narrow">
        <h2 className={`section-title ${visible ? 'fade-in-up' : ''}`}>
          {t.faq.title}
        </h2>
        
        <div className="faq-list">
          {t.faq.items.map((item, index) => (
            <div
              key={index}
              className={`faq-item ${visible ? 'fade-in-up' : ''}`}
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <button
                className={`faq-question ${openIndex === index ? 'faq-open' : ''}`}
                onClick={() => toggleQuestion(index)}
              >
                <span>{item.question}</span>
                <ChevronDown
                  size={20}
                  className={`faq-icon ${openIndex === index ? 'faq-icon-rotated' : ''}`}
                />
              </button>
              <div className={`faq-answer ${openIndex === index ? 'faq-answer-open' : ''}`}>
                <p>{item.answer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQ;
