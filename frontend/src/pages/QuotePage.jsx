import React from 'react';
import Layout from '../components/Layout';
import QuoteWizard from '../features/quote/QuoteWizard';
import { useLanguage } from '../context/LanguageContext';

const QuotePage = () => {
  const { t } = useLanguage();

  return (
    <Layout>
      <section className="page-header quote-page-header">
        <div className="content-wrapper">
          <h1 className="page-title">{t.quote.title}</h1>
          <p className="page-subtitle">{t.quote.subtitle}</p>
        </div>
      </section>

      <section className="section-container quote-section">
        <div className="content-wrapper-narrow">
          <QuoteWizard />
        </div>
      </section>
    </Layout>
  );
};

export default QuotePage;
