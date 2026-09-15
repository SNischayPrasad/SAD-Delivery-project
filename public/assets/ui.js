// Tally shared DOM helpers. All data goes in via textContent — never innerHTML.
import { api } from './api.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- DOM builder ---------------------------------------------------

// Set as properties (after children exist, so <select value> works).
const PROPS = new Set(['value', 'checked', 'selected', 'indeterminate', 'defaultValue', 'defaultChecked', 'muted']);

export function classNames(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(classNames).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, on]) => on)
      .map(([name]) => name)
      .join(' ');
  }
  return '';
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

function setAttribute(el, key, value, deferred) {
  if (value === undefined || value === null) return;
  if (PROPS.has(key)) {
    deferred.push([key, value]);
    return;
  }
  if (key.startsWith('aria-')) {
    el.setAttribute(key, String(value)); // aria-pressed={false} must render "false"
    return;
  }
  if (value === false) return;
  switch (key) {
    case 'class':
    case 'className': {
      const cls = classNames(value);
      if (cls) el.setAttribute('class', cls);
      return;
    }
    case 'dataset':
      for (const [k, v] of Object.entries(value)) if (v !== undefined && v !== null) el.dataset[k] = String(v);
      return;
    case 'style':
      if (typeof value === 'string') el.style.cssText = value;
      else {
        for (const [k, v] of Object.entries(value)) {
          if (v === undefined || v === null) continue;
          if (k.includes('-')) el.style.setProperty(k, String(v));
          else el.style[k] = v;
        }
      }
      return;
    case 'text':
      el.textContent = String(value);
      return;
    case 'ref':
      if (typeof value === 'function') value(el);
      return;
    case 'innerHTML':
    case 'outerHTML':
      throw new Error('h(): innerHTML is not allowed');
    case 'htmlFor':
      key = 'for';
      break;
    default:
      break;
  }
  if (/^on[a-z]/i.test(key)) {
    // onClick / onclick → addEventListener('click'); never an inline handler attribute
    if (typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    return;
  }
  if ((key === 'href' || key === 'src' || key === 'action') && /^\s*javascript:/i.test(String(value))) return;
  el.setAttribute(key, value === true ? '' : String(value));
}

/**
 * h('button', { class: 'btn btn--primary', onClick, 'aria-pressed': false, disabled: true }, 'Label', childNode)
 * attrs may be omitted: h('p', 'text'). Children: strings, numbers, Nodes, arrays; null/false skipped.
 */
export function h(tag, attrs, ...children) {
  if (attrs === null || attrs === undefined || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  const el = document.createElement(tag);
  const deferred = [];
  let ref = null;
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'ref') ref = value;
    else setAttribute(el, key, value, deferred);
  }
  appendChildren(el, children);
  for (const [key, value] of deferred) el[key] = value;
  if (typeof ref === 'function') ref(el);
  return el;
}

