import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import Layout from '../components/Layout';
import CtaBand from '../components/CtaBand';
import { useLanguage } from '../context/LanguageContext';
import { getServiceBySlug, serviceContent } from '../data/services';

const ServiceDetail = () => {
  const { slug } = useParams();
  const { t, language } = useLanguage();
  const service = getServiceBySlug(slug);

  // Un slug inexistente no debe renderizar una página vacía con estado 200.
  // Cloudflare ya devuelve 404.html para estas URLs porque no existen como
  // asset; esto cubre la navegación interna de la SPA.
  if (!service) return <Navigate to="/404" replace />;

  const c = serviceContent(service, language);
  const labels = t.servicesSection.detail;

  return (
    <Layout>
      <article className="service-detail">
        <header className="page-header">
          <div className="content-wrapper">
            <Link to="/servicios" className="back-link">
              <ArrowLeft size={16} aria-hidden="true" />
              {t.common.backToServices}
            </Link>
            <h1 className="page-title">{c.name}</h1>
            <p className="page-subtitle">{c.short}</p>
            <ul className="service-frameworks" aria-label={labels.frameworks}>
              {service.frameworks.map((framework) => (
                <li key={framework} className="framework-chip">{framework}</li>
              ))}
            </ul>
          </div>
        </header>

        <section className="section-container">
          <div className="content-wrapper detail-grid">
            <div className="detail-main">
              <section aria-labelledby="objetivo">
                <h2 id="objetivo" className="detail-heading">{labels.objective}</h2>
                <p className="detail-text">{c.objective}</p>
              </section>

              <section aria-labelledby="evalua">
                <h2 id="evalua" className="detail-heading">{labels.evaluates}</h2>
                <ul className="check-list">
                  {c.evaluates.map((item) => (
                    <li key={item}>
                      <Check size={16} aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="metodologia">
                <h2 id="metodologia" className="detail-heading">{labels.methodology}</h2>
                <ol className="numbered-list">
                  {c.methodology.map((phase, index) => (
                    <li key={phase.title}>
                      <span className="numbered-index">{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <h3 className="numbered-title">{phase.title}</h3>
                        <p className="numbered-text">{phase.description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              <section aria-labelledby="pruebas">
                <h2 id="pruebas" className="detail-heading">{labels.tests}</h2>
                <ul className="bullet-list">
                  {c.tests.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>

            <aside className="detail-aside">
              <div className="aside-card">
                <h2 className="aside-title">{labels.deliverables}</h2>
                <ul className="check-list">
                  {c.deliverables.map((item) => (
                    <li key={item}>
                      <Check size={16} aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="aside-card">
                <h2 className="aside-title">{labels.duration}</h2>
                <p className="aside-text">{c.duration}</p>
                <p className="aside-note">{labels.durationNote}</p>
              </div>

              <Link to={`/cotizar?servicio=${service.id}`} className="btn-primary btn-full">
                {t.common.quoteCta}
              </Link>
            </aside>
          </div>
        </section>
      </article>

      <CtaBand />
    </Layout>
  );
};

export default ServiceDetail;
