import React from 'react';
import SEO from '../components/SEO';
import Header from '../components/Header';
import Deliverables from '../components/Deliverables';
import FAQ from '../components/FAQ';
import Footer from '../components/Footer';
import { useLanguage } from '../context/LanguageContext';

const Resources = () => {
  const { language } = useLanguage();
  
  const seoData = {
    es: {
      title: 'Recursos y Entregables | VulnFocus SPA',
      description: 'Conoce los entregables de nuestros servicios de pentesting: informes ejecutivos, técnicos, evidencias y recomendaciones de remediación.',
      keywords: 'entregables pentesting, informe de seguridad, reporte vulnerabilidades, FAQ ciberseguridad'
    },
    en: {
      title: 'Resources & Deliverables | VulnFocus SPA',
      description: 'Learn about our pentesting deliverables: executive reports, technical reports, evidence and remediation recommendations.',
      keywords: 'pentesting deliverables, security report, vulnerability report, cybersecurity FAQ'
    }
  };
  
  const data = seoData[language] || seoData.es;
  
  return (
    <div className="app-wrapper">
      <SEO 
        url="/recursos"
        title={data.title}
        description={data.description}
        keywords={data.keywords}
      />
      <Header />
      <main>
        <Deliverables />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
};

export default Resources;
