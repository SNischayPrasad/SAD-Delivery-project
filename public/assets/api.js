// Tally API client: JSON fetch wrapper, upload with progress, live events, auth guard.

const FETCH_HEADER = 'X-Requested-With';
const FETCH_VALUE = 'fetch';

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

const FALLBACK_MESSAGES = {
  0: "Can't reach the server. Check your connection and try again.",
  400: 'That request was not valid.',
  401: 'Your session has ended. Sign in again.',
  403: "You don't have permission to do that.",
  404: 'That could not be found.',
  409: 'That conflicts with something that already exists.',
  413: 'That file is too large.',
  415: 'That file type is not supported.',
  422: "That can't be done right now.",
  429: 'Too many attempts. Wait a few minutes and try again.',
};

function fallbackMessage(status) {
  if (FALLBACK_MESSAGES[status]) return FALLBACK_MESSAGES[status];
  if (status >= 500) return 'Something went wrong on the server. Try again.';
  return `Request failed (${status}).`;
}

function isAuthPath(path) {
  return String(path).startsWith('/api/auth/');
}

function dispatchUnauthorized(path) {
  if (isAuthPath(path) || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('tally:unauthorized', { detail: { path, status: 401 } }));
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Shared by fetch and XHR paths: 2xx → parsed JSON (null for 204/empty), else throw ApiError.
function handleResponse(status, text, path) {
  if (status === 204) return null;
  const data = parseJson(text);
  if (status >= 200 && status < 300) return data === undefined ? null : data;
  if (status === 401) dispatchUnauthorized(path);
  const serverMessage = data && typeof data.error === 'string' && data.error.trim() ? data.error : null;
  throw new ApiError(status, serverMessage || fallbackMessage(status), data ?? null);
}

function isRawBody(body) {
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    typeof body === 'string'
  );
}

async function request(method, path, body, { signal, headers } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { [FETCH_HEADER]: FETCH_VALUE, Accept: 'application/json', ...headers },
    signal,
  };
  if (body !== undefined && body !== null) {
    if (isRawBody(body)) {
      init.body = body; // FormData etc. pass through untouched (browser sets the boundary)
    } else {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, FALLBACK_MESSAGES[0]);
  }
  const text = res.status === 204 ? '' : await res.text().catch(() => '');
  return handleResponse(res.status, text, path);
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body, options),
  put: (path, body, options) => request('PUT', path, body, options),
  patch: (path, body, options) => request('PATCH', path, body, options),
  del: (path, body, options) => request('DELETE', path, body, options),
};
api.delete = api.del;

/**
 * Multipart upload with progress (fetch cannot report upload progress).
 * onProgress(fraction 0..1, { loaded, total }) — called during upload and once with 1 at the end.
 */
export function uploadWithProgress(path, formData, onProgress, { method = 'POST', signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    xhr.setRequestHeader(FETCH_HEADER, FETCH_VALUE);
    xhr.setRequestHeader('Accept', 'application/json');
    const report = (loaded, total) => {
      if (typeof onProgress !== 'function') return;
      try {
        onProgress(total ? Math.min(1, loaded / total) : 0, { loaded, total });
      } catch (err) {
        console.error(err);
      }
    };
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) report(e.loaded, e.total);
    });
    xhr.upload.addEventListener('load', () => report(1, 1));
    xhr.addEventListener('load', () => {
      try {
        resolve(handleResponse(xhr.status, xhr.responseText, path));
      } catch (err) {
        reject(err);
      }
    });
    xhr.addEventListener('error', () => reject(new ApiError(0, FALLBACK_MESSAGES[0])));
    xhr.addEventListener('timeout', () => reject(new ApiError(0, FALLBACK_MESSAGES[0])));
    xhr.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')));
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(formData);
  });
}

/**
 * Live events from /api/notifications/stream with reconnect + exponential backoff.
 * handlers: { hello(data, meta), notification(n), invoice({id, status}), status(state) }
 *   state: 'connecting' | 'open' | 'reconnecting' | 'closed'; meta: { reconnected: boolean }
 * Returns close().
 */
export function connectEvents(handlers = {}, { url = '/api/notifications/stream' } = {}) {
  let source = null;
  let closed = false;
  let attempt = 0;
  let timer = null;
  let everOpened = false;

  const call = (name, ...args) => {
    const fn = handlers[name];
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (err) {
      console.error(`connectEvents ${name} handler failed`, err);
    }
  };
  const parse = (event) => {
    try {
      return JSON.parse(event.data);
    } catch {
      return null;
    }
  };

  function open() {
    if (closed) return;
    timer = null;
    call('status', attempt ? 'reconnecting' : 'connecting');
    const es = new EventSource(url);
    source = es;
    es.addEventListener('open', () => call('status', 'open'));
    es.addEventListener('hello', (e) => {
      const reconnected = everOpened;
      everOpened = true;
      attempt = 0;
      call('hello', parse(e) || {}, { reconnected });
    });
    es.addEventListener('notification', (e) => {
      const data = parse(e);
      if (data) call('notification', data);
    });
    es.addEventListener('invoice', (e) => {
      const data = parse(e);
      if (data) call('invoice', data);
    });
    es.addEventListener('error', () => {
      if (closed || source !== es) return;
      // Take over reconnection so a 401 or server restart gets a real backoff.
      es.close();
      source = null;
      schedule();
    });
  }

  async function schedule() {
    attempt += 1;
    call('status', 'reconnecting');
    if (attempt % 3 === 0) {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          headers: { [FETCH_HEADER]: FETCH_VALUE, Accept: 'application/json' },
        });
        if (res.status === 401) {
          dispatchUnauthorized(url);
          close();
          return;
        }
      } catch {
        /* offline — keep retrying */
      }
    }
    if (closed) return;
    const base = Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 5));
    timer = setTimeout(open, base * (0.75 + Math.random() * 0.5));
  }

  const reconnectNow = () => {
    if (closed || source || !timer) return;
    clearTimeout(timer);
    open();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') reconnectNow();
  };

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    timer = null;
    source?.close();
    source = null;
    window.removeEventListener('online', reconnectNow);
    document.removeEventListener('visibilitychange', onVisible);
    call('status', 'closed');
  }

  window.addEventListener('online', reconnectNow);
  document.addEventListener('visibilitychange', onVisible);
  open();
  return close;
}

