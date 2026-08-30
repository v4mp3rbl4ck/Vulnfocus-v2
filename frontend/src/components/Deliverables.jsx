import React, { useEffect, useRef, useState } from 'react';
import { FileText, Code, Table, Presentation } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const iconMap = [FileText, Code, Table, Presentation];

const Deliverables = () => {
  const { t } = useLanguage();
  const [visibleCards, setVisibleCards] = useState([]);
  const cardsRef = useRef([]);

  useEffect(() => {
    const observers = cardsRef.current.map((card, index) => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setTimeout(() => {
                setVisibleCards((prev) => [...new Set([...prev, index])]);
              }, index * 100);
            }
          });
        },
        { threshold: 0.1 }
      );

      if (card) observer.observe(card);
      return observer;
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);

  return (
    <section id="deliverables" className="section-container">
      <div className="content-wrapper">
        <h2 className="section-title">{t.deliverables.title}</h2>
        
        <div className="deliverables-grid">
          {t.deliverables.items.map((item, index) => {
            const Icon = iconMap[index];
            return (
              <div
                key={index}
                ref={(el) => (cardsRef.current[index] = el)}
                className={`deliverable-card ${visibleCards.includes(index) ? 'card-visible' : ''}`}
              >
                <div className="deliverable-icon-wrapper">
                  <Icon size={28} className="deliverable-icon" />
                </div>
                <h3 className="deliverable-title">{item.title}</h3>
                <p className="deliverable-description">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Deliverables;
