import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * En una SPA el navegador no reinicia el scroll al cambiar de ruta: se navega a
 * otra página y se sigue viendo el pie de la anterior. Esto lo corrige, salvo
 * cuando la URL trae un ancla, donde el destino es esa sección.
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
