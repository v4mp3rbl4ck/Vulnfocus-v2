import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Monta el widget de Cloudflare Turnstile y expone su token.
 *
 * El site key es PÚBLICO por diseño; el secreto vive solo en Cloudflare Secrets
 * y únicamente lo usa el Worker contra Siteverify. Este hook no es un control
 * de seguridad: solo consigue el token. Quien decide es el servidor.
 *
 * El script se carga con `render=explicit` desde public/index.html, así que hay
 * que esperar a que `window.turnstile` exista: el componente puede montarse
 * antes de que el script termine de descargarse.
 */
export function useTurnstile({ language = 'es' } = {}) {
  const siteKey = process.env.REACT_APP_TURNSTILE_SITE_KEY || '';
  const containerRef = useRef(null);
  const widgetId = useRef(null);
  const [token, setToken] = useState('');

  useEffect(() => {
    if (!siteKey) return undefined;

    let cancelled = false;

    const render = () => {
      if (cancelled) return;
      if (!window.turnstile || !containerRef.current || widgetId.current !== null) return;
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'dark',
        language: language === 'en' ? 'en' : 'es',
        callback: (value) => setToken(value),
        'expired-callback': () => setToken(''),
        'timeout-callback': () => setToken(''),
        'error-callback': () => setToken(''),
      });
    };

    if (window.turnstile) {
      render();
      return () => {
        cancelled = true;
      };
    }

    const poll = setInterval(() => {
      if (window.turnstile) {
        clearInterval(poll);
        render();
      }
    }, 200);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
    // El idioma solo afecta al primer render del widget: volver a renderizarlo
    // al cambiar de idioma invalidaría un token ya obtenido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  /** Un token es de un solo uso: tras enviar (con éxito o no) hay que pedir otro. */
  const reset = useCallback(() => {
    setToken('');
    if (window.turnstile && widgetId.current !== null) {
      window.turnstile.reset(widgetId.current);
    }
  }, []);

  return { containerRef, token, reset, enabled: Boolean(siteKey) };
}

export default useTurnstile;
