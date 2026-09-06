/**
 * INTERFAZ DE ADMINISTRACIÓN — una sola página, servida por el Worker.
 *
 * Por qué NO va en la SPA de React:
 *
 *   `/admin` es una de las rutas que docs/SECURITY.md exige que devuelvan 404 en
 *   vulnfocus.com. Si el panel fuera un asset estático más, existiría como
 *   fichero y respondería 200 a cualquiera que lo pidiera, con Access protegiendo
 *   solo el subdominio. Sirviéndolo desde el Worker, la misma ruta responde 404
 *   mientras `ADMIN_ENABLED` esté apagado y también con el interruptor encendido
 *   si no hay aserción de identidad válida de Cloudflare Access.
 *
 * Por qué no hay build ni framework aquí:
 *
 *   Es una pantalla de gestión interna para una tabla. Añadir un segundo pipeline
 *   de compilación (o meter el panel en el bundle público, que se descargaría en
 *   cada visita del sitio comercial) cuesta más de lo que aporta. Sin dependencias
 *   tampoco hay superficie de suministro que auditar.
 *
 * Seguridad de la propia página:
 *
 *  · CSP con nonce por respuesta. No hay 'unsafe-inline'.
 *  · Todo lo que viene de D1 se inserta con textContent, nunca con innerHTML: los
 *    campos de empresa, contacto y notas son entrada de terceros y ya están en la
 *    base. Es la barrera contra XSS almacenado.
 *  · La página no guarda nada: ni localStorage, ni cookies propias. La sesión es
 *    la de Access.
 */

const STATUS_LABELS = {
  NEW: 'Nueva',
  CONTACTED: 'Contactada',
  PROPOSAL_SENT: 'Propuesta enviada',
  ACCEPTED: 'Aceptada',
  REJECTED: 'Rechazada',
  EXPIRED: 'Caducada',
};

/** Nonce aleatorio por respuesta. Es lo que permite CSP sin 'unsafe-inline'. */
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const STYLES = `
  :root {
    --bg: #0a0c10; --surface: #12161d; --surface-2: #181e27; --border: #232b36;
    --text: #e8ecf1; --muted: #8b97a8; --accent: #0080ff; --danger: #ff4458;
    --ok: #22c55e; --warn: #f59e0b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  header {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 24px; border-bottom: 1px solid var(--border); background: var(--surface);
    position: sticky; top: 0; z-index: 10; flex-wrap: wrap;
  }
  h1 { font-size: 17px; margin: 0; letter-spacing: -0.01em; }
  h1 span { color: var(--accent); }
  .identity { color: var(--muted); font-size: 13px; }
  main { padding: 20px 24px 48px; max-width: 1240px; margin: 0 auto; }
  .stats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
  .stat {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 14px; min-width: 108px;
  }
  .stat b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
  .stat span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  input, select, button {
    font: inherit; color: var(--text); background: var(--surface-2);
    border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px;
  }
  input:focus-visible, select:focus-visible, button:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  input { min-width: 240px; }
  button { cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 10px; overflow: hidden; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 14px; }
  th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--surface-2); }
  td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pill {
    display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px;
    border: 1px solid var(--border); white-space: nowrap;
  }
  .pill.NEW { border-color: var(--accent); color: #7dc0ff; }
  .pill.CONTACTED { border-color: var(--warn); color: #fcd34d; }
  .pill.PROPOSAL_SENT { border-color: #a78bfa; color: #c4b5fd; }
  .pill.ACCEPTED { border-color: var(--ok); color: #86efac; }
  .pill.REJECTED { border-color: var(--danger); color: #fca5a5; }
  .pill.EXPIRED { border-color: var(--muted); color: var(--muted); }
  .empty, .error { padding: 28px; text-align: center; color: var(--muted); }
  .error { color: #fca5a5; }
  dialog {
    border: 1px solid var(--border); border-radius: 12px; background: var(--surface);
    color: var(--text); max-width: 780px; width: calc(100% - 32px); padding: 0;
  }
  dialog::backdrop { background: rgba(0, 0, 0, .66); }
  .dialog-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
    padding: 16px 20px; border-bottom: 1px solid var(--border);
  }
  .dialog-body { padding: 16px 20px; max-height: 66vh; overflow: auto; }
  .dialog-foot { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  dl.fields { display: grid; grid-template-columns: minmax(140px, auto) 1fr; gap: 6px 16px; margin: 0 0 18px; }
  dl.fields dt { color: var(--muted); font-size: 13px; }
  dl.fields dd { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
  h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 18px 0 8px; }
  ul.plain { margin: 0; padding-left: 18px; }
  ul.plain li { font-size: 14px; margin-bottom: 4px; }
  .history { list-style: none; margin: 0; padding: 0; }
  .history li { border-left: 2px solid var(--border); padding: 0 0 10px 12px; font-size: 13px; }
  .history .meta { color: var(--muted); }
  .pager { display: flex; justify-content: center; margin-top: 16px; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  @media (max-width: 760px) {
    th.hide-sm, td.hide-sm { display: none; }
    main, header { padding-left: 14px; padding-right: 14px; }
  }
`;

