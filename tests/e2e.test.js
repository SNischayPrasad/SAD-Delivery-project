// Full API flow against a real Tally server on a throwaway DATA_DIR.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-e2e-'));

process.env.DATA_DIR = DATA_DIR;
process.env.EXTRACTOR = 'local';
for (const key of [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_TTL_HOURS',
  'MAX_INVOICE_MB', 'MAX_PHOTO_MB', 'MAX_PHOTOS_PER_UPLOAD',
]) delete process.env[key];

const { startServer } = await import('../server/index.js');

const INVOICE_DIR = path.join(DATA_DIR, 'uploads', 'invoices');
const PHOTO_DIR = path.join(DATA_DIR, 'uploads', 'photos');
const TMP_DIR = path.join(DATA_DIR, 'uploads', 'tmp');
// A valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));
const GST = EXPECTED['gst-tax-invoice.pdf'];
const US = EXPECTED['us-invoice.pdf'];

let server = null;
let base = '';
const openStreams = new Set();
const s = {}; // state shared by the ordered tests below

before(async () => {
  server = await startServer({ port: 0, dataDir: DATA_DIR });
  base = server.url;
});

after(async () => {
  for (const stream of [...openStreams]) stream.close();
  await server?.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// ---------- helpers ----------

async function call(method, url, { cookie, json, form, csrf = true } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrf && method !== 'GET' && method !== 'HEAD') headers['X-Requested-With'] = 'fetch';
  let body;
  if (form) body = form;
  else if (json !== undefined) {
    body = JSON.stringify(json);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(base + url, { method, headers, body, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') && buf.length ? JSON.parse(buf.toString('utf8')) : null;
  return { status: res.status, headers: res.headers, data, buf };
}

async function login(username, password, role) {
  const res = await call('POST', '/api/auth/login', { json: { username, password, role } });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('tally_sid=')) || null;
  return { ...res, setCookie, cookie: setCookie ? setCookie.split(';')[0] : null };
}

function fileForm(field, buffer, filename, type) {
  const form = new FormData();
  form.append(field, new Blob([buffer], { type }), filename);
  return form;
}

const listDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const lineOf = ({ description, sku, quantity, unit }) => ({ description, sku, quantity, unit });

/** Opens /api/notifications/stream with fetch and parses Server-Sent Events from the body. */
async function openEvents(cookie) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/notifications/stream`, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const queue = [];
  let buffer = '';
  let pending = null;

  function parse() {
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue; // heartbeat comment
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length) queue.push({ event, data: JSON.parse(data.join('\n')) });
    }
  }

  const stream = {
    async next(name, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = queue.findIndex((e) => e.event === name);
        if (index !== -1) return queue.splice(index, 1)[0].data;
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`Timed out waiting for SSE event "${name}"`);
        pending ??= reader.read();
        let timer;
        const result = await Promise.race([
          pending,
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), left); }),
        ]);
        clearTimeout(timer);
        if (result === null) continue;
        pending = null;
        if (result.done) throw new Error(`SSE stream ended before "${name}" arrived`);
        buffer += decoder.decode(result.value, { stream: true });
        parse();
      }
    },
    /** Resolves true once the server ends the stream, false if it is still open after timeoutMs. */
    async ended(timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const left = deadline - Date.now();
        if (left <= 0) return false;
        pending ??= reader.read();
        let timer;
        let result;
        try {
          result = await Promise.race([
            pending,
            new Promise((resolve) => { timer = setTimeout(() => resolve(null), left); }),
          ]);
        } catch {
          return true; // connection torn down
        } finally {
          clearTimeout(timer);
        }
        if (result === null) return false;
        pending = null;
        if (result.done) return true;
        buffer += decoder.decode(result.value, { stream: true });
        parse();
      }
    },
    close() {
      openStreams.delete(stream);
      pending?.catch(() => {});
      controller.abort();
    },
  };
  openStreams.add(stream);
  return stream;
}

// ---------- pages ----------

test('pages are served with the basic security headers', async () => {
  for (const url of ['/', '/login.html?role=admin', '/admin/', '/staff/']) {
    const res = await call('GET', url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), /text\/html/, url);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', url);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
    assert.equal(res.headers.get('referrer-policy'), 'same-origin', url);
  }
  const redirect = await call('GET', '/admin');
  assert.ok([301, 302, 308].includes(redirect.status));
  assert.equal(redirect.headers.get('location'), '/admin/');
  const missing = await call('GET', '/api/nope');
  assert.equal(missing.status, 404);
  assert.equal(typeof missing.data.error, 'string');
});

// ---------- auth ----------

test('the seeded admin signs in with the default password', async () => {
  const res = await login('admin', 'admin123', 'admin');
  assert.equal(res.status, 200);
  assert.equal(res.data.user.username, 'admin');
  assert.equal(res.data.user.role, 'admin');
  assert.equal(res.data.user.active, true);
  assert.equal('password_hash' in res.data.user, false);
  assert.ok(res.cookie, 'sets the tally_sid cookie');
  assert.match(res.setCookie, /HttpOnly/i);
  assert.match(res.setCookie, /SameSite=Lax/i);
  assert.match(res.setCookie, /Path=\//);
  assert.doesNotMatch(res.setCookie, /Secure/i);
  s.admin = res.cookie;
  s.adminUser = res.data.user;

  const me = await call('GET', '/api/auth/me', { cookie: s.admin });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.id, s.adminUser.id);
  assert.equal((await call('GET', '/api/auth/me')).status, 401);
});

test('GET /api/config gives signed-in users the upload limits', async () => {
  const res = await call('GET', '/api/config', { cookie: s.admin });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { max_invoice_mb: 20, max_photo_mb: 15, max_photos_per_upload: 10 });
  const anonymous = await call('GET', '/api/config');
  assert.equal(anonymous.status, 401);
  assert.equal(typeof anonymous.data.error, 'string');
});

test('valid credentials at the wrong sign-in door get 403', async () => {
  const res = await login('admin', 'admin123', 'staff');
  assert.equal(res.status, 403);
  assert.equal(res.data.error, 'This account is not a staff account. Use the admin sign-in.');
  assert.equal(res.cookie, null);
});

test('a wrong password or unknown user gets 401', async () => {
  const wrong = await login('admin', 'not-the-password', 'admin');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, 'Incorrect username or password');
  assert.equal(wrong.cookie, null);
  const unknown = await login('nobody-here', 'whatever-123', 'staff');
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error, 'Incorrect username or password');
});

test('non-GET API requests without X-Requested-With: fetch are refused with 403', async () => {
  const res = await call('POST', '/api/admin/users', {
    cookie: s.admin,
    csrf: false,
    json: { username: 'sneaky', display_name: 'Sneaky', password: 'sneaky-pass-1', role: 'admin' },
  });
  assert.equal(res.status, 403);
  assert.match(res.data.error, /X-Requested-With/);
  const loginNoHeader = await call('POST', '/api/auth/login', {
    csrf: false, json: { username: 'admin', password: 'admin123', role: 'admin' },
  });
  assert.equal(loginNoHeader.status, 403);
  const users = await call('GET', '/api/admin/users', { cookie: s.admin });
  assert.equal(users.status, 200);
  assert.ok(!users.data.users.some((u) => u.username === 'sneaky'));
});

test('admin creates staff accounts', async () => {
  const created = await call('POST', '/api/admin/users', {
    cookie: s.admin,
    json: { username: 'priya', display_name: 'Priya', password: 'picker-pass-1', role: 'staff' },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(
    { ...created.data.user, id: undefined, created_at: undefined },
    { id: undefined, username: 'priya', display_name: 'Priya', role: 'staff', active: true, created_at: undefined },
  );

  const duplicate = await call('POST', '/api/admin/users', {
    cookie: s.admin, json: { username: 'PRIYA', display_name: 'Other', password: 'picker-pass-2', role: 'staff' },
  });
  assert.equal(duplicate.status, 409);
  const shortPassword = await call('POST', '/api/admin/users', {
    cookie: s.admin, json: { username: 'shorty', display_name: 'Shorty', password: 'short', role: 'staff' },
  });
  assert.equal(shortPassword.status, 400);

  const ravi = await call('POST', '/api/admin/users', {
    cookie: s.admin, json: { username: 'ravi', display_name: 'Ravi', password: 'picker-pass-3', role: 'staff' },
  });
  assert.equal(ravi.status, 201);
  s.raviUser = ravi.data.user;

  const priyaLogin = await login('priya', 'picker-pass-1', 'staff');
  assert.equal(priyaLogin.status, 200);
  assert.equal(priyaLogin.data.user.role, 'staff');
  s.staff = priyaLogin.cookie;
  s.staffUser = priyaLogin.data.user;

  const raviLogin = await login('ravi', 'picker-pass-3', 'staff');
  assert.equal(raviLogin.status, 200);
  s.ravi = raviLogin.cookie;
});

// ---------- admin: upload, edit, publish ----------

test('uploading the GST invoice drafts a checklist with the extracted lines', async () => {
  const pdf = fs.readFileSync(path.join(FIXTURES, 'gst-tax-invoice.pdf'));
  const res = await call('POST', '/api/admin/invoices', {
    cookie: s.admin, form: fileForm('file', pdf, 'gst-tax-invoice.pdf', 'application/pdf'),
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const inv = res.data.invoice;
  assert.equal(inv.status, 'draft');
  assert.equal(inv.extraction_method, 'pdf-text');
  assert.deepEqual(inv.extraction_warnings, []);
  assert.equal(inv.invoice_number, GST.invoice_number);
  assert.equal(inv.customer_name, GST.customer_name);
  assert.equal(inv.invoice_date, GST.invoice_date);
  assert.deepEqual(inv.items.map(lineOf), GST.items);
  assert.deepEqual(inv.items.map((it) => it.position), GST.items.map((_, i) => i + 1));
  assert.ok(inv.items.every((it) => it.collected === false && it.note === null && it.review_status === null));
  assert.equal(inv.items_total, GST.items.length);
  assert.equal(inv.items_collected, 0);
  assert.equal(inv.original_filename, 'gst-tax-invoice.pdf');
  assert.equal(inv.mime_type, 'application/pdf');
  assert.equal(inv.file_url, `/api/admin/invoices/${inv.id}/file`);
  assert.deepEqual(inv.photos, []);
  assert.deepEqual(inv.events.map((e) => e.type), ['created']);
  assert.equal(inv.events[0].user_name, 'Admin');

  const stored = listDir(INVOICE_DIR);
  assert.equal(stored.length, 1);
  assert.match(stored[0], /^[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual(listDir(TMP_DIR), []);
  s.invoice = inv;

  const fake = await call('POST', '/api/admin/invoices', {
    cookie: s.admin, form: fileForm('file', Buffer.from('not a pdf at all'), 'invoice.pdf', 'application/pdf'),
  });
  assert.equal(fake.status, 415);
  assert.equal(listDir(INVOICE_DIR).length, 1);
  assert.deepEqual(listDir(TMP_DIR), []);
});

test('PUT edits header fields and lines: listed ids stay, new lines are added, the rest are deleted', async () => {
  const [first, ...rest] = s.invoice.items;
  const removed = rest.pop();
  const body = {
    invoice_number: s.invoice.invoice_number,
    customer_name: s.invoice.customer_name,
    invoice_date: s.invoice.invoice_date,
    items: [
      { id: first.id, description: first.description, sku: 'BR-5KG', quantity: 12, unit: 'bag' },
      ...rest.map(({ id, description, sku, quantity, unit }) => ({ id, description, sku, quantity, unit })),
      { description: 'Returnable delivery crate', sku: null, quantity: 1, unit: 'crate' },
    ],
  };
  const res = await call('PUT', `/api/admin/invoices/${s.invoice.id}`, { cookie: s.admin, json: body });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const inv = res.data.invoice;
  assert.equal(inv.items.length, GST.items.length);
  assert.equal(inv.items[0].id, first.id);
  assert.equal(inv.items[0].sku, 'BR-5KG');
  assert.equal(inv.items[0].quantity, 12);
  assert.deepEqual(inv.items.slice(1, -1).map((it) => it.id), rest.map((it) => it.id));
  assert.equal(inv.items.at(-1).description, 'Returnable delivery crate');
  assert.ok(!inv.items.some((it) => it.description === removed.description));
  assert.deepEqual(inv.items.map((it) => it.position), inv.items.map((_, i) => i + 1));
  assert.equal(inv.events[0].type, 'edited');

  const invalid = await call('PUT', `/api/admin/invoices/${s.invoice.id}`, {
    cookie: s.admin, json: { items: [{ description: 'Broken line', quantity: 0 }] },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error, 'Line 1: quantity must be greater than 0');
  s.invoice = inv;
});

test('publish returns 422 for missing fields and 409 for a duplicate invoice number', async () => {
  const pdf = fs.readFileSync(path.join(FIXTURES, 'us-invoice.pdf'));
  const upload = await call('POST', '/api/admin/invoices', {
    cookie: s.admin, form: fileForm('file', pdf, 'us-invoice.pdf', 'application/pdf'),
  });
  assert.equal(upload.status, 201);
  s.second = upload.data.invoice;
  const second = `/api/admin/invoices/${s.second.id}`;

  assert.equal((await call('PUT', second, { cookie: s.admin, json: { invoice_number: null } })).status, 200);
  const noNumber = await call('POST', `${second}/publish`, { cookie: s.admin });
  assert.equal(noNumber.status, 422);
  assert.equal(noNumber.data.error, 'Add the invoice number before publishing');

  assert.equal((await call('PUT', second, { cookie: s.admin, json: { invoice_number: 'US-10482', customer_name: '' } })).status, 200);
  const noCustomer = await call('POST', `${second}/publish`, { cookie: s.admin });
  assert.equal(noCustomer.status, 422);
  assert.equal(noCustomer.data.error, 'Add the customer name before publishing');

  const published = await call('POST', `/api/admin/invoices/${s.invoice.id}/publish`, { cookie: s.admin });
  assert.equal(published.status, 200);
  assert.equal(published.data.invoice.status, 'open');
  assert.ok(published.data.invoice.published_at);
  s.invoice = published.data.invoice;

  const again = await call('POST', `/api/admin/invoices/${s.invoice.id}/publish`, { cookie: s.admin });
  assert.equal(again.status, 403);

  const clash = await call('PUT', second, {
    cookie: s.admin, json: { invoice_number: s.invoice.invoice_number, customer_name: 'Harbor Cafe LLC' },
  });
  assert.equal(clash.status, 200, 'a draft may hold a clashing number until it is published');
  const duplicate = await call('POST', `${second}/publish`, { cookie: s.admin });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error, `Invoice number ${s.invoice.invoice_number} is already in use`);
  assert.equal((await call('GET', second, { cookie: s.admin })).data.invoice.status, 'draft');

  const counts = await call('GET', '/api/admin/invoices/counts', { cookie: s.admin });
  assert.deepEqual(counts.data, { draft: 1, open: 1, in_progress: 0, submitted: 0, approved: 0, returned: 0 });
});

test('re-reading a draft replaces its fields and lines; published checklists cannot be re-read', async () => {
  const res = await call('POST', `/api/admin/invoices/${s.second.id}/reextract`, { cookie: s.admin });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const inv = res.data.invoice;
  assert.equal(inv.status, 'draft');
  assert.equal(inv.extraction_method, 'pdf-text');
  assert.equal(inv.invoice_number, US.invoice_number);
  assert.equal(inv.customer_name, US.customer_name);
  assert.deepEqual(inv.items.map(lineOf), US.items);
  assert.equal(inv.events[0].type, 'reextracted');
  assert.equal((await call('POST', `/api/admin/invoices/${s.invoice.id}/reextract`, { cookie: s.admin })).status, 403);
});

// ---------- staff: find, pick, photograph, submit ----------

test('staff find published checklists by number and by partial lowercase customer name', async () => {
  const byNumber = await call('GET', `/api/staff/checklists/search?q=${encodeURIComponent(s.invoice.invoice_number)}`, { cookie: s.staff });
  assert.equal(byNumber.status, 200);
  assert.equal(byNumber.data.checklists[0].id, s.invoice.id);
  assert.equal(byNumber.data.checklists[0].status, 'open');
  assert.equal(byNumber.data.checklists[0].items_total, s.invoice.items.length);

  const byCustomer = await call('GET', '/api/staff/checklists/search?q=sharma%20kir', { cookie: s.staff });
  assert.equal(byCustomer.status, 200);
  assert.deepEqual(byCustomer.data.checklists.map((c) => c.id), [s.invoice.id]);

  const drafts = await call('GET', '/api/staff/checklists/search?q=harbor', { cookie: s.staff });
  assert.deepEqual(drafts.data.checklists, [], 'drafts never show up for staff');
  const wildcard = await call('GET', '/api/staff/checklists/search?q=%25', { cookie: s.staff });
  assert.deepEqual(wildcard.data.checklists, [], '% is matched literally');
  assert.equal((await call('GET', '/api/staff/checklists/search?q=%20%20', { cookie: s.staff })).status, 400);

  const detail = await call('GET', `/api/staff/checklists/${s.invoice.id}`, { cookie: s.staff });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.checklist.items.length, s.invoice.items.length);
  for (const key of ['file_url', 'events', 'raw_text']) assert.equal(key in detail.data.checklist, false, key);
  assert.equal((await call('GET', `/api/staff/checklists/${s.second.id}`, { cookie: s.staff })).status, 404);
});

test('staff cannot call admin routes', async () => {
  const id = s.invoice.id;
  const attempts = [
    ['GET', '/api/admin/invoices'],
    ['GET', '/api/admin/invoices/counts'],
    ['GET', `/api/admin/invoices/${id}`],
    ['PUT', `/api/admin/invoices/${id}`],
    ['POST', `/api/admin/invoices/${id}/approve`],
    ['DELETE', `/api/admin/invoices/${id}`],
    ['GET', '/api/admin/users'],
    ['POST', '/api/admin/users'],
  ];
  for (const [method, url] of attempts) {
    const res = await call(method, url, { cookie: s.staff, json: method === 'GET' ? undefined : {} });
    assert.equal(res.status, 403, `${method} ${url}`);
  }
  assert.equal((await call('GET', '/api/admin/invoices')).status, 401);
  assert.equal((await call('GET', '/api/staff/checklists/mine')).status, 401);
});

test('malformed percent-escapes in route params are a 400, not a server error', async () => {
  for (const [method, url, cookie] of [
    ['GET', '/api/staff/checklists/%E0%A4%A', s.staff],
    ['GET', '/api/admin/invoices/%ZZ', s.admin],
    ['POST', '/api/notifications/%ZZ/read', s.admin],
  ]) {
    const res = await call(method, url, { cookie });
    assert.equal(res.status, 400, `${method} ${url}`);
    assert.equal(typeof res.data.error, 'string');
  }
});

test('ticking an item moves the checklist to in_progress', async () => {
  const [first, second] = s.invoice.items;
  const base = `/api/staff/checklists/${s.invoice.id}/items`;
  const tick = await call('PATCH', `${base}/${first.id}`, { cookie: s.staff, json: { collected: true } });
  assert.equal(tick.status, 200, JSON.stringify(tick.data));
  assert.equal(tick.data.item.collected, true);
  assert.equal(tick.data.item.updated_by_name, 'Priya');
  assert.equal(tick.data.checklist.status, 'in_progress');
  assert.equal(tick.data.checklist.items_collected, 1);

  const note = await call('PATCH', `${base}/${second.id}`, { cookie: s.staff, json: { note: 'Only 20 packs on the shelf' } });
  assert.equal(note.status, 200);
  assert.equal(note.data.item.note, 'Only 20 packs on the shelf');
  assert.equal(note.data.item.collected, false);
  const tooLong = await call('PATCH', `${base}/${second.id}`, { cookie: s.staff, json: { note: 'x'.repeat(501) } });
  assert.equal(tooLong.status, 400);

  const admin = await call('GET', `/api/admin/invoices/${s.invoice.id}`, { cookie: s.admin });
  assert.equal(admin.data.invoice.status, 'in_progress');
  const checked = admin.data.invoice.events.find((e) => e.type === 'item_checked');
  assert.equal(checked.user_name, 'Priya');
  assert.equal(admin.data.invoice.events.filter((e) => e.type === 'item_checked').length, 1, 'note-only changes log no event');
});

test('submitting without a photo is refused with 422', async () => {
  const res = await call('POST', `/api/staff/checklists/${s.invoice.id}/submit`, { cookie: s.staff, json: { note: 'Done' } });
  assert.equal(res.status, 422);
  assert.equal(res.data.error, 'Add at least one photo of the collected items before submitting');
});

test('photos: a real PNG is stored and served, a text file named .png gets 415', async () => {
  const url = `/api/staff/checklists/${s.invoice.id}/photos`;
  const res = await call('POST', url, { cookie: s.staff, form: fileForm('photos', PNG, 'basket.png', 'image/png') });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const [photo] = res.data.photos;
  assert.equal(res.data.photos.length, 1);
  assert.equal(photo.url, `/api/photos/${photo.id}`);
  assert.equal(photo.original_filename, 'basket.png');
  assert.equal(photo.uploaded_by_name, 'Priya');
  assert.equal(res.data.checklist.photos_count, 1);
  assert.equal(res.data.checklist.status, 'in_progress');
  s.photo = photo;

  const served = await call('GET', photo.url, { cookie: s.staff });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal(served.headers.get('cache-control'), 'private, max-age=3600');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(served.buf.equals(PNG));
  assert.equal((await call('GET', photo.url, { cookie: s.admin })).status, 200);

  const photosBefore = listDir(PHOTO_DIR);
  assert.equal(photosBefore.length, 1);
  assert.match(photosBefore[0], /^[0-9a-f-]{36}\.png$/);
  const fake = await call('POST', url, {
    cookie: s.staff, form: fileForm('photos', Buffer.from('this is plain text, not an image'), 'notes.png', 'image/png'),
  });
  assert.equal(fake.status, 415);
  assert.equal(fake.data.error, 'Unsupported photo type. Use JPEG, PNG, WEBP or HEIC images.');
  assert.deepEqual(listDir(PHOTO_DIR), photosBefore, 'rejected file is not kept');
  assert.deepEqual(listDir(TMP_DIR), []);

  const notMine = await call('DELETE', `${url}/${photo.id}`, { cookie: s.ravi });
  assert.equal(notMine.status, 403);
  assert.equal(notMine.data.error, 'You can only remove photos you added');
});

test('a photo upload that fails midway (file move error) leaves no orphaned files', async () => {
  const url = `/api/staff/checklists/${s.invoice.id}/photos`;
  const photosBefore = listDir(PHOTO_DIR);
  const realRename = fs.promises.rename;
  let calls = 0;
  fs.promises.rename = async (...args) => {
    calls += 1;
    if (calls === 2) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    return realRename(...args);
  };
  const originalError = console.error;
  console.error = () => {}; // the expected 500 is logged
  let res;
  try {
    const form = new FormData();
    form.append('photos', new Blob([PNG], { type: 'image/png' }), 'one.png');
    form.append('photos', new Blob([PNG], { type: 'image/png' }), 'two.png');
    res = await call('POST', url, { cookie: s.staff, form });
  } finally {
    fs.promises.rename = realRename;
    console.error = originalError;
  }
  assert.equal(res.status, 500);
  assert.equal(calls, 2);
  assert.deepEqual(listDir(PHOTO_DIR), photosBefore, 'the photo moved before the failure is removed');
  assert.deepEqual(listDir(TMP_DIR), []);
  const detail = await call('GET', `/api/staff/checklists/${s.invoice.id}`, { cookie: s.staff });
  assert.equal(detail.data.checklist.photos.length, 1);
});

test('submitting with uncollected items needs a note', async () => {
  const res = await call('POST', `/api/staff/checklists/${s.invoice.id}/submit`, { cookie: s.staff, json: {} });
  assert.equal(res.status, 422);
  assert.equal(res.data.error, 'Add a note explaining the items that were not collected');
});

test('a successful submit reaches the admin as an SSE notification and in the unread list', async () => {
  const events = await openEvents(s.admin);
  const hello = await events.next('hello');
  assert.equal(typeof hello.unread, 'number');

  const res = await call('POST', `/api/staff/checklists/${s.invoice.id}/submit`, {
    cookie: s.staff, json: { note: 'Five lines are still on the pallet' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.checklist.status, 'submitted');
  assert.equal(res.data.checklist.submit_note, 'Five lines are still on the pallet');
  assert.equal(res.data.checklist.submitted_by_name, 'Priya');

  const notification = await events.next('notification');
  assert.equal(notification.type, 'submitted');
  assert.equal(notification.invoice_id, s.invoice.id);
  assert.equal(notification.read, false);
  assert.equal(notification.message, `Priya submitted ${s.invoice.invoice_number} (${s.invoice.customer_name}) for review`);
  assert.deepEqual(await events.next('invoice'), { id: s.invoice.id, status: 'submitted' });
  events.close();

  const list = await call('GET', '/api/notifications', { cookie: s.admin });
  assert.equal(list.status, 200);
  assert.equal(list.data.unread, 1);
  assert.deepEqual(list.data.notifications[0], notification);
  s.adminNotification = notification;
});

test('a submitted checklist is locked for staff', async () => {
  const id = s.invoice.id;
  const locked = 'This checklist is locked while it is submitted';
  const tick = await call('PATCH', `/api/staff/checklists/${id}/items/${s.invoice.items[1].id}`, { cookie: s.staff, json: { collected: true } });
  assert.equal(tick.status, 403);
  assert.equal(tick.data.error, locked);
  const photo = await call('POST', `/api/staff/checklists/${id}/photos`, { cookie: s.staff, form: fileForm('photos', PNG, 'more.png', 'image/png') });
  assert.equal(photo.status, 403);
  assert.equal(photo.data.error, locked);
  assert.equal((await call('DELETE', `/api/staff/checklists/${id}/photos/${s.photo.id}`, { cookie: s.staff })).status, 403);
  assert.equal((await call('POST', `/api/staff/checklists/${id}/submit`, { cookie: s.staff, json: { note: 'again' } })).status, 403);
  assert.equal(listDir(PHOTO_DIR).length, 1);
  assert.deepEqual(listDir(TMP_DIR), []);
  const edit = await call('PUT', `/api/admin/invoices/${id}`, { cookie: s.admin, json: { customer_name: 'Changed' } });
  assert.equal(edit.status, 403);

  // Notifications are private to their recipient.
  assert.equal((await call('POST', `/api/notifications/${s.adminNotification.id}/read`, { cookie: s.staff })).status, 404);
  assert.equal((await call('POST', `/api/notifications/${s.adminNotification.id}/read`, { cookie: s.admin })).status, 204);
  assert.equal((await call('GET', '/api/notifications', { cookie: s.admin })).data.unread, 0);
});

// ---------- admin review ----------

test('admin return needs a note; staff are notified and can edit again', async () => {
  const id = s.invoice.id;
  const staffEvents = await openEvents(s.staff);
  await staffEvents.next('hello');

  const blank = await call('POST', `/api/admin/invoices/${id}/return`, { cookie: s.admin, json: { note: '   ' } });
  assert.equal(blank.status, 400);
  assert.equal(blank.data.error, 'Add a note telling staff what to fix');

  const flagged = s.invoice.items[1];
  const res = await call('POST', `/api/admin/invoices/${id}/return`, {
    cookie: s.admin,
    json: { note: 'The toor dal is missing from the photo', item_reviews: [{ item_id: flagged.id, review_status: 'issue' }] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.invoice.status, 'returned');
  assert.equal(res.data.invoice.review_note, 'The toor dal is missing from the photo');
  assert.equal(res.data.invoice.reviewed_by_name, 'Admin');

  const notification = await staffEvents.next('notification');
  assert.equal(notification.type, 'returned');
  assert.equal(notification.invoice_id, id);
  assert.match(notification.message, /^Admin returned /);
  assert.deepEqual(await staffEvents.next('invoice'), { id, status: 'returned' });
  staffEvents.close();

  const inbox = await call('GET', '/api/notifications', { cookie: s.staff });
  assert.equal(inbox.data.unread, 1);
  assert.equal(inbox.data.notifications[0].type, 'returned');

  const checklist = await call('GET', `/api/staff/checklists/${id}`, { cookie: s.staff });
  assert.equal(checklist.data.checklist.status, 'returned');
  assert.equal(checklist.data.checklist.review_note, 'The toor dal is missing from the photo');
  assert.equal(checklist.data.checklist.items.find((it) => it.id === flagged.id).review_status, 'issue');

  const mine = await call('GET', '/api/staff/checklists/mine', { cookie: s.staff });
  assert.equal(mine.data.checklists[0].id, id);
  assert.equal(mine.data.checklists[0].status, 'returned');

  const tick = await call('PATCH', `/api/staff/checklists/${id}/items/${flagged.id}`, { cookie: s.staff, json: { collected: true } });
  assert.equal(tick.status, 200);
  assert.equal(tick.data.checklist.status, 'returned');
});

test('staff resubmit a returned checklist', async () => {
  const id = s.invoice.id;
  const current = await call('GET', `/api/staff/checklists/${id}`, { cookie: s.staff });
  for (const item of current.data.checklist.items.filter((it) => !it.collected)) {
    const res = await call('PATCH', `/api/staff/checklists/${id}/items/${item.id}`, { cookie: s.staff, json: { collected: true } });
    assert.equal(res.status, 200);
  }
  const res = await call('POST', `/api/staff/checklists/${id}/submit`, { cookie: s.staff, json: {} });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.checklist.status, 'submitted');
  assert.equal(res.data.checklist.items_collected, res.data.checklist.items_total);
  assert.ok(res.data.checklist.items.every((it) => it.review_status === null), 'previous review marks are cleared');
  const resubmitted = await call('GET', `/api/admin/invoices/${id}`, { cookie: s.admin });
  for (const inv of [res.data.checklist, resubmitted.data.invoice]) {
    assert.equal(inv.status, 'submitted');
    assert.equal(inv.reviewed_at, null, 'the previous return is not the current review');
    assert.equal(inv.reviewed_by_name, null);
    assert.equal(inv.review_note, null);
  }
  assert.ok(resubmitted.data.invoice.events.some((e) => e.type === 'returned' && e.note === 'The toor dal is missing from the photo'),
    'the earlier return note stays in the timeline');
  const counts = await call('GET', '/api/admin/invoices/counts', { cookie: s.admin });
  assert.equal(counts.data.submitted, 1);
  const queue = await call('GET', '/api/admin/invoices', { cookie: s.admin });
  assert.equal(queue.data.invoices[0].id, id, 'submitted invoices come first');
});

test('approve locks the checklist and notifies the submitter', async () => {
  const id = s.invoice.id;
  const res = await call('POST', `/api/admin/invoices/${id}/approve`, {
    cookie: s.admin,
    json: { note: 'All there', item_reviews: s.invoice.items.map((it) => ({ item_id: it.id, review_status: 'ok' })) },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const inv = res.data.invoice;
  assert.equal(inv.status, 'approved');
  assert.ok(inv.reviewed_at);
  assert.ok(inv.items.every((it) => it.review_status === 'ok'));
  assert.deepEqual(
    [...new Set(inv.events.map((e) => e.type))].filter((t) => ['created', 'published', 'submitted', 'returned', 'approved'].includes(t)),
    ['approved', 'submitted', 'returned', 'published', 'created'],
    'events are newest first',
  );

  assert.equal((await call('POST', `/api/admin/invoices/${id}/approve`, { cookie: s.admin, json: {} })).status, 403);
  const tick = await call('PATCH', `/api/staff/checklists/${id}/items/${inv.items[0].id}`, { cookie: s.staff, json: { collected: false } });
  assert.equal(tick.status, 403);
  assert.equal(tick.data.error, 'This checklist is locked while it is approved');

  const inbox = await call('GET', '/api/notifications', { cookie: s.staff });
  assert.equal(inbox.data.notifications[0].type, 'approved');
  assert.equal(inbox.data.unread, 2);
  assert.equal((await call('POST', '/api/notifications/read-all', { cookie: s.staff })).status, 204);
  assert.equal((await call('GET', '/api/notifications', { cookie: s.staff })).data.unread, 0);

  const verified = await call('GET', '/api/admin/invoices?status=approved', { cookie: s.admin });
  assert.deepEqual(verified.data.invoices.map((i) => i.id), [id]);
  const active = await call('GET', '/api/admin/invoices?status=active', { cookie: s.admin });
  assert.deepEqual(active.data.invoices, []);
});

// ---------- files ----------

test('stored invoice files and photos are only served to the right roles', async () => {
  const fileUrl = `/api/admin/invoices/${s.invoice.id}/file`;
  const asAdmin = await call('GET', fileUrl, { cookie: s.admin });
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.headers.get('content-type'), 'application/pdf');
  assert.equal(asAdmin.headers.get('content-disposition'), 'inline; filename="gst-tax-invoice.pdf"');
  assert.equal(asAdmin.buf.subarray(0, 4).toString('latin1'), '%PDF');

  assert.equal((await call('GET', fileUrl, { cookie: s.staff })).status, 403);
  assert.equal((await call('GET', fileUrl)).status, 401);
  assert.equal((await call('GET', s.photo.url)).status, 401);
  assert.equal((await call('GET', '/api/photos/999999', { cookie: s.staff })).status, 404);
});

test('deleting an invoice removes its files from disk', async () => {
  assert.equal(listDir(INVOICE_DIR).length, 2);
  assert.equal(listDir(PHOTO_DIR).length, 1);

  const del = await call('DELETE', `/api/admin/invoices/${s.invoice.id}`, { cookie: s.admin });
  assert.equal(del.status, 204);
  assert.equal((await call('GET', `/api/admin/invoices/${s.invoice.id}`, { cookie: s.admin })).status, 404);
  assert.equal((await call('GET', s.photo.url, { cookie: s.admin })).status, 404);
  assert.deepEqual(listDir(PHOTO_DIR), []);
  assert.equal(listDir(INVOICE_DIR).length, 1);

  assert.equal((await call('DELETE', `/api/admin/invoices/${s.second.id}`, { cookie: s.admin })).status, 204);
  assert.deepEqual(listDir(INVOICE_DIR), []);
  const search = await call('GET', `/api/staff/checklists/search?q=${encodeURIComponent(s.invoice.invoice_number)}`, { cookie: s.staff });
  assert.deepEqual(search.data.checklists, []);
});

test('search and duplicate invoice numbers ignore letter case in any script, not just ASCII', async () => {
  const pdf = fs.readFileSync(path.join(FIXTURES, 'us-invoice.pdf'));
  const draft = async (number, customer) => {
    const up = await call('POST', '/api/admin/invoices', { cookie: s.admin, form: fileForm('file', pdf, 'us-invoice.pdf', 'application/pdf') });
    assert.equal(up.status, 201);
    const put = await call('PUT', `/api/admin/invoices/${up.data.invoice.id}`, { cookie: s.admin, json: { invoice_number: number, customer_name: customer } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    return up.data.invoice.id;
  };
  const first = await draft('ÉTÉ-7', 'Émile Épicerie');
  assert.equal((await call('POST', `/api/admin/invoices/${first}/publish`, { cookie: s.admin })).status, 200);

  for (const q of ['Émile', 'ÉMILE', 'émile', 'émile épicerie', 'été-7', 'ÉTÉ-7']) {
    const staff = await call('GET', `/api/staff/checklists/search?q=${encodeURIComponent(q)}`, { cookie: s.staff });
    assert.deepEqual(staff.data.checklists.map((c) => c.id), [first], `staff search ${q}`);
    const admin = await call('GET', `/api/admin/invoices?q=${encodeURIComponent(q)}`, { cookie: s.admin });
    assert.deepEqual(admin.data.invoices.map((c) => c.id), [first], `admin search ${q}`);
  }

  const second = await draft('été-7', 'Another Shop');
  const duplicate = await call('POST', `/api/admin/invoices/${second}/publish`, { cookie: s.admin });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error, 'Invoice number été-7 is already in use');

  for (const id of [first, second]) {
    assert.equal((await call('DELETE', `/api/admin/invoices/${id}`, { cookie: s.admin })).status, 204);
  }
  assert.deepEqual(listDir(INVOICE_DIR), []);
});

// ---------- accounts and sessions ----------

test('an inactive user cannot sign in and loses existing sessions', async () => {
  const self = await call('PATCH', `/api/admin/users/${s.adminUser.id}`, { cookie: s.admin, json: { active: false } });
  assert.equal(self.status, 422);

  assert.equal((await call('GET', '/api/auth/me', { cookie: s.ravi })).status, 200);
  const off = await call('PATCH', `/api/admin/users/${s.raviUser.id}`, { cookie: s.admin, json: { active: false } });
  assert.equal(off.status, 200);
  assert.equal(off.data.user.active, false);
  assert.equal((await call('GET', '/api/auth/me', { cookie: s.ravi })).status, 401);

  const attempt = await login('ravi', 'picker-pass-3', 'staff');
  assert.equal(attempt.status, 401);
  assert.equal(attempt.data.error, 'Incorrect username or password');
  assert.equal(attempt.cookie, null);

  assert.equal((await call('PATCH', `/api/admin/users/${s.raviUser.id}`, { cookie: s.admin, json: { active: true } })).status, 200);
  assert.equal((await login('ravi', 'picker-pass-3', 'staff')).status, 200);
});

test('logging out invalidates the session', async () => {
  const out = await call('POST', '/api/auth/logout', { cookie: s.staff });
  assert.equal(out.status, 204);
  const cleared = out.headers.getSetCookie().find((c) => c.startsWith('tally_sid='));
  assert.ok(cleared, 'clears the cookie');
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await call('GET', '/api/auth/me', { cookie: s.staff })).status, 401);
  assert.equal((await call('GET', '/api/staff/checklists/mine', { cookie: s.staff })).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { cookie: s.admin })).status, 200, 'other sessions are untouched');
});

test('changing your password checks the current one and signs out your other sessions', async () => {
  const short = await call('POST', '/api/auth/password', { cookie: s.admin, json: { current_password: 'admin123', new_password: 'short' } });
  assert.equal(short.status, 400);
  const wrong = await call('POST', '/api/auth/password', { cookie: s.admin, json: { current_password: 'not-it-at-all', new_password: 'a-better-password' } });
  assert.equal(wrong.status, 400);

  const otherDevice = await login('admin', 'admin123', 'admin');
  assert.equal(otherDevice.status, 200);
  const ok = await call('POST', '/api/auth/password', { cookie: s.admin, json: { current_password: 'admin123', new_password: 'a-better-password' } });
  assert.equal(ok.status, 204);
  assert.equal((await call('GET', '/api/auth/me', { cookie: s.admin })).status, 200, 'this session stays signed in');
  assert.equal((await call('GET', '/api/auth/me', { cookie: otherDevice.cookie })).status, 401);
  assert.equal((await login('admin', 'admin123', 'admin')).status, 401);
  assert.equal((await login('admin', 'a-better-password', 'admin')).status, 200);
});

test('repeated failed sign-ins for one username are rate limited with 429', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await login('rate-limit-probe', `wrong-pass-${i}`, 'staff')).status, 401);
  }
  const blocked = await login('rate-limit-probe', 'wrong-pass-again', 'staff');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error, 'Too many failed sign-in attempts. Try again in 15 minutes.');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

/** POST from one fixed client address (localhost can resolve to ::1 or 127.0.0.1, which the limiter keys apart). */
function postFromIpv4(url, json, cookie) {
  const headers = { 'content-type': 'application/json', 'X-Requested-With': 'fetch' };
  if (cookie) headers.cookie = cookie;
  return fetch(base.replace('localhost', '127.0.0.1') + url, { method: 'POST', headers, body: JSON.stringify(json) })
    .then(async (res) => ({ status: res.status, body: await res.text() }));
}

test('a burst of concurrent sign-in guesses cannot get past the attempt limit', async () => {
  const created = await call('POST', '/api/admin/users', {
    cookie: s.admin, json: { username: 'burst-target', display_name: 'Burst', password: 'burst-pass-ok', role: 'staff' },
  });
  assert.equal(created.status, 201);
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (
    postFromIpv4('/api/auth/login', { username: 'burst-target', password: `wrong-guess-${i}`, role: 'staff' })
  )));
  const count = (status) => results.filter((r) => r.status === status).length;
  assert.equal(count(401) + count(429), 30);
  assert.ok(count(401) <= 10, `only 10 guesses may be checked, got ${count(401)}`);
  const right = await postFromIpv4('/api/auth/login', { username: 'burst-target', password: 'burst-pass-ok', role: 'staff' });
  assert.equal(right.status, 429, 'even the right password is refused while locked out');
});

test('wrong current passwords on POST /api/auth/password are rate limited too', async () => {
  const created = await call('POST', '/api/admin/users', {
    cookie: s.admin, json: { username: 'guess-target', display_name: 'Guess', password: 'guess-pass-ok', role: 'staff' },
  });
  assert.equal(created.status, 201);
  const session = await login('guess-target', 'guess-pass-ok', 'staff');
  assert.equal(session.status, 200);
  const guesses = await Promise.all(Array.from({ length: 12 }, (_, i) => (
    postFromIpv4('/api/auth/password', { current_password: `wrong-${i}`, new_password: 'brand-new-pass' }, session.cookie)
  )));
  const wrong = guesses.filter((r) => r.status === 400).length;
  const limited = guesses.filter((r) => r.status === 429).length;
  assert.equal(wrong + limited, 12);
  assert.ok(wrong <= 10 && limited >= 2, `400s: ${wrong}, 429s: ${limited}`);
  const right = await postFromIpv4('/api/auth/password', { current_password: 'guess-pass-ok', new_password: 'brand-new-pass' }, session.cookie);
  assert.equal(right.status, 429);
  assert.match(JSON.parse(right.body).error, /Too many wrong current passwords/);
  assert.equal((await login('guess-target', 'guess-pass-ok', 'staff')).status, 200, 'the password was not changed');
});

test('signing out, a password change or an admin reset ends the live event streams of the revoked sessions', async () => {
  const password = 'a-better-password';
  const signedOut = await login('admin', password, 'admin');
  const otherDevice = await login('admin', password, 'admin');
  assert.equal(signedOut.status, 200);
  assert.equal(otherDevice.status, 200);
  const signedOutStream = await openEvents(signedOut.cookie);
  const otherStream = await openEvents(otherDevice.cookie);
  const currentStream = await openEvents(s.admin);
  for (const stream of [signedOutStream, otherStream, currentStream]) await stream.next('hello');

  assert.equal((await call('POST', '/api/auth/logout', { cookie: signedOut.cookie })).status, 204);
  assert.equal(await signedOutStream.ended(), true, 'the signed-out session stops receiving events');
  assert.equal(await otherStream.ended(300), false, 'other sessions keep their streams');

  const changed = await call('POST', '/api/auth/password', { cookie: s.admin, json: { current_password: password, new_password: 'the-third-password' } });
  assert.equal(changed.status, 204);
  assert.equal(await otherStream.ended(), true, 'other devices are signed out of their streams too');
  assert.equal(await currentStream.ended(300), false, 'the session that changed the password keeps its stream');

  // Staff password reset by an admin ends that person's streams everywhere.
  const ravi = await login('ravi', 'picker-pass-3', 'staff');
  assert.equal(ravi.status, 200);
  const raviStream = await openEvents(ravi.cookie);
  await raviStream.next('hello');
  const reset = await call('PATCH', `/api/admin/users/${s.raviUser.id}`, { cookie: s.admin, json: { password: 'picker-pass-4' } });
  assert.equal(reset.status, 200);
  assert.equal(await raviStream.ended(), true);
  assert.equal((await call('GET', '/api/auth/me', { cookie: ravi.cookie })).status, 401);

  for (const stream of [signedOutStream, otherStream, currentStream, raviStream]) stream.close();
});

test('an admin cannot change their own password through the users endpoint (it skips the current-password check)', async () => {
  const self = await call('PATCH', `/api/admin/users/${s.adminUser.id}`, { cookie: s.admin, json: { password: 'no-current-check' } });
  assert.equal(self.status, 422);
  assert.equal(self.data.error, 'Use Change password to change your own password');
  assert.equal((await login('admin', 'no-current-check', 'admin')).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { cookie: s.admin })).status, 200);
  const rename = await call('PATCH', `/api/admin/users/${s.adminUser.id}`, { cookie: s.admin, json: { display_name: 'Admin' } });
  assert.equal(rename.status, 200, 'other self edits still work');
});

test('out-of-range numeric settings fall back to safe values', async () => {
  const config = await import('../server/config.js');
  const keys = ['MAX_PHOTOS_PER_UPLOAD', 'SESSION_TTL_HOURS', 'MAX_PHOTO_MB'];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const load = (env) => {
      for (const key of keys) delete process.env[key];
      Object.assign(process.env, env);
      return config.loadConfig({ dataDir: DATA_DIR, port: 0 });
    };
    let c = load({ MAX_PHOTOS_PER_UPLOAD: '0.5', SESSION_TTL_HOURS: '100000000', MAX_PHOTO_MB: '-3' });
    assert.equal(c.MAX_PHOTOS_PER_UPLOAD, 10, 'a fraction that floors to 0 is rejected');
    assert.equal(c.SESSION_TTL_HOURS, 168, 'a TTL past year 9999 is rejected');
    assert.equal(c.MAX_PHOTO_MB, 15);
    c = load({ SESSION_TTL_HOURS: '1e10', MAX_PHOTOS_PER_UPLOAD: '3.7' });
    assert.equal(c.SESSION_TTL_HOURS, 168);
    assert.equal(c.MAX_PHOTOS_PER_UPLOAD, 3);
    c = load({ SESSION_TTL_HOURS: String(24 * 365 * 10) });
    assert.equal(c.SESSION_TTL_HOURS, 87600, 'ten years is still allowed');
  } finally {
    for (const key of keys) delete process.env[key];
    config.loadConfig({ dataDir: DATA_DIR, port: 0 });
    console.warn = originalWarn;
  }
});
