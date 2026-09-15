// Tally admin app: hash router, queue, upload, draft editor, review, verified record, accounts.
import { api, ApiError, requireUser, connectEvents, uploadWithProgress, signOut, limits, loadLimits } from '/assets/api.js';
import {
  h, mount, qs, qsa, debounce, icon, toast, statusChip, statusLabel, progress, updateProgress, checkRow,
  setRowIssue, stamp, banner, emptyState, skeleton, setLoading, confirmDialog, promptDialog, formDialog,
  openLightbox, photoThumb, bindDropzone, mountBell, setBaseTitle, timeAgo, relativeTime, formatDate,
  formatDateTime, parseQuantity,
} from '/assets/ui.js';

// Invoice size limit comes from GET /api/config (loaded in boot; 20 MB if that call fails).
const maxInvoiceMb = () => limits().max_invoice_mb;
const INVOICE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const INVOICE_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
const EDITABLE = new Set(['draft', 'open', 'in_progress', 'returned']);

const TABS = [
  { key: 'submitted', label: 'Needs review', status: 'submitted', alert: true, count: (c) => c.submitted },
  { key: 'active', label: 'In progress', status: 'active', count: (c) => c.open + c.in_progress + c.returned },
  { key: 'draft', label: 'Drafts', status: 'draft', count: (c) => c.draft },
  { key: 'approved', label: 'Verified', status: 'approved', count: (c) => c.approved },
  { key: 'all', label: 'All', status: null, count: (c) => Object.values(c).reduce((a, b) => a + (Number(b) || 0), 0) },
];

const METHOD_LABELS = {
  claude: 'AI reading (Claude)',
  'pdf-text': 'PDF text layer',
  ocr: 'Text recognition (OCR)',
  none: 'Not read automatically',
};

const EVENT_LABELS = {
  created: 'Invoice uploaded',
  edited: 'Details edited',
  published: 'Checklist published',
  reextracted: 'Invoice re-read',
  photo_removed: 'Photo removed',
  submitted: 'Submitted for review',
  approved: 'Approved',
  returned: 'Returned to staff',
};

const els = {
  main: qs('#main'),
  queueCount: qs('#queue-count'),
  userName: qs('#user-name'),
  liveStatus: qs('#live-status'),
  announcer: qs('#announcer'),
};

const app = { user: null, bell: null, counts: null, view: null, hash: '', historyIdx: 0, firstRoute: true };

// ---------- small helpers ----------

const plural = (n, word, many = `${word}s`) => (n === 1 ? word : many);
const isAbort = (err) => err?.name === 'AbortError';
const invoiceLabel = (inv) => inv.invoice_number || `draft #${inv.id}`;

function explain(err, fallback) {
  if (!(err instanceof ApiError)) return fallback || 'Something went wrong. Try again.';
  if (err.status === 0) return 'Can’t reach the server. Check your connection, then try again.';
  if (err.status >= 500) return `${fallback ? `${fallback} ` : ''}The server hit a problem. Try again in a moment.`;
  return err.message;
}

function announce(message) {
  els.announcer.textContent = '';
  requestAnimationFrame(() => {
    els.announcer.textContent = message;
  });
}

function qtyString(q) {
  const n = Number(q);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '';
}

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

// Status changes we caused ourselves; the matching SSE `invoice` event is ignored for a moment.
const ownActions = new Map();
function markOwn(id) {
  ownActions.set(Number(id), Date.now() + 6000);
}
function isOwn(id) {
  const until = ownActions.get(Number(id));
  if (!until) return false;
  if (Date.now() > until) {
    ownActions.delete(Number(id));
    return false;
  }
  return true;
}

function pageHeader({ eyebrow, title, sub, actions, titleExtra, stampSlot }) {
  return h(
    'div',
    { class: 'page-header' },
    h(
      'div',
      { class: 'page-header__lead' },
      eyebrow && h('p', { class: 'eyebrow' }, eyebrow),
      h('div', { class: 'title-row' }, h('h1', { class: 'page-title', tabindex: '-1' }, title), titleExtra),
      sub && h('p', { class: 'muted' }, sub),
    ),
    stampSlot,
    actions && h('div', { class: 'cluster' }, actions),
  );
}

function backLink() {
  return h('a', { class: 'back-link', href: '#/queue' }, icon('arrow-left'), 'Back to queue');
}

function retryButton(onClick, label = 'Try again') {
  return h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick }, icon('refresh'), label);
}

function textField({ id, label, value, type = 'text', mono = false, help, optional = false, maxLength, onInput }) {
  const helpId = help ? `${id}-help` : null;
  const errorId = `${id}-error`;
  const error = h('p', { class: 'field__error', id: errorId });
  const input = h('input', {
    id,
    class: ['input', mono && 'input--mono'],
    type,
    value: value ?? '',
    maxlength: maxLength,
    autocomplete: 'off',
    spellcheck: mono ? 'false' : undefined,
    'aria-describedby': [helpId, errorId].filter(Boolean).join(' '),
    onInput: () => {
      setError('');
      onInput?.();
    },
  });
  function setError(message) {
    error.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  const el = h(
    'div',
    { class: 'field' },
    h('label', { class: 'field__label', for: id }, label, optional && h('span', { class: 'field__optional' }, ' (optional)')),
    input,
    help && h('p', { class: 'field__help', id: helpId }, help),
    error,
  );
  return { el, input, setError };
}

// ---------- counts (rail badge + queue tabs) ----------

async function refreshCounts() {
  try {
    app.counts = await api.get('/api/admin/invoices/counts');
    const n = app.counts.submitted || 0;
    els.queueCount.hidden = n <= 0;
    mount(els.queueCount, String(n), h('span', { class: 'sr-only' }, ` ${plural(n, 'needs', 'need')} review`));
    app.view?.onCounts?.(app.counts);
  } catch {
    /* counts are decorative; the views show their own errors */
  }
  return app.counts;
}
const refreshCountsSoon = debounce(refreshCounts, 300);

// ---------- router ----------

const ROUTES = [
  { pattern: /^\/queue$/, nav: 'queue', view: queueView },
  { pattern: /^\/upload$/, nav: 'upload', view: uploadView },
  { pattern: /^\/invoice\/(\d+)$/, nav: 'queue', view: invoiceView },
  { pattern: /^\/staff$/, nav: 'staff', view: staffView },
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [pathPart, query = ''] = raw.split('?');
  const path = pathPart.replace(/\/+$/, '');
  return { path, params: new URLSearchParams(query) };
}

function replaceHash(hash) {
  history.replaceState(history.state, '', hash);
  app.hash = location.hash;
}

// Every entry the app routes to records its position in history.state, so a navigation the leave
// guard cancels can be undone by moving back to the entry we were on. (Rewriting the destination
// entry with replaceState would leave two identical entries and lose the real one.)
function stampHistory() {
  const state = history.state && typeof history.state === 'object' ? history.state : {};
  if (Number.isInteger(state.tallyIdx)) {
    app.historyIdx = state.tallyIdx;
  } else {
    app.historyIdx = (app.historyIdx || 0) + 1;
    history.replaceState({ ...state, tallyIdx: app.historyIdx }, '');
  }
}

function undoNavigation() {
  const idx = history.state?.tallyIdx;
  if (!Number.isInteger(idx)) history.back(); // a new entry: link, typed hash, location.hash = …
  else if (idx !== app.historyIdx) history.go(app.historyIdx - idx); // Back or Forward
  else replaceHash(app.hash);
}

let routeSeq = 0;

function route() {
  let { path, params } = parseHash();
  if (!path) {
    replaceHash('#/queue');
    path = '/queue';
  }
  stampHistory();
  app.view?.destroy?.();
  document.body.style.removeProperty('--toast-offset');

  const seq = ++routeSeq;
  const controller = new AbortController();
  const ctx = {
    main: els.main,
    params,
    signal: controller.signal,
    alive: () => seq === routeSeq,
    pendingFocus: !app.firstRoute,
    ready(title, { focus } = {}) {
      setBaseTitle(`${title} · Tally`);
      const shouldFocus = focus ?? ctx.pendingFocus;
      ctx.pendingFocus = false;
      if (shouldFocus) {
        qs('h1', els.main)?.focus({ preventScroll: true });
        announce(title);
      }
    },
  };
  app.hash = location.hash;
  app.firstRoute = false;

  const found = ROUTES.map((r) => ({ r, m: r.pattern.exec(path) })).find((x) => x.m);
  for (const link of qsa('.rail__link')) {
    if (found && link.dataset.nav === found.r.nav) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);

  const view = found ? found.r.view(ctx, ...found.m.slice(1)) || {} : notFoundView(ctx);
  const destroy = view.destroy;
  view.destroy = () => {
    controller.abort();
    destroy?.();
  };
  app.view = view;
}

async function canLeaveView() {
  if (typeof app.view?.canLeave !== 'function') return true;
  return Boolean(await app.view.canLeave());
}

let leaving = false;
window.addEventListener('hashchange', async () => {
  if (location.hash === app.hash || leaving) return;
  if (location.hash === '#main') {
    undoNavigation();
    return;
  }
  leaving = true;
  const target = location.hash;
  const ok = await canLeaveView();
  leaving = false;
  if (!ok) {
    undoNavigation();
    return;
  }
  if (location.hash !== target) history.replaceState(history.state, '', target);
  route();
});

async function navigate(hash) {
  if (location.hash === hash) {
    if (await canLeaveView()) route();
  } else {
    location.hash = hash;
  }
}

function notFoundView(ctx) {
  mount(
    ctx.main,
    pageHeader({ title: 'Page not found' }),
    emptyState({
      title: 'There’s nothing at this address.',
      text: 'The link may be mistyped or out of date.',
      action: h('a', { class: 'btn btn--primary', href: '#/queue' }, 'Go to the queue'),
    }),
  );
  ctx.ready('Page not found');
  return {};
}

// ---------- queue ----------

function invoiceRow(inv) {
  const time = inv.status === 'submitted' ? inv.submitted_at : inv.status === 'approved' ? inv.reviewed_at || inv.updated_at : inv.updated_at;
  const lines = inv.items_total;
  return h(
    'tr',
    { class: ['is-row-link', inv.status === 'submitted' && 'is-highlight'], dataset: { invoiceId: inv.id } },
    h(
      'td',
      { class: 'mono q-number' },
      h(
        'a',
        { class: 'table__link', href: `#/invoice/${inv.id}` },
        inv.invoice_number || h('span', { class: 'q-missing' }, `Draft #${inv.id}`, h('span', { class: 'sr-only' }, ', no invoice number yet')),
      ),
    ),
    h('td', { class: 'q-customer' }, inv.customer_name || h('span', { class: 'q-missing' }, 'No customer yet')),
    h('td', { class: 'q-status' }, statusChip(inv.status)),
    h(
      'td',
      { class: 'q-progress' },
      inv.status === 'draft'
        ? h('span', { class: 'muted text-14' }, `${lines} ${plural(lines, 'line')} · not published`)
        : progress(inv.items_collected, inv.items_total, { size: 'thin' }),
    ),
    h('td', { class: 'num q-photos' }, icon('camera'), h('span', {}, String(inv.photos_count)), h('span', { class: 'sr-only' }, ` ${plural(inv.photos_count, 'photo')}`)),
    h('td', { class: 'nowrap muted q-time' }, timeAgo(time)),
  );
}

function invoiceTable(invoices, caption) {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'table table--interactive queue-table' },
      h('caption', { class: 'sr-only' }, caption),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Invoice'),
          h('th', { scope: 'col' }, 'Customer'),
          h('th', { scope: 'col' }, 'Status'),
          h('th', { scope: 'col' }, 'Progress'),
          h('th', { scope: 'col', class: 'th-num' }, 'Photos'),
          h('th', { scope: 'col' }, 'Updated'),
        ),
      ),
      h('tbody', {}, invoices.map(invoiceRow)),
    ),
  );
}

