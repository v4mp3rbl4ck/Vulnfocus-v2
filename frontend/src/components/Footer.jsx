import React from 'react';
import { useLanguage } from '../context/LanguageContext';

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

const Footer = () => {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-brand">
          <div className="footer-logo">
            <BicolorShieldLogo size={24} />
            <span className="footer-logo-text">VulnFocus SPA</span>
          </div>
        </div>
        
        <div className="footer-info">
          <p className="footer-text">
            © {currentYear} VulnFocus SPA. {t.footer.rights}
          </p>
          <p className="footer-tagline">{t.footer.tagline}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
