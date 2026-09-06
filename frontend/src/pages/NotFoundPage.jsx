import React from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { useLanguage } from '../context/LanguageContext';

/**
 * Página de error.
 *
 * El código HTTP 404 lo pone Cloudflare al servir 404.html
 * (assets.not_found_handling = "404-page"): este componente solo aporta el
 * contenido. No es una ruta declarada en site.json a propósito, para que no
 * exista como asset propio ni entre en el sitemap.
 */
const NotFoundPage = () => {
  const { t } = useLanguage();

  return (
    <Layout title={`${t.notFound.title} | VulnFocus`} description={t.notFound.description}>
      <section className="section-container not-found">
        <div className="content-wrapper-narrow">
          <p className="not-found-code">{t.notFound.code}</p>
          <h1 className="page-title">{t.notFound.title}</h1>
          <p className="page-subtitle">{t.notFound.description}</p>
          <div className="hero-cta-group">
            <Link to="/" className="btn-primary">{t.notFound.home}</Link>
            <Link to="/servicios" className="btn-secondary">{t.notFound.services}</Link>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default NotFoundPage;