function queueView(ctx) {
  let tabKey = TABS.some((t) => t.key === ctx.params.get('tab')) ? ctx.params.get('tab') : null;
  let q = (ctx.params.get('q') || '').slice(0, 100);
  let invoices = null;
  let listController = null;
  const tabEls = new Map();

  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Filter invoices by status', onKeydown: onTabKey });
  for (const tab of TABS) {
    const count = h('span', { class: ['tab__count'], hidden: true });
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'tab',
        role: 'tab',
        id: `queue-tab-${tab.key}`,
        'aria-controls': 'queue-panel',
        'aria-selected': 'false',
        tabindex: '-1',
        onClick: () => selectTab(tab.key),
      },
      tab.label,
      count,
    );
    tabEls.set(tab.key, { btn, count });
    tablist.append(btn);
  }

  const runSearch = debounce(() => {
    syncHash();
    load();
  }, 250);
  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Invoice number or customer',
    value: q,
    maxlength: 100,
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    onInput: (e) => {
      q = e.target.value;
      runSearch();
    },
    onKeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearch.cancel();
        syncHash();
        load();
      }
    },
  });
  const statusLine = h('p', { class: 'muted text-14', role: 'status' });
  const panel = h('div', { id: 'queue-panel', role: 'tabpanel', class: 'stack stack--3' });

  mount(
    ctx.main,
    pageHeader({
      eyebrow: 'Admin',
      title: 'Queue',
      sub: 'Submitted checklists come first, oldest submission at the top.',
      actions: h('a', { class: 'btn btn--primary', href: '#/upload' }, icon('upload'), 'Upload invoice'),
    }),
    h('div', { class: 'queue-tools' }, tablist, h('label', { class: 'search queue-search' }, h('span', { class: 'sr-only' }, 'Search by invoice number or customer'), searchInput)),
    statusLine,
    panel,
  );
  ctx.ready('Queue');
  mount(panel, skeleton(0, { rows: 5 }));

  function renderCounts(c) {
    if (!c) return;
    for (const tab of TABS) {
      const { count } = tabEls.get(tab.key);
      const n = tab.count(c);
      count.hidden = false;
      count.textContent = String(n);
      count.classList.toggle('tab__count--alert', Boolean(tab.alert && n > 0));
    }
  }

  function syncHash() {
    const p = new URLSearchParams({ tab: tabKey });
    if (q.trim()) p.set('q', q.trim());
    replaceHash(`#/queue?${p}`);
  }

  function selectTab(key, { focus = false } = {}) {
    if (key === tabKey && invoices) return;
    tabKey = key;
    for (const [k, { btn }] of tabEls) {
      const on = k === key;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      if (on && focus) btn.focus();
    }
    panel.setAttribute('aria-labelledby', `queue-tab-${key}`);
    syncHash();
    load();
  }

  function onTabKey(event) {
    const keys = TABS.map((t) => t.key);
    const i = keys.indexOf(tabKey);
    let next = null;
    if (event.key === 'ArrowRight') next = keys[(i + 1) % keys.length];
    else if (event.key === 'ArrowLeft') next = keys[(i - 1 + keys.length) % keys.length];
    else if (event.key === 'Home') next = keys[0];
    else if (event.key === 'End') next = keys[keys.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next, { focus: true });
  }

  async function load() {
    listController?.abort();
    listController = new AbortController();
    const { signal } = listController;
    const tab = TABS.find((t) => t.key === tabKey);
    const query = new URLSearchParams();
    if (tab.status) query.set('status', tab.status);
    const term = q.trim();
    if (term) query.set('q', term);
    if (!invoices) mount(panel, skeleton(0, { rows: 5 }));
    panel.setAttribute('aria-busy', 'true');
    try {
      const qsText = query.toString();
      const data = await api.get(`/api/admin/invoices${qsText ? `?${qsText}` : ''}`, { signal });
      invoices = data.invoices || [];
      render(tab, term);
    } catch (err) {
      if (isAbort(err)) return;
      invoices = null;
      statusLine.textContent = '';
      mount(panel, banner({ type: 'error', title: 'Couldn’t load invoices', message: explain(err), actions: retryButton(() => load()) }));
    } finally {
      if (!signal.aborted) panel.removeAttribute('aria-busy');
    }
  }

  function render(tab, term) {
    const focusedId = panel.contains(document.activeElement) ? document.activeElement.closest('tr')?.dataset.invoiceId : null;
    const n = invoices.length;
    statusLine.textContent = term
      ? `${n} ${plural(n, 'invoice')} matching “${term}” in ${tab.label}`
      : `${n} ${plural(n, 'invoice')} in ${tab.label}`;
    if (!n) {
      mount(panel, h('div', { class: 'table-wrap' }, queueEmpty(tab, term)));
      return;
    }
    mount(panel, invoiceTable(invoices, `${tab.label} invoices`));
    if (focusedId) qs(`tr[data-invoice-id="${CSS.escape(focusedId)}"] a`, panel)?.focus();
  }

  function queueEmpty(tab, term) {
    if (term) {
      return emptyState({
        compact: true,
        title: `No invoices match “${term}”`,
        text: tab.key === 'all' ? 'Check the spelling, or search by part of the number or customer name.' : `Nothing in ${tab.label} matches. Try All, or a shorter search.`,
        action: h('button', {
          type: 'button',
          class: 'btn btn--secondary',
          onClick: () => {
            q = '';
            searchInput.value = '';
            syncHash();
            load();
            searchInput.focus();
          },
        }, 'Clear search'),
      });
    }
    const upload = h('a', { class: 'btn btn--primary', href: '#/upload' }, icon('upload'), 'Upload invoice');
    const empty = {
      submitted: { title: 'Nothing needs review', text: 'Checklists appear here the moment staff submit them. You’ll also get a notification.' },
      active: { title: 'No checklists are being picked', text: 'Publish a draft to give staff a checklist to pick.', action: h('button', { type: 'button', class: 'btn btn--secondary', onClick: () => selectTab('draft', { focus: true }) }, 'See drafts') },
      draft: { title: 'No drafts', text: 'Upload an invoice and Tally will draft its checklist for you to check.', action: upload },
      approved: { title: 'No verified checklists yet', text: 'Checklists you approve are kept here as a record.' },
      all: { title: 'No invoices yet', text: 'Upload an invoice to create the first checklist.', action: upload },
    }[tab.key];
    return emptyState({ compact: tab.key !== 'all', ...empty });
  }

  const reloadSoon = debounce(() => load(), 300);
  ctx.signal.addEventListener('abort', () => {
    listController?.abort();
    runSearch.cancel();
    reloadSoon.cancel();
  });

  (async () => {
    const counts = app.counts || (await refreshCounts());
    if (!ctx.alive()) return;
    renderCounts(counts);
    if (!tabKey) tabKey = counts && counts.submitted > 0 ? 'submitted' : 'all';
    const initial = tabKey;
    tabKey = null;
    selectTab(initial);
  })();

  return {
    onCounts: renderCounts,
    onInvoiceEvent: () => reloadSoon(),
    onReconnect: () => reloadSoon(),
  };
}

// ---------- upload ----------

let uploadJob = null;

function checkInvoiceFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (/^hei[cf]$/.test(ext) || /hei[cf]/.test(file.type)) {
    return `“${file.name}” is a HEIC photo. Invoices must be PDF, JPG, PNG or WEBP: export the photo as JPG and upload that.`;
  }
  if (!INVOICE_TYPES.includes(file.type) && !INVOICE_EXTENSIONS.includes(ext)) {
    return `“${file.name}” isn’t a PDF, JPG, PNG or WEBP file. Save or scan the invoice in one of those formats.`;
  }
  if (file.size === 0) return `“${file.name}” is empty. Choose the invoice file again.`;
  if (file.size > Math.floor(maxInvoiceMb() * 1024 * 1024)) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `“${file.name}” is ${mb} MB. The limit is ${maxInvoiceMb()} MB: compress the PDF, or upload a photo of the invoice instead.`;
  }
  return null;
}

function uploadErrorMessage(err, file) {
  if (!(err instanceof ApiError)) return 'The upload failed. Try again.';
  switch (err.status) {
    case 0:
      return 'The upload didn’t reach the server. Check your connection and try again.';
    case 413:
      // The server's own message names its real limit ("File is too large (max N MB)").
      return `“${file.name}” is larger than the server allows${/max [\d.]+ MB/i.test(err.message) ? ` (${/max ([\d.]+ MB)/i.exec(err.message)[1]})` : ''}. Compress it or upload a photo of the invoice.`;
    case 415:
      return `${err.message} “${file.name}” doesn’t look like a real PDF or image, even if its name says so.`;
    default:
      return err.status >= 500
        ? `The server couldn’t process “${file.name}”. Try again, or upload a different copy of the invoice.`
        : err.message;
  }
}

function startUpload(file) {
  const controller = new AbortController();
  const job = { file, phase: 'uploading', fraction: 0, readingSince: 0, controller, subs: new Set(), invoice: null, error: null };
  uploadJob = job;
  const emit = () => job.subs.forEach((fn) => fn(job));
  const form = new FormData();
  form.append('file', file);
  uploadWithProgress(
    '/api/admin/invoices',
    form,
    (fraction) => {
      job.fraction = fraction;
      if (fraction >= 1 && job.phase === 'uploading') {
        job.phase = 'reading';
        job.readingSince = Date.now();
      }
      emit();
    },
    { signal: controller.signal },
  )
    .then((data) => {
      job.phase = 'done';
      job.invoice = data.invoice;
    })
    .catch((err) => {
      job.phase = isAbort(err) ? 'cancelled' : 'error';
      job.error = err;
    })
    .finally(() => {
      if (uploadJob === job) uploadJob = null;
      if (job.phase === 'done') refreshCountsSoon();
      if (job.subs.size) {
        emit();
      } else if (job.phase === 'done') {
        toast(`${file.name} has been read. Check the draft checklist, then publish it.`, {
          type: 'success',
          action: { label: 'Open draft', onClick: () => navigate(`#/invoice/${job.invoice.id}`) },
        });
      } else if (job.phase === 'error') {
        toast(uploadErrorMessage(job.error, file), { type: 'error' });
      }
    });
  return job;
}

