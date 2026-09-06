import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TURNSTILE_POLL_MS,
  TURNSTILE_STATUS,
  createTurnstileWidget,
} from '../lib/turnstileWidget';

/**
 * Monta el widget de Cloudflare Turnstile y expone su token.
 *
 * El site key es PÚBLICO por diseño; el secreto vive solo en Cloudflare Secrets
 * y únicamente lo usa el Worker contra Siteverify. Este hook no es un control
 * de seguridad: solo consigue el token. Quien decide es el servidor.
 *
 * Toda la lógica del ciclo de vida está en `lib/turnstileWidget.js`, fuera de
 * React, porque es una máquina de estados con dos entradas asíncronas que pueden
 * llegar en cualquier orden —el script y el nodo del DOM— y ahí es donde estaba
 * el fallo que se corrigió: ver el comentario de aquel módulo. Este hook solo la
 * conecta a React.
 *
 * @returns {{
 *   containerRef: Function, token: string, status: string,
 *   ready: boolean, solved: boolean, enabled: boolean, reset: Function
 * }}
 */
export function useTurnstile({ language = 'es' } = {}) {
  const siteKey = process.env.REACT_APP_TURNSTILE_SITE_KEY || '';

  const [state, setState] = useState(() => ({
    status: siteKey ? TURNSTILE_STATUS.LOADING : TURNSTILE_STATUS.DISABLED,
    token: '',
  }));

  // Una sola instancia por montaje del componente. `useRef` y no `useMemo`:
  // useMemo puede recalcular cuando React quiera, y un widget de Turnstile de
  // más es un iframe de más.
  const widgetRef = useRef(null);
  if (widgetRef.current === null) {
    widgetRef.current = createTurnstileWidget({ siteKey, language, onChange: setState });
  }

  /**
   * Callback ref, no un objeto ref: se ejecuta EN EL MOMENTO en que el nodo
   * entra o sale del DOM. Es lo que permite que el widget se monte aunque el
   * contenedor aparezca mucho después que el script, que es exactamente lo que
   * pasa en un formulario dentro de un diálogo que primero consulta la API.
   */
  const containerRef = useCallback((node) => {
    widgetRef.current.attach(node);
  }, []);

  // Sondeo por si el script llega DESPUÉS que el contenedor. Se detiene en
  // cuanto no queda nada pendiente; no se queda girando de fondo.
  useEffect(() => {
    const widget = widgetRef.current;
    widget.revive();
    if (widget.ensureRendered()) return undefined;

    const poll = setInterval(() => {
      if (widget.ensureRendered()) clearInterval(poll);
    }, TURNSTILE_POLL_MS);

    return () => clearInterval(poll);
  }, []);

  // Al desmontar se suelta el widget: reabrir el formulario monta uno nuevo en
  // lugar de reutilizar uno cuyo nodo React ya retiró del DOM.
  useEffect(() => {
    const widget = widgetRef.current;
    return () => widget.destroy();
  }, []);

  /** Un token es de un solo uso: tras enviar (con éxito o no) hay que pedir otro. */
  const reset = useCallback(() => {
    widgetRef.current.reset();
  }, []);

  return {
    containerRef,
    token: state.token,
    status: state.status,
    // El widget está montado y se puede interactuar con él.
    ready: state.status === TURNSTILE_STATUS.READY || state.status === TURNSTILE_STATUS.SOLVED,
    // Hay token vigente: es la única condición que habilita el envío.
    solved: state.status === TURNSTILE_STATUS.SOLVED && state.token.length > 0,
    enabled: Boolean(siteKey),
    reset,
  };
}

export default useTurnstile;