// ---------- Upload limits (GET /api/config) ---------------------------------

/** Server defaults (SPEC §3), used until /api/config answers or when it fails. */
export const DEFAULT_LIMITS = Object.freeze({ max_invoice_mb: 20, max_photo_mb: 15, max_photos_per_upload: 10 });

/** Keeps each field that is a usable number; anything missing or invalid falls back to the default. */
export function normalizeLimits(data) {
  const pick = (key, { integer = false } = {}) => {
    const n = Number(data?.[key]);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMITS[key];
    if (!integer) return n;
    return Math.floor(n) >= 1 ? Math.floor(n) : DEFAULT_LIMITS[key];
  };
  return {
    max_invoice_mb: pick('max_invoice_mb'),
    max_photo_mb: pick('max_photo_mb'),
    max_photos_per_upload: pick('max_photos_per_upload', { integer: true }),
  };
}

let currentLimits = { ...DEFAULT_LIMITS };
let limitsRequest = null;

/** The limits known right now (defaults until loadLimits() has resolved). */
export function limits() {
  return currentLimits;
}

/**
 * Fetches the configured upload limits once per page (call after sign-in). Never rejects: a 404
 * (older server), 401, network error or timeout keeps the defaults.
 */
export function loadLimits({ timeoutMs = 5000 } = {}) {
  limitsRequest ??= (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const data = await api.get('/api/config', { signal: controller?.signal });
      currentLimits = normalizeLimits(data);
    } catch {
      currentLimits = { ...DEFAULT_LIMITS };
    } finally {
      clearTimeout(timer);
    }
    return currentLimits;
  })();
  return limitsRequest;
}

/**
 * Splits photos into upload requests the server will accept: files over max_photo_mb are set aside
 * (multer would reject the whole request with 413), the rest go in groups of max_photos_per_upload.
 * → { batches: File[][], oversized: File[] }
 */
export function planPhotoBatches(files, lim = currentLimits) {
  const { max_photo_mb: maxMb, max_photos_per_upload: perRequest } = normalizeLimits(lim);
  const maxBytes = Math.floor(maxMb * 1024 * 1024);
  const oversized = [];
  const ok = [];
  for (const file of files || []) (Number(file?.size) > maxBytes ? oversized : ok).push(file);
  const batches = [];
  for (let i = 0; i < ok.length; i += perRequest) batches.push(ok.slice(i, i + perRequest));
  return { batches, oversized };
}

// ---------- Auth helpers ---------------------------------------------------

export function homeFor(role) {
  return role === 'admin' ? '/admin/' : '/staff/';
}

export function currentPath() {
  return location.pathname + location.search + location.hash;
}

export function loginUrl(role, next = currentPath()) {
  const params = new URLSearchParams({ role: role === 'admin' ? 'admin' : 'staff' });
  if (next) params.set('next', next);
  return `/login.html?${params}`;
}

/**
 * Returns `next` if it is a same-origin path under /admin/ or /staff/ that this role may open,
 * else null. Admins may open both apps; staff only /staff/.
 */
export function safeNext(next, role, origin = globalThis.location?.origin || 'http://localhost') {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  let url;
  try {
    url = new URL(next, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  const path = url.pathname;
  const allowed =
    (path.startsWith('/admin/') && role === 'admin') ||
    (path.startsWith('/staff/') && (role === 'staff' || role === 'admin'));
  return allowed ? path + url.search + url.hash : null;
}

const never = () => new Promise(() => {});
let unauthorizedHooked = false;

/**
 * Page guard for /admin/ and /staff/. Resolves with the signed-in user, or redirects
 * (and never resolves): 401 → sign-in with ?next; staff on an admin page → /staff/.
 * Also installs a one-time 'tally:unauthorized' listener that sends the user to sign-in.
 */
export async function requireUser(expectedRole) {
  let res;
  try {
    res = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      headers: { [FETCH_HEADER]: FETCH_VALUE, Accept: 'application/json' },
    });
  } catch {
    throw new ApiError(0, FALLBACK_MESSAGES[0]);
  }
  if (res.status === 401) {
    location.replace(loginUrl(expectedRole));
    return never();
  }
  const text = await res.text().catch(() => '');
  const data = handleResponse(res.status, text, '/api/auth/me');
  const user = data?.user;
  if (!user) throw new ApiError(500, fallbackMessage(500));

  if (expectedRole === 'admin' && user.role !== 'admin') {
    location.replace(homeFor(user.role));
    return never();
  }
  if (expectedRole === 'staff' && user.role !== 'staff' && user.role !== 'admin') {
    location.replace('/');
    return never();
  }

  if (!unauthorizedHooked) {
    unauthorizedHooked = true;
    let redirecting = false;
    window.addEventListener('tally:unauthorized', () => {
      if (redirecting) return;
      redirecting = true;
      location.assign(loginUrl(expectedRole));
    });
  }
  return user;
}

/** POST /api/auth/logout (errors ignored), then go to `to` (default: the landing page). */
export async function signOut({ to = '/' } = {}) {
  try {
    await api.post('/api/auth/logout');
  } catch {
    /* session may already be gone */
  }
  location.assign(to);
}