function uploadView(ctx) {
  const input = h('input', {
    type: 'file',
    class: 'sr-only',
    accept: 'application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp',
    'aria-describedby': 'upload-hint',
  });
  const title = h('span', { class: 'dropzone__title' }, 'Drop an invoice here');
  const hint = h('span', { class: 'dropzone__hint', id: 'upload-hint' }, 'or ', h('span', { class: 'dropzone__browse' }, 'browse files'), ` · PDF, JPG, PNG or WEBP up to ${maxInvoiceMb()} MB`);
  const progressSlot = h('span', { class: 'dropzone__progress', hidden: true });
  const zone = h('label', { class: 'dropzone' }, input, h('span', { class: 'dropzone__icon' }, icon('upload')), title, hint, progressSlot);
  const errorSlot = h('div', { class: 'slot' });
  const liveText = h('p', { class: 'sr-only', role: 'status' });
  const cancelBtn = h('button', { type: 'button', class: 'btn btn--secondary', hidden: true, onClick: () => uploadJob?.controller.abort() }, 'Cancel upload');
  const draftsSlot = h('div', { class: 'stack stack--3' });

  mount(
    ctx.main,
    pageHeader({ eyebrow: 'Admin', title: 'Upload invoice', sub: 'Tally reads the invoice and drafts a checklist. You check the lines before staff see it.' }),
    h('div', { class: 'stack stack--4' }, errorSlot, zone, h('div', { class: 'cluster' }, cancelBtn), liveText, draftsSlot),
  );
  ctx.ready('Upload invoice');

  let bar = null;
  let phaseShown = null;
  let slowTimer = null;
  let job = null;

  function render(j) {
    const busy = j && (j.phase === 'uploading' || j.phase === 'reading');
    zone.classList.toggle('is-busy', Boolean(busy));
    input.disabled = Boolean(busy);
    cancelBtn.hidden = !(j && j.phase === 'uploading');
    progressSlot.hidden = !busy;
    if (!busy) {
      title.textContent = 'Drop an invoice here';
      hint.hidden = false;
      phaseShown = null;
      clearInterval(slowTimer);
      return;
    }
    hint.hidden = true;
    if (j.phase === 'uploading') {
      const pct = Math.round(j.fraction * 100);
      title.textContent = `Uploading ${j.file.name}`;
      if (phaseShown !== 'uploading') {
        bar = progress(0, 100, { format: 'none' });
        mount(progressSlot, h('span', { class: 'upload-status' }, bar, h('span', { class: 'upload-status__pct mono' }, '0%')));
        liveText.textContent = `Uploading ${j.file.name}`;
        phaseShown = 'uploading';
      }
      updateProgress(bar, pct, 100);
      const track = qs('.progress__track', bar);
      track?.setAttribute('aria-label', 'Upload progress');
      track?.setAttribute('aria-valuetext', `${pct}%`);
      const pctEl = qs('.upload-status__pct', progressSlot);
      if (pctEl) pctEl.textContent = `${pct}%`;
    } else if (phaseShown !== 'reading') {
      phaseShown = 'reading';
      title.textContent = 'Reading invoice…';
      const detail = h('span', { class: 'muted' }, 'Finding the invoice number, customer and lines.');
      mount(progressSlot, h('span', { class: 'upload-status' }, h('span', { class: 'upload-status__line' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), j.file.name), detail));
      liveText.textContent = 'Upload complete. Reading invoice…';
      clearInterval(slowTimer);
      slowTimer = setInterval(() => {
        if (Date.now() - j.readingSince > 10000) {
          detail.textContent = 'Still reading. Scanned images can take up to a minute. You can leave this page; we’ll tell you when it’s ready.';
          clearInterval(slowTimer);
        }
      }, 1000);
    }
  }

  function onJob(j) {
    render(j);
    if (j.phase === 'done') {
      j.subs.delete(onJob);
      announce('Invoice read. Opening the draft.');
      navigate(`#/invoice/${j.invoice.id}`);
    } else if (j.phase === 'error') {
      j.subs.delete(onJob);
      showError(uploadErrorMessage(j.error, j.file));
    } else if (j.phase === 'cancelled') {
      j.subs.delete(onJob);
      liveText.textContent = 'Upload cancelled.';
      toast('Upload cancelled', { type: 'info' });
      input.focus();
    }
  }

  function showError(message) {
    mount(errorSlot, banner({ type: 'error', title: 'That invoice wasn’t uploaded', message }));
    input.disabled = false;
    input.focus();
  }

  function attach(j) {
    job = j;
    j.subs.add(onJob);
    render(j);
  }

  const unbindZone = bindDropzone(zone, {
    onFiles(files) {
      if (uploadJob) return;
      mount(errorSlot);
      const file = files[0];
      if (files.length > 1) toast(`One invoice at a time. Uploading “${file.name}” only.`, { type: 'warning' });
      const problem = checkInvoiceFile(file);
      if (problem) {
        showError(problem);
        return;
      }
      attach(startUpload(file));
    },
  });

  if (uploadJob) attach(uploadJob);

  (async () => {
    try {
      const { invoices } = await api.get('/api/admin/invoices?status=draft', { signal: ctx.signal });
      if (!invoices.length) return;
      const shown = invoices.slice(0, 5);
      mount(
        draftsSlot,
        h(
          'div',
          { class: 'spread' },
          h('h2', { class: 'section-title' }, 'Drafts waiting to be published'),
          invoices.length > shown.length && h('a', { href: '#/queue?tab=draft' }, `See all ${invoices.length} drafts`),
        ),
        invoiceTable(shown, 'Drafts waiting to be published'),
      );
    } catch {
      /* optional list; ignore */
    }
  })();

  return {
    async canLeave() {
      if (!uploadJob || uploadJob.phase !== 'uploading') return true;
      const ok = await confirmDialog({
        title: 'Stop the upload?',
        message: `“${uploadJob.file.name}” is still uploading. Leaving now cancels it.`,
        confirmLabel: 'Cancel upload and leave',
        cancelLabel: 'Stay',
        danger: true,
      });
      if (ok) uploadJob?.controller.abort();
      return ok;
    },
    destroy() {
      job?.subs.delete(onJob);
      clearInterval(slowTimer);
      unbindZone();
    },
  };
}

// ---------- shared invoice pieces ----------

function invoiceHeader(inv, { justRuled } = {}) {
  const stampSlot = h('div', { class: 'header-stamp' });
  const sub = [inv.customer_name || 'Customer not set', inv.invoice_date && formatDate(inv.invoice_date)].filter(Boolean).join(' · ');
  const header = pageHeader({
    eyebrow: `Invoice${inv.invoice_number ? '' : ` · draft #${inv.id}`}`,
    title: inv.invoice_number || 'Untitled draft',
    titleExtra: statusChip(inv.status, { size: 'lg' }),
    sub,
    stampSlot,
    actions:
      inv.file_url &&
      h(
        'a',
        { class: 'btn btn--secondary btn--sm', href: inv.file_url, target: '_blank', rel: 'noopener' },
        icon('external'),
        'View original',
        h('span', { class: 'sr-only' }, ' (opens in a new tab)'),
      ),
  });
  if (inv.status === 'approved' || inv.status === 'returned') {
    const who = [inv.reviewed_at && formatDate(inv.reviewed_at), inv.reviewed_by_name].filter(Boolean).join(' · ');
    stamp(stampSlot, inv.status, { animate: justRuled === inv.status, meta: who || undefined, overlay: false });
  }
  return header;
}

function itemByline(item) {
  if (!item.collected) return 'Not collected';
  if (!item.updated_by_name) return 'Collected';
  return `Ticked by ${item.updated_by_name}${item.updated_at ? ` · ${relativeTime(item.updated_at)}` : ''}`;
}

function staffNote(item) {
  return item.note ? h('p', { class: 'check-row__note' }, item.note) : null;
}

function reviewTag(item) {
  if (item.review_status === 'issue') return h('span', { class: 'issue-tag' }, 'Issue');
  if (item.review_status === 'ok') return h('span', { class: 'ok-tag' }, 'OK');
  return null;
}

function bigCount(collected, total) {
  return h(
    'div',
    { class: 'review-count' },
    h('div', { class: 'tally' }, h('span', { class: 'tally__num' }, String(collected)), h('span', { class: 'tally__label' }, `of ${total} collected`)),
    progress(collected, total, { format: 'none', size: 'thick' }),
  );
}

function photoViewer(photos) {
  if (!photos.length) {
    return emptyState({ compact: true, title: 'No photos', text: 'No photos were attached to this checklist.' });
  }
  const n = photos.length;
  let current = 0;
  const img = h('img', { alt: '' });
  const fallbackName = h('span', { class: 'mono text-12' });
  const fallback = h('span', { class: 'viewer__fallback', hidden: true }, icon('file'), h('span', {}, 'This photo can’t be previewed in this browser.'), fallbackName);
  const caption = h('p', { class: 'viewer__caption' });
  const main = h(
    'button',
    {
      type: 'button',
      class: 'viewer__main',
      onClick: () => openLightbox(photos, current, { onClose: (i) => select(i) }),
      onKeydown: (e) => {
        if (e.key === 'ArrowRight' && current < n - 1) {
          e.preventDefault();
          select(current + 1);
        } else if (e.key === 'ArrowLeft' && current > 0) {
          e.preventDefault();
          select(current - 1);
        }
      },
    },
    img,
    fallback,
    h('span', { class: 'viewer__hint', 'aria-hidden': 'true' }, icon('zoom-in'), 'Click to zoom'),
  );
  img.addEventListener('error', () => {
    img.hidden = true;
    fallback.hidden = false;
  });
  const thumbs = photos.map((p, i) => {
    const li = photoThumb(p, { onOpen: () => select(i), active: i === 0 });
    qs('.thumb__open', li)?.setAttribute('aria-label', `Show photo ${i + 1} of ${n}: ${p.original_filename || 'photo'}`);
    return li;
  });

  function select(i) {
    current = Math.max(0, Math.min(n - 1, i));
    const p = photos[current];
    img.hidden = false;
    fallback.hidden = true;
    img.src = p.url;
    img.alt = `${p.original_filename || 'Photo'}, photo ${current + 1} of ${n}`;
    fallbackName.textContent = p.original_filename || '';
    main.setAttribute('aria-label', `Open photo ${current + 1} of ${n} full screen${n > 1 ? '. Left and right arrow keys switch photos' : ''}`);
    caption.textContent = [`Photo ${current + 1} of ${n}`, p.original_filename, p.uploaded_by_name && `added by ${p.uploaded_by_name}`, p.uploaded_at && relativeTime(p.uploaded_at)]
      .filter(Boolean)
      .join(' · ');
    thumbs.forEach((li, j) => {
      li.classList.toggle('is-active', j === current);
      qs('.thumb__open', li)?.setAttribute('aria-current', j === current ? 'true' : 'false');
    });
  }
  select(0);
  return h('div', { class: 'viewer' }, main, n > 1 && h('ul', { class: 'thumbs thumbs--strip', 'aria-label': 'All photos' }, thumbs), caption);
}

function photoGrid(photos) {
  if (!photos.length) return h('p', { class: 'muted text-14' }, 'No photos yet. Staff add them before submitting.');
  return h('ul', { class: 'thumbs' }, photos.map((p, i) => photoThumb(p, { onOpen: () => openLightbox(photos, i) })));
}

function groupEvents(events) {
  const grouped = [];
  for (const e of events || []) {
    const last = grouped[grouped.length - 1];
    const groupable = ['item_checked', 'item_unchecked', 'edited'].includes(e.type);
    if (groupable && last && last.type === e.type && last.user_name === e.user_name) {
      last.count += 1;
      continue;
    }
    grouped.push({ ...e, count: 1 });
  }
  return grouped;
}

function eventLabel(e) {
  switch (e.type) {
    case 'item_checked':
      if (e.count > 1) return `Ticked ${e.count} items`;
      return e.note ? `Ticked “${e.note}”` : 'Ticked an item';
    case 'item_unchecked':
      if (e.count > 1) return `Unticked ${e.count} items`;
      return e.note ? `Unticked “${e.note}”` : 'Unticked an item';
    case 'edited':
      return e.count > 1 ? `Edited ${e.count} times` : EVENT_LABELS.edited;
    case 'photo_added': {
      const n = Number(e.note);
      return Number.isFinite(n) && n > 0 ? `Added ${n} ${plural(n, 'photo')}` : 'Added photos';
    }
    default:
      return EVENT_LABELS[e.type] || String(e.type).replace(/_/g, ' ');
  }
}

function timeline(events) {
  const grouped = groupEvents(events);
  if (!grouped.length) return h('p', { class: 'muted text-14' }, 'No activity recorded yet.');
  return h(
    'ol',
    { class: 'timeline' },
    grouped.map((e) =>
      h(
        'li',
        { class: ['timeline__item', `timeline__item--${e.type}`] },
        h('div', { class: 'timeline__head' }, h('span', { class: 'timeline__type' }, eventLabel(e)), e.user_name && h('span', { class: 'timeline__who' }, `by ${e.user_name}`)),
        h('time', { class: 'timeline__time', datetime: e.created_at }, `${formatDateTime(e.created_at)} · ${relativeTime(e.created_at)}`),
        e.note && !['photo_added', 'photo_removed', 'item_checked', 'item_unchecked'].includes(e.type) && h('p', { class: 'timeline__note' }, e.note),
      ),
    ),
  );
}

function activitySection(events, { open = false } = {}) {
  const n = groupEvents(events).length;
  return h(
    'details',
    { class: 'sheet activity', open },
    h('summary', {}, h('span', {}, 'Activity ', h('span', { class: 'muted weight-500' }, `(${n})`)), icon('chevron-down')),
    h('div', { class: 'sheet__body' }, timeline(events)),
  );
}

// ---------- invoice route: loads, then picks editor / review / record ----------

