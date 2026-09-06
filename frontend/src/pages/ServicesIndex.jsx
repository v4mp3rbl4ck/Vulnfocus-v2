import React from 'react';
import Layout from '../components/Layout';
import ServicesGrid from '../components/ServicesGrid';
import Methodology from '../components/Methodology';
import CtaBand from '../components/CtaBand';
import { useLanguage } from '../context/LanguageContext';

const ServicesIndex = () => {
  const { t } = useLanguage();

  return (
    <Layout>
      <section className="page-header">
        <div className="content-wrapper">
          <h1 className="page-title">{t.servicesSection.title}</h1>
          <p className="page-subtitle">{t.servicesSection.intro}</p>
        </div>
      </section>
      <ServicesGrid withTitle={false} />
      <Methodology />
      <CtaBand />
    </Layout>
  );
};

export default ServicesIndex;
