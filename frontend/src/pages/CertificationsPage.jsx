import React from 'react';
import SEO from '../components/SEO';
import Header from '../components/Header';
import Certifications from '../components/Certifications';
import Footer from '../components/Footer';
import { useLanguage } from '../context/LanguageContext';

const CertificationsPage = () => {
  const { language } = useLanguage();
  
  const seoData = {
    es: {
      title: 'Certificaciones | VulnFocus SPA',
      description: 'Conoce nuestras certificaciones profesionales en ciberseguridad: OSCP, CEH, CISSP, eWPT y los frameworks que utilizamos.',
      keywords: 'certificaciones pentesting, OSCP, CEH, CISSP, eWPT, OWASP, PTES, NIST, ISO 27001'
    },
    en: {
      title: 'Certifications | VulnFocus SPA',
      description: 'Learn about our professional cybersecurity certifications: OSCP, CEH, CISSP, eWPT and the frameworks we use.',
      keywords: 'pentesting certifications, OSCP, CEH, CISSP, eWPT, OWASP, PTES, NIST, ISO 27001'
    }
  };
  
  const data = seoData[language] || seoData.es;
  
  return (
    <div className="app-wrapper">
      <SEO 
        url="/certificaciones"
        title={data.title}
        description={data.description}
        keywords={data.keywords}
      />
      <Header />
      <main>
        <Certifications />
      </main>
      <Footer />
    </div>
  );
};

export default CertificationsPage;
