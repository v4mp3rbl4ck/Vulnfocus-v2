/**
 * CICLO DE VIDA DEL WIDGET DE TURNSTILE.
 *
 * Está fuera de React a propósito: es una máquina de estados con dos entradas
 * asíncronas que llegan en cualquier orden —el script de Cloudflare y el nodo
 * del DOM donde montar el widget— y esa combinación es justo donde estaba el
 * fallo que corrige este módulo.
 *
 * EL FALLO
 *
 * La versión anterior intentaba montar el widget UNA vez, en el efecto de
 * montaje, y exigía que el contenedor ya existiera en ese instante. En un
 * formulario que se abre en un diálogo y pinta su contenido después de una
 * petición, el contenedor todavía no está. Y como `window.turnstile` sí solía
 * estar —el script viene cacheado—, se tomaba el camino rápido, no se instalaba
 * ningún reintento, y el widget no se montaba nunca: el usuario veía
 * "Completa la verificación para poder enviar" sin nada que completar, y solo
 * recargando la página se volvía a jugar la carrera.
 *
 * EL ARREGLO
 *
 * `ensureRendered()` es idempotente y se puede llamar tantas veces como haga
 * falta: monta el widget en cuanto **las dos** condiciones se cumplen, y
 * devuelve `true` cuando ya no queda nada pendiente. Lo llama el nodo al
 * aparecer (callback ref) y también un sondeo, así que da igual cuál de las dos
 * entradas llegue primero.
 *
 * ESTADOS
 *
 *   disabled  no hay site key: la verificación no aplica y no debe bloquear nada
 *   loading   falta el script, el contenedor, o los dos
 *   ready     widget montado, esperando a que la persona lo resuelva
 *   solved    hay token válido
 *
 * `ready` y `loading` son distintos porque el mensaje que se le muestra a la
 * persona es distinto: pedirle que complete algo que aún no ha aparecido es
 * exactamente el bug que se está corrigiendo.
 */

export const TURNSTILE_STATUS = Object.freeze({
  DISABLED: 'disabled',
  LOADING: 'loading',
  READY: 'ready',
  SOLVED: 'solved',
});

/** Sondeo del script. Corto: es una comprobación de una propiedad, no una petición. */
export const TURNSTILE_POLL_MS = 150;

function defaultGetApi() {
  return typeof window !== 'undefined' ? window.turnstile : undefined;
}

/**
 * @param {object} options
 * @param {string} options.siteKey   Clave pública. Vacía = verificación deshabilitada.
 * @param {string} [options.language]
 * @param {Function} [options.getApi] Inyectable para los tests; por defecto `window.turnstile`.
 * @param {Function} [options.onChange] Se invoca con `{ status, token }` en cada cambio.
 */
export function createTurnstileWidget({
  siteKey,
  language = 'es',
  getApi = defaultGetApi,
  onChange = () => {},
} = {}) {
  let container = null;
  let widgetId = null;
  let token = '';
  let status = siteKey ? TURNSTILE_STATUS.LOADING : TURNSTILE_STATUS.DISABLED;
  let destroyed = false;

  function emit() {
    onChange({ status, token });
  }

  function transition(nextStatus, nextToken = token) {
    if (status === nextStatus && token === nextToken) return;
    status = nextStatus;
    token = nextToken;
    emit();
  }

  /**
   * El token se descarta en cuanto caduca, falla o se agota el tiempo.
   *
   * Turnstile los emite de un solo uso y con vida corta. Conservarlo "por si
   * acaso" solo consigue que el envío se rechace con un 403 que la persona no
   * puede explicarse; es preferible volver a `ready` y que resuelva otra vez.
   */
  function clearToken() {
    if (destroyed) return;
    transition(TURNSTILE_STATUS.READY, '');
  }

  /** Suelta el widget de Turnstile sin tocar el estado observable. */
  function removeWidget() {
    if (widgetId === null) return;
    try {
      getApi()?.remove(widgetId);
    } catch {
      /* El widget ya no existía. No hay nada que recuperar. */
    }
    widgetId = null;
  }

  const widget = {
    getState() {
      return { status, token, rendered: widgetId !== null };
    },

    /**
     * Intenta montar el widget.
     * @returns {boolean} `true` si no queda nada pendiente (montado, o no aplica).
     */
    ensureRendered() {
      if (destroyed || !siteKey) return true;
      if (widgetId !== null) return true;
      if (!container) return false;

      const api = getApi();
      if (!api) return false;

      widgetId = api.render(container, {
        sitekey: siteKey,
        theme: 'dark',
        language,
        callback: (value) => {
          if (destroyed) return;
          transition(TURNSTILE_STATUS.SOLVED, value || '');
        },
        'expired-callback': clearToken,
        'timeout-callback': clearToken,
        'error-callback': clearToken,
      });

      transition(TURNSTILE_STATUS.READY, '');
      return true;
    },

    /**
     * Callback ref del contenedor.
     *
     * Con `node` monta en cuanto puede; con `null` —el nodo se fue del DOM—
     * suelta el widget y vuelve a `loading`, de modo que reabrir el formulario
     * monta uno nuevo en lugar de quedarse mirando un widget que ya no existe.
     */
    attach(node) {
      if (node === container) return;

      if (!node) {
        container = null;
        removeWidget();
        if (siteKey) transition(TURNSTILE_STATUS.LOADING, '');
        return;
      }

      // Recibir un nodo revive el widget aunque venga de un `destroy()`.
      //
      // No es un detalle: React reengancha las refs ANTES de volver a montar los
      // efectos, así que en StrictMode este `attach` ocurre después del
      // `destroy()` del desmontaje y antes del `revive()` del efecto. Si aquí se
      // saliera por estar "destruido", el contenedor se perdería, React no
      // volvería a llamar a la ref, y el widget no se montaría nunca: el mismo
      // síntoma que se está corrigiendo, esta vez solo en desarrollo.
      destroyed = false;
      container = node;
      widget.ensureRendered();
    },

    /** Tras un envío: el token ya se gastó, se pide otro. Nunca lanza. */
    reset() {
      if (destroyed || !siteKey) return;
      if (widgetId !== null) {
        try {
          getApi()?.reset(widgetId);
        } catch {
          /* Si el widget ya no está, el estado de abajo es igualmente correcto. */
        }
      }
      transition(widgetId !== null ? TURNSTILE_STATUS.READY : TURNSTILE_STATUS.LOADING, '');
    },

    /**
     * Desmontaje.
     *
     * Reversible a propósito: en React StrictMode los efectos se montan, se
     * desmontan y se vuelven a montar, y un `destroy()` definitivo dejaría el
     * formulario sin verificación en desarrollo. Se sale de él con `revive()` o,
     * más habitual, recibiendo un contenedor nuevo en `attach()`.
     */
    destroy() {
      removeWidget();
      container = null;
      destroyed = true;
      status = siteKey ? TURNSTILE_STATUS.LOADING : TURNSTILE_STATUS.DISABLED;
      token = '';
    },

    revive() {
      if (!destroyed) return;
      destroyed = false;
      emit();
    },
  };

  return widget;
}

export default createTurnstileWidget;