/** Replace all children of el. */
export function mount(el, ...children) {
  el.replaceChildren();
  appendChildren(el, children);
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

export function debounce(fn, ms = 300) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------- Icons ---------------------------------------------------------

const SEARCH_PATHS = ['M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13Z', 'm15.3 15.3 5.2 5.2'];
const CIRCLE = 'M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18Z';
const ICONS = {
  bell: ['M6 10a6 6 0 0 1 12 0c0 4.6 1.4 6.2 2.5 7.2h-17C4.6 16.2 6 14.6 6 10Z', 'M9.8 20.2a2.4 2.4 0 0 0 4.4 0'],
  search: SEARCH_PATHS,
  x: ['M6 6l12 12', 'M18 6 6 18'],
  check: ['m4.5 12.5 5 5L19.5 7'],
  'check-circle': [CIRCLE, 'm8 12.3 2.8 2.8 5.2-5.6'],
  'chevron-left': ['m14.5 5.5-6.5 6.5 6.5 6.5'],
  'chevron-right': ['m9.5 5.5 6.5 6.5-6.5 6.5'],
  'chevron-down': ['m5.5 9 6.5 6.5L18.5 9'],
  'arrow-left': ['M20 12H5', 'm10.5 6.5L5 12l5.5 5.5'],
  'arrow-right': ['M4 12h15', 'm13.5 6.5 5.5 5.5-5.5 5.5'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  camera: ['M3.5 8.5h3.2l1.6-2.5h7.4l1.6 2.5h3.2v11h-17Z', 'M12 10.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7Z'],
  image: ['M4 4.5h16v15H4Z', 'm4 16 4.5-4.5 4 4 2.5-2.5L20 18', 'M15.5 8.5h.01'],
  upload: ['M12 15.5V4', 'm7 9 5-5 5 5', 'M4 15.5V20h16v-4.5'],
  file: ['M6 3h8.5L19 7.5V21H6Z', 'M14 3v5h5'],
  trash: ['M4 7h16', 'M9.5 7V4h5v3', 'M6.5 7l1 13.5h9l1-13.5', 'M10 11v6', 'M14 11v6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  'zoom-in': [...SEARCH_PATHS, 'M10.5 8v5', 'M8 10.5h5'],
  'zoom-out': [...SEARCH_PATHS, 'M8 10.5h5'],
  alert: ['M12 3.5 2.5 20h19Z', 'M12 10v4.5', 'M12 17.2h.01'],
  info: [CIRCLE, 'M12 11v5.5', 'M12 7.8h.01'],
  note: ['M4 20h4.5L19.5 9 15 4.5 4 15.5Z', 'm13 6.5 4.5 4.5'],
  logout: ['M10 4H5v16h5', 'm15 8 4 4-4 4', 'M19 12H9'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4v5h-5'],
  users: ['M9 11a3.5 3.5 0 1 1 0-7a3.5 3.5 0 0 1 0 7Z', 'M2.5 20c.4-3.6 3-6 6.5-6s6.1 2.4 6.5 6', 'M15.5 4.3a3.5 3.5 0 0 1 0 6.4', 'M18 14.4c2 .8 3.2 2.8 3.5 5.6'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
  key: ['M7.5 11a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7Z', 'm10 12 9.5-9.5', 'm16 6 3 3', 'm13.5 8.5 2 2'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  clock: [CIRCLE, 'M12 7.5V12l3 2'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  package: ['M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5Z', 'M3.5 7.5 12 12l8.5-4.5', 'M12 12v9'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  send: ['M21 3 10 14', 'M21 3l-7 18-4-7-7-4Z'],
};
ICONS.edit = ICONS.note;

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** Inline SVG icon (class "icon"). Decorative unless `label` is given. */
export function icon(name, { size, label, className } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', ['icon', className].filter(Boolean).join(' '));
  if (size) {
    svg.style.width = `${size}px`;
    svg.style.height = `${size}px`;
  }
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

// ---------- Formatters (pure) --------------------------------------------

const qtyFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/** formatQty(6, 'carton') → "6 carton"; formatQty(2.5) → "2.5"; integers never show decimals. */
export function formatQty(n, unit) {
  const num = typeof n === 'string' && n.trim() !== '' ? Number(n) : n;
  const qty = typeof num === 'number' && Number.isFinite(num) ? qtyFormat.format(num === 0 ? 0 : num) : '';
  const u = typeof unit === 'string' ? unit.trim() : '';
  return [qty, u].filter(Boolean).join(' ');
}

/**
 * Parses a typed quantity. Accepts "2.5", a decimal comma ("2,5") and thousands separators
 * ("1,000", "12,500.5"). Anything ambiguous or malformed ("1,2,3", "1.000,5", "abc") → NaN.
 */
export function parseQuantity(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s) || /^\.\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, '')); // thousands
  if (/^\d+,\d+$/.test(s)) return Number(s.replace(',', '.')); // decimal comma (not 3 digits after)
  return NaN;
}

function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  // Date-only strings are calendar dates: build them in local time so they never shift a day.
  const d = dateOnly ? new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** formatDate('2026-09-14T13:05:00Z') → "14 Sep 2026"; { time: true } → "14 Sep 2026, 14:05" (local). */
export function formatDate(iso, { time = false } = {}) {
  const d = parseDate(iso);
  if (!d) return typeof iso === 'string' ? iso : '';
  let out = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const dateOnly = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
  if (time && !dateOnly) out += `, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return out;
}

export function formatDateTime(iso) {
  return formatDate(iso, { time: true });
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * relativeTime(iso, now?) → "just now", "5 min ago", "1 hour ago", "3 hours ago",
 * "yesterday", "4 days ago", then "14 Sep 2026" after a week. Future: "in 5 min", "tomorrow".
 */
export function relativeTime(iso, now = Date.now()) {
  const d = parseDate(iso);
  if (!d) return '';
  const nowDate = parseDate(now) || new Date();
  const diff = nowDate.getTime() - d.getTime();
  const future = diff < 0;
  const seconds = Math.abs(diff) / 1000;
  if (seconds < 45) return future ? 'in a moment' : 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return future ? `in ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(seconds / 3600);
  if (hours < 24) {
    const label = hours === 1 ? '1 hour' : `${hours} hours`;
    return future ? `in ${label}` : `${label} ago`;
  }
  const days = Math.max(1, Math.round(Math.abs(startOfDay(nowDate) - startOfDay(d)) / 86400000));
  if (days === 1) return future ? 'tomorrow' : 'yesterday';
  if (days < 7) return future ? `in ${days} days` : `${days} days ago`;
  return formatDate(d);
}

let tickerStarted = false;
function ensureTicker() {
  if (tickerStarted || typeof document === 'undefined') return;
  tickerStarted = true;
  setInterval(() => {
    for (const el of document.querySelectorAll('time[data-relative]')) el.textContent = relativeTime(el.dateTime);
  }, 60000);
}

/** <time datetime title="14 Sep 2026, 13:05" data-relative>5 min ago</time>, refreshed every minute. */
export function timeAgo(iso, { className } = {}) {
  if (!iso) return h('time', { class: className });
  ensureTicker();
  return h('time', { class: className, datetime: iso, title: formatDateTime(iso), 'data-relative': true }, relativeTime(iso));
}

// ---------- Title -----------------------------------------------------------

let baseTitle = null;
let titleCount = 0;

function applyTitle() {
  document.title = titleCount > 0 ? `(${titleCount > 99 ? '99+' : titleCount}) ${baseTitle}` : baseTitle;
}

/** Prefix document.title with "(n) " (removed when n is 0). */
export function setTitleCount(n) {
  if (baseTitle === null) baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, '');
  titleCount = Math.max(0, Math.floor(Number(n) || 0));
  applyTitle();
}

/** Change the page title while keeping the unread prefix. */
export function setBaseTitle(title) {
  baseTitle = String(title);
  applyTitle();
}

// ---------- Status, progress, stamp ----------------------------------------

export const STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  open: 'Ready to pick',
  in_progress: 'Picking',
  submitted: 'Needs review',
  approved: 'Verified',
  returned: 'Returned',
});

export function statusLabel(status) {
  return STATUS_LABELS[status] || String(status ?? '');
}

/** <span class="chip chip--submitted">Needs review</span> */
export function statusChip(status, { size } = {}) {
  const known = Object.hasOwn(STATUS_LABELS, status);
  return h('span', { class: ['chip', known && `chip--${status}`, size === 'lg' && 'chip--lg'], dataset: { status } }, statusLabel(status));
}

function progressParts(collected, total) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const c = Math.min(t, Math.max(0, Math.floor(Number(collected) || 0)));
  const pct = t ? Math.round((c / t) * 100) : 0;
  return { c, t, pct, complete: t > 0 && c >= t };
}

function progressText(format, c, t) {
  if (format === 'sentence') return `${c} of ${t} collected`;
  if (format === 'none') return '';
  return `${c}/${t}`;
}

/**
 * progress(11, 12) → "11/12" + bar. Options: format 'fraction'|'sentence'|'none',
 * size 'thin'|'thick', layout 'inline'|'stacked'.
 */
export function progress(collected, total, { format = 'fraction', size, layout = 'inline' } = {}) {
  const { c, t, pct, complete } = progressParts(collected, total);
  const text = progressText(format, c, t);
  return h(
    'div',
    {
      class: ['progress', size && `progress--${size}`, layout === 'stacked' && 'progress--stacked', complete && 'progress--complete'],
      dataset: { format },
    },
    format !== 'none' && h('span', { class: 'progress__text' }, text),
    h(
      'span',
      {
        class: 'progress__track',
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': t,
        'aria-valuenow': c,
        'aria-label': `${c} of ${t} items collected`,
      },
      h('span', { class: 'progress__fill', style: { '--p': `${pct}%` } }),
    ),
  );
}

/** Update an element created by progress() in place (animates the bar). */
export function updateProgress(el, collected, total) {
  if (!el) return;
  const { c, t, pct, complete } = progressParts(collected, total);
  const format = el.dataset.format || 'fraction';
  const text = el.querySelector('.progress__text');
  if (text) text.textContent = progressText(format, c, t);
  const track = el.querySelector('.progress__track');
  track?.setAttribute('aria-valuemax', String(t));
  track?.setAttribute('aria-valuenow', String(c));
  track?.setAttribute('aria-label', `${c} of ${t} items collected`);
  el.querySelector('.progress__fill')?.style.setProperty('--p', `${pct}%`);
  el.classList.toggle('progress--complete', complete);
}

const STAMP_WORDS = { approved: 'Verified', returned: 'Returned' };

/**
 * Put a rubber stamp into `container` (replacing any previous one) and thump it in.
 * kind 'approved' → VERIFIED (green), 'returned' → RETURNED (red).
 * Options: animate (true), meta (small line under the word), size 'sm'|'lg', overlay (true: top-right corner).
 */
export function stamp(container, kind, { animate = true, meta, size, overlay = true } = {}) {
  const k = kind === 'returned' ? 'returned' : 'approved';
  for (const old of container.querySelectorAll(':scope > .stamp')) old.remove();
  if (overlay && getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const word = STAMP_WORDS[k];
  const el = h(
    'div',
    {
      class: ['stamp', `stamp--${k}`, overlay && 'stamp--overlay', size && `stamp--${size}`],
      role: 'img',
      'aria-label': meta ? `${word}, ${meta}` : word,
    },
    h('span', { class: 'stamp__text', 'aria-hidden': 'true' }, word.toUpperCase()),
    meta && h('span', { class: 'stamp__meta', 'aria-hidden': 'true' }, meta),
  );
  container.appendChild(el);
  if (animate && !prefersReducedMotion()) {
    void el.offsetWidth; // restart animation
    el.classList.add('stamp--thump');
    el.addEventListener('animationend', () => el.classList.remove('stamp--thump'), { once: true });
  }
  return el;
}

// ---------- Checklist rows ---------------------------------------------------

/**
 * checkRow(item, { onToggle(item, nextCollected, li), readOnly, extra, byline, showBox }) → <li class="check-row">.
 * With onToggle the row is a <button aria-pressed>; otherwise a read-only <div>. Collected rows show
 * the highlighter band; review_status 'issue' adds the red issue marker. `extra` nodes go into
 * .check-row__extra below the row (notes, review toggle, "Add note" link).
 */
export function checkRow(item, { onToggle, readOnly = typeof onToggle !== 'function', extra, byline, showBox = true } = {}) {
  const collected = Boolean(item.collected);
  const qty = formatQty(item.quantity);
  const unit = typeof item.unit === 'string' ? item.unit.trim() : '';
  const content = [
    h('span', { class: ['check-row__box', !showBox && 'check-row__box--hidden'], 'aria-hidden': 'true' }),
    h(
      'span',
      { class: 'check-row__body' },
      h('span', { class: 'check-row__desc' }, item.description),
      item.sku && h('span', { class: 'check-row__sku' }, item.sku),
      byline && h('span', { class: 'check-row__byline' }, byline),
      readOnly && h('span', { class: 'sr-only check-row__state' }, collected ? ', collected' : ', not collected'),
    ),
    h('span', { class: 'check-row__qty' }, qty && `× ${qty}`, unit && h('span', { class: 'check-row__qty-unit' }, ` ${unit}`)),
  ];
  const li = h('li', {
    class: ['check-row', collected && 'is-collected', item.review_status === 'issue' && 'is-issue'],
    dataset: { itemId: item.id },
  });
  const main = readOnly
    ? h('div', { class: 'check-row__main' }, content)
    : h(
        'button',
        {
          type: 'button',
          class: 'check-row__main',
          'aria-pressed': collected,
          onClick: () => onToggle(item, main.getAttribute('aria-pressed') !== 'true', li),
        },
        content,
      );
  li.append(main, h('div', { class: 'check-row__extra' }, extra));
  return li;
}

/** Show/hide the highlighter band on a row from checkRow() (also flips aria-pressed). */
export function setRowCollected(li, collected) {
  if (!li) return;
  const on = Boolean(collected);
  li.classList.toggle('is-collected', on);
  const main = li.querySelector(':scope > .check-row__main');
  if (main?.tagName === 'BUTTON') main.setAttribute('aria-pressed', String(on));
  const state = li.querySelector('.check-row__state');
  if (state) state.textContent = on ? ', collected' : ', not collected';
}

/** Add/remove the red issue marker on a row. */
export function setRowIssue(li, isIssue) {
  li?.classList.toggle('is-issue', Boolean(isIssue));
}

// ---------- Buttons, banners, empty states, skeletons ---------------------

let loadingGuardInstalled = false;

// A loading button is not `disabled` (that would drop keyboard focus to <body>), so block its
// activation here instead: capture on the document runs before any listener on the button, and
// preventDefault also stops the implicit form submission that Enter triggers.
function installLoadingGuard() {
  if (loadingGuardInstalled || typeof document === 'undefined') return;
  loadingGuardInstalled = true;
  document.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('.is-loading')) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
}

/**
 * Toggle a button's loading state (spinner, aria-busy, aria-disabled). The button keeps focus and its
 * accessible name; clicks and Enter/Space are ignored until loading ends.
 */
export function setLoading(button, loading = true) {
  if (!button) return;
  if (loading) {
    if (button.classList.contains('is-loading')) return;
    installLoadingGuard();
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    if (!button.hasAttribute('aria-disabled')) {
      button.setAttribute('aria-disabled', 'true');
      button.dataset.loadingAriaDisabled = '1';
    }
  } else {
    if (!button.classList.contains('is-loading')) return;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    if (button.dataset.loadingAriaDisabled === '1') {
      button.removeAttribute('aria-disabled');
      delete button.dataset.loadingAriaDisabled;
    }
  }
}

/** Run an async fn with `button` in its loading state. Returns fn's result (rethrows errors). */
export async function withLoading(button, fn) {
  setLoading(button, true);
  try {
    return await fn();
  } finally {
    setLoading(button, false);
  }
}

const BANNER_ICONS = { info: 'info', warning: 'alert', error: 'alert', success: 'check-circle' };

/** banner({ type: 'warning', title, message, actions: [Node] }) — message may be a string, Node, or array. */
export function banner({ type = 'info', title, message, actions } = {}) {
  return h(
    'div',
    { class: ['banner', `banner--${type}`], role: type === 'error' ? 'alert' : 'status' },
    h('span', { class: 'banner__icon' }, icon(BANNER_ICONS[type] || 'info')),
    h(
      'div',
      { class: 'banner__content' },
      title && h('p', { class: 'banner__title' }, title),
      message !== undefined && message !== null && h('div', { class: 'banner__body' }, message),
    ),
    actions && [actions].flat().length > 0 && h('div', { class: 'banner__actions' }, actions),
  );
}

/** emptyState({ title, text, action: Node, compact }) */
export function emptyState({ title, text, action, compact = false } = {}) {
  return h(
    'div',
    { class: ['empty', compact && 'empty--compact'] },
    h('div', { class: 'empty__art', 'aria-hidden': 'true' }),
    title && h('p', { class: 'empty__title' }, title),
    text && h('p', { class: 'empty__text' }, text),
    action && h('div', { class: 'empty__action' }, action),
  );
}

/** skeleton(lines = 3, { title: true, rows: 0, block: 0 }) — loading placeholder, aria-busy. */
export function skeleton(lines = 3, { title = false, rows = 0, block = 0 } = {}) {
  const parts = [];
  if (title) parts.push(h('span', { class: 'skeleton skeleton--title' }));
  if (block) parts.push(h('span', { class: 'skeleton skeleton--block', style: { '--h': `${block}px` } }));
  for (let i = 0; i < rows; i++) parts.push(h('span', { class: 'skeleton skeleton--row' }));
  for (let i = 0; i < lines; i++) parts.push(h('span', { class: 'skeleton skeleton--line' }));
  return h('div', { class: 'skeleton-group', 'aria-busy': 'true', 'aria-label': 'Loading' }, parts);
}

// ---------- Toasts ----------------------------------------------------------

let toastStack = null;
const TOAST_ICONS = { info: 'info', success: 'check-circle', warning: 'alert', error: 'alert' };
const MAX_TOASTS = 4;

function getToastStack() {
  if (!toastStack || !toastStack.isConnected) {
    toastStack = h('div', { class: 'toast-stack', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    document.body.appendChild(toastStack);
  }
  return toastStack;
}

// Screen readers only announce changes to a live region that already exists, so create the (empty)
// stack as soon as the page loads rather than together with the first toast.
if (typeof document !== 'undefined') {
  if (document.body) getToastStack();
  else document.addEventListener('DOMContentLoaded', () => getToastStack(), { once: true });
}

/** An empty polite live region for a dialog, created when the dialog opens. */
function dialogAnnouncer() {
  return h('div', { class: 'sr-only dialog-announcer', 'aria-live': 'polite', 'aria-atomic': 'true' });
}

// While a modal <dialog> is open the rest of the page is inert, toasts included: repeat the toast
// text in the top dialog's own live region so it is still announced.
function announceInOpenDialog(text) {
  if (!text || typeof document === 'undefined') return;
  const open = document.querySelectorAll('dialog[open]');
  const region = open[open.length - 1]?.querySelector(':scope > .dialog-announcer');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => {
    region.textContent = text;
  }, 50);
}

/**
 * toast('Saved', { type: 'success' | 'info' | 'warning' | 'error', action: { label, onClick }, timeout })
 * timeout in ms (0 = stays until dismissed). Returns { dismiss, el }.
 */
export function toast(message, { type = 'info', action, timeout } = {}) {
  const ms = timeout ?? (action ? 8000 : type === 'error' ? 7000 : 4500);
  let timer = null;
  let remaining = ms;
  let startedAt = 0;

  const dismiss = () => {
    if (!el.isConnected || el.classList.contains('is-leaving')) return;
    clearTimeout(timer);
    el.classList.add('is-leaving');
    const remove = () => el.remove();
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 260);
  };

  const el = h(
    'div',
    { class: ['toast', `toast--${type}`], role: type === 'error' ? 'alert' : undefined },
    h('span', { class: 'toast__icon' }, icon(TOAST_ICONS[type] || 'info')),
    h('div', { class: 'toast__message' }, message),
    action &&
      h(
        'button',
        {
          type: 'button',
          class: 'toast__action',
          onClick: () => {
            dismiss();
            action.onClick?.();
          },
        },
        action.label,
      ),
    h('button', { type: 'button', class: 'toast__close', 'aria-label': 'Dismiss', onClick: dismiss }, icon('x')),
  );

  const start = () => {
    if (ms <= 0 || !el.isConnected) return;
    clearTimeout(timer);
    startedAt = Date.now();
    timer = setTimeout(dismiss, Math.max(1200, remaining));
  };
  const pause = () => {
    if (ms <= 0) return;
    clearTimeout(timer);
    remaining -= Date.now() - startedAt;
  };
  el.addEventListener('pointerenter', pause);
  el.addEventListener('pointerleave', start);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', start);

  const stack = getToastStack();
  stack.prepend(el); // column-reverse: first child sits nearest the corner
  while (stack.children.length > MAX_TOASTS) stack.lastElementChild.remove();
  announceInOpenDialog(el.querySelector('.toast__message')?.textContent?.trim());
  start();
  return { dismiss, el };
}

// ---------- Dialogs ---------------------------------------------------------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
}

function trapTab(event, root) {
  if (event.key !== 'Tab') return;
  const items = focusables(root);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

let dialogSeq = 0;

/**
 * Low-level accessible modal (native <dialog>; bottom sheet under 600px).
 * actions: [{ label, variant, value, submit, onClick(ctx) }] — onClick may be async; throw to show
 * the error inside the dialog, return false to stay open, return a value to close with it.
 * Returns { dialog, body, close(value), closed: Promise<value>, setError(msg) }.
 */
export function openModal({
  title,
  description,
  content,
  actions = [],
  size,
  dismissible = true,
  closeOnBackdrop,
  className,
  initialFocus,
  onClose,
} = {}) {
  const id = `tally-dialog-${++dialogSeq}`;
  const previousFocus = document.activeElement;
  let closing = false;
  let finished = false;
  let busy = false;
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  const errorEl = h('div', { class: 'modal__error', 'aria-live': 'assertive' });
  const setError = (message) => {
    errorEl.replaceChildren();
    if (message) errorEl.appendChild(banner({ type: 'error', message }));
  };
  const body = h('div', { class: 'modal__body' }, errorEl, content);

  const buttons = actions.map((action) =>
    h(
      'button',
      {
        type: action.submit ? 'submit' : 'button',
        class: ['btn', `btn--${action.variant || (action.submit ? 'primary' : 'secondary')}`],
        dataset: {
          action: action.submit ? 'submit' : !action.onClick && (action.value === false || action.value == null) ? 'cancel' : 'other',
        },
      },
      action.label,
    ),
  );

  const form = h(
    'form',
    { class: 'modal__form', novalidate: true },
    h(
      'div',
      { class: 'modal__header' },
      h('h2', { class: 'modal__title', id: `${id}-title` }, title),
      description && h('p', { class: 'modal__desc', id: `${id}-desc` }, description),
    ),
    body,
    buttons.length > 0 && h('div', { class: 'modal__footer' }, buttons),
    dismissible &&
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost btn--icon btn--sm modal__close', 'aria-label': 'Close', onClick: () => close(undefined) },
        icon('x'),
      ),
  );

  const dialog = h(
    'dialog',
    {
      class: ['modal', size && `modal--${size}`, className],
      'aria-labelledby': `${id}-title`,
      'aria-describedby': description ? `${id}-desc` : undefined,
    },
    form,
    dialogAnnouncer(),
  );

  const ctx = { dialog, form, body, close: (v) => close(v), setError };

  async function runAction(action, button) {
    if (busy || closing) return;
    setError(null);
    if (typeof action.onClick !== 'function') {
      close(action.value);
      return;
    }
    let result;
    busy = true;
    setLoading(button, true);
    try {
      result = await action.onClick(ctx);
    } catch (err) {
      setError(err?.message || 'Something went wrong. Try again.');
      return;
    } finally {
      busy = false;
      setLoading(button, false);
    }
    if (result === false) return;
    close(result === undefined ? action.value : result);
  }

  actions.forEach((action, i) => {
    if (!action.submit) buttons[i].addEventListener('click', () => runAction(action, buttons[i]));
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const i = actions.findIndex((a) => a.submit);
    if (i >= 0) runAction(actions[i], buttons[i]);
  });

  function finish(value) {
    if (finished) return;
    finished = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
    try {
      onClose?.(value);
    } finally {
      resolveClosed(value);
    }
  }

  function close(value) {
    if (closing) return;
    closing = true;
    if (prefersReducedMotion()) {
      finish(value);
      return;
    }
    dialog.classList.add('is-closing');
    dialog.addEventListener('animationend', () => finish(value), { once: true });
    setTimeout(() => finish(value), 240);
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (dismissible && !busy) close(undefined);
  });
  dialog.addEventListener('close', () => {
    if (!closing) {
      closing = true;
      finish(undefined);
    }
  });
  dialog.addEventListener('keydown', (event) => trapTab(event, dialog));
  let pressedBackdrop = false;
  dialog.addEventListener('pointerdown', (event) => {
    pressedBackdrop = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    const allow = closeOnBackdrop ?? dismissible;
    if (allow && pressedBackdrop && event.target === dialog && !busy) close(undefined);
  });

  document.body.appendChild(dialog);
  dialog.showModal();

  let focusTarget = null;
  if (initialFocus instanceof Element) focusTarget = initialFocus;
  else if (initialFocus === 'cancel') focusTarget = form.querySelector('[data-action="cancel"]');
  else if (initialFocus === 'submit') focusTarget = form.querySelector('[data-action="submit"]');
  else if (typeof initialFocus === 'string') focusTarget = form.querySelector(initialFocus);
  focusTarget ||=
    body.querySelector('[autofocus]') ||
    body.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])') ||
    form.querySelector('[data-action="submit"]') ||
    buttons[0];
  focusTarget?.focus();

  return { dialog, body, close: ctx.close, closed, setError };
}

