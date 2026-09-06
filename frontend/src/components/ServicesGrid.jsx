import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Braces, Cloud, Crosshair, Globe, Globe2, Network, RefreshCw, Smartphone, Users,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { SERVICES, serviceContent } from '../data/services';
import useReveal from '../hooks/useReveal';

// El catálogo de servicios es datos, no JSX: el icono viaja como nombre y se
// resuelve aquí. Así el fichero de contenido no importa componentes.
const ICONS = { Globe, Braces, Globe2, Network, Users, Smartphone, Cloud, Crosshair, RefreshCw };

const ServicesGrid = ({ withTitle = true, compact = false }) => {
  const { t, language } = useLanguage();
  const [ref, visible] = useReveal();

  return (
    <section id="servicios" className="section-container" ref={ref} aria-labelledby="services-title">
      <div className="content-wrapper">
        {withTitle && (
          <>
            <h2 id="services-title" className={`section-title ${visible ? 'fade-in-up' : ''}`}>
              {t.servicesSection.title}
            </h2>
            <p className={`section-subtitle ${visible ? 'fade-in-up' : ''}`}>
              {t.servicesSection.subtitle}
            </p>
          </>
        )}

        <div className="services-grid">
          {SERVICES.map((service) => {
            const Icon = ICONS[service.icon] || Globe;
            const content = serviceContent(service, language);
            return (
              <article key={service.id} className={`service-card ${visible ? 'card-visible' : ''}`}>
                <div className="service-icon-wrapper">
                  <Icon size={28} className="service-icon" aria-hidden="true" />
                </div>
                <h3 className="service-title">
                  {/* El enlace envuelve el título y la tarjeta entera es clicable por CSS
                      (::after). Así el destino del enlace se anuncia con un texto útil en
                      lugar de "leer más". */}
                  <Link to={service.path} className="service-card-link">
                    {content.name}
                  </Link>
                </h3>
                <p className="service-description">{content.short}</p>
                {!compact && (
                  <ul className="service-frameworks" aria-label={t.servicesSection.detail.frameworks}>
                    {service.frameworks.slice(0, 3).map((framework) => (
                      <li key={framework} className="framework-chip">{framework}</li>
                    ))}
                  </ul>
                )}
                <span className="service-more" aria-hidden="true">
                  {t.common.viewService}
                  <ArrowRight size={16} />
                </span>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default ServicesGrid;
