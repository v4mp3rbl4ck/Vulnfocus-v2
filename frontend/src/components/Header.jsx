import React, { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useNavigate, useLocation } from 'react-router-dom';

// Logo personalizado bicolor (azul y rojo) - Solo bordes
const BicolorShieldLogo = ({ size = 24 }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    className="logo-icon"
  >
    {/* Mitad izquierda - Borde Azul */}
    <path 
      d="M12 2L3 5V11C3 16.55 6.84 21.74 12 23" 
      fill="none"
      stroke="#0080FF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Mitad derecha - Borde Rojo */}
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

const Header = () => {
  const { language, toggleLanguage, t } = useLanguage();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Cerrar menú móvil cuando cambia la ruta
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  const scrollToSection = (id) => {
    setMobileMenuOpen(false);
    if (location.pathname !== '/') {
      navigate('/');
      setTimeout(() => {
        const element = document.getElementById(id);
        if (element) {
          const offset = 80;
          const elementPosition = element.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - offset;
          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      }, 100);
    } else {
      const element = document.getElementById(id);
      if (element) {
        const offset = 80;
        const elementPosition = element.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - offset;
        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    }
  };

  const goToHome = () => {
    setMobileMenuOpen(false);
    navigate('/');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToResources = () => {
    setMobileMenuOpen(false);
    navigate('/recursos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToProcess = () => {
    setMobileMenuOpen(false);
    navigate('/proceso');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToCertifications = () => {
    setMobileMenuOpen(false);
    navigate('/certificaciones');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header className={`dark-header ${scrolled ? 'header-scrolled' : ''}`}>
      <div className="header-content">
        <div className="logo-container" onClick={goToHome}>
          <BicolorShieldLogo size={28} />
          <span className="logo-text">VulnFocus SPA</span>
        </div>
        
        {/* Botón hamburguesa para móvil */}
        <button 
          className="mobile-menu-toggle"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        
        {/* Navegación - se oculta en móvil, se muestra con menú hamburguesa */}
        <nav className={`dark-nav ${mobileMenuOpen ? 'mobile-nav-open' : ''}`}>
          <button onClick={() => scrollToSection('services')} className="dark-nav-link">
            {t.nav.services}
          </button>
          <button onClick={() => scrollToSection('methodology')} className="dark-nav-link">
            {t.nav.methodology}
          </button>
          <button onClick={goToProcess} className="dark-nav-link">
            {t.nav.process}
          </button>
          <button onClick={goToResources} className="dark-nav-link">
            {t.nav.resources}
          </button>
          <button onClick={goToCertifications} className="dark-nav-link">
            {t.nav.certifications}
          </button>
          
          <button 
            onClick={toggleLanguage} 
            className="language-switch"
            aria-label="Toggle language"
          >
            {language === 'es' ? 'EN' : 'ES'}
          </button>
          
          <button onClick={() => scrollToSection('contact')} className="btn-primary btn-header">
            {t.nav.contact}
          </button>
        </nav>
      </div>
    </header>
  );
};

export default Header;