function invoiceView(ctx, idText) {
  const id = Number(idText);
  let sub = null;
  let current = null;

  // carry: true keeps unsent review marks and the decision note across the rebuild (see show()).
  async function load({ quiet = false, focus, carry } = {}) {
    if (!quiet) mount(ctx.main, skeleton(2, { title: true, rows: 6 }));
    try {
      const { invoice } = await api.get(`/api/admin/invoices/${id}`, { signal: ctx.signal });
      if (!ctx.alive()) return null;
      show(invoice, { focus, keepScroll: quiet, carry });
      return invoice;
    } catch (err) {
      if (isAbort(err) || !ctx.alive()) return null;
      if (err.status === 404) renderGone();
      else if (!quiet) {
        mount(ctx.main, backLink(), pageHeader({ title: 'Invoice' }), banner({ type: 'error', title: 'Couldn’t load this invoice', message: explain(err), actions: retryButton(() => load()) }));
        ctx.ready('Invoice');
      } else {
        toast(`Couldn’t refresh this invoice. ${explain(err)}`, { type: 'error' });
      }
      return null;
    }
  }

  function show(invoice, opts = {}) {
    const y = window.scrollY;
    // Read the review in progress before the old view is destroyed (captured now, not when the GET started).
    const carry = opts.carry === true ? (sub?.carry?.() ?? null) : null;
    sub?.destroy?.();
    document.body.style.removeProperty('--toast-offset');
    current = invoice;
    const nav = { show, reload: load, gone: renderGone };
    const viewOpts = { ...opts, carry };
    if (EDITABLE.has(invoice.status)) sub = editorView(ctx, invoice, nav, viewOpts);
    else if (invoice.status === 'submitted') sub = reviewView(ctx, invoice, nav, viewOpts);
    else sub = recordView(ctx, invoice, nav, viewOpts);
    if (opts.keepScroll) window.scrollTo(0, y);
    if (carry && invoice.status !== 'submitted') {
      toast(`${invoiceLabel(invoice)} is now “${statusLabel(invoice.status)}”, so your review marks and note weren’t sent.`, { type: 'warning' });
    }
  }

  function renderGone() {
    sub?.destroy?.();
    sub = null;
    document.body.style.removeProperty('--toast-offset');
    mount(
      ctx.main,
      backLink(),
      pageHeader({ title: 'Invoice not found' }),
      emptyState({
        title: 'This invoice doesn’t exist any more.',
        text: 'It may have been deleted by another admin, or the link is out of date.',
        action: h('a', { class: 'btn btn--primary', href: '#/queue' }, 'Back to the queue'),
      }),
    );
    ctx.ready('Invoice not found');
  }

  async function remoteChange(status) {
    if (status === 'submitted' && sub?.carry && !sub.isBusy?.()) {
      load({ quiet: true, focus: false, carry: true });
      return;
    }
    if (status === null) {
      if (sub?.isDirty?.()) {
        sub.notice?.(banner({ type: 'error', title: 'This invoice was just deleted', message: 'Another admin deleted it, so your changes can’t be saved.', actions: h('a', { class: 'btn btn--secondary btn--sm', href: '#/queue' }, 'Back to the queue') }));
      } else {
        renderGone();
        toast('This invoice was deleted by another admin.', { type: 'warning' });
      }
      return;
    }
    if (sub?.isDirty?.()) {
      sub.notice?.(
        banner({
          type: 'warning',
          title: `Someone changed this invoice: it’s now “${statusLabel(status)}”`,
          message: EDITABLE.has(status)
            ? 'Your unsaved edits are still here. Save them, or reload to see the latest version.'
            : 'It can’t be edited in this status, so your unsaved edits can’t be saved. Reload to see it.',
          actions: h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: () => { sub?.discard?.(); load({ quiet: true }); } }, icon('refresh'), 'Reload'),
        }),
      );
      return;
    }
    const before = current?.status;
    const fresh = await load({ quiet: true, focus: false });
    if (fresh && before && fresh.status !== before) {
      toast(`${invoiceLabel(fresh)} is now “${statusLabel(fresh.status)}”.`, { type: 'info' });
    }
  }

  load();

  return {
    canLeave: () => (sub?.canLeave ? sub.canLeave() : true),
    onInvoiceEvent(data) {
      if (Number(data.id) !== id || isOwn(id)) return;
      remoteChange(data.status ?? null);
    },
    onReconnect() {
      // The review view can rebuild from fresh data and keep the admin's marks and note.
      if (sub?.carry) {
        if (!sub.isBusy?.()) load({ quiet: true, focus: false, carry: true });
        return;
      }
      if (!sub?.isDirty?.()) load({ quiet: true, focus: false });
    },
    destroy() {
      sub?.destroy?.();
    },
  };
}

// ---------- draft editor (draft / open / in_progress / returned) ----------

const FIELD_LABELS = { description: 'Description', sku: 'SKU', quantity: 'Qty', unit: 'Unit' };
const LINE_FIELDS = ['description', 'sku', 'quantity', 'unit'];

function toLines(items) {
  return items.map((it) => ({
    key: newKey(),
    id: it.id,
    description: it.description ?? '',
    sku: it.sku ?? '',
    quantity: qtyString(it.quantity),
    unit: it.unit ?? '',
    collected: Boolean(it.collected),
  }));
}

// Only a new, untouched line is blank (and left out of the save). A saved line always goes through
// validation: leaving it out of the PUT would delete the item, its tick and its note.
const isBlankLine = (l) =>
  !l.id && !l.description.trim() && !l.sku.trim() && !l.unit.trim() && ['', '1'].includes(l.quantity.trim());

