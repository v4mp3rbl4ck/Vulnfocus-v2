import React from 'react';
import SEO from '../components/SEO';
import Header from '../components/Header';
import Process from '../components/Process';
import Footer from '../components/Footer';
import { useLanguage } from '../context/LanguageContext';

const ProcessPage = () => {
  const { language } = useLanguage();
  
  const seoData = {
    es: {
      title: 'Proceso de Implementación | VulnFocus SPA',
      description: 'Conoce nuestro proceso de pentesting paso a paso: desde el alcance inicial hasta la entrega del informe final y soporte post-evaluación.',
      keywords: 'proceso pentesting, metodología seguridad, fases ethical hacking, implementación pentest'
    },
    en: {
      title: 'Implementation Process | VulnFocus SPA',
      description: 'Learn about our step-by-step pentesting process: from initial scope to final report delivery and post-evaluation support.',
      keywords: 'pentesting process, security methodology, ethical hacking phases, pentest implementation'
    }
  };
  
  const data = seoData[language] || seoData.es;
  
  return (
    <div className="app-wrapper">
      <SEO 
        url="/proceso"
        title={data.title}
        description={data.description}
        keywords={data.keywords}
      />
      <Header />
      <main>
        <Process />
      </main>
      <Footer />
    </div>
  );
};

export default ProcessPage;