/**
 * confirmDialog({ title, message, confirmLabel, cancelLabel, danger, onConfirm }) → Promise<boolean>
 * onConfirm (optional, async) runs before closing; if it throws, the error shows in the dialog.
 */
export function confirmDialog(options = {}) {
  const opts = typeof options === 'string' ? { message: options } : options;
  const { title = 'Are you sure?', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm } = opts;
  const modal = openModal({
    title,
    size: 'sm',
    content: message ? h('p', { class: 'modal__message' }, message) : null,
    initialFocus: danger ? 'cancel' : 'submit',
    actions: [
      { label: cancelLabel, variant: 'secondary', value: false },
      {
        label: confirmLabel,
        variant: danger ? 'danger' : 'primary',
        submit: true,
        value: true,
        onClick: onConfirm
          ? async () => {
              await onConfirm();
              return true;
            }
          : undefined,
      },
    ],
  });
  return modal.closed.then((value) => value === true);
}

function buildField(field, id) {
  const {
    name,
    label,
    type = 'text',
    value = '',
    placeholder,
    required = false,
    multiline = false,
    rows = 3,
    autocomplete,
    help,
    minLength,
    maxLength,
    options,
    inputmode,
    mono = false,
  } = field;
  const controlId = `${id}-${name}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = `${controlId}-error`;
  const common = {
    id: controlId,
    name,
    placeholder,
    required,
    autocomplete,
    inputmode,
    maxlength: maxLength,
    minlength: minLength,
    'aria-describedby': [helpId, errorId].filter(Boolean).join(' '),
  };
  let control;
  if (options) {
    control = h(
      'select',
      { ...common, class: 'select', value: String(value ?? '') },
      options.map((o) => (typeof o === 'string' ? h('option', { value: o }, o) : h('option', { value: o.value }, o.label))),
    );
  } else if (multiline) {
    control = h('textarea', { ...common, class: ['textarea', mono && 'input--mono'], rows, value: String(value ?? '') });
  } else {
    control = h('input', { ...common, class: ['input', mono && 'input--mono'], type, value: String(value ?? '') });
  }
  const errorEl = h('p', { class: 'field__error', id: errorId });
  const el = h(
    'div',
    { class: 'field' },
    h('label', { class: 'field__label', for: controlId }, label, !required && field.optionalHint !== false && h('span', { class: 'field__optional' }, ' (optional)')),
    control,
    help && h('p', { class: 'field__help', id: helpId }, help),
    errorEl,
  );
  return { el, control, errorEl, field };
}

/**
 * formDialog({ title, description, fields: [...], confirmLabel, cancelLabel, danger, size, onSubmit })
 * → Promise<values | onSubmit result | null>. Field: { name, label, type, value, placeholder, required,
 * multiline, rows, autocomplete, help, minLength, maxLength, options, inputmode, mono, trim, validate }.
 */
export function formDialog({
  title,
  description,
  fields = [],
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  danger = false,
  size,
  onSubmit,
} = {}) {
  const id = `tally-form-${++dialogSeq}`;
  const built = fields.map((f) => buildField(f, id));

  const readValues = () => {
    const values = {};
    for (const { control, field } of built) {
      let v = control.value;
      if (field.type !== 'password' && field.trim !== false) v = v.trim();
      values[field.name] = v;
    }
    return values;
  };

  const validate = (values) => {
    let firstInvalid = null;
    for (const { control, errorEl, field } of built) {
      const v = values[field.name];
      let message = '';
      if (field.required && !String(v).trim()) message = field.requiredMessage || `${field.label} is required`;
      else if (field.minLength && v.length > 0 && v.length < field.minLength) message = `${field.label} must be at least ${field.minLength} characters`;
      else if (typeof field.validate === 'function') message = field.validate(v, values) || '';
      errorEl.textContent = message;
      control.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (message && !firstInvalid) firstInvalid = control;
    }
    firstInvalid?.focus();
    return !firstInvalid;
  };

  for (const { control, errorEl } of built) {
    control.addEventListener('input', () => {
      if (control.getAttribute('aria-invalid') === 'true') {
        control.setAttribute('aria-invalid', 'false');
        errorEl.textContent = '';
      }
    });
    if (control.tagName === 'TEXTAREA') {
      control.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          control.form?.requestSubmit();
        }
      });
    }
  }

  const modal = openModal({
    title,
    description,
    size,
    closeOnBackdrop: false,
    content: h('div', { class: 'stack stack--4' }, built.map((b) => b.el)),
    actions: [
      { label: cancelLabel, variant: 'secondary', value: null },
      {
        label: confirmLabel,
        variant: danger ? 'danger' : 'primary',
        submit: true,
        onClick: async () => {
          const values = readValues();
          if (!validate(values)) return false;
          if (typeof onSubmit === 'function') {
            const result = await onSubmit(values);
            return result === undefined ? values : result;
          }
          return values;
        },
      },
    ],
  });
  return modal.closed.then((value) => (value === undefined ? null : value));
}

/**
 * promptDialog({ title, message, label, value, placeholder, required, multiline, type, confirmLabel,
 * cancelLabel, maxLength, danger, help, onSubmit(value) }) → Promise<string | null> (null = cancelled).
 */
export async function promptDialog({
  title,
  message,
  label = 'Note',
  value = '',
  placeholder,
  required = false,
  multiline = false,
  type = 'text',
  autocomplete,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  maxLength,
  minLength,
  danger = false,
  help,
  requiredMessage,
  validate,
  onSubmit,
} = {}) {
  const result = await formDialog({
    title,
    description: message,
    confirmLabel,
    cancelLabel,
    danger,
    fields: [
      { name: 'value', label, value, placeholder, required, multiline, type, autocomplete, maxLength, minLength, help, requiredMessage, validate, rows: 4 },
    ],
    onSubmit: onSubmit
      ? async (values) => {
          await onSubmit(values.value);
          return values;
        }
      : undefined,
  });
  return result ? result.value : null;
}

// ---------- Lightbox --------------------------------------------------------

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/**
 * openLightbox(photos, startIndex) — full-screen viewer with zoom (wheel, pinch, double-click,
 * +/- keys), pan (drag), arrow-key and swipe navigation, Esc to close.
 * photos: [{ url, original_filename? }] or [url]. Returns { close, go(index) } or null if empty.
 */
export function openLightbox(photos, startIndex = 0, { onClose } = {}) {
  const items = (photos || [])
    .map((p) => (typeof p === 'string' ? { url: p } : p))
    .filter((p) => p && p.url);
  if (!items.length) return null;

  const previousFocus = document.activeElement;
  const MIN = 1;
  const MAX = 5;
  let index = clamp(Math.floor(Number(startIndex) || 0), 0, items.length - 1);
  let scale = 1;
  let tx = 0;
  let ty = 0;

  const img = h('img', { class: 'lightbox__img', alt: '', draggable: 'false' });
  const openOriginalLink = h('a', { target: '_blank', rel: 'noopener' }, 'Open the file');
  const fallback = h(
    'div',
    { class: 'lightbox__fallback', hidden: true },
    icon('file', { size: 40 }),
    h('p', {}, 'This photo can’t be previewed in this browser.'),
    openOriginalLink,
  );
  const counter = h('span', { class: 'lightbox__counter' });
  const name = h('span', { class: 'lightbox__name' });
  const zoomLevel = h('span', { class: 'lightbox__zoom-level', 'aria-live': 'polite' }, '100%');
  const btn = (label, iconName, onClick, extra = {}) =>
    h('button', { type: 'button', class: 'lightbox__btn', 'aria-label': label, title: label, onClick, ...extra }, icon(iconName));
  const zoomOutBtn = btn('Zoom out', 'zoom-out', () => zoomBy(1 / 1.5));
  const zoomInBtn = btn('Zoom in', 'zoom-in', () => zoomBy(1.5));
  const originalLink = h(
    'a',
    { class: 'lightbox__btn', target: '_blank', rel: 'noopener', 'aria-label': 'Open original in new tab', title: 'Open original' },
    icon('external'),
  );
  const closeBtn = btn('Close', 'x', () => close());
  const prevBtn = h('button', { type: 'button', class: 'lightbox__nav lightbox__nav--prev', 'aria-label': 'Previous photo', onClick: () => go(index - 1) }, icon('chevron-left'));
  const nextBtn = h('button', { type: 'button', class: 'lightbox__nav lightbox__nav--next', 'aria-label': 'Next photo', onClick: () => go(index + 1) }, icon('chevron-right'));
  const stage = h('div', { class: 'lightbox__stage' }, img, fallback, prevBtn, nextBtn);

  const dialog = h(
    'dialog',
    { class: 'lightbox', 'aria-label': 'Photo viewer' },
    h(
      'div',
      { class: 'lightbox__bar' },
      h('div', { class: 'lightbox__caption' }, counter, name),
      h('div', { class: 'lightbox__tools' }, zoomOutBtn, zoomLevel, zoomInBtn, originalLink, closeBtn),
    ),
    stage,
    dialogAnnouncer(),
  );

  function apply({ animate = true } = {}) {
    img.style.transition = animate ? '' : 'none';
    img.style.setProperty('--s', String(scale));
    img.style.setProperty('--x', `${tx}px`);
    img.style.setProperty('--y', `${ty}px`);
    img.classList.toggle('is-zoomed', scale > 1.01);
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    zoomOutBtn.disabled = scale <= MIN + 0.001;
    zoomInBtn.disabled = scale >= MAX - 0.001;
  }

  function clampPan() {
    const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    tx = clamp(tx, -maxX, maxX);
    ty = clamp(ty, -maxY, maxY);
  }

  // Zoom keeping the point (px, py) — relative to the stage centre — fixed on screen.
  function zoomTo(next, px = 0, py = 0, opts) {
    const s = clamp(next, MIN, MAX);
    tx = px - ((px - tx) * s) / scale;
    ty = py - ((py - ty) * s) / scale;
    scale = s;
    if (scale <= MIN + 0.001) {
      scale = MIN;
      tx = 0;
      ty = 0;
    }
    clampPan();
    apply(opts);
  }
  const zoomBy = (factor) => zoomTo(scale * factor);

  function stagePoint(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2];
  }

  function go(i) {
    if (i < 0 || i >= items.length) return;
    index = i;
    const photo = items[index];
    scale = 1;
    tx = 0;
    ty = 0;
    apply({ animate: false });
    const filename = photo.original_filename || `Photo ${index + 1}`;
    img.hidden = false;
    fallback.hidden = true;
    img.alt = `${filename} (photo ${index + 1} of ${items.length})`;
    img.src = photo.url;
    openOriginalLink.href = photo.url;
    originalLink.href = photo.url;
    counter.textContent = `${index + 1} of ${items.length}`;
    name.textContent = filename;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === items.length - 1;
    for (const n of [index - 1, index + 1]) if (items[n]) new Image().src = items[n].url;
  }

  img.addEventListener('error', () => {
    img.hidden = true;
    fallback.hidden = false;
  });

  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const [px, py] = stagePoint(event.clientX, event.clientY);
      zoomTo(scale * Math.exp(-event.deltaY * 0.0022), px, py, { animate: false });
    },
    { passive: false },
  );

  const pointers = new Map();
  let gesture = null;
  let lastTap = { time: 0, x: 0, y: 0 };
  let lastPointerType = 'mouse';

  const toggleZoomAt = (clientX, clientY) => {
    const [px, py] = stagePoint(clientX, clientY);
    zoomTo(scale > 1.01 ? 1 : 2.5, px, py);
  };

  stage.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, a')) return;
    lastPointerType = event.pointerType;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      gesture = { type: 'drag', startX: event.clientX, startY: event.clientY, tx, ty, moved: false, target: event.target };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = {
        type: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2),
        scale,
        tx,
        ty,
        moved: true,
      };
    }
    img.classList.add('is-dragging');
  });

  stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const s = clamp((gesture.scale * dist) / gesture.dist, MIN * 0.8, MAX);
      tx = mid[0] - ((gesture.mid[0] - gesture.tx) * s) / gesture.scale;
      ty = mid[1] - ((gesture.mid[1] - gesture.ty) * s) / gesture.scale;
      scale = s;
      apply({ animate: false });
    } else if (gesture.type === 'drag') {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.hypot(dx, dy) > 6) gesture.moved = true;
      if (scale > 1.01) {
        tx = gesture.tx + dx;
        ty = gesture.ty + dy;
        clampPan();
      } else if (items.length > 1) {
        tx = dx * 0.5; // rubber-band feedback for swipe
        ty = 0;
      }
      apply({ animate: false });
    }
  });

  const endPointer = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (!gesture) return;
    if (pointers.size === 1 && gesture.type === 'pinch') {
      const [p] = [...pointers.values()];
      gesture = { type: 'drag', startX: p.x, startY: p.y, tx, ty, moved: true, target: stage };
      return;
    }
    if (pointers.size > 0) return;
    img.classList.remove('is-dragging');
    const g = gesture;
    gesture = null;
    if (g.type === 'pinch' || scale > 1.01) {
      if (scale < 1.01) zoomTo(1);
      else {
        clampPan();
        apply();
      }
      return;
    }
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (g.moved && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2 && items.length > 1) {
      const target = dx < 0 ? index + 1 : index - 1;
      if (target >= 0 && target < items.length) {
        go(target);
        return;
      }
    }
    tx = 0;
    ty = 0;
    apply();
    if (g.moved || event.type === 'pointercancel') return;
    if (event.pointerType !== 'mouse') {
      const now = performance.now();
      if (now - lastTap.time < 300 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30) {
        lastTap = { time: 0, x: 0, y: 0 };
        toggleZoomAt(event.clientX, event.clientY);
        return;
      }
      lastTap = { time: now, x: event.clientX, y: event.clientY };
    }
    if (g.target === stage) close(); // tap on the dark backdrop
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  img.addEventListener('dblclick', (event) => {
    if (lastPointerType === 'mouse') toggleZoomAt(event.clientX, event.clientY);
  });

  dialog.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        go(index - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        go(index + 1);
        break;
      case '+':
      case '=':
        event.preventDefault();
        zoomBy(1.5);
        break;
      case '-':
      case '_':
        event.preventDefault();
        zoomBy(1 / 1.5);
        break;
      case '0':
        event.preventDefault();
        zoomTo(1);
        break;
      case 'Tab':
        trapTab(event, dialog);
        break;
      default:
        break;
    }
  });

  let closedOnce = false;
  function close() {
    if (closedOnce) return;
    closedOnce = true;
    window.removeEventListener('resize', onResize);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
    onClose?.(index);
  }
  const onResize = () => {
    clampPan();
    apply({ animate: false });
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('close', close);
  window.addEventListener('resize', onResize);

  document.body.appendChild(dialog);
  dialog.showModal();
  go(index);
  closeBtn.focus();
  return { close, go, dialog };
}

// ---------- Photos & drop zone ----------------------------------------------

function fileTile(name) {
  return h('span', { class: 'thumb__file' }, icon('file'), h('span', {}, 'No preview'), h('span', { class: 'thumb__file-name' }, name));
}

/**
 * photoThumb(photo, { onOpen(photo), onRemove(photo, li), active }) → <li class="thumb">.
 * Falls back to a file tile when the image cannot render (HEIC outside Safari).
 */
export function photoThumb(photo, { onOpen, onRemove, active = false } = {}) {
  const filename = photo.original_filename || 'Photo';
  const li = h('li', { class: ['thumb', active && 'is-active'], dataset: { photoId: photo.id } });
  const img = h('img', { class: 'thumb__img', src: photo.url, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener(
    'error',
    () => {
      img.replaceWith(fileTile(filename));
      li.classList.add('thumb--file');
    },
    { once: true },
  );
  if (onOpen) {
    li.appendChild(h('button', { type: 'button', class: 'thumb__open', 'aria-label': `Open photo ${filename}`, onClick: () => onOpen(photo) }, img));
  } else {
    img.alt = filename;
    li.appendChild(img);
  }
  if (onRemove) {
    li.appendChild(
      h(
        'button',
        {
          type: 'button',
          class: 'thumb__remove',
          'aria-label': `Remove photo ${filename}`,
          title: 'Remove photo',
          onClick: (event) => {
            event.stopPropagation();
            onRemove(photo, li);
          },
        },
        icon('x'),
      ),
    );
  }
  return li;
}

/**
 * Wire a .dropzone <label> containing an <input type="file">: drag-over styling, drop, and browse.
 * onFiles(File[]) is called for dropped or chosen files. Returns an unbind function.
 */
export function bindDropzone(zone, { onFiles } = {}) {
  const input = zone.querySelector('input[type="file"]');
  let depth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  const busy = () => zone.classList.contains('is-busy');

  const onEnter = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    if (!busy()) zone.classList.add('is-dragover');
  };
  const onOver = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy() ? 'none' : 'copy';
  };
  const onLeave = (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove('is-dragover');
  };
  const onDrop = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    depth = 0;
    zone.classList.remove('is-dragover');
    const files = [...event.dataTransfer.files];
    if (files.length && !busy()) onFiles?.(files);
  };
  const onChange = () => {
    const files = [...(input?.files || [])];
    if (input) input.value = '';
    if (files.length) onFiles?.(files);
  };
  // Stop the browser from opening a file dropped just outside the zone.
  const guard = (event) => {
    if (hasFiles(event)) event.preventDefault();
  };

  zone.addEventListener('dragenter', onEnter);
  zone.addEventListener('dragover', onOver);
  zone.addEventListener('dragleave', onLeave);
  zone.addEventListener('drop', onDrop);
  input?.addEventListener('change', onChange);
  window.addEventListener('dragover', guard);
  window.addEventListener('drop', guard);
  return () => {
    zone.removeEventListener('dragenter', onEnter);
    zone.removeEventListener('dragover', onOver);
    zone.removeEventListener('dragleave', onLeave);
    zone.removeEventListener('drop', onDrop);
    input?.removeEventListener('change', onChange);
    window.removeEventListener('dragover', guard);
    window.removeEventListener('drop', guard);
  };
}

// ---------- Notification bell -----------------------------------------------

let bellSeq = 0;
const TOAST_TYPE_FOR = { submitted: 'info', approved: 'success', returned: 'warning' };

/**
 * mountBell(container, { onOpenInvoice(invoiceId, notification), actionLabel, toastOnPush,
 * desktopAlerts, updateTitle }) → bell { el, push(n), refresh(), setUnread(n), open(), close(),
 * destroy(), unread }.
 * Loads /api/notifications, shows an unread badge, lists notifications in a dropdown; clicking one
 * marks it read and calls onOpenInvoice. push(n) is for SSE 'notification' events.
 */
export function mountBell(container, {
  onOpenInvoice,
  actionLabel = 'Open',
  toastOnPush = true,
  desktopAlerts = true,
  updateTitle = true,
  label = 'Notifications',
} = {}) {
  const panelId = `tally-bell-${++bellSeq}`;
  let items = [];
  let unread = 0;
  let isOpen = false;
  let loadError = null;
  let loaded = false;

  const badge = h('span', { class: 'bell__badge', hidden: true, 'aria-hidden': 'true' });
  const button = h(
    'button',
    { type: 'button', class: 'bell__button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': panelId },
    icon('bell'),
    h('span', { class: 'bell__label' }, label),
    badge,
  );
  const markAllButton = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => markAllRead() }, 'Mark all read');
  const list = h('ul', { class: 'bell__list' });
  const emptyEl = h('p', { class: 'bell__empty', hidden: true });
  const footer = h('div', { class: 'bell__footer' });
  const panel = h(
    'div',
    { class: 'bell__panel', id: panelId, role: 'dialog', 'aria-label': label, tabindex: '-1', hidden: true },
    h('div', { class: 'bell__header' }, h('h2', { class: 'bell__title' }, label), markAllButton),
    list,
    emptyEl,
    footer,
  );
  const root = h('div', { class: 'bell' }, button);
  container.appendChild(root);
  document.body.appendChild(panel); // fixed-position panel must escape transformed/filtered ancestors

  function render() {
    badge.hidden = unread <= 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    button.setAttribute('aria-label', unread > 0 ? `${label}, ${unread} unread` : label);
    markAllButton.disabled = unread <= 0;
    if (updateTitle) setTitleCount(unread);

    list.replaceChildren(...items.map(renderItem));
    if (!loaded && !loadError) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'Loading…';
    } else if (loadError && !items.length) {
      emptyEl.hidden = false;
      emptyEl.textContent = loadError;
    } else {
      emptyEl.hidden = items.length > 0;
      emptyEl.textContent = 'You’re all caught up. Updates about checklists will show here.';
    }
    renderFooter();
  }

  function renderItem(n) {
    return h(
      'li',
      {},
      h(
        'button',
        { type: 'button', class: ['bell__item', `bell__item--${n.type}`, !n.read && 'is-unread'], onClick: () => openItem(n) },
        h('span', { class: 'bell__dot', 'aria-hidden': 'true' }),
        h('span', { class: 'bell__message' }, n.message, !n.read && h('span', { class: 'sr-only' }, ' (unread)')),
        timeAgo(n.created_at, { className: 'bell__time' }),
      ),
    );
  }

  function renderFooter() {
    footer.replaceChildren();
    if (!desktopAlerts || typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      footer.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--secondary btn--sm',
            onClick: async () => {
              try {
                await Notification.requestPermission();
              } catch {
                /* ignored */
              }
              renderFooter();
            },
          },
          icon('bell'),
          'Enable desktop alerts',
        ),
      );
    } else if (Notification.permission === 'granted') {
      footer.appendChild(h('span', {}, 'Desktop alerts are on for this browser.'));
    } else {
      footer.appendChild(h('span', {}, 'Desktop alerts are blocked in this browser’s site settings.'));
    }
  }

  function markRead(n) {
    if (n.read) return;
    n.read = true;
    unread = Math.max(0, unread - 1);
    render();
    api.post(`/api/notifications/${encodeURIComponent(n.id)}/read`).catch(() => {});
  }

  function openItem(n) {
    markRead(n);
    close({ restoreFocus: false });
    if (n.invoice_id && typeof onOpenInvoice === 'function') onOpenInvoice(n.invoice_id, n);
  }

  async function markAllRead() {
    const before = items.map((n) => n.read);
    const beforeUnread = unread;
    items.forEach((n) => {
      n.read = true;
    });
    unread = 0;
    render();
    try {
      await api.post('/api/notifications/read-all');
    } catch (err) {
      items.forEach((n, i) => {
        n.read = before[i];
      });
      unread = beforeUnread;
      render();
      toast(err.message, { type: 'error' });
    }
  }

  async function refresh() {
    try {
      const data = await api.get('/api/notifications');
      items = Array.isArray(data?.notifications) ? data.notifications : [];
      unread = Number.isFinite(data?.unread) ? data.unread : items.filter((n) => !n.read).length;
      loadError = null;
      loaded = true;
    } catch (err) {
      loadError = err?.status === 401 ? 'Sign in to see notifications.' : 'Couldn’t load notifications. Try again in a moment.';
    }
    render();
  }

  function setUnread(n) {
    unread = Math.max(0, Math.floor(Number(n) || 0));
    render();
  }

  function bump() {
    badge.classList.remove('is-bump');
    void badge.offsetWidth;
    badge.classList.add('is-bump');
  }

  function push(n) {
    if (!n || typeof n !== 'object') return;
    if (items.some((x) => x.id === n.id)) return;
    items.unshift({ ...n });
    if (items.length > 50) items.length = 50;
    if (!n.read) {
      unread += 1;
      bump();
    }
    loaded = true;
    render();
    if (isOpen) position();
    const item = items[0];
    if (toastOnPush && n.message) {
      const canOpen = n.invoice_id && typeof onOpenInvoice === 'function';
      toast(n.message, {
        type: TOAST_TYPE_FOR[n.type] || 'info',
        action: canOpen ? { label: typeof actionLabel === 'function' ? actionLabel(n) : actionLabel, onClick: () => openItem(item) } : undefined,
      });
    }
    if (
      desktopAlerts &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      (document.hidden || !document.hasFocus())
    ) {
      try {
        const desktop = new Notification('Tally', { body: n.message, tag: `tally-${n.id}` });
        desktop.onclick = () => {
          window.focus();
          openItem(item);
          desktop.close();
        };
      } catch {
        /* some platforms only allow notifications from a service worker */
      }
    }
  }

  function position() {
    const r = button.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 8;
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    let top;
    let left;
    const inLeftRail = vw >= 900 && r.left < 280 && r.top > vh / 2;
    if (inLeftRail) {
      left = r.right + gap;
      top = r.bottom - ph;
    } else {
      const below = vh - r.bottom - gap - margin;
      const above = r.top - gap - margin;
      top = below >= Math.min(ph, 300) || below >= above ? r.bottom + gap : r.top - gap - ph;
      left = r.right - pw;
      if (left < margin) left = r.left;
    }
    left = clamp(left, margin, Math.max(margin, vw - pw - margin));
    top = clamp(top, margin, Math.max(margin, vh - ph - margin));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  const onDocPointer = (event) => {
    if (!root.contains(event.target) && !panel.contains(event.target)) close({ restoreFocus: false });
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  const onFocusOut = (event) => {
    const next = event.relatedTarget;
    if (next && !panel.contains(next) && !root.contains(next)) close({ restoreFocus: false });
  };
  const onReflow = () => position();

  function open() {
    if (isOpen) return;
    isOpen = true;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    render();
    position();
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onKey);
    panel.addEventListener('focusout', onFocusOut);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    (panel.querySelector('.bell__item') || panel).focus();
    if (!loaded || loadError) refresh().then(() => isOpen && position());
  }

  function close({ restoreFocus = true } = {}) {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointer, true);
    document.removeEventListener('keydown', onKey);
    panel.removeEventListener('focusout', onFocusOut);
    window.removeEventListener('resize', onReflow);
    window.removeEventListener('scroll', onReflow, true);
    if (restoreFocus) button.focus();
  }

  button.addEventListener('click', () => (isOpen ? close() : open()));

  function destroy() {
    close({ restoreFocus: false });
    root.remove();
    panel.remove();
  }

  render();
  refresh();

  return {
    el: root,
    panel,
    push,
    refresh,
    setUnread,
    open,
    close,
    destroy,
    get unread() {
      return unread;
    },
  };
}