function editorView(ctx, initial, nav, opts = {}) {
  const id = initial.id;
  let invoice = initial;
  const isDraft = invoice.status === 'draft';
  let lines = toLines(invoice.items);
  let baseline = '';
  let busy = false;
  let discarded = false;
  let destroyed = false;

  const onEdit = () => updateDirty();
  const fields = {
    number: textField({ id: 'f-number', label: 'Invoice number', value: invoice.invoice_number, mono: true, maxLength: 100, help: isDraft ? 'Needed to publish. Staff search by it.' : 'Staff search by this number.', onInput: onEdit }),
    customer: textField({ id: 'f-customer', label: 'Customer', value: invoice.customer_name, maxLength: 200, help: isDraft ? 'Needed to publish.' : 'Staff can also search by customer.', onInput: onEdit }),
    date: textField({ id: 'f-date', label: 'Invoice date', type: 'date', value: invoice.invoice_date, optional: true, onInput: onEdit }),
  };

  const headerSlot = h('div', {});
  const noticeSlot = h('div', { class: 'stack stack--3 slot' });
  const summarySlot = h('div', { class: 'slot' });
  const tbody = h('tbody', {});
  const lineCount = h('span', { class: 'muted text-14' });
  const addLineBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => addLine() }, icon('plus'), 'Add line');
  const progressSlot = h('div', { class: 'stack stack--4' });
  const activitySlot = h('div', {});
  const saveState = h('span', { class: 'save-state', role: 'status' });
  const saveBtn = h('button', { type: 'button', class: ['btn', isDraft ? 'btn--secondary' : 'btn--primary'], onClick: () => save() }, 'Save changes');
  const publishBtn = isDraft && h('button', { type: 'button', class: 'btn btn--primary', onClick: () => publish() }, icon('send'), 'Publish checklist');
  const rereadBtn = isDraft && h('button', { type: 'button', class: 'btn btn--secondary', onClick: () => reread() }, icon('refresh'), 'Re-read invoice');
  const deleteBtn = h('button', { type: 'button', class: 'btn btn--danger-ghost', onClick: () => deleteInvoice() }, icon('trash'), 'Delete');

  const pickedCol = !isDraft;
  const table = h(
    'table',
    { class: 'table table--edit lines-table' },
    h('caption', { class: 'sr-only' }, 'Checklist lines. Press Enter to move to the same field on the next line.'),
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col', class: 'line-no' }, h('span', { 'aria-hidden': 'true' }, '#'), h('span', { class: 'sr-only' }, 'Line')),
        h('th', { scope: 'col', class: 'line-desc' }, 'Description'),
        h('th', { scope: 'col', class: 'line-sku' }, 'SKU'),
        h('th', { scope: 'col', class: 'line-qty num' }, 'Qty'),
        h('th', { scope: 'col', class: 'line-unit' }, 'Unit'),
        pickedCol && h('th', { scope: 'col', class: 'line-picked' }, 'Picked'),
        h('th', { scope: 'col', class: 'col-shrink line-del' }, h('span', { class: 'sr-only' }, 'Delete')),
      ),
    ),
    tbody,
  );

  mount(
    ctx.main,
    backLink(),
    headerSlot,
    h(
      'div',
      { class: 'stack stack--6' },
      noticeSlot,
      summarySlot,
      h(
        'section',
        { class: 'sheet', 'aria-labelledby': 'details-title' },
        h('header', { class: 'sheet__header' }, h('h2', { class: 'sheet__title', id: 'details-title' }, 'Invoice details')),
        h('div', { class: 'sheet__body stack stack--4' }, h('div', { class: 'field-row' }, fields.number.el, fields.customer.el, fields.date.el), h('hr', { class: 'divider' }), metaList()),
      ),
      h(
        'section',
        { class: 'sheet', 'aria-labelledby': 'lines-title' },
        h('header', { class: 'sheet__header' }, h('h2', { class: 'sheet__title', id: 'lines-title' }, 'Lines'), lineCount),
        h('div', { class: 'table-wrap table-wrap--bare' }, table),
        h('div', { class: 'lines-footer' }, addLineBtn, h('span', { class: 'muted text-12 hide-mobile' }, 'Enter moves to the next line · Ctrl+S saves')),
      ),
      progressSlot,
      activitySlot,
    ),
    h(
      'div',
      { class: 'bottom-bar editor-bar' },
      h('div', { class: 'bar-start' }, deleteBtn, saveState),
      rereadBtn,
      saveBtn,
      publishBtn,
    ),
  );

  renderHeader();
  renderNotices();
  renderLines();
  renderProgress();
  setBaseline();
  ctx.ready(invoice.invoice_number || 'Untitled draft', { focus: opts.focus });
  if (window.matchMedia('(min-width: 600px)').matches) document.body.style.setProperty('--toast-offset', '72px');

  const onBeforeUnload = (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      save();
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('keydown', onKey);

  function metaList() {
    const item = (dt, dd) => h('div', { class: 'meta__item' }, h('dt', {}, dt), h('dd', {}, dd));
    return h(
      'dl',
      { class: 'meta' },
      item('Read with', METHOD_LABELS[invoice.extraction_method] || invoice.extraction_method || '—'),
      item('Original file', h('span', { class: 'mono' }, invoice.original_filename || '—')),
      item('Uploaded', formatDateTime(invoice.created_at)),
      invoice.published_at && item('Published', formatDateTime(invoice.published_at)),
    );
  }

  function renderHeader() {
    mount(headerSlot, invoiceHeader(invoice, { justRuled: opts.justRuled }));
  }

  function renderNotices() {
    const parts = [];
    if (invoice.status === 'returned') {
      parts.push(
        banner({
          type: 'error',
          title: `Returned to staff${invoice.reviewed_by_name ? ` by ${invoice.reviewed_by_name}` : ''}${invoice.reviewed_at ? `, ${relativeTime(invoice.reviewed_at)}` : ''}`,
          message: invoice.review_note || 'No note was left.',
        }),
      );
    }
    if (!isDraft) {
      parts.push(
        banner({
          type: 'info',
          title: 'This checklist is live',
          message: 'Staff can already see it. Saved changes reach them straight away, and removing a line also removes its tick and note.',
        }),
      );
    }
    if (isDraft && invoice.extraction_warnings?.length) {
      parts.push(
        banner({
          type: 'warning',
          title: 'Check what Tally read',
          message: h('ul', {}, invoice.extraction_warnings.map((w) => h('li', {}, w))),
          actions: invoice.file_url && h('a', { class: 'btn btn--secondary btn--sm', href: invoice.file_url, target: '_blank', rel: 'noopener' }, 'View original'),
        }),
      );
    } else if (isDraft && !invoice.items.length) {
      parts.push(banner({ type: 'warning', title: 'No lines were found', message: 'Add the lines from the invoice by hand, or re-read it.' }));
    }
    mount(noticeSlot, parts);
  }

  function lineRow(line, index) {
    const n = index + 1;
    const cell = (field, extra = {}) =>
      h('input', {
        class: ['input', 'input--cell', (field === 'sku' || field === 'quantity') && 'input--mono'],
        dataset: { key: line.key, field },
        value: line[field],
        'aria-label': `${FIELD_LABELS[field]}, line ${n}`,
        placeholder: FIELD_LABELS[field],
        autocomplete: 'off',
        spellcheck: field === 'description' ? undefined : 'false',
        ...extra,
        onInput: (e) => {
          line[field] = e.target.value;
          e.target.removeAttribute('aria-invalid');
          updateDirty();
        },
        onKeydown: onCellKey,
      });
    return h(
      'tr',
      { dataset: { key: line.key } },
      h('td', { class: 'num line-no' }, String(n)),
      h('td', { class: 'line-desc' }, cell('description', { maxlength: 300 })),
      h('td', { class: 'line-sku' }, cell('sku', { maxlength: 100 })),
      h('td', { class: 'line-qty' }, cell('quantity', { inputmode: 'decimal' })),
      h('td', { class: 'line-unit' }, cell('unit', { maxlength: 50 })),
      pickedCol && h('td', { class: 'line-picked' }, line.collected ? icon('check', { label: 'Picked by staff' }) : h('span', { class: 'sr-only' }, 'Not picked')),
      h(
        'td',
        { class: 'col-shrink line-del' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--icon btn--sm',
            dataset: { key: line.key, field: 'delete' },
            'aria-label': `Delete line ${n}${line.description.trim() ? ` (${line.description.trim()})` : ''}`,
            title: 'Delete line',
            onClick: () => removeLine(line.key),
          },
          icon('trash'),
        ),
      ),
    );
  }

  function renderLines({ focus } = {}) {
    const active = document.activeElement;
    const keep = focus || (tbody.contains(active) && active.dataset.key ? { key: active.dataset.key, field: active.dataset.field, start: active.selectionStart, end: active.selectionEnd } : null);
    if (lines.length) {
      tbody.replaceChildren(...lines.map(lineRow));
    } else {
      tbody.replaceChildren(h('tr', { class: 'lines-empty' }, h('td', { colspan: pickedCol ? 7 : 6 }, 'No lines yet. Use “Add line” to type them in from the invoice.')));
    }
    const count = lines.filter((l) => !isBlankLine(l)).length;
    lineCount.textContent = `${count} ${plural(count, 'line')}`;
    if (keep) {
      const target = qs(`[data-key="${CSS.escape(keep.key)}"][data-field="${keep.field}"]`, tbody);
      if (target) {
        target.focus();
        if (keep.start != null && typeof target.setSelectionRange === 'function') {
          try {
            target.setSelectionRange(keep.start, keep.end);
          } catch {
            /* not a text input */
          }
        }
      }
    }
  }

  function focusCell(key, field) {
    const el = qs(`[data-key="${CSS.escape(key)}"][data-field="${field}"]`, tbody);
    el?.focus();
    el?.select?.();
  }

  function onCellKey(e) {
    const { key, field } = e.target.dataset;
    const index = lines.findIndex((l) => l.key === key);
    let target = null;
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) target = e.shiftKey ? index - 1 : index + 1;
    else if (e.key === 'ArrowDown' && !e.altKey) target = index + 1;
    else if (e.key === 'ArrowUp' && !e.altKey) target = index - 1;
    else return;
    e.preventDefault();
    if (target < 0) return;
    if (target >= lines.length) {
      if (e.key === 'Enter') addLine(field);
      return;
    }
    focusCell(lines[target].key, field);
  }

  function addLine(field = 'description') {
    const line = { key: newKey(), id: null, description: '', sku: '', quantity: '1', unit: '', collected: false };
    lines.push(line);
    renderLines();
    focusCell(line.key, field);
    updateDirty();
  }

  function removeLine(key) {
    const index = lines.findIndex((l) => l.key === key);
    if (index < 0) return;
    const [removed] = lines.splice(index, 1);
    renderLines();
    const next = lines[index] || lines[index - 1];
    if (next) qs(`[data-key="${CSS.escape(next.key)}"][data-field="delete"]`, tbody)?.focus();
    else addLineBtn.focus();
    updateDirty();
    const name = removed.description.trim() ? `“${removed.description.trim()}”` : `Line ${index + 1}`;
    toast(`${name} removed. It’s deleted when you save.`, {
      action: {
        label: 'Undo',
        onClick: () => {
          if (!ctx.alive() || discarded || destroyed || lines.some((l) => l.key === removed.key)) return;
          // Saved since the removal? Then the server already deleted the item, so the line comes back
          // as a new one (its old id would be rejected as not belonging to this invoice).
          const stillSaved = removed.id && invoice.items.some((it) => it.id === removed.id);
          const restored = removed.id && !stillSaved ? { ...removed, id: null, collected: false } : removed;
          lines.splice(Math.min(index, lines.length), 0, restored);
          renderLines();
          focusCell(restored.key, 'description');
          updateDirty();
        },
      },
    });
  }

  function renderProgress() {
    if (isDraft) return;
    const items = invoice.items;
    const done = items.filter((i) => i.collected).length;
    const refreshBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => refreshProgress(refreshBtn) }, icon('refresh'), 'Refresh');
    mount(
      progressSlot,
      h(
        'section',
        { class: 'sheet', 'aria-labelledby': 'progress-title' },
        h('header', { class: 'sheet__header' }, h('h2', { class: 'sheet__title', id: 'progress-title' }, 'Staff progress'), refreshBtn),
        h(
          'div',
          { class: 'sheet__body stack stack--4' },
          progress(done, items.length, { format: 'sentence', layout: 'stacked' }),
          items.length
            ? h('ul', { class: 'checklist' }, items.map((it) => checkRow(it, { byline: itemByline(it), extra: [staffNote(it), reviewTag(it)] })))
            : h('p', { class: 'muted text-14' }, 'No saved lines yet.'),
          h('h3', { class: 'subsection-title' }, `Photos so far (${invoice.photos.length})`),
          photoGrid(invoice.photos),
        ),
      ),
    );
    mount(activitySlot, activitySection(invoice.events));
  }

  async function refreshProgress(button) {
    setLoading(button, true);
    try {
      const { invoice: fresh } = await api.get(`/api/admin/invoices/${id}`, { signal: ctx.signal });
      if (fresh.status !== invoice.status) {
        if (isDirty()) {
          notice(banner({ type: 'warning', title: `This invoice is now “${statusLabel(fresh.status)}”`, message: 'Save or discard your edits, then reload.' }));
        } else {
          nav.show(fresh, { focus: false, keepScroll: true });
          return;
        }
      }
      invoice = { ...invoice, items: fresh.items, photos: fresh.photos, events: fresh.events, items_collected: fresh.items_collected };
      const byId = new Map(fresh.items.map((it) => [it.id, it]));
      for (const line of lines) if (line.id && byId.has(line.id)) line.collected = byId.get(line.id).collected;
      renderLines();
      renderProgress();
      qs('#progress-title', progressSlot)?.closest('section')?.querySelector('.btn')?.focus();
      announce('Staff progress refreshed');
    } catch (err) {
      if (isAbort(err)) return;
      if (err.status === 404) nav.gone();
      else toast(`Couldn’t refresh staff progress. ${explain(err)}`, { type: 'error' });
    } finally {
      setLoading(button, false);
    }
  }

  function snapshot() {
    return JSON.stringify({
      number: fields.number.input.value.trim(),
      customer: fields.customer.input.value.trim(),
      date: fields.date.input.value,
      lines: lines.filter((l) => !isBlankLine(l)).map((l) => [l.id, l.description.trim(), l.sku.trim(), l.quantity.trim(), l.unit.trim()]),
    });
  }

  function setBaseline() {
    baseline = snapshot();
    updateDirty();
  }

  function isDirty() {
    return !discarded && snapshot() !== baseline;
  }

  function updateDirty() {
    const dirty = isDirty();
    saveState.classList.toggle('is-dirty', dirty);
    saveState.textContent = dirty ? 'Unsaved changes' : invoice.updated_at ? `Saved ${relativeTime(invoice.updated_at)}` : '';
  }

  function notice(node) {
    mount(noticeSlot, node);
    noticeSlot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function clearErrors() {
    mount(summarySlot);
    Object.values(fields).forEach((f) => f.setError(''));
    qsa('[aria-invalid="true"]', tbody).forEach((el) => el.removeAttribute('aria-invalid'));
  }

  // errors: [{ message, target? }]
  function showSummary(errors, title) {
    const list = h(
      'ul',
      {},
      errors.map((e) =>
        h(
          'li',
          {},
          e.target
            ? h('button', { type: 'button', class: 'link', onClick: () => { e.target.focus(); e.target.select?.(); } }, e.message)
            : e.message,
        ),
      ),
    );
    const box = banner({ type: 'error', title, message: list, actions: errors.actions });
    box.tabIndex = -1;
    box.dataset.focusTarget = '';
    mount(summarySlot, box);
    const single = errors.length === 1 && errors[0].target;
    if (single) {
      single.focus();
      single.select?.();
    } else {
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      box.focus({ preventScroll: true });
    }
  }

  function collect({ forPublish }) {
    clearErrors();
    const errors = [];
    const needHeader = forPublish || !isDraft;
    const number = fields.number.input.value.trim();
    const customer = fields.customer.input.value.trim();
    const date = fields.date.input.value;
    if (needHeader && !number) {
      fields.number.setError('Add the invoice number. Staff search by it.');
      errors.push({ message: 'Add the invoice number.', target: fields.number.input });
    }
    if (needHeader && !customer) {
      fields.customer.setError('Add the customer name.');
      errors.push({ message: 'Add the customer name.', target: fields.customer.input });
    }
    if (fields.date.input.validity?.badInput) {
      fields.date.setError('Enter a full date, or clear the field.');
      errors.push({ message: 'Enter a full invoice date, or clear it.', target: fields.date.input });
    }
    const sent = [];
    lines.forEach((line, i) => {
      if (isBlankLine(line)) return;
      const description = line.description.trim();
      const quantity = parseQuantity(line.quantity); // "1,000" → 1000, "2,5" → 2.5, ambiguous → NaN
      if (!description) {
        const el = qs(`[data-key="${line.key}"][data-field="description"]`, tbody);
        el?.setAttribute('aria-invalid', 'true');
        errors.push({ message: `Line ${i + 1}: add a description${line.id ? ', or delete the line' : ''}.`, target: el });
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        const el = qs(`[data-key="${line.key}"][data-field="quantity"]`, tbody);
        el?.setAttribute('aria-invalid', 'true');
        errors.push({ message: `Line ${i + 1}: quantity must be a number greater than 0, like 6, 2.5 or 1,000.`, target: el });
      }
      sent.push({
        line,
        payload: {
          ...(line.id ? { id: line.id } : {}),
          description,
          sku: line.sku.trim() || null,
          quantity,
          unit: line.unit.trim() || null,
        },
      });
    });
    if (needHeader && sent.length === 0) {
      errors.push({ message: forPublish ? 'Add at least one line before publishing.' : 'A published checklist needs at least one line.', target: addLineBtn });
    }
    if (errors.length) {
      showSummary(errors, forPublish ? 'Fix these before publishing' : 'Fix these before saving');
      return null;
    }
    return {
      sent,
      body: { invoice_number: number || null, customer_name: customer || null, invoice_date: date || null, items: sent.map((s) => s.payload) },
    };
  }

  async function confirmRemovals(sent) {
    if (isDraft) return true;
    const keptIds = new Set(sent.map((s) => s.line.id).filter(Boolean));
    if (!invoice.items.some((it) => !keptIds.has(it.id))) return true;
    // Ticks and notes don't send live events, so `invoice.items` may be as old as the editor.
    // Check the latest state before deleting lines on a live checklist.
    let items = invoice.items;
    let checked = true;
    try {
      const { invoice: fresh } = await api.get(`/api/admin/invoices/${id}`, { signal: ctx.signal });
      if (Array.isArray(fresh?.items)) items = fresh.items;
    } catch (err) {
      if (isAbort(err)) return false;
      checked = false; // fall back to what we have; the save itself reports server problems
    }
    const worked = items.filter((it) => !keptIds.has(it.id) && (it.collected || it.note));
    if (!worked.length) return true;
    const names = worked.slice(0, 3).map((it) => it.description).join(', ') + (worked.length > 3 ? ` and ${worked.length - 3} more` : '');
    return confirmDialog({
      title: `Remove ${worked.length} ${plural(worked.length, 'line')} staff already worked on?`,
      message: `Staff have ticked or added a note to: ${names}. Saving removes these lines with their ticks and notes.${checked ? '' : ' (Tally couldn’t check for newer ticks.)'}`,
      confirmLabel: 'Save and remove',
      cancelLabel: 'Keep editing',
      danger: true,
    });
  }

  function applySaved(saved, sent) {
    invoice = saved;
    const before = document.activeElement;
    lines = saved.items.map((it, i) => ({
      key: sent[i]?.line.key ?? newKey(),
      id: it.id,
      description: it.description,
      sku: it.sku ?? '',
      quantity: qtyString(it.quantity),
      unit: it.unit ?? '',
      collected: Boolean(it.collected),
    }));
    for (const [field, value] of [[fields.number, saved.invoice_number], [fields.customer, saved.customer_name], [fields.date, saved.invoice_date]]) {
      if (field.input.value.trim() !== (value ?? '')) field.input.value = value ?? '';
    }
    renderHeader();
    renderLines();
    renderProgress();
    setBaseline();
    if (before && !before.isConnected) saveBtn.focus();
  }

  // Maps a failed save/publish to the field or line it concerns.
  function handleFailure(err, sent, action) {
    if (isAbort(err)) return;
    const verb = action === 'publish' ? 'publish' : 'save';
    if (err.status === 404) {
      nav.gone();
      return;
    }
    const message = explain(err, `Couldn’t ${verb} the checklist.`);
    const errors = [];
    const lineMatch = /^Line (\d+)/.exec(err.message || '');
    if (err.status === 409 || /invoice number/i.test(err.message)) {
      fields.number.setError(err.message);
      errors.push({ message, target: fields.number.input });
    } else if (/customer/i.test(err.message) && err.status < 500) {
      fields.customer.setError(err.message);
      errors.push({ message, target: fields.customer.input });
    } else if (/date/i.test(err.message) && err.status === 400) {
      fields.date.setError(err.message);
      errors.push({ message, target: fields.date.input });
    } else if (lineMatch && sent?.[Number(lineMatch[1]) - 1]) {
      const { line } = sent[Number(lineMatch[1]) - 1];
      const shownIndex = lines.indexOf(line) + 1;
      const field = /quantity/i.test(err.message) ? 'quantity' : /sku/i.test(err.message) ? 'sku' : /unit/i.test(err.message) ? 'unit' : 'description';
      const el = qs(`[data-key="${line.key}"][data-field="${field}"]`, tbody);
      el?.setAttribute('aria-invalid', 'true');
      errors.push({ message: shownIndex > 0 ? err.message.replace(/^Line \d+/, `Line ${shownIndex}`) : err.message, target: el });
    } else if (/item|line/i.test(err.message) && err.status === 422) {
      errors.push({ message, target: addLineBtn });
    } else if (err.status === 403) {
      errors.push({ message: `${err.message}. Someone may have changed its status. Reload to see the latest version.` });
      errors.actions = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: () => { discard(); nav.reload({ quiet: true }); } }, icon('refresh'), 'Reload');
    } else {
      errors.push({ message });
      errors.actions = retryButton(() => (action === 'publish' ? publish() : save()));
    }
    showSummary(errors, action === 'publish' ? 'The checklist wasn’t published' : 'Your changes weren’t saved');
  }

  async function save() {
    if (busy) return null;
    const collected = collect({ forPublish: false });
    if (!collected) return null;
    if (!isDirty()) {
      toast('Nothing to save. Everything is up to date.', { type: 'info' });
      return invoice;
    }
    busy = true;
    setLoading(saveBtn, true);
    try {
      if (!(await confirmRemovals(collected.sent))) return null;
      if (!ctx.alive() || destroyed) return null;
      const { invoice: saved } = await api.put(`/api/admin/invoices/${id}`, collected.body);
      if (!ctx.alive()) return null;
      applySaved(saved, collected.sent);
      toast(isDraft ? 'Draft saved' : 'Changes saved. Staff see them now.', { type: 'success' });
      return saved;
    } catch (err) {
      if (ctx.alive()) handleFailure(err, collected.sent, 'save');
      return null;
    } finally {
      busy = false;
      setLoading(saveBtn, false);
    }
  }

  async function publish() {
    if (busy) return;
    const collected = collect({ forPublish: true });
    if (!collected) return;
    busy = true;
    setLoading(publishBtn, true);
    try {
      if (isDirty()) {
        const { invoice: saved } = await api.put(`/api/admin/invoices/${id}`, collected.body);
        if (!ctx.alive()) return;
        applySaved(saved, collected.sent);
      }
      markOwn(id);
      const { invoice: published } = await api.post(`/api/admin/invoices/${id}/publish`);
      if (!ctx.alive()) return;
      refreshCountsSoon();
      toast(`Checklist published. Staff can find ${published.invoice_number} by number or customer.`, { type: 'success' });
      nav.show(published, { focus: true });
    } catch (err) {
      if (ctx.alive()) handleFailure(err, collected.sent, 'publish');
    } finally {
      busy = false;
      if (publishBtn.isConnected) setLoading(publishBtn, false);
    }
  }

  async function reread() {
    if (busy) return;
    let result = null;
    const ok = await confirmDialog({
      title: 'Re-read the invoice?',
      message: `Tally reads “${invoice.original_filename}” again and replaces the invoice number, customer, date and every line.${isDirty() ? ' Your unsaved edits will be lost.' : ''} Scanned images can take up to a minute.`,
      confirmLabel: 'Re-read invoice',
      onConfirm: async () => {
        try {
          ({ invoice: result } = await api.post(`/api/admin/invoices/${id}/reextract`));
        } catch (err) {
          if (err.status === 404) throw new ApiError(404, 'This invoice no longer exists. It may have been deleted.');
          throw new ApiError(err.status, explain(err, 'Couldn’t re-read the invoice.'));
        }
      },
    });
    if (!ok || !result || !ctx.alive()) return;
    discard();
    nav.show(result, { focus: false });
    const lineTotal = result.items.length;
    toast(`Invoice re-read: ${lineTotal} ${plural(lineTotal, 'line')} found. Check them before publishing.`, { type: result.extraction_warnings?.length ? 'warning' : 'success' });
  }

  async function deleteInvoice() {
    const photos = invoice.photos.length;
    const ticked = invoice.items.filter((i) => i.collected).length;
    const message = isDraft
      ? 'The draft and its original file will be removed. This can’t be undone.'
      : `The checklist${ticked ? `, ${ticked} staff ${plural(ticked, 'tick')}` : ''}${photos ? `, ${photos} ${plural(photos, 'photo')}` : ''} and the original file will be removed. Staff won’t be able to find it any more. This can’t be undone.`;
    const ok = await confirmDialog({
      title: `Delete ${invoice.invoice_number || 'this draft'}?`,
      message,
      confirmLabel: 'Delete invoice',
      danger: true,
      onConfirm: async () => {
        markOwn(id);
        try {
          await api.del(`/api/admin/invoices/${id}`);
        } catch (err) {
          if (err.status !== 404) throw new ApiError(err.status, explain(err, 'Couldn’t delete the invoice.'));
        }
      },
    });
    if (!ok) return;
    discard();
    refreshCountsSoon();
    toast(`${invoice.invoice_number || 'Draft'} deleted`, { type: 'success' });
    navigate('#/queue');
  }

  function discard() {
    discarded = true;
  }

  return {
    isDirty,
    discard,
    notice,
    async canLeave() {
      if (!isDirty()) return true;
      return confirmDialog({
        title: 'Discard unsaved changes?',
        message: 'You changed this invoice but haven’t saved. Leaving now throws those changes away.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      });
    },
    destroy() {
      destroyed = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('keydown', onKey);
    },
  };
}

// ---------- review (submitted) ----------

function reviewView(ctx, invoice, nav, opts = {}) {
  const id = invoice.id;
  // carry: { reviews: Map, note, focus } from the review view this one replaces (reconnect / refresh),
  // so rebuilding from fresh data never silently drops marks the admin hasn't sent yet.
  const carried = opts.carry || null;
  const reviews = new Map(
    invoice.items.map((it) => [it.id, carried?.reviews?.has(it.id) ? carried.reviews.get(it.id) : (it.review_status ?? null)]),
  );
  const rows = new Map();
  const toggles = new Map();
  const noticeSlot = h('div', { class: 'stack stack--3 slot' });
  let busy = false;
  let discarded = false;
  const submitter = invoice.submitted_by_name || 'staff';
  const collected = invoice.items.filter((i) => i.collected).length;
  const total = invoice.items.length;

  const marksText = h('span', { role: 'status' });
  const markAllBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: markRemainingOk }, icon('check'), 'Mark unchecked as OK');
  const noteInput = h('textarea', {
    id: 'decision-note',
    class: 'textarea',
    maxlength: 1000,
    rows: 3,
    placeholder: 'e.g. Two cartons of oat milk are missing from the photo.',
    'aria-describedby': 'decision-note-help decision-note-error',
    value: carried?.note ?? '',
    onInput: () => {
      noteError.textContent = '';
      noteInput.removeAttribute('aria-invalid');
    },
  });
  const noteError = h('p', { class: 'field__error', id: 'decision-note-error' });
  const decisionError = h('div', { class: 'slot' });
  const approveBtn = h('button', { type: 'button', class: 'btn btn--primary', onClick: () => decide('approved') }, icon('check'), 'Approve');
  const returnBtn = h('button', { type: 'button', class: 'btn btn--danger', onClick: () => decide('returned') }, icon('undo'), 'Return to staff');

  const list = h(
    'ul',
    { class: 'checklist review-list' },
    invoice.items.map((item) => {
      const toggle = reviewToggle(item);
      const li = checkRow(item, { byline: itemByline(item), extra: [staffNote(item), toggle.el] });
      rows.set(item.id, li);
      toggles.set(item.id, toggle);
      return li;
    }),
  );
  for (const [itemId, value] of reviews) setRowIssue(rows.get(itemId), value === 'issue');

  mount(
    ctx.main,
    backLink(),
    invoiceHeader(invoice),
    h(
      'div',
      { class: 'stack stack--6' },
      noticeSlot,
      h(
        'p',
        { class: 'muted' },
        `Submitted by ${submitter}${invoice.submitted_at ? ` ${relativeTime(invoice.submitted_at)} (${formatDateTime(invoice.submitted_at)})` : ''}. Compare the photos with each line, mark it OK or Issue, then approve or return it.`,
      ),
      h(
        'div',
        { class: 'split split--sticky' },
        h(
          'section',
          { class: 'stack stack--3', 'aria-labelledby': 'photos-title' },
          h('h2', { class: 'section-title', id: 'photos-title' }, `Photos (${invoice.photos.length})`),
          photoViewer(invoice.photos),
        ),
        h(
          'div',
          { class: 'stack stack--4' },
          invoice.submit_note && banner({ type: 'info', title: `Note from ${submitter}`, message: invoice.submit_note }),
          h(
            'section',
            { class: 'sheet sheet--flush', 'aria-labelledby': 'checklist-title' },
            h('header', { class: 'sheet__header' }, h('h2', { class: 'sheet__title', id: 'checklist-title' }, 'Checklist'), bigCount(collected, total)),
            h('div', { class: 'review-marks' }, marksText, markAllBtn),
            list,
          ),
          h(
            'section',
            { class: 'sheet', 'aria-labelledby': 'decision-title' },
            h('header', { class: 'sheet__header' }, h('h2', { class: 'sheet__title', id: 'decision-title' }, 'Decision')),
            h(
              'div',
              { class: 'sheet__body stack stack--3' },
              decisionError,
              h(
                'div',
                { class: 'field' },
                h('label', { class: 'field__label', for: 'decision-note' }, 'Note for staff'),
                noteInput,
                h('p', { class: 'field__help', id: 'decision-note-help' }, 'Optional when approving. Required when returning: tell staff exactly what to fix.'),
                noteError,
              ),
            ),
          ),
        ),
      ),
      activitySection(invoice.events),
    ),
    h('div', { class: 'bottom-bar decision-bar' }, h('div', { class: 'bar-start' }, h('span', { class: 'muted text-14' }, `${collected} of ${total} collected · ${invoice.photos.length} ${plural(invoice.photos.length, 'photo')}`)), returnBtn, approveBtn),
  );
  updateMarks();
  ctx.ready(`Review ${invoice.invoice_number || 'invoice'}`, { focus: opts.focus });
  if (window.matchMedia('(min-width: 600px)').matches) document.body.style.setProperty('--toast-offset', '72px');
  restoreFocus(carried?.focus);

  function focusDescriptor() {
    const active = document.activeElement;
    if (active === noteInput) return { note: true, start: active.selectionStart, end: active.selectionEnd };
    for (const [itemId, t] of toggles) {
      if (active === t.ok) return { itemId, value: 'ok' };
      if (active === t.issue) return { itemId, value: 'issue' };
    }
    return null;
  }

  function restoreFocus(focus) {
    if (focus?.note) {
      noteInput.focus({ preventScroll: true });
      try {
        noteInput.setSelectionRange(focus.start, focus.end);
      } catch {
        /* selection not restorable */
      }
    } else if (focus?.itemId) {
      toggles.get(focus.itemId)?.[focus.value]?.focus({ preventScroll: true });
    }
  }

  function reviewToggle(item) {
    const make = (value, label) =>
      h('button', { type: 'button', class: ['review-toggle__btn', `review-toggle__btn--${value}`], 'aria-pressed': 'false', onClick: () => setReview(item.id, value) }, label);
    const ok = make('ok', 'OK');
    const issue = make('issue', 'Issue');
    const el = h('div', { class: 'review-toggle', role: 'group', 'aria-label': `Cross-check ${item.description}` }, ok, issue);
    const sync = (value) => {
      ok.setAttribute('aria-pressed', String(value === 'ok'));
      issue.setAttribute('aria-pressed', String(value === 'issue'));
    };
    sync(reviews.get(item.id));
    return { el, sync, ok, issue };
  }

  function setReview(itemId, value) {
    const next = reviews.get(itemId) === value ? null : value;
    reviews.set(itemId, next);
    toggles.get(itemId).sync(next);
    setRowIssue(rows.get(itemId), next === 'issue');
    updateMarks();
  }

  function markRemainingOk() {
    let changed = 0;
    for (const [itemId, value] of reviews) {
      if (value === null) {
        reviews.set(itemId, 'ok');
        toggles.get(itemId).sync('ok');
        changed += 1;
      }
    }
    updateMarks();
    announce(changed ? `Marked ${changed} ${plural(changed, 'line')} OK` : 'Every line is already marked');
  }

  function tallyMarks() {
    const values = [...reviews.values()];
    return { ok: values.filter((v) => v === 'ok').length, issue: values.filter((v) => v === 'issue').length, none: values.filter((v) => v === null).length };
  }

  function updateMarks() {
    const m = tallyMarks();
    marksText.textContent = `${m.ok} OK · ${m.issue} ${plural(m.issue, 'issue')} · ${m.none} not checked`;
    markAllBtn.disabled = m.none === 0;
  }

  function hasProgress() {
    return noteInput.value.trim() !== '' || [...reviews.values()].some((v) => v !== null);
  }

  async function decide(kind) {
    if (busy) return;
    mount(decisionError);
    noteError.textContent = '';
    noteInput.removeAttribute('aria-invalid');
    const note = noteInput.value.trim();
    if (kind === 'returned' && !note) {
      noteError.textContent = 'Add a note telling staff what to fix. They see it on their checklist.';
      noteInput.setAttribute('aria-invalid', 'true');
      noteInput.focus();
      return;
    }
    if (kind === 'approved') {
      const { issue } = tallyMarks();
      const missing = total - collected;
      if (issue || missing) {
        const parts = [issue && `${issue} ${plural(issue, 'line is', 'lines are')} marked as an issue`, missing && `${missing} ${plural(missing, 'line was', 'lines were')} not collected`].filter(Boolean);
        const ok = await confirmDialog({
          title: 'Approve anyway?',
          message: `${parts.join(' and ')}. Approving closes the checklist and staff can’t change it afterwards. To get it fixed, return it instead.`,
          confirmLabel: 'Approve anyway',
          cancelLabel: 'Go back',
        });
        if (!ok) return;
      }
    }
    busy = true;
    const button = kind === 'approved' ? approveBtn : returnBtn;
    const other = kind === 'approved' ? returnBtn : approveBtn;
    setLoading(button, true);
    other.disabled = true;
    const body = { item_reviews: [...reviews].map(([item_id, review_status]) => ({ item_id, review_status })) };
    if (note) body.note = note;
    try {
      markOwn(id);
      const { invoice: ruled } = await api.post(`/api/admin/invoices/${id}/${kind === 'approved' ? 'approve' : 'return'}`, body);
      if (!ctx.alive()) return;
      refreshCountsSoon();
      const label = invoiceLabel(ruled);
      toast(kind === 'approved' ? `${label} verified. ${submitter} has been told.` : `${label} returned to ${submitter} with your note.`, { type: 'success' });
      announce(kind === 'approved' ? 'Approved. The checklist is verified.' : 'Returned to staff.');
      nav.show(ruled, { justRuled: kind, focus: true });
    } catch (err) {
      if (!ctx.alive()) return;
      if (err.status === 400 && /note/i.test(err.message)) {
        noteError.textContent = err.message;
        noteInput.setAttribute('aria-invalid', 'true');
        noteInput.focus();
      } else if (err.status === 404) {
        nav.gone();
      } else if (err.status === 403) {
        mount(
          decisionError,
          banner({
            type: 'error',
            title: 'This checklist can’t be ruled on any more',
            message: `${err.message}. Another admin may have approved or returned it already.`,
            actions: h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: () => nav.reload({ quiet: true }) }, icon('refresh'), 'Reload'),
          }),
        );
        decisionError.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        const verb = kind === 'approved' ? 'approve' : 'return';
        mount(decisionError, banner({ type: 'error', title: `Couldn’t ${verb} the checklist`, message: explain(err, 'Nothing was changed.'), actions: retryButton(() => decide(kind)) }));
        decisionError.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } finally {
      busy = false;
      if (button.isConnected) {
        setLoading(button, false);
        other.disabled = false;
      }
    }
  }

  return {
    // Unsent marks or a typed note count as unsaved work: reconnects and remote changes must not wipe them.
    isDirty: () => !discarded && (busy || hasProgress()),
    isBusy: () => busy,
    carry: () => (discarded || !hasProgress() ? null : { reviews: new Map(reviews), note: noteInput.value, focus: focusDescriptor() }),
    discard() {
      discarded = true;
    },
    notice(node) {
      mount(noticeSlot, node);
      noticeSlot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    async canLeave() {
      if (busy) return false;
      if (discarded || !hasProgress()) return true;
      return confirmDialog({
        title: 'Leave without deciding?',
        message: 'Your note and OK / Issue marks for this checklist will be lost.',
        confirmLabel: 'Leave',
        cancelLabel: 'Stay',
        danger: true,
      });
    },
  };
}

