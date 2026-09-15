// Tally staff app: find a checklist, tick items as they are picked, add photos, submit for review.
import {
  api, requireUser, connectEvents, uploadWithProgress, signOut, ApiError, limits, loadLimits, planPhotoBatches,
} from '/assets/api.js';
import {
  h, mount, debounce, icon, toast, statusChip, progress, updateProgress, checkRow, setRowCollected,
  stamp, mountBell, openLightbox, photoThumb, confirmDialog, openModal, banner, emptyState, skeleton,
  timeAgo, formatQty, formatDate, formatDateTime, setBaseTitle, setLoading,
} from '/assets/ui.js';

const EDITABLE = new Set(['open', 'in_progress', 'returned']);
// Photo size and per-request count come from GET /api/config (loaded in boot; see limits()).
const SEARCH_DEBOUNCE_MS = 300;

const main = document.getElementById('main');
const live = document.getElementById('sr-live');

let user = null;
let view = null; // { destroy(), refresh?(opts), onInvoice?(data) }
let lastQuery = '';
let routeCount = 0;
let unloadGuards = 0;

// ---------- small helpers ----------------------------------------------------

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const megabytes = (bytes) => (Number(bytes) / (1024 * 1024)).toFixed(1);

function nameList(files, max = 3) {
  const names = files.slice(0, max).map((f) => `“${f.name}”`).join(', ');
  return files.length > max ? `${names} and ${files.length - max} more` : names;
}

function announce(text) {
  live.textContent = '';
  setTimeout(() => {
    live.textContent = text;
  }, 60);
}

/** User-facing text for any error thrown by api.* (server messages are already specific). */
function errorMessage(err) {
  if (!(err instanceof ApiError)) return 'Something went wrong. Try again.';
  if (err.status >= 500) return 'Something went wrong on the server. Try again in a moment.';
  return err.message;
}

const LOCK_REASONS = {
  submitted: 'it has been sent to the admin for review',
  approved: 'the admin has already verified it',
  draft: 'it isn’t published yet',
};

/** 403 from a staff write means the checklist is locked; word it for people, not status codes. */
function lockMessage(err) {
  const status = /locked while it is (\w+)/i.exec(err?.message || '')?.[1];
  return status && LOCK_REASONS[status] ? `This checklist can’t be changed because ${LOCK_REASONS[status]}.` : errorMessage(err);
}

function errorBanner(err, title, retry) {
  return banner({
    type: 'error',
    title,
    message: errorMessage(err),
    actions: retry && h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: retry }, icon('refresh'), 'Try again'),
  });
}

function setUnloadGuard(on) {
  unloadGuards = Math.max(0, unloadGuards + (on ? 1 : -1));
}

window.addEventListener('beforeunload', (event) => {
  if (unloadGuards > 0) {
    event.preventDefault();
    event.returnValue = '';
  }
});

/** Wraps case-insensitive matches of `query` in <mark> (text nodes only, never HTML). */
function highlight(text, query) {
  const value = String(text ?? '');
  const q = query.trim().toLowerCase();
  const lower = value.toLowerCase();
  if (!q || lower.length !== value.length) return value;
  const parts = [];
  let from = 0;
  let at = lower.indexOf(q);
  while (at !== -1) {
    if (at > from) parts.push(value.slice(from, at));
    parts.push(h('mark', { class: 'staff-match' }, value.slice(at, at + q.length)));
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < value.length) parts.push(value.slice(from));
  return parts;
}

const checklistLabel = (c) => c?.invoice_number || `Checklist ${c?.id ?? ''}`.trim();
const homeHref = () => (lastQuery ? `#/?q=${encodeURIComponent(lastQuery)}` : '#/');

function focusHeading(el) {
  el?.focus({ preventScroll: true });
}

// ---------- router -----------------------------------------------------------

function parseRoute() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw.startsWith('/')) return { name: 'home', query: '' };
  const [path, search = ''] = raw.split('?');
  if (path === '/' || path === '') return { name: 'home', query: new URLSearchParams(search).get('q') || '' };
  const match = /^\/checklist\/(\d+)\/?$/.exec(path);
  if (match) return { name: 'checklist', id: Number(match[1]) };
  return { name: 'notfound' };
}

function renderRoute() {
  const route = parseRoute();
  view?.destroy();
  view = null;
  const focus = routeCount++ > 0;
  window.scrollTo(0, 0);
  if (route.name === 'home') view = homeView(route, { focus });
  else if (route.name === 'checklist') view = checklistView(route.id, { focus });
  else view = notFoundView({ focus });
}

function openInvoice(id) {
  const target = `#/checklist/${id}`;
  if (location.hash === target) view?.refresh?.({ quiet: true });
  else location.hash = target;
}

// ---------- tickets (search results and "Your checklists") ------------------

function whenMeta(c) {
  if (c.status === 'returned' && c.reviewed_at) return h('span', {}, 'Returned ', timeAgo(c.reviewed_at));
  if (c.status === 'approved' && c.reviewed_at) return h('span', {}, 'Verified ', timeAgo(c.reviewed_at));
  if (c.status === 'submitted' && c.submitted_at) return h('span', {}, 'Sent ', timeAgo(c.submitted_at));
  return c.updated_at ? h('span', {}, 'Updated ', timeAgo(c.updated_at)) : null;
}

function ticket(c, { query = '' } = {}) {
  const returned = c.status === 'returned';
  return h(
    'a',
    { class: ['ticket', returned && 'ticket--returned'], href: `#/checklist/${c.id}` },
    h('span', { class: 'ticket__top' }, h('span', { class: 'ticket__number' }, highlight(checklistLabel(c), query)), statusChip(c.status)),
    h('span', { class: 'ticket__customer' }, highlight(c.customer_name || 'Unknown customer', query)),
    progress(c.items_collected, c.items_total),
    h(
      'span',
      { class: 'ticket__meta' },
      h('span', {}, plural(c.items_total, 'item')),
      c.photos_count > 0 && h('span', {}, plural(c.photos_count, 'photo')),
      whenMeta(c),
    ),
    returned && c.review_note && h('span', { class: 'ticket__note' }, c.review_note),
  );
}

// ---------- home: search + your checklists ----------------------------------

