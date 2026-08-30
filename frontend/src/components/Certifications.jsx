import React, { useEffect, useRef, useState } from 'react';
import { Shield, Award, CheckCircle, BadgeCheck } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const Certifications = () => {
  const { language } = useLanguage();
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef(null);

  const content = {
    es: {
      title: 'Certificaciones y Competencias',
      subtitle: 'Nuestro equipo cuenta con las certificaciones más reconocidas en la industria de ciberseguridad',
      certifications: [
        {
          name: 'OSCP',
          fullName: 'Offensive Security Certified Professional',
          description: 'Certificación práctica en penetration testing',
          icon: Shield
        },
        {
          name: 'CEH',
          fullName: 'Certified Ethical Hacker',
          description: 'Hacking ético y técnicas de intrusión',
          icon: BadgeCheck
        },
        {
          name: 'CISSP',
          fullName: 'Certified Information Systems Security Professional',
          description: 'Gestión de seguridad de la información',
          icon: Award
        },
        {
          name: 'eWPT',
          fullName: 'eLearnSecurity Web Penetration Tester',
          description: 'Especialización en seguridad web',
          icon: CheckCircle
        }
      ],
      frameworks: [
        'OWASP Top 10',
        'PTES',
        'NIST',
        'ISO 27001',
        'PCI DSS',
        'MITRE ATT&CK'
      ],
      frameworksTitle: 'Frameworks y Estándares'
    },
    en: {
      title: 'Certifications & Expertise',
      subtitle: 'Our team holds the most recognized certifications in the cybersecurity industry',
      certifications: [
        {
          name: 'OSCP',
          fullName: 'Offensive Security Certified Professional',
          description: 'Hands-on penetration testing certification',
          icon: Shield
        },
        {
          name: 'CEH',
          fullName: 'Certified Ethical Hacker',
          description: 'Ethical hacking and intrusion techniques',
          icon: BadgeCheck
        },
        {
          name: 'CISSP',
          fullName: 'Certified Information Systems Security Professional',
          description: 'Information security management',
          icon: Award
        },
        {
          name: 'eWPT',
          fullName: 'eLearnSecurity Web Penetration Tester',
          description: 'Web security specialization',
          icon: CheckCircle
        }
      ],
      frameworks: [
        'OWASP Top 10',
        'PTES',
        'NIST',
        'ISO 27001',
        'PCI DSS',
        'MITRE ATT&CK'
      ],
      frameworksTitle: 'Frameworks & Standards'
    }
  };

  const t = content[language] || content.es;

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
    <section id="certifications" className="section-container" ref={sectionRef}>
      <div className="content-wrapper">
        <h2 className={`section-title ${visible ? 'fade-in-up' : ''}`}>
          {t.title}
        </h2>
        <p className={`section-subtitle ${visible ? 'fade-in-up' : ''}`}>
          {t.subtitle}
        </p>

        {/* Certificaciones */}
        <div className="certifications-grid">
          {t.certifications.map((cert, index) => {
            const IconComponent = cert.icon;
            return (
              <div
                key={index}
                className={`certification-card ${visible ? 'fade-in-up' : ''}`}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="certification-icon">
                  <IconComponent size={32} />
                </div>
                <div className="certification-content">
                  <h3 className="certification-name">{cert.name}</h3>
                  <p className="certification-fullname">{cert.fullName}</p>
                  <p className="certification-description">{cert.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Frameworks */}
        <div className={`frameworks-section ${visible ? 'fade-in-up' : ''}`}>
          <h3 className="frameworks-title">{t.frameworksTitle}</h3>
          <div className="frameworks-badges">
            {t.frameworks.map((framework, index) => (
              <span key={index} className="framework-badge">
                {framework}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Certifications;
