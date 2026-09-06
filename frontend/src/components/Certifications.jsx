import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import useReveal from '../hooks/useReveal';

/**
 * Marcos de referencia aplicados en las evaluaciones.
 *
 * Aquí NO se publican certificaciones profesionales. La versión anterior de esta
 * página afirmaba OSCP, CEH, CISSP y eWPT del "equipo"; no es verificable desde
 * el repositorio y publicar una acreditación que no se posee es un problema
 * legal, no de copy. El propietario puede reactivarlas rellenando
 * TEAM_CERTIFICATIONS con las que estén vigentes: la interfaz ya está preparada
 * y, mientras la lista esté vacía, la sección sencillamente no se renderiza.
 *
 * REQUIERE CONFIGURACIÓN DEL PROPIETARIO.
 */
const TEAM_CERTIFICATIONS = [
  // { name: 'OSCP', fullName: 'Offensive Security Certified Professional', holder: '', year: 2024 },
];

const Certifications = () => {
  const { t } = useLanguage();
  const [ref, visible] = useReveal();

  return (
    <section id="marcos" className="section-container" ref={ref} aria-labelledby="frameworks-title">
      <div className="content-wrapper">
        <h2 id="frameworks-title" className={`section-title ${visible ? 'fade-in-up' : ''}`}>
          {t.methodology.title}
        </h2>
        <p className={`section-subtitle ${visible ? 'fade-in-up' : ''}`}>{t.methodology.intro}</p>

        <div className="methodology-list">
          {t.methodology.frameworks.map((framework) => (
            <article key={framework.name} className={`methodology-item ${visible ? 'fade-in-up' : ''}`}>
              <h3 className="methodology-name">{framework.name}</h3>
              <p className="methodology-description">{framework.description}</p>
            </article>
          ))}
        </div>

        {TEAM_CERTIFICATIONS.length > 0 && (
          <div className="certifications-grid">
            {TEAM_CERTIFICATIONS.map((cert) => (
              <article key={cert.name} className="certification-card">
                <h3 className="certification-name">{cert.name}</h3>
                <p className="certification-fullname">{cert.fullName}</p>
              </article>
            ))}
          </div>
        )}

        <p className="section-note">{t.methodology.footer}</p>
      </div>
    </section>
  );
};

export default Certifications;