const SCRIPT = `
(function () {
  'use strict';
  var STATUS_LABELS = ` + JSON.stringify(STATUS_LABELS) + `;
  var state = { cursor: null, status: '', q: '', statuses: [], pricingEnabled: false };

  function el(id) { return document.getElementById(id); }

  function api(path, options) {
    return fetch(path, Object.assign({
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin',
    }, options || {})).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, ok: res.ok, body: body };
      });
    });
  }

  function statusPill(status) {
    var span = document.createElement('span');
    span.className = 'pill ' + status;
    span.textContent = STATUS_LABELS[status] || status;
    return span;
  }

  function date(value) {
    if (!value) return '—';
    var d = new Date(value);
    return isNaN(d) ? '—' : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  }

  function money(row) {
    if (row.currency == null || row.minPrice == null) return '—';
    var fmt = function (n) { return new Intl.NumberFormat('es-CL').format(n); };
    return fmt(row.minPrice) + '–' + fmt(row.maxPrice) + ' ' + row.currency;
  }

  function cell(row, text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    row.appendChild(td);
    return td;
  }

  function renderStats(stats) {
    var box = el('stats');
    box.textContent = '';
    var items = [['Total', stats.total]];
    Object.keys(stats.byStatus).forEach(function (key) {
      items.push([STATUS_LABELS[key] || key, stats.byStatus[key]]);
    });
    items.forEach(function (pair) {
      var div = document.createElement('div');
      div.className = 'stat';
      var b = document.createElement('b');
      b.textContent = String(pair[1]);
      var span = document.createElement('span');
      span.textContent = pair[0];
      div.appendChild(b);
      div.appendChild(span);
      box.appendChild(div);
    });
  }

  function renderRows(quotes, append) {
    var tbody = el('rows');
    if (!append) tbody.textContent = '';
    quotes.forEach(function (quote) {
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      cell(tr, quote.quoteNumber, 'num');
      cell(tr, quote.company);
      cell(tr, quote.contactName + ' · ' + quote.email, 'hide-sm');
      cell(tr, (quote.services || []).join(' + '), 'hide-sm');
      cell(tr, quote.complexity, 'hide-sm');
      cell(tr, quote.minHours + '–' + quote.maxHours + ' h', 'num');
      cell(tr, money(quote), 'num hide-sm');
      var tdStatus = document.createElement('td');
      tdStatus.appendChild(statusPill(quote.status));
      tr.appendChild(tdStatus);
      cell(tr, date(quote.createdAt), 'num hide-sm');
      var open = function () { openDetail(quote.publicId); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
      tbody.appendChild(tr);
    });
  }

  function load(append) {
    var params = new URLSearchParams();
    if (state.status) params.set('status', state.status);
    if (state.q) params.set('q', state.q);
    if (append && state.cursor) params.set('cursor', state.cursor);
    el('feedback').textContent = 'Cargando…';
    return api('/api/admin/quotes?' + params.toString()).then(function (res) {
      if (!res.ok) {
        el('feedback').textContent = 'No fue posible cargar el listado (' + res.status + ').';
        el('feedback').className = 'error';
        return;
      }
      state.cursor = res.body.nextCursor;
      renderRows(res.body.quotes || [], append);
      el('more').hidden = !state.cursor;
      var count = el('rows').children.length;
      el('feedback').className = 'empty';
      el('feedback').textContent = count === 0 ? 'Sin cotizaciones para este filtro.' : '';
    });
  }

  function refreshStats() {
    return api('/api/admin/stats').then(function (res) {
      if (res.ok && res.body.stats) renderStats(res.body.stats);
    });
  }

  function field(dl, label, value) {
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value == null || value === '' ? '—' : String(value);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function openDetail(publicId) {
    api('/api/admin/quotes/' + encodeURIComponent(publicId)).then(function (res) {
      if (!res.ok) { window.alert('No fue posible abrir la cotización.'); return; }
      var q = res.body.quote;
      el('detail-title').textContent = q.quoteNumber + ' · ' + q.company;
      var badge = el('detail-status');
      badge.textContent = '';
      badge.appendChild(statusPill(q.status));

      var body = el('detail-body');
      body.textContent = '';

      var dl = document.createElement('dl');
      dl.className = 'fields';
      field(dl, 'Contacto', q.contactName);
      field(dl, 'Email', q.email);
      field(dl, 'Teléfono', q.phone);
      field(dl, 'Servicios', (q.services || []).join(' + '));
      field(dl, 'Complejidad', q.complexity);
      field(dl, 'Horas estimadas', q.estimatedHours);
      field(dl, 'Banda de esfuerzo', q.minHours + '–' + q.maxHours + ' h');
      field(dl, 'Rango comercial', money(q));
      field(dl, 'Creada', date(q.createdAt));
      field(dl, 'Actualizada', date(q.updatedAt));
      field(dl, 'Vigente hasta', date(q.expiresAt));
      field(dl, 'Motor', q.engineVersion);
      body.appendChild(dl);

      if (q.notes) {
        var h = document.createElement('h3');
        h.textContent = 'Notas del cliente';
        var p = document.createElement('p');
        p.textContent = q.notes;
        body.appendChild(h);
        body.appendChild(p);
      }

      var scopeKeys = Object.keys(q.scope || {});
      if (scopeKeys.length) {
        var hs = document.createElement('h3');
        hs.textContent = 'Alcance declarado';
        body.appendChild(hs);
        scopeKeys.forEach(function (serviceId) {
          var h4 = document.createElement('h4');
          h4.textContent = serviceId;
          h4.style.margin = '10px 0 4px';
          h4.style.fontSize = '14px';
          var ul = document.createElement('ul');
          ul.className = 'plain';
          var answers = q.scope[serviceId] || {};
          Object.keys(answers).forEach(function (key) {
            var li = document.createElement('li');
            var value = answers[key];
            li.textContent = key + ': ' + (Array.isArray(value) ? (value.join(', ') || '—') : String(value));
            ul.appendChild(li);
          });
          body.appendChild(h4);
          body.appendChild(ul);
        });
      }

      var hh = document.createElement('h3');
      hh.textContent = 'Histórico de estado';
      body.appendChild(hh);
      var ul2 = document.createElement('ul');
      ul2.className = 'history';
      if (!q.history || q.history.length === 0) {
        var li0 = document.createElement('li');
        li0.textContent = 'Sin cambios registrados.';
        ul2.appendChild(li0);
      } else {
        q.history.forEach(function (event) {
          var li = document.createElement('li');
          var strong = document.createElement('strong');
          strong.textContent = (STATUS_LABELS[event.from] || event.from) + ' → ' + (STATUS_LABELS[event.to] || event.to);
          var meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = date(event.at) + ' · ' + event.actor + (event.note ? ' · ' + event.note : '');
          li.appendChild(strong);
          li.appendChild(meta);
          ul2.appendChild(li);
        });
      }
      body.appendChild(ul2);

      var select = el('transition');
      select.textContent = '';
      (q.allowedTransitions || []).forEach(function (status) {
        var option = document.createElement('option');
        option.value = status;
        option.textContent = STATUS_LABELS[status] || status;
        select.appendChild(option);
      });
      var terminal = !q.allowedTransitions || q.allowedTransitions.length === 0;
      select.disabled = terminal;
      el('apply').disabled = terminal;
      el('note').disabled = terminal;
      el('transition-hint').textContent = terminal ? 'Estado final: no admite más cambios.' : '';
      el('apply').dataset.publicId = q.publicId;
      el('note').value = '';
      el('detail').showModal();
    });
  }

  function applyTransition() {
    var button = el('apply');
    var publicId = button.dataset.publicId;
    var target = el('transition').value;
    if (!publicId || !target) return;
    button.disabled = true;
    api('/api/admin/quotes/' + encodeURIComponent(publicId) + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ status: target, note: el('note').value }),
    }).then(function (res) {
      button.disabled = false;
      if (!res.ok) {
        el('transition-hint').textContent = res.body && res.body.message
          ? res.body.message
          : 'No fue posible cambiar el estado.';
        return;
      }
      el('detail').close();
      state.cursor = null;
      return Promise.all([load(false), refreshStats()]);
    });
  }

  function init() {
    api('/api/admin/session').then(function (res) {
      if (!res.ok) {
        el('feedback').className = 'error';
        el('feedback').textContent = 'Sesión no válida. Vuelve a autenticarte en Cloudflare Access.';
        return;
      }
      state.statuses = res.body.session.statuses || [];
      state.pricingEnabled = !!res.body.session.pricingEnabled;
      el('identity').textContent = res.body.session.email;
      var select = el('filter-status');
      state.statuses.forEach(function (status) {
        var option = document.createElement('option');
        option.value = status;
        option.textContent = STATUS_LABELS[status] || status;
        select.appendChild(option);
      });
      if (!state.pricingEnabled) {
        el('pricing-note').textContent = 'PRICING_ENABLED=false: las cotizaciones se guardan sin rango económico.';
      }
      return Promise.all([load(false), refreshStats()]);
    });

    el('search-form').addEventListener('submit', function (event) {
      event.preventDefault();
      state.q = el('filter-q').value.trim();
      state.status = el('filter-status').value;
      state.cursor = null;
      load(false);
    });
    el('filter-status').addEventListener('change', function () {
      state.status = el('filter-status').value;
      state.cursor = null;
      load(false);
    });
    el('more').addEventListener('click', function () { load(true); });
    el('apply').addEventListener('click', applyTransition);
    el('close-detail').addEventListener('click', function () { el('detail').close(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

/**
 * Página completa del panel. `noindex` y `no-store` porque no es contenido
 * público y no debe quedar en ninguna cache intermedia.
 */
export function adminPageResponse() {
  const nonce = generateNonce();

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>VulnFocus · Administración</title>
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<header>
  <h1>Vuln<span>Focus</span> · Administración</h1>
  <p class="identity">Sesión de Cloudflare Access: <strong id="identity">…</strong></p>
</header>
<main>
  <section class="stats" id="stats" aria-label="Resumen"></section>
  <p class="identity" id="pricing-note"></p>
  <form class="toolbar" id="search-form" role="search">
    <label class="sr-only" for="filter-q">Buscar</label>
    <input id="filter-q" type="search" placeholder="Empresa, contacto, email o VF-…" autocomplete="off">
    <label class="sr-only" for="filter-status">Estado</label>
    <select id="filter-status"><option value="">Todos los estados</option></select>
    <button type="submit" class="primary">Buscar</button>
  </form>
  <table>
    <thead>
      <tr>
        <th scope="col">Número</th>
        <th scope="col">Empresa</th>
        <th scope="col" class="hide-sm">Contacto</th>
        <th scope="col" class="hide-sm">Servicios</th>
        <th scope="col" class="hide-sm">Complejidad</th>
        <th scope="col">Esfuerzo</th>
        <th scope="col" class="hide-sm">Rango</th>
        <th scope="col">Estado</th>
        <th scope="col" class="hide-sm">Creada</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <p class="empty" id="feedback" role="status" aria-live="polite"></p>
  <div class="pager"><button type="button" id="more" hidden>Cargar más</button></div>
</main>

<dialog id="detail" aria-labelledby="detail-title">
  <div class="dialog-head">
    <div>
      <h2 id="detail-title" style="font-size:16px;margin:0 0 6px"></h2>
      <div id="detail-status"></div>
    </div>
    <button type="button" id="close-detail" aria-label="Cerrar">✕</button>
  </div>
  <div class="dialog-body" id="detail-body"></div>
  <div class="dialog-foot">
    <label class="sr-only" for="transition">Nuevo estado</label>
    <select id="transition"></select>
    <label class="sr-only" for="note">Nota interna</label>
    <input id="note" type="text" maxlength="500" placeholder="Nota interna (opcional)">
    <button type="button" class="primary" id="apply">Cambiar estado</button>
    <span class="identity" id="transition-hint" role="status" aria-live="polite"></span>
  </div>
</dialog>

<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy':
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; ` +
        "connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

export default adminPageResponse;
