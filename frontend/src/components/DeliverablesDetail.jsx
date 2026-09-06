import React from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, CheckSquare, FileText, GitBranch, Image, Presentation, RefreshCw, Wrench,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import useReveal from '../hooks/useReveal';

const ICONS = [FileText, Wrench, Image, BarChart3, GitBranch, CheckSquare, Presentation, RefreshCw];

const DeliverablesDetail = () => {
  const { t } = useLanguage();
  const [ref, visible] = useReveal();

  return (
    <section id="entregables" className="section-container" ref={ref} aria-labelledby="deliverables-title">
      <div className="content-wrapper">
        <h2 id="deliverables-title" className={`section-title ${visible ? 'fade-in-up' : ''}`}>
          {t.deliverables.title}
        </h2>
        <p className={`section-subtitle ${visible ? 'fade-in-up' : ''}`}>{t.deliverables.subtitle}</p>

        <div className="deliverables-grid">
          {t.deliverables.items.map((item, index) => {
            const Icon = ICONS[index % ICONS.length];
            return (
              <article key={item.title} className={`deliverable-card ${visible ? 'card-visible' : ''}`}>
                <div className="deliverable-icon-wrapper">
                  <Icon size={24} className="deliverable-icon" aria-hidden="true" />
                </div>
                <h3 className="deliverable-title">{item.title}</h3>
                <p className="deliverable-description">{item.description}</p>
              </article>
            );
          })}
        </div>

        {/*
          Informe de ejemplo. La descarga directa queda preparada pero no se
          publica: no existe todavía un informe anonimizado que revisar, y
          enlazar un fichero inexistente sería peor que pedirlo por contacto.
          Cuando exista, basta con sustituir este enlace por el asset.
        */}
        <aside className="sample-report" aria-labelledby="sample-report-title">
          <h3 id="sample-report-title" className="sample-report-title">{t.deliverables.sampleTitle}</h3>
          <p className="sample-report-text">{t.deliverables.sampleText}</p>
          <Link to="/#contacto" className="btn-secondary">
            {t.deliverables.sampleCta}
          </Link>
          <p className="sample-report-note">{t.deliverables.samplePending}</p>
        </aside>
      </div>
    </section>
  );
};

export default DeliverablesDetail;
