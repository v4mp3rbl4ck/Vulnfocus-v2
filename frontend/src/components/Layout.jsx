import React from 'react';
import Header from './Header';
import Footer from './Footer';
import Seo from './Seo';
import { useLanguage } from '../context/LanguageContext';

/**
 * Estructura común de todas las páginas: enlace de salto, cabecera, main
 * identificable y pie. Centralizarlo evita que cada página vuelva a montar su
 * propio esqueleto y que una se olvide del landmark <main>.
 */
const Layout = ({ children, title, description }) => {
  const { t } = useLanguage();

  return (
    <div className="app-wrapper">
      <Seo title={title} description={description} />
      <a className="skip-link" href="#contenido">
        {t.common.skipToContent}
      </a>
      <Header />
      <main id="contenido" tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  );
};

export default Layout;
