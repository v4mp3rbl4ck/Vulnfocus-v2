import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

// Logo personalizado bicolor (azul y rojo) - Solo bordes
const BicolorShieldLogo = ({ size = 24 }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    className="methodology-icon"
  >
    <path 
      d="M12 2L3 5V11C3 16.55 6.84 21.74 12 23" 
      fill="none"
      stroke="#0080FF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path 
      d="M12 2L21 5V11C21 16.55 17.16 21.74 12 23" 
      fill="none"
      stroke="#FF4458"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Methodology = () => {
  const { t } = useLanguage();
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

    // Se copia la ref a una variable local: en el cleanup, sectionRef.current
    // puede apuntar ya a otro nodo y se desobservaría el equivocado.
    const nodo = sectionRef.current;
    if (nodo) {
      observer.observe(nodo);
    }

    return () => {
      if (nodo) {
        observer.unobserve(nodo);
      }
    };
  }, []);

  return (
    <section id="methodology" className="section-container section-alt" ref={sectionRef}>
      <div className="content-wrapper">
        <h2 className={`section-title ${visible ? 'fade-in-up' : ''}`}>
          {t.methodology.title}
        </h2>
        
        <p className={`methodology-intro ${visible ? 'fade-in-up' : ''}`}>
          {t.methodology.intro}
        </p>

        <div className="methodology-list">
          {t.methodology.frameworks.map((framework, index) => (
            <div
              key={index}
              className={`methodology-item ${visible ? 'fade-in-up' : ''}`}
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="methodology-header">
                <BicolorShieldLogo size={20} />
                <h3 className="methodology-name">{framework.name}</h3>
              </div>
              <p className="methodology-description">{framework.description}</p>
            </div>
          ))}
        </div>

        <p className={`methodology-footer ${visible ? 'fade-in-up' : ''}`}>
          {t.methodology.footer}
        </p>
      </div>
    </section>
  );
};

export default Methodology;
