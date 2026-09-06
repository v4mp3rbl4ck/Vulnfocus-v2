import { useEffect, useRef, useState } from 'react';

/**
 * Revela un bloque cuando entra en el viewport.
 *
 * Sustituye al IntersectionObserver copiado en seis componentes. Respeta
 * `prefers-reduced-motion`: si la persona pidió menos movimiento, el contenido
 * aparece ya visible en lugar de animarse.
 */
export function useReveal({ threshold = 0.1, once = true } = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || typeof IntersectionObserver !== 'function') {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setVisible(false);
          }
        });
      },
      { threshold },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, once]);

  return [ref, visible];
}

export default useReveal;
