import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { SERVICES, serviceContent } from '../data/services';
import BrandLogo from './BrandLogo';

const Footer = () => {
  const { t, language } = useLanguage();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-columns">
          <div className="footer-brand">
            <div className="footer-logo">
              <BrandLogo size={24} />
              <span className="footer-logo-text">VulnFocus</span>
            </div>
            <p className="footer-claim">{t.hero.eyebrow}</p>
            <p className="footer-tagline">{t.footer.tagline}</p>
          </div>

          <nav className="footer-column" aria-label={t.footer.servicesTitle}>
            <h2 className="footer-column-title">{t.footer.servicesTitle}</h2>
            <ul className="footer-list">
              {SERVICES.map((service) => (
                <li key={service.id}>
                  <Link to={service.path} className="footer-link">
                    {serviceContent(service, language).name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav className="footer-column" aria-label={t.footer.companyTitle}>
            <h2 className="footer-column-title">{t.footer.companyTitle}</h2>
            <ul className="footer-list">
              <li><Link to="/servicios" className="footer-link">{t.nav.services}</Link></li>
              <li><Link to="/proceso" className="footer-link">{t.nav.process}</Link></li>
              <li><Link to="/recursos" className="footer-link">{t.nav.resources}</Link></li>
              <li><Link to="/certificaciones" className="footer-link">{t.nav.certifications}</Link></li>
              <li><Link to="/cotizar" className="footer-link">{t.nav.quote}</Link></li>
            </ul>
          </nav>

          <div className="footer-column">
            <h2 className="footer-column-title">{t.footer.contactTitle}</h2>
            <ul className="footer-list">
              <li><a className="footer-link" href="mailto:contacto@vulnfocus.com">contacto@vulnfocus.com</a></li>
              <li>
                <a className="footer-link" href="https://wa.me/+56964134886" target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </li>
              <li>
                <a className="footer-link" href="https://linkedin.com/company/vulnfocus" target="_blank" rel="noopener noreferrer">
                  LinkedIn
                </a>
              </li>
              <li><Link to="/#contacto" className="footer-link">{t.nav.contact}</Link></li>
            </ul>
          </div>
        </div>

        <div className="footer-info">
          <p className="footer-text">© {currentYear} VulnFocus SPA. {t.footer.rights}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