function homeView(route, { focus }) {
  let alive = true;
  let searchSeq = 0;
  let searchAbort = null;
  let query = route.query.trim();
  let hasResults = false;
  let mineItems = null;

  setBaseTitle('Find a checklist · Tally');

  const title = h('h1', { class: 'page-title', id: 'home-title', tabindex: '-1' }, 'Find a checklist');
  const input = h('input', {
    class: 'input',
    type: 'search',
    name: 'q',
    placeholder: 'Invoice number or customer name',
    enterkeyhint: 'search',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    maxlength: '100',
    'aria-describedby': 'search-status',
    value: route.query,
  });
  const status = h('p', { class: 'staff-search__status muted text-14', id: 'search-status', role: 'status' });
  const results = h('div', { class: 'staff-results' });
  const typed = debounce((value) => runSearch(value), SEARCH_DEBOUNCE_MS);
  const refreshSoon = debounce(() => {
    loadMine({ quiet: true });
    if (query) runSearch(query, { quiet: true });
  }, 400);

  const form = h(
    'form',
    {
      class: 'staff-search',
      role: 'search',
      novalidate: true,
      onSubmit: (event) => {
        event.preventDefault();
        typed.cancel();
        runSearch(input.value);
      },
    },
    h('label', { class: 'search search--lg' }, h('span', { class: 'sr-only' }, 'Invoice number or customer name'), input),
    h('button', { type: 'submit', class: 'btn btn--primary btn--lg hide-mobile' }, 'Search'),
  );
  input.addEventListener('input', () => typed(input.value));

  const mineCount = h('span', { class: 'count', hidden: true });
  const mine = h('div', { class: 'staff-mine' });

  mount(
    main,
    h(
      'div',
      { class: 'page page--narrow stack stack--8' },
      h(
        'section',
        { class: 'stack stack--4', 'aria-labelledby': 'home-title' },
        h('div', { class: 'page-header__lead' }, h('p', { class: 'eyebrow' }, 'Stockroom'), title),
        form,
        status,
        results,
      ),
      h(
        'section',
        { class: 'stack stack--3', 'aria-labelledby': 'mine-title' },
        h('div', { class: 'staff-section-head' }, h('h2', { class: 'section-title', id: 'mine-title' }, 'Your checklists'), mineCount),
        mine,
      ),
    ),
  );

  function syncHash(q) {
    const next = q ? `#/?q=${encodeURIComponent(q)}` : '#/';
    if (alive && location.hash !== next) history.replaceState(history.state, '', next);
  }

  function renderHint() {
    status.textContent = '';
    mount(
      results,
      emptyState({
        compact: Boolean(mineItems?.length),
        title: 'Search for a checklist to start picking.',
        text: 'Type an invoice number or customer name above.',
      }),
    );
  }

  async function runSearch(raw, { quiet = false } = {}) {
    const q = String(raw ?? '').trim();
    query = q;
    lastQuery = q;
    syncHash(q);
    searchAbort?.abort();
    const seq = ++searchSeq;
    if (!q) {
      searchAbort = null;
      hasResults = false;
      renderHint();
      return;
    }
    const controller = new AbortController();
    searchAbort = controller;
    if (!quiet) {
      status.textContent = 'Searching…';
      results.setAttribute('aria-busy', 'true');
      if (!hasResults) mount(results, skeleton(0, { rows: 2 }));
    }
    try {
      const data = await api.get(`/api/staff/checklists/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (!alive || seq !== searchSeq) return;
      renderResults(q, data?.checklists || []);
    } catch (err) {
      if (err?.name === 'AbortError' || !alive || seq !== searchSeq || quiet) return;
      hasResults = false;
      status.textContent = '';
      mount(results, errorBanner(err, 'Search didn’t work', () => runSearch(input.value)));
    } finally {
      if (seq === searchSeq) results.removeAttribute('aria-busy');
    }
  }

  function renderResults(q, list) {
    hasResults = list.length > 0;
    if (!list.length) {
      status.textContent = `No checklists match “${q}”.`;
      mount(
        results,
        emptyState({
          compact: true,
          title: 'Nothing to pick under that name',
          text: 'Check the invoice number, or try part of the customer name. Invoices that aren’t published yet won’t show up.',
        }),
      );
      return;
    }
    status.textContent =
      list.length >= 50
        ? `Showing the first 50 matches for “${q}”. Type more to narrow it down.`
        : `${plural(list.length, 'checklist')} ${list.length === 1 ? 'matches' : 'match'} “${q}”.`;
    mount(results, h('ul', { class: 'ticket-list' }, list.map((c) => h('li', {}, ticket(c, { query: q })))));
  }

  // Summaries from a strict server may not carry review_note; fetch it for returned checklists.
  async function fillReturnedNotes(list) {
    const missing = list.filter((c) => c.status === 'returned' && !('review_note' in c)).slice(0, 5);
    await Promise.allSettled(
      missing.map(async (c) => {
        const data = await api.get(`/api/staff/checklists/${c.id}`);
        c.review_note = data?.checklist?.review_note ?? null;
      }),
    );
  }

  async function loadMine({ quiet = false } = {}) {
    if (!quiet && !mineItems) mount(mine, skeleton(0, { rows: 2 }));
    try {
      const data = await api.get('/api/staff/checklists/mine');
      const list = data?.checklists || [];
      await fillReturnedNotes(list);
      if (!alive) return;
      mineItems = list;
      renderMine();
      if (!query) renderHint();
    } catch (err) {
      if (!alive || quiet) return;
      mount(mine, errorBanner(err, 'Couldn’t load your checklists', () => loadMine()));
    }
  }

  function renderMine() {
    const returned = mineItems.filter((c) => c.status === 'returned').length;
    mineCount.hidden = mineItems.length === 0;
    mineCount.textContent = String(mineItems.length);
    mineCount.classList.toggle('count--alert', returned > 0);
    mineCount.setAttribute('aria-label', returned ? `${mineItems.length}, ${returned} returned` : String(mineItems.length));
    if (!mineItems.length) {
      mount(mine, h('p', { class: 'muted' }, 'Checklists you start picking show up here. Anything the admin sends back will be at the top.'));
      return;
    }
    mount(mine, h('ul', { class: 'ticket-list' }, mineItems.map((c) => h('li', {}, ticket(c)))));
  }

  if (query) runSearch(query);
  else renderHint();
  loadMine();
  if (focus) focusHeading(title);

  return {
    destroy() {
      alive = false;
      searchAbort?.abort();
      typed.cancel();
      refreshSoon.cancel();
    },
    refresh: () => refreshSoon(),
    onInvoice: () => refreshSoon(),
  };
}

// ---------- checklist --------------------------------------------------------

function isImageFile(file) {
  return (file.type || '').startsWith('image/') || /\.(hei[cf]|jpe?g|png|webp)$/i.test(file.name || '');
}

function checklistView(id, { focus }) {
  const base = `/api/staff/checklists/${id}`;
  const s = {
    alive: true,
    data: null, // InvoiceDetail
    photos: [],
    rows: new Map(), // itemId → <li>
    sync: new Map(), // itemId → { confirmed, desired, promise }
    writes: new Map(), // itemId → { clock, item }: latest PATCH result per item (see applyRecentWrites)
    writeClock: 0,
    noteFields: new Map(), // itemId → open note field { itemId, textarea, saving, detach() }
    noteSaves: new Set(),
    batches: [], // queued photo uploads: { progress, files: [{ file, url, tile, bar }] }
    uploading: false,
    submitting: false,
    justSubmitted: false,
    animateStamp: false,
    noteDraft: '', // kept if the submit sheet is closed without submitting
  };
  const els = {};
  let barObserver = null;

  setBaseTitle('Checklist · Tally');
  mount(
    main,
    h('div', { class: 'page page--narrow stack stack--4' }, skeleton(0, { title: true, block: 40 }), skeleton(0, { rows: 5 })),
  );
  load({ focus });

  const editable = () => Boolean(s.data && EDITABLE.has(s.data.status));
  const shownCollected = (item) => s.sync.get(item.id)?.desired ?? Boolean(item.collected);
  const collectedCount = () => s.data.items.reduce((n, it) => n + (shownCollected(it) ? 1 : 0), 0);
  // Always read and write the item in the current s.data: load() replaces the objects rows were built from.
  const itemById = (itemId) => s.data?.items.find((it) => it.id === itemId) || null;

  /** Stores a PATCH result on the current item and remembers it for reloads that may predate it. */
  function recordWrite(itemId, serverItem) {
    s.writes.set(itemId, { clock: ++s.writeClock, item: { ...serverItem } });
    const current = itemById(itemId);
    if (current) Object.assign(current, serverItem);
  }

  // A GET that was in flight while a tick or note PATCH came back can predate that write. Re-apply the
  // PATCH results that arrived after the GET started, unless the server's copy is newer.
  function applyRecentWrites(checklist, sinceClock) {
    for (const [itemId, write] of s.writes) {
      if (write.clock <= sinceClock) continue;
      const item = checklist.items.find((it) => it.id === itemId);
      if (!item) continue;
      if (item.updated_at && write.item.updated_at && String(item.updated_at) > String(write.item.updated_at)) continue;
      Object.assign(item, write.item);
    }
  }

  async function load({ quiet = false, focus: focusTitle = false, animateStamp = false } = {}) {
    const clockAtStart = s.writeClock;
    try {
      const data = await api.get(base);
      if (!s.alive) return;
      s.data = data.checklist;
      applyRecentWrites(s.data, clockAtStart);
      s.photos = Array.isArray(s.data.photos) ? [...s.data.photos] : [];
      s.animateStamp = animateStamp;
      render({ focusTitle });
    } catch (err) {
      if (!s.alive) return;
      if (quiet && s.data && err.status !== 404) return;
      renderError(err, { focusTitle: focusTitle || quiet });
    }
  }

  function renderError(err, { focusTitle }) {
    teardownBar();
    const notFound = err instanceof ApiError && err.status === 404;
    const heading = h('h1', { class: notFound ? 'sr-only' : 'page-title', tabindex: '-1' }, notFound ? 'Checklist not found' : 'Checklist');
    setBaseTitle(notFound ? 'Checklist not found · Tally' : 'Checklist · Tally');
    const back = h('a', { class: 'btn btn--secondary', href: homeHref() }, icon('arrow-left'), 'Back to search');
    mount(
      main,
      h(
        'div',
        { class: 'page page--narrow stack stack--4' },
        heading,
        notFound
          ? emptyState({
              title: 'This checklist isn’t available',
              text: 'It may have been deleted, or the link is wrong. Search for the invoice number again.',
              action: back,
            })
          : [errorBanner(err, 'Couldn’t open this checklist', () => load({ focus: true })), h('div', {}, back)],
      ),
    );
    if (focusTitle) focusHeading(heading);
  }

  // ---- full render ----

  function render({ focusTitle = false } = {}) {
    // Removing a focused textarea fires no blur, so an open note field would vanish unsaved. Keep each
    // draft and reopen it on the rebuilt row (saved on blur as usual).
    const drafts = [];
    for (const field of s.noteFields.values()) {
      if (field.saving || !field.textarea.isConnected) continue;
      drafts.push({
        itemId: field.itemId,
        value: field.textarea.value,
        focused: document.activeElement === field.textarea,
        selection: [field.textarea.selectionStart, field.textarea.selectionEnd],
      });
      field.detach();
    }
    s.noteFields.clear();

    teardownBar();
    const c = s.data;
    const canEdit = editable();
    setBaseTitle(`${checklistLabel(c)} · Tally`);

    els.chip = statusChip(c.status);
    els.chipSlot = h('span', {}, els.chip);
    els.progress = progress(collectedCount(), c.items.length, { format: 'sentence', size: 'thick', layout: 'stacked' });
    const titleEl = h('h1', { class: 'sticky-head__title', tabindex: '-1' }, checklistLabel(c));
    const sub = [c.customer_name, c.invoice_date && formatDate(c.invoice_date)].filter(Boolean).join(' · ');
    const head = h(
      'header',
      { class: 'sticky-head staff-head' },
      h(
        'div',
        { class: 'staff-head__row' },
        h('a', { class: 'btn btn--ghost btn--icon staff-head__back', href: homeHref(), 'aria-label': 'Back to search', title: 'Back to search' }, icon('arrow-left')),
        h(
          'div',
          { class: 'staff-head__titles' },
          titleEl,
          h('div', { class: 'staff-head__meta' }, els.chipSlot, sub && h('p', { class: 'sticky-head__sub truncate' }, sub)),
        ),
      ),
      els.progress,
    );

    const notice = statusNotice(c);

    s.rows = new Map();
    els.list = h('ul', { class: 'checklist', 'aria-label': 'Items' });
    for (const item of c.items) {
      const li = buildRow(item, canEdit);
      s.rows.set(item.id, li);
      els.list.append(li);
    }
    const itemsSection = h(
      'section',
      { class: 'stack stack--3', 'aria-labelledby': 'items-title' },
      h(
        'div',
        { class: 'spread' },
        h('h2', { class: 'section-title', id: 'items-title' }, 'Items'),
        h('p', { class: 'muted text-14' }, canEdit ? 'Tap an item when it’s in your basket.' : 'Read-only'),
      ),
      c.items.length
        ? els.list
        : emptyState({ compact: true, title: 'This checklist has no items', text: 'Ask an admin to add the lines from the invoice.' }),
    );

    const body = h('div', { class: 'page page--narrow stack stack--6' }, notice, itemsSection, buildPhotosSection(canEdit));
    mount(main, head, body, canEdit ? buildBar() : null);
    if (canEdit) observeBar();
    renderPhotos();
    s.animateStamp = false;

    for (const draft of drafts) {
      const item = itemById(draft.itemId);
      const rowLi = s.rows.get(draft.itemId);
      if (canEdit && item && rowLi) {
        openNote(item, rowLi, { draft: draft.value, focus: draft.focused, selection: draft.selection });
      } else if (draft.value.trim() !== (item?.note || '')) {
        const why = !item ? 'the item was removed from the checklist' : 'the checklist can’t be changed any more';
        toast(`Your note for “${item?.description || 'an item'}” wasn’t saved because ${why}.`, { type: 'warning' });
      }
    }

    if (s.justSubmitted && notice) {
      s.justSubmitted = false;
      notice.setAttribute('tabindex', '-1');
      window.scrollTo(0, 0);
      focusHeading(notice);
    } else if (focusTitle) {
      focusHeading(titleEl);
    }
  }

  function statusNotice(c) {
    const who = (name, at) => [name && `${name}`, at && formatDateTime(at)].filter(Boolean).join(' · ');
    if (c.status === 'returned') {
      const flagged = c.items.filter((i) => i.review_status === 'issue').length;
      const stampSlot = h('div', { class: 'staff-banner-stamp' });
      stamp(stampSlot, 'returned', { animate: s.animateStamp, overlay: false, size: 'sm' });
      return banner({
        type: 'error',
        title: 'Returned by admin',
        message: [
          h('p', {}, c.review_note || 'The admin sent this checklist back. Check the items and photos, then submit again.'),
          h(
            'p',
            { class: 'muted text-14' },
            [who(c.reviewed_by_name, c.reviewed_at), flagged && `${plural(flagged, 'item')} marked with an issue below`].filter(Boolean).join(' · '),
          ),
        ],
        actions: stampSlot,
      });
    }
    if (c.status === 'submitted') {
      const el = banner({
        type: 'success',
        title: 'Sent to admin for review',
        message: [
          h(
            'p',
            {},
            s.justSubmitted
              ? 'You’ll get a notification when the admin verifies it or sends it back.'
              : 'This checklist is read-only while the admin checks it.',
          ),
          h('p', { class: 'muted text-14' }, `Submitted by ${who(c.submitted_by_name || 'staff', c.submitted_at)}`),
          c.submit_note && h('p', {}, `Note: ${c.submit_note}`),
        ],
        actions: h('a', { class: 'btn btn--secondary btn--sm', href: '#/' }, 'Find another checklist'),
      });
      el.classList.add('staff-notice');
      return el;
    }
    if (c.status === 'approved') {
      const sheet = h(
        'section',
        { class: 'sheet sheet--pad staff-verdict staff-notice', 'aria-labelledby': 'verdict-title' },
        h(
          'div',
          { class: 'stack stack--2' },
          h('h2', { class: 'section-title', id: 'verdict-title' }, 'Verified'),
          h('p', { class: 'muted text-14' }, `Checked by ${who(c.reviewed_by_name || 'the admin', c.reviewed_at)}`),
          c.review_note && h('p', {}, c.review_note),
          c.submit_note && h('p', { class: 'text-14' }, `Picker’s note: ${c.submit_note}`),
        ),
      );
      stamp(sheet, 'approved', { animate: s.animateStamp, meta: c.reviewed_at ? formatDate(c.reviewed_at) : undefined });
      return sheet;
    }
    return null;
  }

  // ---- rows, ticks, notes ----

  function buildRow(item, canEdit) {
    const shown = shownCollected(item);
    const byline =
      item.collected && item.updated_by_name && item.updated_by_name !== user.display_name ? `Ticked by ${item.updated_by_name}` : undefined;
    const li = checkRow(
      { ...item, collected: shown },
      { onToggle: canEdit ? (_it, next, rowLi) => toggle(item.id, next, rowLi) : undefined, byline },
    );
    renderExtra(item, li, canEdit);
    return li;
  }

  function renderExtra(item, li, canEdit) {
    const extra = li?.querySelector('.check-row__extra');
    if (!extra) return;
    const open = s.noteFields.get(item.id);
    if (open && extra.contains(open.textarea)) s.noteFields.delete(item.id);
    const parts = [];
    if (item.review_status === 'issue') {
      parts.push(h('span', { class: 'issue-tag' }, 'Issue', h('span', { class: 'sr-only' }, ' flagged by the admin')));
    } else if (item.review_status === 'ok' && s.data.status === 'returned') {
      parts.push(h('span', { class: 'ok-tag' }, 'OK', h('span', { class: 'sr-only' }, ' checked by the admin')));
    }
    if (canEdit) {
      parts.push(
        h(
          'button',
          {
            type: 'button',
            class: 'link link--quiet text-14 staff-note-link',
            'aria-label': `${item.note ? 'Edit note' : 'Add note'} for ${item.description}`,
            onClick: () => openNote(item, li),
          },
          icon('note'),
          item.note ? 'Edit note' : 'Add note',
        ),
      );
    }
    if (item.note) parts.push(h('p', { class: 'check-row__note' }, item.note));
    mount(extra, parts);
  }

  function refreshProgress() {
    if (!s.alive || !els.progress) return;
    updateProgress(els.progress, collectedCount(), s.data.items.length);
    updateBar();
  }

  function toggle(itemId, next, li) {
    if (!editable()) return;
    const item = itemById(itemId);
    if (!item) return;
    setRowCollected(li, next);
    let st = s.sync.get(itemId);
    if (!st) {
      st = { confirmed: Boolean(item.collected), desired: next, promise: null };
      s.sync.set(itemId, st);
    }
    st.desired = next;
    refreshProgress();
    announce(`${collectedCount()} of ${s.data.items.length} collected`);
    if (!st.promise) {
      const description = item.description;
      st.promise = runSync(itemId, st, description).finally(() => {
        st.promise = null;
        if (st.desired === st.confirmed) s.sync.delete(itemId);
        // The row may have been rebuilt meanwhile; show the confirmed state on whichever row is current.
        const current = itemById(itemId);
        if (s.alive && current && !s.sync.has(itemId)) {
          setRowCollected(s.rows.get(itemId), current.collected);
          refreshProgress();
        }
      });
    }
  }

  // Sends ticks one at a time per item so rapid taps end in the last state the picker chose.
  async function runSync(itemId, st, description) {
    while (st.desired !== st.confirmed) {
      const want = st.desired;
      try {
        const data = await api.patch(`${base}/items/${itemId}`, { collected: want });
        st.confirmed = Boolean(data?.item?.collected ?? want);
        recordWrite(itemId, data?.item ? { ...data.item, collected: st.confirmed } : { collected: st.confirmed });
        applySummary(data?.checklist);
      } catch (err) {
        st.desired = st.confirmed;
        if (s.alive) {
          setRowCollected(s.rows.get(itemId), st.confirmed);
          refreshProgress();
        }
        reportItemError(err, itemById(itemId) || { description }, want);
        return;
      }
    }
  }

  function reportItemError(err, item, wanted) {
    const name = `“${item.description}”`;
    if (err.status === 403) {
      toast(lockMessage(err), { type: 'warning' });
      load({ quiet: true });
    } else if (err.status === 404) {
      toast(`${name} is no longer on this checklist, so the list was refreshed.`, { type: 'warning' });
      load({ quiet: true });
    } else if (err.status === 0) {
      toast(`${name} wasn’t saved because you’re offline. Tap it again when you’re back online.`, { type: 'error' });
    } else {
      toast(`Couldn’t ${wanted ? 'mark' : 'unmark'} ${name}. ${errorMessage(err)}`, { type: 'error' });
    }
  }

  /** Merge an InvoiceSummary from a write response into local state. */
  function applySummary(summary) {
    if (!summary || !s.data) return;
    const before = s.data.status;
    s.data.status = summary.status;
    for (const key of ['items_total', 'items_collected', 'photos_count', 'updated_at']) {
      if (key in summary) s.data[key] = summary[key];
    }
    if (!s.alive || summary.status === before) return;
    if (EDITABLE.has(summary.status) && EDITABLE.has(before)) {
      els.chip = statusChip(summary.status);
      els.chipSlot?.replaceChildren(els.chip);
    } else {
      load({ quiet: true });
    }
  }

  // draft/focus/selection/error: used when a re-render or a failed background save reopens the field.
  function openNote(item, li, { draft, focus = true, selection, error } = {}) {
    const extra = li.querySelector('.check-row__extra');
    if (!extra || extra.querySelector('.check-row__note-field')) return;
    const itemId = item.id;
    const current = () => itemById(itemId) || item;
    const fieldId = `note-${itemId}`;
    const textarea = h('textarea', {
      class: 'textarea',
      id: fieldId,
      name: 'note',
      maxlength: '500',
      rows: '2',
      placeholder: 'e.g. only 3 in stock',
      'aria-describedby': `${fieldId}-help`,
      value: draft ?? (item.note || ''),
    });
    const help = h('p', { class: 'field__help', id: `${fieldId}-help` }, 'Saved when you leave the field. Esc cancels.');
    const field = h('div', { class: 'check-row__note-field' }, h('label', { class: 'sr-only', for: fieldId }, `Note for ${item.description}`), textarea, help);
    for (const el of extra.querySelectorAll('.staff-note-link, .check-row__note')) el.hidden = true;
    extra.append(field);
    if (error) {
      help.className = 'field__error';
      help.textContent = error;
      textarea.setAttribute('aria-invalid', 'true');
    }
    if (focus) {
      textarea.focus({ preventScroll: Boolean(selection) });
      if (selection) {
        try {
          textarea.setSelectionRange(selection[0], selection[1]);
        } catch {
          /* selection not restorable */
        }
      }
    }

    let cancelled = false;
    let saving = false;
    s.noteFields.set(itemId, {
      itemId,
      textarea,
      get saving() {
        return saving;
      },
      detach() {
        cancelled = true; // the textarea is about to be replaced; its draft moves to the new row
      },
    });

    textarea.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelled = true;
      renderExtra(current(), li, editable());
      li.querySelector('.staff-note-link')?.focus();
    });
    textarea.addEventListener('blur', () => {
      if (!cancelled && !saving) save();
    });

    async function save() {
      const value = textarea.value.trim();
      if (value === (current().note || '')) {
        renderExtra(current(), li, editable());
        return;
      }
      saving = true;
      help.className = 'field__help';
      help.textContent = 'Saving…';
      textarea.removeAttribute('aria-invalid');
      const request = api.patch(`${base}/items/${itemId}`, { note: value || null });
      s.noteSaves.add(request);
      try {
        const data = await request;
        recordWrite(itemId, data?.item ? data.item : { note: value || null });
        applySummary(data?.checklist);
        const saved = current();
        // The list may have been re-rendered while saving: update whichever row is current.
        // The list may have been re-rendered while saving: update whichever row is current, unless that
        // row already shows a different (reopened) note field.
        const rowLi = li.isConnected ? li : s.rows.get(itemId);
        if (s.alive && rowLi?.isConnected && (rowLi === li || !rowLi.querySelector('.check-row__note-field'))) {
          renderExtra(saved, rowLi, editable());
        }
        announce(saved.note ? `Note saved for ${saved.description}` : `Note removed from ${saved.description}`);
      } catch (err) {
        saving = false;
        const reason = err.status === 0 ? 'you’re offline' : errorMessage(err).replace(/\.$/, '');
        if (err.status === 403) {
          toast(lockMessage(err), { type: 'warning' });
          load({ quiet: true });
          return;
        }
        if (!li.isConnected) {
          if (s.noteFields.get(itemId)?.textarea === textarea) s.noteFields.delete(itemId);
          // Reopen the unsaved text on the rebuilt row so the picker can retry instead of retyping.
          const rowLi = s.rows.get(itemId);
          if (s.alive && editable() && rowLi?.isConnected && itemById(itemId)) {
            openNote(itemById(itemId), rowLi, { draft: value, focus: false, error: `Not saved: ${reason}. Tap the note to try again.` });
          }
          toast(`Your note for “${item.description}” wasn’t saved: ${reason}.`, { type: 'error' });
          return;
        }
        help.className = 'field__error';
        help.textContent = `Not saved: ${reason}. Tap the note to try again.`;
        textarea.setAttribute('aria-invalid', 'true');
        toast(`Your note for “${item.description}” wasn’t saved.`, { type: 'error' });
      } finally {
        s.noteSaves.delete(request);
      }
    }
  }

  // ---- photos ----

  function fileInput(capture) {
    const input = h('input', {
      type: 'file',
      accept: 'image/*',
      multiple: true,
      capture: capture ? 'environment' : undefined,
      class: 'sr-only',
      tabindex: '-1',
      'aria-hidden': 'true',
    });
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.value = '';
      if (files.length) queueUpload(files);
    });
    return input;
  }

  function buildPhotosSection(canEdit) {
    els.photoCount = h('span', { class: 'count', hidden: true });
    els.thumbs = h('ul', { class: 'thumbs', 'aria-label': 'Photos' });
    els.photoEmpty = h('p', { class: 'muted text-14' });
    els.uploadText = h('p', { class: 'text-14', id: 'upload-status' });
    els.uploadBar = progress(0, 100, { format: 'none', size: 'thin' });
    els.upload = h('div', { class: 'staff-upload', hidden: true }, els.uploadText, els.uploadBar);
    els.takeBtn = null;

    let actions = null;
    if (canEdit) {
      const camera = fileInput(true);
      const gallery = fileInput(false);
      els.takeBtn = h('button', { type: 'button', class: 'btn btn--secondary', onClick: () => camera.click() }, icon('camera'), 'Take or add photos');
      const galleryBtn = h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => gallery.click() }, icon('image'), 'Choose from gallery');
      actions = h('div', { class: 'cluster staff-photo-actions' }, els.takeBtn, galleryBtn, camera, gallery);
    }

    return h(
      'section',
      { class: 'sheet', 'aria-labelledby': 'photos-title' },
      h('header', { class: 'sheet__header' }, h('h2', { class: 'sheet__title staff-section-head', id: 'photos-title' }, 'Photos', els.photoCount)),
      h(
        'div',
        { class: 'sheet__body stack stack--4' },
        canEdit && h('p', { class: 'muted text-14' }, 'Take one or more photos that show all the collected items together.'),
        actions,
        els.upload,
        els.thumbs,
        els.photoEmpty,
      ),
    );
  }

  function canRemove(photo) {
    if (user.role === 'admin') return true;
    if (photo.uploaded_by !== undefined && photo.uploaded_by !== null) return photo.uploaded_by === user.id;
    return photo.uploaded_by_name === user.display_name;
  }

  function renderPhotos() {
    if (!s.alive || !els.thumbs?.isConnected) return;
    const canEdit = editable();
    const tiles = s.photos.map((p) =>
      photoThumb(p, {
        onOpen: (photo) => openLightbox(s.photos, Math.max(0, s.photos.indexOf(photo))),
        onRemove: canEdit && canRemove(p) ? (photo) => removePhoto(photo) : undefined,
      }),
    );
    const pending = s.batches.flatMap((b) => b.files.map((f) => f.tile));
    mount(els.thumbs, tiles, pending);
    els.thumbs.hidden = tiles.length + pending.length === 0;
    els.photoCount.hidden = s.photos.length === 0;
    els.photoCount.textContent = String(s.photos.length);
    els.photoEmpty.hidden = tiles.length + pending.length > 0;
    els.photoEmpty.textContent = canEdit ? 'No photos yet.' : 'No photos were added.';
    const none = s.photos.length === 0 && pending.length === 0;
    els.takeBtn?.classList.toggle('btn--primary', none);
    els.takeBtn?.classList.toggle('btn--secondary', !none);
    updateBar();
  }

  function uploadingTile(file, url) {
    const img = h('img', { class: 'thumb__img', src: url, alt: '' });
    const bar = h('span', { class: 'thumb__progress', style: { '--p': '0%' } });
    const tile = h('li', { class: 'thumb thumb--uploading' }, img, bar);
    img.addEventListener(
      'error',
      () => img.replaceWith(h('span', { class: 'thumb__file' }, icon('file'), h('span', {}, 'No preview'), h('span', { class: 'thumb__file-name' }, file.name))),
      { once: true },
    );
    return { tile, bar };
  }

  function queueUpload(fileList) {
    const files = fileList.filter(isImageFile);
    const skipped = fileList.length - files.length;
    if (skipped) {
      const first = fileList.find((f) => !isImageFile(f));
      toast(skipped === 1 ? `“${first.name}” isn’t a photo, so it wasn’t added.` : `${skipped} files weren’t photos, so they weren’t added.`, { type: 'warning' });
    }
    if (!files.length) return;
    // A photo over the size limit makes the server refuse its whole request, so set those aside by
    // name and upload the rest.
    const lim = limits();
    const { batches, oversized } = planPhotoBatches(files, lim);
    if (oversized.length) {
      const tip = 'Try a lower camera resolution, or send a smaller copy.';
      toast(
        oversized.length === 1
          ? `“${oversized[0].name}” is ${megabytes(oversized[0].size)} MB, over the ${lim.max_photo_mb} MB limit, so it wasn’t added. ${tip}`
          : `${nameList(oversized)} are over the ${lim.max_photo_mb} MB limit, so they weren’t added. ${tip}`,
        { type: 'warning', timeout: 0 },
      );
    }
    enqueueBatches(batches);
  }

  function enqueueBatches(groups) {
    const nonEmpty = groups.filter((g) => g.length);
    if (!nonEmpty.length) return;
    for (const group of nonEmpty) {
      s.batches.push({
        progress: 0,
        files: group.map((file) => {
          const url = URL.createObjectURL(file);
          return { file, url, ...uploadingTile(file, url) };
        }),
      });
    }
    announce(`Uploading ${plural(nonEmpty.reduce((n, g) => n + g.length, 0), 'photo')}`);
    renderPhotos();
    updateUploadStatus();
    if (!s.uploading) runUploads();
  }

  async function runUploads() {
    s.uploading = true;
    setUnloadGuard(true);
    try {
      while (s.batches.length) {
        const batch = s.batches[0];
        const form = new FormData();
        for (const f of batch.files) form.append('photos', f.file, f.file.name);
        let added = 0;
        try {
          const data = await uploadWithProgress(`${base}/photos`, form, (fraction) => {
            batch.progress = fraction;
            for (const f of batch.files) f.bar.style.setProperty('--p', `${Math.round(fraction * 100)}%`);
            updateUploadStatus();
          });
          const known = new Set(s.photos.map((p) => p.id));
          const fresh = (data?.photos || []).filter((p) => !known.has(p.id));
          s.photos.push(...fresh);
          added = fresh.length;
          applySummary(data?.checklist);
        } catch (err) {
          reportUploadError(err, batch.files.map((f) => f.file));
        } finally {
          s.batches.shift();
          for (const f of batch.files) URL.revokeObjectURL(f.url);
        }
        if (added) {
          announce(`${plural(added, 'photo')} added`);
          if (!s.alive) toast(`${plural(added, 'photo')} added to ${checklistLabel(s.data)}.`, { type: 'success' });
        }
        renderPhotos();
        updateUploadStatus();
      }
    } finally {
      s.uploading = false;
      setUnloadGuard(false);
      updateBar();
    }
  }

  function updateUploadStatus() {
    if (!s.alive || !els.upload) return;
    const total = s.batches.reduce((n, b) => n + b.files.length, 0);
    els.upload.hidden = total === 0;
    if (!total) return;
    const done = s.batches.reduce((n, b) => n + b.progress * b.files.length, 0) / total;
    const pct = Math.round(done * 100);
    els.uploadText.textContent = pct >= 100 ? `Saving ${plural(total, 'photo')}…` : `Uploading ${plural(total, 'photo')}… ${pct}%`;
    updateProgress(els.uploadBar, pct, 100);
    els.uploadBar.querySelector('.progress__track')?.setAttribute('aria-label', 'Photo upload progress');
  }

  function reportUploadError(err, files) {
    const what = files.length === 1 ? `“${files[0].name}” wasn’t uploaded` : `${files.length} photos weren’t uploaded`;
    const retry = { label: 'Try again', onClick: () => (s.alive ? queueUpload(files) : toast('Open the checklist again to add photos.')) };
    switch (err.status) {
      case 0:
        toast(`${what} because the connection dropped. Check your signal and try again.`, { type: 'error', action: retry, timeout: 0 });
        break;
      case 413:
        if (files.length > 1) {
          // The server refuses the whole request when one photo is too big. Send these one at a time
          // so only that photo fails, and its name is shown.
          enqueueBatches(files.map((f) => [f]));
          break;
        }
        toast(`${what}: ${err.message.replace(/\.$/, '')}. Try a smaller photo or a lower camera resolution.`, { type: 'error' });
        break;
      case 400:
        if (files.length > 1 && /too many photos/i.test(err.message)) {
          // The server allows fewer photos per request than this page assumed: split and resend.
          const half = Math.ceil(files.length / 2);
          enqueueBatches([files.slice(0, half), files.slice(half)]);
          break;
        }
        toast(`${what}: ${err.message}`, { type: 'error' });
        break;
      case 415:
        toast(`${what}: ${err.message}`, { type: 'error' });
        break;
      case 403:
        toast(lockMessage(err), { type: 'warning' });
        load({ quiet: true });
        break;
      case 404:
        toast('This checklist no longer exists, so the photos weren’t added.', { type: 'error' });
        load({ quiet: true });
        break;
      default:
        toast(`${what}. ${errorMessage(err)}`, { type: 'error', action: retry });
    }
  }

  async function removePhoto(photo) {
    let outcome = 'removed';
    let lockErr = null;
    const ok = await confirmDialog({
      title: 'Remove this photo?',
      message: `“${photo.original_filename || 'Photo'}” will be removed from this checklist.`,
      confirmLabel: 'Remove photo',
      danger: true,
      onConfirm: async () => {
        try {
          await api.del(`${base}/photos/${photo.id}`);
        } catch (err) {
          if (err.status === 404) {
            outcome = 'gone';
            return;
          }
          if (err.status === 403 && /locked/i.test(err.message)) {
            outcome = 'locked';
            lockErr = err;
            return;
          }
          if (err.status === 0) throw new Error('Couldn’t remove the photo because you’re offline. Try again when you’re back online.');
          throw new Error(errorMessage(err));
        }
      },
    });
    if (!ok) return;
    if (outcome === 'locked') {
      toast(lockMessage(lockErr), { type: 'warning' });
      load({ quiet: true });
      return;
    }
    s.photos = s.photos.filter((p) => p.id !== photo.id);
    if (s.data) s.data.photos_count = s.photos.length;
    renderPhotos();
    announce(outcome === 'gone' ? 'That photo was already removed' : 'Photo removed');
    if (s.alive) (els.thumbs.querySelector('.thumb__open') || els.takeBtn)?.focus();
  }

  // ---- bottom bar and submit ----

  function buildBar() {
    els.barHint = h('span', { class: 'bottom-bar__hint', id: 'submit-hint' });
    els.submitBtn = h(
      'button',
      { type: 'button', class: 'btn btn--primary btn--lg', 'aria-describedby': 'submit-hint', onClick: onSubmitClick },
      icon('send'),
      'Submit for review',
    );
    els.bar = h('div', { class: 'bottom-bar' }, els.barHint, els.submitBtn);
    return els.bar;
  }

  function observeBar() {
    const setOffset = () => {
      if (els.bar?.isConnected) document.body.style.setProperty('--toast-offset', `${els.bar.offsetHeight + 8}px`);
    };
    setOffset();
    if (typeof ResizeObserver === 'function') {
      barObserver = new ResizeObserver(setOffset);
      barObserver.observe(els.bar);
    }
  }

  function teardownBar() {
    barObserver?.disconnect();
    barObserver = null;
    els.bar = null;
    els.submitBtn = null;
    els.barHint = null;
    document.body.style.removeProperty('--toast-offset');
  }

  function updateBar() {
    if (!s.alive || !els.submitBtn || !s.data) return;
    const missing = s.data.items.length - collectedCount();
    let hint;
    let blocked = true;
    if (s.batches.length) hint = 'Wait for the photos to finish uploading';
    else if (!s.photos.length) hint = 'Add a photo to submit';
    else {
      blocked = false;
      hint = missing ? `${plural(missing, 'item')} not collected. You’ll be asked why.` : `All ${plural(s.data.items.length, 'item')} collected`;
    }
    els.barHint.textContent = hint;
    els.submitBtn.setAttribute('aria-disabled', String(blocked));
  }

  async function flushPending() {
    const pending = [...s.sync.values()].map((st) => st.promise).filter(Boolean);
    await Promise.allSettled([...pending, ...s.noteSaves]);
  }

  async function onSubmitClick() {
    if (s.submitting || !editable()) return;
    if (s.batches.length) {
      toast('Wait for the photos to finish uploading, then submit.', { type: 'warning' });
      return;
    }
    if (!s.photos.length) {
      toast('Add at least one photo of the collected items before submitting.', { type: 'warning' });
      els.takeBtn?.focus();
      return;
    }
    const button = els.submitBtn;
    setLoading(button, true);
    try {
      await flushPending();
      if (!s.alive || !editable()) return;
      const missing = s.data.items.filter((it) => !shownCollected(it));
      if (missing.length) {
        setLoading(button, false);
        openSubmitSheet(missing);
        return;
      }
      const checklist = await postSubmit(null);
      applySubmitted(checklist);
    } catch (err) {
      handleSubmitError(err);
    } finally {
      if (button.isConnected) setLoading(button, false);
    }
  }

  async function postSubmit(note) {
    s.submitting = true;
    try {
      const data = await api.post(`${base}/submit`, note ? { note } : {});
      return data.checklist;
    } finally {
      s.submitting = false;
    }
  }

  function applySubmitted(checklist) {
    announce('Sent to admin for review');
    if (!s.alive) {
      toast(`${checklistLabel(checklist)} was sent to the admin for review.`, { type: 'success' });
      return;
    }
    s.data = checklist;
    s.photos = Array.isArray(checklist.photos) ? [...checklist.photos] : s.photos;
    s.justSubmitted = true;
    render();
  }

  function handleSubmitError(err) {
    if (!(err instanceof ApiError)) {
      toast('Couldn’t submit. Try again.', { type: 'error' });
      return;
    }
    switch (err.status) {
      case 422:
        toast(err.message, { type: 'warning' });
        load({ quiet: true });
        break;
      case 403:
        toast(lockMessage(err), { type: 'warning' });
        load({ quiet: true });
        break;
      case 404:
        load({ quiet: true });
        break;
      case 0:
        toast('Couldn’t submit because you’re offline. Your ticks and photos are saved; try again when you’re back online.', { type: 'error' });
        break;
      default:
        toast(`Couldn’t submit. ${errorMessage(err)}`, { type: 'error' });
    }
  }

  function openSubmitSheet(missing) {
    const fieldId = 'submit-note';
    const textarea = h('textarea', {
      class: 'textarea',
      id: fieldId,
      name: 'note',
      rows: '4',
      maxlength: '1000',
      required: true,
      placeholder: 'e.g. Oat milk: only 4 of 6 on the shelf',
      'aria-describedby': `${fieldId}-help ${fieldId}-error`,
      value: s.noteDraft || '',
    });
    const errorEl = h('p', { class: 'field__error', id: `${fieldId}-error` });
    textarea.addEventListener('input', () => {
      s.noteDraft = textarea.value;
      if (errorEl.textContent) {
        errorEl.textContent = '';
        textarea.removeAttribute('aria-invalid');
      }
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        textarea.form?.requestSubmit();
      }
    });

    const shown = missing.slice(0, 5);
    const content = h(
      'div',
      { class: 'stack stack--4' },
      h(
        'ul',
        { class: 'staff-missing', 'aria-label': 'Items not collected' },
        shown.map((it) => h('li', {}, h('span', {}, it.description), h('span', { class: 'num' }, `× ${formatQty(it.quantity, it.unit)}`))),
        missing.length > shown.length && h('li', { class: 'muted' }, `and ${missing.length - shown.length} more`),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'field__label', for: fieldId }, 'Which items weren’t collected and why?'),
        textarea,
        h('p', { class: 'field__help', id: `${fieldId}-help` }, 'The admin reads this while checking your photos.'),
        errorEl,
      ),
    );

    let failure = null;
    const modal = openModal({
      title: missing.length === 1 ? '1 item wasn’t collected' : `${missing.length} items weren’t collected`,
      description: 'Add a note for the admin, then submit.',
      content,
      closeOnBackdrop: false,
      initialFocus: textarea,
      actions: [
        { label: 'Keep picking', variant: 'secondary', value: null },
        {
          label: 'Submit for review',
          submit: true,
          onClick: async () => {
            const note = textarea.value.trim();
            if (!note) {
              errorEl.textContent = 'Write a short note about the items that weren’t collected.';
              textarea.setAttribute('aria-invalid', 'true');
              textarea.focus();
              return false;
            }
            try {
              return { checklist: await postSubmit(note) };
            } catch (err) {
              if (err.status === 403 || err.status === 404) {
                failure = err;
                return { failed: true };
              }
              if (err.status === 0) throw new Error('Couldn’t submit because you’re offline. Your note is kept; try again when you’re back online.');
              throw new Error(errorMessage(err));
            }
          },
        },
      ],
    });
    modal.closed.then((result) => {
      if (result?.checklist) {
        s.noteDraft = '';
        applySubmitted(result.checklist);
      } else if (result?.failed) {
        handleSubmitError(failure);
      }
    });
  }

  return {
    destroy() {
      s.alive = false;
      teardownBar();
    },
    refresh: () => load({ quiet: true }),
    onInvoice(data) {
      if (Number(data?.id) !== id || !s.data || s.submitting || data.status === s.data.status) return;
      load({ quiet: true, animateStamp: data.status === 'approved' || data.status === 'returned' });
    },
  };
}

// ---------- not found --------------------------------------------------------

function notFoundView({ focus }) {
  setBaseTitle('Page not found · Tally');
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'Page not found');
  mount(
    main,
    h(
      'div',
      { class: 'page page--narrow stack stack--4' },
      title,
      emptyState({
        title: 'That link doesn’t lead to a checklist.',
        text: 'Search for the invoice number or customer name instead.',
        action: h('a', { class: 'btn btn--primary', href: '#/' }, 'Go to search'),
      }),
    ),
  );
  if (focus) focusHeading(title);
  return { destroy() {} };
}

// ---------- boot -------------------------------------------------------------

function setupTopbar() {
  const nameEl = document.getElementById('user-name');
  nameEl.textContent = user.display_name;
  nameEl.title = `Signed in as ${user.display_name}`;
  const signOutBtn = document.getElementById('sign-out');
  if (user.role === 'admin') {
    signOutBtn.before(h('a', { class: 'btn btn--ghost btn--sm hide-mobile', href: '/admin/' }, 'Admin'));
  }

  const bell = mountBell(document.getElementById('bell-slot'), { onOpenInvoice: openInvoice, actionLabel: 'Open' });
  let stopEvents = null;
  const startEvents = () => {
    stopEvents?.();
    stopEvents = connectEvents({
      hello: (data, { reconnected } = {}) => {
        bell.setUnread(data?.unread);
        if (reconnected) {
          bell.refresh();
          view?.refresh?.({ quiet: true });
        }
      },
      notification: (n) => bell.push(n),
      invoice: (data) => view?.onInvoice?.(data),
    });
  };
  startEvents();
  window.addEventListener('pagehide', () => {
    stopEvents?.();
    stopEvents = null;
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      startEvents();
      bell.refresh();
      view?.refresh?.({ quiet: true });
    }
  });

  signOutBtn.addEventListener('click', () => {
    setLoading(signOutBtn, true);
    stopEvents?.();
    signOut();
  });
  document.getElementById('topbar-actions').hidden = false;
}

async function boot() {
  document.querySelector('.skip-link')?.addEventListener('click', (event) => {
    event.preventDefault();
    main.focus();
  });
  try {
    user = await requireUser('staff');
    await loadLimits(); // never rejects; keeps the default limits if /api/config is unavailable
  } catch (err) {
    mount(
      main,
      h(
        'div',
        { class: 'page page--narrow' },
        banner({
          type: 'error',
          title: 'Couldn’t load Tally',
          message: errorMessage(err),
          actions: h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: () => location.reload() }, 'Try again'),
        }),
      ),
    );
    return;
  }
  setupTopbar();
  window.addEventListener('offline', () => toast('You’re offline. Ticks and photos won’t save until you reconnect.', { type: 'warning' }));
  window.addEventListener('online', () => {
    toast('You’re back online.', { type: 'success' });
    view?.refresh?.({ quiet: true });
  });
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

boot();
