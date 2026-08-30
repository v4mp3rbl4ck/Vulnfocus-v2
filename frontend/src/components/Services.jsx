import React, { useEffect, useRef, useState } from 'react';
import { Database, Globe, Server, Users, Crosshair } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const iconMap = [Database, Globe, Server, Users, Crosshair];

const Services = () => {
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
    <section id="services" className="section-container">
      <div className="content-wrapper">
        <h2 className="section-title">{t.services.title}</h2>
        
        <div className="services-grid">
          {t.services.items.map((service, index) => {
            const Icon = iconMap[index];
            return (
              <div
                key={index}
                ref={(el) => (cardsRef.current[index] = el)}
                className={`service-card ${visibleCards.includes(index) ? 'card-visible' : ''}`}
              >
                <div className="service-icon-wrapper">
                  <Icon size={32} className="service-icon" />
                </div>
                <h3 className="service-title">{service.title}</h3>
                <p className="service-description">{service.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Services;
