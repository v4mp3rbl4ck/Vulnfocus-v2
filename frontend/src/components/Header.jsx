import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import BrandLogo from './BrandLogo';

const Header = () => {
  const { language, toggleLanguage, t } = useLanguage();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Cambiar de ruta cierra el menú móvil.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Escape cierra el menú: con el menú a pantalla completa, quedarse atrapado
  // sin ratón es un problema de accesibilidad real.
  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);

  const navItems = [
    { to: '/servicios', label: t.nav.services },
    { to: '/proceso', label: t.nav.process },
    { to: '/recursos', label: t.nav.resources },
    { to: '/certificaciones', label: t.nav.certifications },
  ];

  return (
    <header className={`dark-header ${scrolled ? 'header-scrolled' : ''}`}>
      <div className="header-content">
        <Link to="/" className="logo-container" aria-label="VulnFocus">
          <BrandLogo size={28} />
          <span className="logo-text">VulnFocus</span>
        </Link>

        <button
          type="button"
          className="mobile-menu-toggle"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label={mobileMenuOpen ? t.nav.close : t.nav.menu}
          aria-expanded={mobileMenuOpen}
          aria-controls="nav-principal"
        >
          {mobileMenuOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
        </button>

        <nav
          id="nav-principal"
          className={`dark-nav ${mobileMenuOpen ? 'mobile-nav-open' : ''}`}
          aria-label={language === 'es' ? 'Navegación principal' : 'Main navigation'}
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `dark-nav-link ${isActive ? 'nav-link-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}

          <Link to="/#contacto" className="dark-nav-link">
            {t.nav.contact}
          </Link>

          <button
            type="button"
            onClick={toggleLanguage}
            className="language-switch"
            aria-label={language === 'es' ? 'Switch to English' : 'Cambiar a español'}
          >
            {language === 'es' ? 'EN' : 'ES'}
          </button>

          <Link to="/cotizar" className="btn-primary btn-header">
            {t.nav.quote}
          </Link>
        </nav>
      </div>
    </header>
  );
};

export default Header;
