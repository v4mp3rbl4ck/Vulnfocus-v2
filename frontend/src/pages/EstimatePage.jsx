import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import Layout from '../components/Layout';
import EstimateResult from '../features/quote/EstimateResult';
import { fetchQuote } from '../features/quote/quoteApi';
import { useLanguage } from '../context/LanguageContext';

/**
 * Consulta de una estimación ya creada: /estimacion?id=<public_id>
 *
 * El identificador va en la URL porque ES la credencial: 128 bits aleatorios,
 * no enumerables. La ruta está marcada `noindex` en el manifiesto para que no
 * acabe en buscadores.
 */
const EstimatePage = () => {
  const [searchParams] = useSearchParams();
  const publicId = searchParams.get('id') || '';
  const { t } = useLanguage();

  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    let cancelled = false;

    // Se comprueba el formato antes de llamar: ahorra una petición inútil y no
    // gasta cuota de rate limit por un enlace mal copiado.
    if (!/^[0-9a-f]{32}$/.test(publicId)) {
      setStatus('error');
      return () => {
        cancelled = true;
      };
    }

    setStatus('loading');
    fetchQuote(publicId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setQuote(result.quote);
        setStatus('ok');
      } else {
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [publicId]);

  return (
    <Layout>
      <section className="section-container estimate-page">
        <div className="content-wrapper-narrow">
          {status === 'loading' && (
            <p className="estimate-loading" aria-live="polite">
              <Loader2 size={20} className="animate-spin" aria-hidden="true" />
              {t.quote.estimate.loading}
            </p>
          )}

          {status === 'error' && (
            <div className="estimate-error" role="alert">
              <AlertCircle size={20} aria-hidden="true" />
              <p>{t.quote.estimate.lookupError}</p>
              <Link to="/cotizar" className="btn-primary">{t.common.quoteCta}</Link>
            </div>
          )}

          {status === 'ok' && quote && <EstimateResult quote={quote} showShare={false} />}
        </div>
      </section>
    </Layout>
  );
};

export default EstimatePage;