// ---------- verified record (approved) ----------

function recordView(ctx, invoice, nav, opts = {}) {
  const collected = invoice.items.filter((i) => i.collected).length;
  const total = invoice.items.length;
  const item = (dt, dd) => dd && h('div', { class: 'meta__item' }, h('dt', {}, dt), h('dd', {}, dd));
  const deleteBtn = h('button', { type: 'button', class: 'btn btn--danger-ghost', onClick: () => remove() }, icon('trash'), 'Delete invoice');

  mount(
    ctx.main,
    backLink(),
    invoiceHeader(invoice, { justRuled: opts.justRuled }),
    h(
      'div',
      { class: 'stack stack--6' },
      h(
        'section',
        { class: 'sheet sheet--pad', 'aria-label': 'Record details' },
        h(
          'dl',
          { class: 'meta' },
          item('Customer', invoice.customer_name),
          item('Invoice date', invoice.invoice_date && formatDate(invoice.invoice_date)),
          item('Published', invoice.published_at && formatDateTime(invoice.published_at)),
          item('Submitted', invoice.submitted_at && `${formatDateTime(invoice.submitted_at)}${invoice.submitted_by_name ? ` by ${invoice.submitted_by_name}` : ''}`),
          item(statusLabel(invoice.status), invoice.reviewed_at && `${formatDateTime(invoice.reviewed_at)}${invoice.reviewed_by_name ? ` by ${invoice.reviewed_by_name}` : ''}`),
          item('Read with', METHOD_LABELS[invoice.extraction_method]),
          item('Original file', invoice.original_filename && h('span', { class: 'mono' }, invoice.original_filename)),
        ),
      ),
      invoice.review_note && banner({ type: 'success', title: `Review note${invoice.reviewed_by_name ? ` from ${invoice.reviewed_by_name}` : ''}`, message: invoice.review_note }),
      invoice.submit_note && banner({ type: 'info', title: `Note from ${invoice.submitted_by_name || 'staff'}`, message: invoice.submit_note }),
      h(
        'div',
        { class: 'split' },
        h('section', { class: 'stack stack--3', 'aria-labelledby': 'photos-title' }, h('h2', { class: 'section-title', id: 'photos-title' }, `Photos (${invoice.photos.length})`), photoViewer(invoice.photos)),
        h(
          'section',
          { class: 'sheet sheet--flush', 'aria-labelledby': 'checklist-title' },
          h('header', { class: 'sheet__header' }, h('h2', { class: 'sheet__title', id: 'checklist-title' }, 'Checklist'), bigCount(collected, total)),
          h('ul', { class: 'checklist review-list' }, invoice.items.map((it) => checkRow(it, { byline: itemByline(it), extra: [staffNote(it), reviewTag(it)] }))),
        ),
      ),
      h(
        'section',
        { class: 'sheet', 'aria-labelledby': 'activity-title' },
        h('header', { class: 'sheet__header' }, h('h2', { class: 'sheet__title', id: 'activity-title' }, 'Activity')),
        h('div', { class: 'sheet__body' }, timeline(invoice.events)),
      ),
      h('div', { class: 'cluster cluster--end' }, deleteBtn),
    ),
  );
  ctx.ready(invoice.invoice_number || 'Invoice', { focus: opts.focus });

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete ${invoice.invoice_number || 'this invoice'}?`,
      message: `This verified record, its ${invoice.photos.length} ${plural(invoice.photos.length, 'photo')} and the original file will be removed for good. This can’t be undone.`,
      confirmLabel: 'Delete invoice',
      danger: true,
      onConfirm: async () => {
        markOwn(invoice.id);
        try {
          await api.del(`/api/admin/invoices/${invoice.id}`);
        } catch (err) {
          if (err.status !== 404) throw new ApiError(err.status, explain(err, 'Couldn’t delete the invoice.'));
        }
      },
    });
    if (!ok) return;
    refreshCountsSoon();
    toast(`${invoice.invoice_number || 'Invoice'} deleted`, { type: 'success' });
    navigate('#/queue');
  }

  return {};
}

// ---------- staff accounts ----------

const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;

function staffView(ctx) {
  let users = [];
  const body = h('div', { class: 'stack stack--4' });
  const addBtn = h('button', { type: 'button', class: 'btn btn--primary', onClick: () => addAccount() }, icon('plus'), 'Add staff account');

  mount(
    ctx.main,
    pageHeader({ eyebrow: 'Admin', title: 'Staff accounts', sub: 'Who can sign in. Staff pick checklists; admins also upload, review and manage accounts.', actions: addBtn }),
    body,
  );
  ctx.ready('Staff accounts');
  load();

  async function load() {
    mount(body, skeleton(0, { rows: 4 }));
    try {
      ({ users } = await api.get('/api/admin/users', { signal: ctx.signal }));
      render();
    } catch (err) {
      if (isAbort(err)) return;
      mount(body, banner({ type: 'error', title: 'Couldn’t load accounts', message: explain(err), actions: retryButton(() => load()) }));
    }
  }

  function render() {
    const focused = body.contains(document.activeElement) ? { id: document.activeElement.closest('tr')?.dataset.userId, action: document.activeElement.dataset.action } : null;
    const hasStaff = users.some((u) => u.role === 'staff');
    mount(
      body,
      !hasStaff &&
        banner({
          type: 'info',
          title: 'No staff accounts yet',
          message: 'Add an account for each person who picks orders, then give them their username and password.',
        }),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table users-table' },
          h('caption', { class: 'sr-only' }, 'Accounts'),
          h(
            'thead',
            {},
            h('tr', {}, ...['Name', 'Username', 'Role', 'Access', 'Added'].map((t) => h('th', { scope: 'col' }, t)), h('th', { scope: 'col', class: 'users-actions' }, h('span', { class: 'sr-only' }, 'Actions'))),
          ),
          h('tbody', {}, users.map(userRow)),
        ),
      ),
      h('p', { class: 'muted text-12', id: 'self-note' }, 'You can’t change your own role or turn off your own access. Ask another admin.'),
    );
    if (focused?.id) qs(`tr[data-user-id="${focused.id}"] [data-action="${focused.action}"]`, body)?.focus();
  }

  function userRow(u) {
    const self = u.id === app.user.id;
    const stateText = h('span', {}, u.active ? 'Active' : 'Inactive');
    const activeInput = h('input', {
      type: 'checkbox',
      role: 'switch',
      checked: u.active,
      disabled: self,
      dataset: { action: 'active' },
      'aria-describedby': self ? 'self-note' : undefined,
      onChange: (e) => changeActive(u, e.target),
    });
    const roleSelect = h(
      'select',
      {
        class: 'select',
        'aria-label': `Role for ${u.display_name}`,
        disabled: self,
        dataset: { action: 'role' },
        'aria-describedby': self ? 'self-note' : undefined,
        value: u.role,
        onChange: (e) => changeRole(u, e.target),
      },
      h('option', { value: 'staff' }, 'Staff'),
      h('option', { value: 'admin' }, 'Admin'),
    );
    return h(
      'tr',
      { class: [!u.active && 'is-inactive'], dataset: { userId: u.id } },
      h('td', {}, h('span', { class: 'weight-600' }, u.display_name), self && h('span', {}, ' ', h('span', { class: 'count' }, 'You'))),
      h('td', { class: 'mono' }, u.username),
      h('td', {}, roleSelect),
      h('td', {}, h('label', { class: 'switch' }, activeInput, h('span', { class: 'switch__track' }), stateText, h('span', { class: 'sr-only' }, ` (${u.display_name})`))),
      h('td', { class: 'nowrap muted' }, formatDate(u.created_at)),
      h(
        'td',
        { class: 'users-actions' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { action: 'rename' }, 'aria-label': `Rename ${u.display_name}`, onClick: () => rename(u) }, icon('edit'), 'Rename'),
        self
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { action: 'password' }, onClick: () => changePassword() }, icon('key'), 'Change password')
          : h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { action: 'password' }, 'aria-label': `Reset password for ${u.display_name}`, onClick: () => resetPassword(u) }, icon('key'), 'Reset password'),
      ),
    );
  }

  function accountError(err, what) {
    if (err.status === 404) return `${what} That account no longer exists. Reload the page.`;
    return `${what} ${explain(err)}`;
  }

  async function changeActive(u, input) {
    const next = input.checked;
    if (!next) {
      const ok = await confirmDialog({
        title: `Turn off access for ${u.display_name}?`,
        message: 'They’re signed out straight away and can’t sign in until you turn their access back on. Their past work stays in the records.',
        confirmLabel: 'Turn off access',
        danger: true,
      });
      if (!ok) {
        input.checked = true;
        return;
      }
    }
    input.disabled = true;
    try {
      const { user } = await api.patch(`/api/admin/users/${u.id}`, { active: next });
      Object.assign(u, user);
      render();
      toast(next ? `${u.display_name} can sign in again.` : `${u.display_name} can no longer sign in.`, { type: 'success' });
    } catch (err) {
      input.checked = !next;
      input.disabled = false;
      toast(accountError(err, next ? `Couldn’t turn on access for ${u.display_name}.` : `Couldn’t turn off access for ${u.display_name}.`), { type: 'error' });
    }
  }

  async function changeRole(u, select) {
    const next = select.value;
    if (next === u.role) return;
    const ok = await confirmDialog(
      next === 'admin'
        ? { title: `Make ${u.display_name} an admin?`, message: 'Admins can upload invoices, approve or return checklists, and manage everyone’s accounts.', confirmLabel: 'Make admin' }
        : { title: `Change ${u.display_name} to staff?`, message: 'They lose access to the admin app straight away and can only pick checklists.', confirmLabel: 'Change to staff', danger: true },
    );
    if (!ok) {
      select.value = u.role;
      return;
    }
    select.disabled = true;
    try {
      const { user } = await api.patch(`/api/admin/users/${u.id}`, { role: next });
      Object.assign(u, user);
      render();
      toast(`${u.display_name} is now ${next === 'admin' ? 'an admin' : 'staff'}.`, { type: 'success' });
    } catch (err) {
      select.value = u.role;
      select.disabled = false;
      toast(accountError(err, `Couldn’t change ${u.display_name}’s role.`), { type: 'error' });
    }
  }

  async function rename(u) {
    const name = await promptDialog({
      title: 'Rename account',
      message: `Shown to staff and in the activity history. Username “${u.username}” stays the same.`,
      label: 'Display name',
      value: u.display_name,
      required: true,
      maxLength: 80,
      confirmLabel: 'Save name',
      onSubmit: async (value) => {
        try {
          const { user } = await api.patch(`/api/admin/users/${u.id}`, { display_name: value });
          Object.assign(u, user);
        } catch (err) {
          throw new ApiError(err.status, explain(err, 'Couldn’t rename the account.'));
        }
      },
    });
    if (name === null) return;
    if (u.id === app.user.id) {
      app.user.display_name = u.display_name;
      els.userName.textContent = u.display_name;
    }
    render();
    toast(`Renamed to ${u.display_name}.`, { type: 'success' });
  }

  async function resetPassword(u) {
    const done = await promptDialog({
      title: `Reset password for ${u.display_name}`,
      message: 'They’re signed out everywhere and need the new password to sign in again.',
      label: 'New password',
      type: 'password',
      autocomplete: 'new-password',
      required: true,
      minLength: 8,
      help: 'At least 8 characters. Give it to them in person or over a private channel.',
      confirmLabel: 'Reset password',
      onSubmit: async (value) => {
        try {
          await api.patch(`/api/admin/users/${u.id}`, { password: value });
        } catch (err) {
          throw new ApiError(err.status, explain(err, 'Couldn’t reset the password.'));
        }
      },
    });
    if (done !== null) toast(`Password reset for ${u.display_name}.`, { type: 'success' });
  }

  async function addAccount() {
    const user = await formDialog({
      title: 'Add staff account',
      description: 'They sign in at the staff door with this username and password.',
      confirmLabel: 'Add account',
      fields: [
        { name: 'display_name', label: 'Display name', required: true, maxLength: 80, autocomplete: 'off', placeholder: 'e.g. Priya', help: 'Shown in notifications and activity.' },
        {
          name: 'username',
          label: 'Username',
          required: true,
          maxLength: 40,
          autocomplete: 'off',
          mono: true,
          help: '3–40 letters, numbers, dots, dashes or underscores.',
          validate: (v) => (USERNAME_RE.test(v) ? '' : 'Use 3–40 letters, numbers, dots, dashes or underscores, with no spaces.'),
        },
        { name: 'password', label: 'Password', type: 'password', required: true, minLength: 8, autocomplete: 'new-password', help: 'At least 8 characters.' },
        { name: 'role', label: 'Role', required: true, value: 'staff', options: [{ value: 'staff', label: 'Staff: picks checklists' }, { value: 'admin', label: 'Admin: full access' }] },
      ],
      onSubmit: async (values) => {
        try {
          const { user: created } = await api.post('/api/admin/users', values);
          return created;
        } catch (err) {
          throw new ApiError(err.status, explain(err, 'Couldn’t add the account.'));
        }
      },
    });
    if (!user) return;
    users.push(user);
    render();
    qs(`tr[data-user-id="${user.id}"] [data-action="password"]`, body)?.focus();
    toast(`${user.display_name} can now sign in as “${user.username}”.`, { type: 'success' });
  }

  return {};
}

// ---------- shell actions ----------

async function changePassword() {
  const done = await formDialog({
    title: 'Change your password',
    size: 'sm',
    confirmLabel: 'Change password',
    fields: [
      { name: 'current_password', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'new_password', label: 'New password', type: 'password', required: true, minLength: 8, autocomplete: 'new-password', help: 'At least 8 characters.' },
      {
        name: 'confirm_password',
        label: 'Repeat new password',
        type: 'password',
        required: true,
        autocomplete: 'new-password',
        validate: (v, all) => (v === all.new_password ? '' : 'The new passwords don’t match.'),
      },
    ],
    onSubmit: async ({ current_password, new_password }) => {
      try {
        await api.post('/api/auth/password', { current_password, new_password });
      } catch (err) {
        throw new ApiError(err.status, explain(err, 'Couldn’t change your password.'));
      }
      return true;
    },
  });
  if (done) toast('Password changed. Other devices have been signed out.', { type: 'success' });
}

async function handleSignOut() {
  if (!(await canLeaveView())) return;
  app.view?.destroy?.();
  await signOut({ to: '/login.html?role=admin' });
}

// ---------- boot ----------

async function boot() {
  for (const btn of qsa('[data-action="change-password"]')) {
    if (btn.classList.contains('btn--icon')) btn.replaceChildren(icon('key'));
    else btn.prepend(icon('key'));
    btn.addEventListener('click', changePassword);
  }
  for (const btn of qsa('[data-action="sign-out"]')) {
    if (btn.classList.contains('btn--icon')) btn.replaceChildren(icon('logout'));
    else btn.prepend(icon('logout'));
    btn.addEventListener('click', handleSignOut);
  }
  qs('#skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    els.main.focus();
  });

  try {
    app.user = await requireUser('admin');
    await loadLimits(); // never rejects; keeps the default limits if /api/config is unavailable
  } catch (err) {
    mount(
      els.main,
      pageHeader({ title: 'Tally admin' }),
      banner({ type: 'error', title: 'Can’t open the admin app', message: explain(err), actions: retryButton(() => location.reload()) }),
    );
    setBaseTitle('Admin · Tally');
    return;
  }
  els.userName.textContent = app.user.display_name;

  app.bell = mountBell(qs('#bell-slot'), {
    onOpenInvoice: (invoiceId) => navigate(`#/invoice/${invoiceId}`),
    actionLabel: (n) => (n.type === 'submitted' ? 'Review' : 'Open'),
  });

  const stop = connectEvents({
    hello(data, { reconnected }) {
      app.bell.setUnread(data.unread);
      if (reconnected) {
        app.bell.refresh();
        refreshCounts();
        app.view?.onReconnect?.();
      }
    },
    notification(n) {
      app.bell.push(n);
      refreshCountsSoon();
    },
    invoice(data) {
      refreshCountsSoon();
      app.view?.onInvoiceEvent?.(data);
    },
    status(state) {
      els.liveStatus.hidden = state !== 'reconnecting';
    },
  });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });

  refreshCounts();
  route();
}

boot();
