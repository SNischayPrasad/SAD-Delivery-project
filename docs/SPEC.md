# Tally — build contract

Tally turns an uploaded invoice into a picking checklist. **Admins** upload invoices, review the
extracted lines, and publish a checklist. **Staff** find a checklist by invoice number or customer
name, tick items as collected, photograph the collected goods, and submit. Admins are notified
live, compare the photos against the checklist, then **approve** or **return** it to staff.

This file is the single source of truth for every part of the build. If two parts disagree, this
file wins. Do not invent endpoints, fields, statuses, or class names that are not listed here
without also documenting them here.

---

## 1. Stack and constraints

- Node.js 24, ESM (`"type": "module"`). No TypeScript, no bundler, no frontend framework.
- Express 5, `multer` 2 (uploads), `bcryptjs` (password hashing), built-in `node:sqlite`
  (`DatabaseSync`) — no native DB modules.
- Invoice reading: `pdf-parse` 2 (PDF text layer), `tesseract.js` 7 (OCR for images / scanned
  PDFs), `@anthropic-ai/sdk` + `zod` (optional AI extraction when credentials exist).
- Dev only: `pdfkit` (generates sample invoices for tests).
- Frontend: static HTML + vanilla JS ES modules + one CSS file, served by Express from `public/`.
  Google Fonts via `<link>` is allowed (with system fallbacks). No other CDNs.
- Must run on Windows, macOS and Linux: always build paths with `node:path`, never hardcode `/`.
- Start: `npm start` → `http://localhost:3000` (env `PORT`).

## 2. File layout

```
server/
  index.js            app bootstrap: express, static, routers, error handler, first-run admin seed
  config.js           reads env; exports { PORT, DATA_DIR, DB_PATH, UPLOAD_DIR, INVOICE_DIR, PHOTO_DIR,
                      SESSION_TTL_HOURS, MAX_INVOICE_MB, MAX_PHOTO_MB, MAX_PHOTOS_PER_UPLOAD,
                      ADMIN_USERNAME, ADMIN_PASSWORD, EXTRACTOR, CLAUDE_MODEL }
  db.js               opens SQLite, runs schema (idempotent), exports `db` + small helpers
  auth.js             sessions, password hashing, middleware: requireAuth, requireRole(...roles), csrfGuard
  notify.js           notifications table writes + SSE fan-out
  serializers.js      row → API JSON shape functions (section 5)
  uploads.js          multer instances + magic-byte validation helpers
  routes/
    auth.js           /api/auth/*
    admin-invoices.js /api/admin/invoices/*
    admin-users.js    /api/admin/users/*
    staff.js          /api/staff/*
    notifications.js  /api/notifications/*
    files.js          /api/photos/:id, /api/admin/invoices/:id/file
    config.js         /api/config
  extract/
    index.js          extractInvoice() — chooses strategy, never throws
    claude.js         Claude API extraction (structured output)
    pdf-text.js       PDF text layer via pdf-parse
    ocr.js            tesseract.js OCR
    heuristics.js     text → { invoice_number, customer_name, invoice_date, items }
public/
  index.html          landing: two doors — "Admin sign-in" and "Staff sign-in"
  login.html          sign-in form; role from query string ?role=admin|staff
  assets/
    tally.css         design tokens + all shared component classes (section 8)
    api.js            fetch wrapper + SSE helper
    ui.js             shared DOM helpers (toast, modal, lightbox, stamp, formatters, bell)
    STYLEGUIDE.md     documents every class/helper in tally.css / ui.js for page authors
  admin/index.html, admin/admin.js
  staff/index.html, staff/staff.js
scripts/make-sample-invoices.js   writes sample PDFs + PNG into tests/fixtures/
tests/
  heuristics.test.js  unit tests for text parsing
  extract.test.js     extractInvoice() against fixtures (local strategies only)
  e2e.test.js         full API flow against a real server on a temp DATA_DIR
  fixtures/
data/                 runtime only (gitignored): tally.db, uploads/invoices, uploads/photos
```

## 3. Configuration (env, all optional)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `<repo>/data` | DB + uploads root (tests point this at a temp dir) |
| `SESSION_TTL_HOURS` | `168` | session lifetime (sliding not required) |
| `MAX_INVOICE_MB` | `20` | invoice upload limit |
| `MAX_PHOTO_MB` | `15` | per-photo limit |
| `MAX_PHOTOS_PER_UPLOAD` | `10` | files per photo upload request |
| `ADMIN_USERNAME` | `admin` | first-run admin username |
| `ADMIN_PASSWORD` | `admin123` | first-run admin password (log a loud warning when default is used) |
| `EXTRACTOR` | `auto` | `auto` = Claude if credentials exist else local; `local` = never call Claude; `claude` = Claude, fall back to local on failure |
| `CLAUDE_MODEL` | `claude-opus-5` | model for AI extraction |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | — | presence enables Claude extraction in `auto` |

Numeric settings must be greater than 0 (`PORT` may be 0) and at most: `PORT` 65535,
`SESSION_TTL_HOURS` 87600 (10 years; session expiry must stay an ISO date before year 10000),
`MAX_INVOICE_MB` / `MAX_PHOTO_MB` 1024, `MAX_PHOTOS_PER_UPLOAD` 100. `PORT` and
`MAX_PHOTOS_PER_UPLOAD` are floored to integers *before* this check (so `0.5` is rejected, not
turned into 0). Anything else is ignored with a startup warning and the default is used.

First run: if the `users` table has no admin, create one from `ADMIN_USERNAME`/`ADMIN_PASSWORD`.

## 4. Database schema (SQLite, `PRAGMA foreign_keys = ON`, WAL)

All timestamps are ISO-8601 UTC strings (`new Date().toISOString()`).

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,              -- 32 random bytes, hex
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  invoice_number TEXT COLLATE NOCASE,  -- NULL allowed only while status='draft'
  customer_name TEXT,                  -- NULL allowed only while status='draft'
  invoice_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','in_progress','submitted','approved','returned')),
  file_path TEXT NOT NULL,             -- path relative to INVOICE_DIR
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('claude','pdf-text','ocr','none')),
  extraction_warnings TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  raw_text TEXT,
  submit_note TEXT,
  review_note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  submitted_by INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  submitted_at TEXT,
  reviewed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_unique
  ON invoices(invoice_number) WHERE invoice_number IS NOT NULL AND status <> 'draft';
CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  sku TEXT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit TEXT,
  collected INTEGER NOT NULL DEFAULT 0,
  note TEXT,                            -- staff note, e.g. "only 3 in stock"
  review_status TEXT CHECK (review_status IN ('ok','issue')),  -- admin cross-check mark
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,              -- relative to PHOTO_DIR
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_events (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                   -- see section 6
  user_id INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- recipient
  type TEXT NOT NULL CHECK (type IN ('submitted','approved','returned')),
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
```

Invoice files and photos are stored on disk under `DATA_DIR/uploads/...` with random filenames
(`crypto.randomUUID()` + a safe extension derived from the validated type, never from user input).
Deleting an invoice deletes its files from disk too.

## 5. API shapes

All API responses are JSON. Errors: `{ "error": "Human readable message" }` with an appropriate
status (400 invalid input, 401 not signed in, 403 wrong role / not allowed in this status,
404 not found, 409 conflict, 413 too large, 415 unsupported file type, 422 business-rule failure,
429 too many attempts). A URL with a malformed percent-escape in a route parameter (e.g.
`/api/admin/invoices/%ZZ`) is invalid input → 400, never 500.

**CSRF guard:** every non-GET `/api` request must carry header `X-Requested-With: fetch`, else 403.
Session cookie: `tally_sid`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when
`req.secure`. `api.js` always sends the header and `credentials: 'same-origin'`.

### Object shapes

```jsonc
// User
{ "id": 1, "username": "admin", "display_name": "Admin", "role": "admin", "active": true, "created_at": "..." }

// InvoiceSummary
{ "id": 7, "invoice_number": "INV-1042", "customer_name": "Harbor Cafe", "invoice_date": "2026-09-01",
  "status": "submitted", "items_total": 12, "items_collected": 11, "photos_count": 2,
  "review_note": null,                            // the current review's note (set by approve/return)
  "created_at": "...", "updated_at": "...", "published_at": "...", "submitted_at": "...",
  "submitted_by_name": "Priya", "reviewed_at": null, "reviewed_by_name": null }
// reviewed_at / reviewed_by_name / review_note describe the current review only: they are null while
// submitted (a resubmission clears the previous return; its note stays in the `returned` event).

// InvoiceDetail = InvoiceSummary + :
{ "original_filename": "inv-1042.pdf", "mime_type": "application/pdf",
  "extraction_method": "pdf-text", "extraction_warnings": ["..."],
  "submit_note": "...", "review_note": "...",
  "file_url": "/api/admin/invoices/7/file",      // present in admin responses only
  "raw_text": "INVOICE\nInvoice No: ...",         // admin responses only; extracted text or null, ≤ 500,000 chars
  "items": [Item], "photos": [Photo], "events": [Event] }   // events: admin responses only

// Item
{ "id": 31, "position": 1, "description": "Oat milk 1L", "sku": "OM-1L", "quantity": 6, "unit": "carton",
  "collected": true, "note": null, "review_status": null, "updated_by_name": "Priya", "updated_at": "..." }

// Photo
{ "id": 4, "url": "/api/photos/4", "original_filename": "IMG_2231.jpg", "mime_type": "image/jpeg",
  "uploaded_by": 2, "uploaded_by_name": "Priya", "uploaded_at": "..." }   // uploaded_by = user id

// Event
{ "id": 90, "type": "submitted", "note": "Two cartons short", "user_name": "Priya", "created_at": "..." }

// Notification
{ "id": 3, "type": "submitted", "message": "Priya submitted INV-1042 (Harbor Cafe) for review",
  "invoice_id": 7, "read": false, "created_at": "..." }
```

`quantity` is a number; render integers without decimals.

### Auth — `/api/auth`

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/login` | `{ username, password, role }` | 200 `{ user }` + cookie. 401 `Incorrect username or password` for bad creds or inactive user. If creds are valid but `user.role !== role`: 403 `This account is not a <role> account. Use the <user.role> sign-in.` Login attempts are rate-limited in memory: 10 failures per username+IP per 15 min → 429 `Too many failed sign-in attempts. Try again in 15 minutes.` with `Retry-After`. An attempt is reserved *before* the password check, so attempts still being checked count too: a concurrent burst gets at most 10 checks, and while limited even the right password gets 429. A success removes only its own reservation. `::ffff:1.2.3.4` and `1.2.3.4` are the same IP. |
| POST | `/logout` | — | 204, deletes session (ending its SSE streams), clears cookie |
| GET | `/me` | — | 200 `{ user }` or 401 |
| POST | `/password` | `{ current_password, new_password }` | 204. new_password 8–200 chars else 400; wrong current → 400 `Current password is incorrect`. Wrong current passwords are rate-limited like login (10 per user+IP per 15 min, in-flight attempts count) → 429 `Too many wrong current passwords. Try again in 15 minutes.` On success deletes the user's other sessions and ends their SSE streams; the current session stays. |

### Config — `/api/config` (any signed-in user)

| Method | Path | Result |
|---|---|---|
| GET | `/api/config` | 200 `{ "max_invoice_mb": 20, "max_photo_mb": 15, "max_photos_per_upload": 10 }` from `MAX_INVOICE_MB`, `MAX_PHOTO_MB`, `MAX_PHOTOS_PER_UPLOAD`; 401 when not signed in. The admin and staff apps read it once after sign-in and check files against it before uploading; if the call fails they fall back to 20 / 15 / 10. |

### Admin invoices — `/api/admin/invoices` (role `admin`)

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/` | multipart field `file` (PDF, JPEG, PNG, WEBP) | 201 `{ invoice: InvoiceDetail }`, status `draft`, items from `extractInvoice()`. Extraction runs inline before responding. Items with quantity ≤ 0 or empty description are dropped by the server. `raw_text` is truncated to 500,000 characters before it is stored. |
| GET | `/` | query `status` (optional, one of the statuses or `active` = open+in_progress+returned), `q` (optional search over number/customer, same matching as staff search) | 200 `{ invoices: [InvoiceSummary] }`. Order: `submitted` first (oldest submitted_at first), then others by `updated_at` desc. |
| GET | `/counts` | — | 200 `{ draft, open, in_progress, submitted, approved, returned }` |
| GET | `/:id` | — | 200 `{ invoice: InvoiceDetail }` (with events, newest first) |
| PUT | `/:id` | `{ invoice_number, customer_name, invoice_date, items: [{ id?, description, sku, quantity, unit }] }` | 200 `{ invoice }`. Allowed when status ∈ draft/open/in_progress/returned, else 403. Items listed with an existing `id` keep `collected`/`note`; items without `id` are new; existing items not listed are deleted. Positions follow array order. Validation: description non-empty (≤ 300 chars), quantity > 0. For non-draft, invoice_number and customer_name required. 409 `Invoice number INV-1 is already in use` on duplicate among non-draft invoices. Duplicates are compared case-insensitively for every script (`ÉTÉ-7` = `été-7`, see Staff search), not only by the ASCII `COLLATE NOCASE` index. Logs event `edited`. |
| POST | `/:id/publish` | — | 200 `{ invoice }`. Only from `draft` (else 403). Requires invoice_number, customer_name, ≥ 1 item (else 422 with specific message). 409 on duplicate number. Sets `published_at`, status `open`, event `published`. |
| POST | `/:id/reextract` | — | 200 `{ invoice }`. Only in `draft`. Re-runs extraction on the stored file, replaces header fields and items. |
| POST | `/:id/approve` | `{ note?, item_reviews?: [{ item_id, review_status: 'ok'|'issue'|null }] }` | 200 `{ invoice }`. Only from `submitted` (else 403). Status `approved`, sets reviewed_by/at, review_note, applies item_reviews, event `approved`, notifies the submitter (`approved`). |
| POST | `/:id/return` | `{ note, item_reviews? }` | 200 `{ invoice }`. Only from `submitted`. `note` required (400 if blank). Status `returned`, event `returned`, notifies submitter (`returned`). |
| DELETE | `/:id` | — | 204. Any status. Removes files from disk. |

### Admin users — `/api/admin/users` (role `admin`)

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/` | — | 200 `{ users: [User] }` |
| POST | `/` | `{ username, display_name, password, role }` | 201 `{ user }`. username 3–40 chars `[A-Za-z0-9._-]`; password ≥ 8; role admin/staff; 409 on duplicate username. |
| PATCH | `/:id` | `{ display_name?, password?, active?, role? }` | 200 `{ user }`. An admin cannot deactivate or demote themselves (422), and cannot set their own password here (422 `Use Change password to change your own password`; `POST /api/auth/password` checks the current one). Deactivating a user or resetting their password deletes all their sessions and ends their SSE streams; a role change ends their SSE streams. |

### Staff — `/api/staff` (role `staff` **or** `admin`)

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/checklists/search` | query `q` (required, trimmed, ≥ 1 char, else 400) | 200 `{ checklists: [InvoiceSummary] }`. Non-draft invoices whose invoice_number or customer_name contains `q` (case-insensitive; escape `%` `_` in LIKE). Case folding is Unicode-aware, not just ASCII: both the column and `q` go through the SQL function `tally_fold(x)` = `x.normalize('NFKC').toLowerCase()`, registered by `db.js` on its connection, so `émile` finds `Émile`. Exact invoice_number match (after folding) first, then `updated_at` desc. Limit 50. |
| GET | `/checklists/mine` | — | 200 `{ checklists: [InvoiceSummary] }`. Non-draft invoices where the current user has at least one event, status ∈ in_progress/returned/submitted, `returned` first then updated_at desc. Limit 30. |
| GET | `/checklists/:id` | — | 200 `{ checklist: InvoiceDetail }` (no `file_url`, no `events`, no `raw_text`). Drafts → 404. |
| PATCH | `/checklists/:id/items/:itemId` | `{ collected?: boolean, note?: string|null }` | 200 `{ item, checklist: InvoiceSummary }`. Editable only when status ∈ open/in_progress/returned (else 403 `This checklist is locked while it is <status>`). `open` → `in_progress` on first change. Sets updated_by/at. Events `item_checked` / `item_unchecked` (note-only changes log no event). note ≤ 500 chars. |
| POST | `/checklists/:id/photos` | multipart field `photos` (1–`MAX_PHOTOS_PER_UPLOAD` images: JPEG/PNG/WEBP/HEIC) | 201 `{ photos: [Photo], checklist: InvoiceSummary }`. Same editable-status rule. `open` → `in_progress`. Event `photo_added` (one per request, note = count). All-or-nothing: if any file is rejected (415) or fails to be stored, no photo row is written and every file of the request is removed from disk. |
| DELETE | `/checklists/:id/photos/:photoId` | — | 204. Editable status only; staff may delete only photos they uploaded (admin any). Event `photo_removed`. |
| POST | `/checklists/:id/submit` | `{ note? }` | 200 `{ checklist: InvoiceDetail }`. Editable status only. ≥ 1 photo required → else 422 `Add at least one photo of the collected items before submitting`. If any item uncollected, `note` is required → else 422 `Add a note explaining the items that were not collected`. Status `submitted`, sets submitted_by/at, submit_note, clears previous item review_status and the previous review (reviewed_by, reviewed_at, review_note → null), event `submitted`, notifies **every active admin** (`submitted`). |

HEIC photos are stored and served as-is (browsers other than Safari may not render them; the UI
shows a file tile fallback when an `<img>` fails to load).

### Notifications — `/api/notifications` (any signed-in user)

| Method | Path | Result |
|---|---|---|
| GET | `/` | 200 `{ unread: n, notifications: [Notification] }` newest first, limit 50 |
| POST | `/:id/read` | 204 (own notifications only; others 404) |
| POST | `/read-all` | 204 |
| GET | `/stream` | Server-Sent Events. Headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. On connect send `event: hello\ndata: {"unread":n}\n\n`. Each new notification for this user: `event: notification\ndata: <Notification JSON>\n\n`. Heartbeat `: ping\n\n` every 25 s. Clean up on `close`. A stream belongs to the session that opened it: the server ends it when that session is deleted (logout, password change on another device, admin password reset, deactivation), and re-checks before every event and on every heartbeat that the session still exists, has not expired, the user is active and the role is unchanged — otherwise the stream is ended without sending. |

Also broadcast `event: invoice\ndata: {"id":7,"status":"submitted"}\n\n` to all connected **admins**
whenever any invoice status changes (so the admin queue refreshes live), and to connected staff
for invoices they have events on.

### Files

| Method | Path | Who | Result |
|---|---|---|---|
| GET | `/api/photos/:id` | admin, staff | photo bytes with stored mime type, `Cache-Control: private, max-age=3600`, `X-Content-Type-Options: nosniff` |
| GET | `/api/admin/invoices/:id/file` | admin | original invoice bytes, `Content-Disposition: inline; filename="<sanitized original>"` |

Files are never served from `public/`. Resolve stored relative paths against their base dir and
reject anything that escapes it.

### Pages & redirects

- `GET /` → `public/index.html` (two doors).
- `GET /login.html?role=admin|staff` → sign-in form.
- `GET /admin/` and `GET /staff/` are static; their JS calls `/api/auth/me` and redirects to
  `/login.html?role=<role>&next=<path>` on 401, or to the correct app on role mismatch
  (a staff user on `/admin/` → `/staff/`; an admin may use `/staff/` too).
- After login: `next` (only if it is a same-origin path starting with `/admin/` or `/staff/`), else
  `/admin/` for admins, `/staff/` for staff.

## 6. Status machine and events

```
draft ──publish──▶ open ──first tick/photo──▶ in_progress ──submit──▶ submitted ──approve──▶ approved
                     └──────────────submit (with photo)──────────────▲      │
                                                                      │   return
                                                returned ◀────────────┘──────┘
                                                returned ──submit──▶ submitted
```

Event types: `created`, `edited`, `published`, `reextracted`, `item_checked`, `item_unchecked`,
`photo_added`, `photo_removed`, `submitted`, `approved`, `returned`.

## 7. Invoice extraction contract (`server/extract/index.js`)

```js
export async function extractInvoice({ filePath, mimeType, originalName }) → {
  invoice_number: string | null,
  customer_name: string | null,
  invoice_date: string | null,          // 'YYYY-MM-DD' when confidently parsed, else null
  items: [{ description: string, sku: string | null, quantity: number, unit: string | null }],
  method: 'claude' | 'pdf-text' | 'ocr' | 'none',
  warnings: string[],                   // human-readable, shown to the admin in the review screen
  raw_text: string | null
}
```

- **Never throws.** Unreadable input → `method: 'none'`, `items: []`, warning explaining why and
  telling the admin to add lines manually.
- Strategy (`EXTRACTOR=auto`): Claude when credentials exist; on any Claude error or refusal, fall
  back to local and add a warning (`AI extraction failed (...); used local text reading instead`).
- Local: PDF → pdf-parse text, read in a short-lived child process (`extract/pdf-child.js`, heap cap
  and timeout, so a hostile PDF cannot take down the server). If the text layer yields no line items
  (scanned PDF, or a scan with a watermark text layer), the first 5 pages are rendered and OCR'd and
  the better result is kept (warning when pages were skipped). Images → EXIF-orientation fix and
  pixel-budget downscale (`extract/image.js`, `@napi-rs/canvas`), then tesseract.js OCR (`eng`,
  shared worker, per-job timeout that replaces a stuck worker), then heuristics.
- Claude: send PDFs as a base64 `document` block and images as a base64 `image` block; ask for JSON
  matching the invoice schema and validate it with zod (`safeParse`); check `stop_reason` for
  `refusal` before trusting output. Model from `CLAUDE_MODEL`.
- Heuristics (`heuristics.js`, pure, synchronous, exported as `parseInvoiceText(text)`):
  - invoice number from labels like `Invoice No`, `Invoice #`, `Invoice Number`, `Inv No`, `Bill No`,
    `Invoice:` (value = next token with at least one digit).
  - customer from `Bill To`, `Billed To`, `Customer`, `Customer Name`, `Sold To`, `Ship To`
    (same line after the label, or the next non-empty line).
  - date from `Invoice Date` / `Date` (formats `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`,
    `DD Mon YYYY`, `Mon DD, YYYY`; ambiguous `xx/xx/yyyy` is treated as DD/MM/YYYY).
  - items: locate the table header row (contains a description-like word — Description, Item,
    Product, Particulars — and a quantity-like word — Qty, Quantity, Units), read subsequent lines
    until a totals row (Subtotal, Total, Tax, GST, VAT, Amount Due, Balance). For each line pull
    quantity (the number in the qty column position; prefer integer-like values; ignore money
    values with 2 decimals when a separate integer exists), optional SKU/code token, and the
    remaining text as description. Handle lines split across two text lines (description on one,
    numbers on next) where practical. Skip lines with no letters.
  - Must also return `{ warnings }` for low-confidence results (e.g. `No item table header found`).

## 8. Visual design system (shared by admin and staff UI)

**Concept:** the stockroom pick list. Carbon-copy invoice paper, navy ballpoint ink, a yellow
highlighter swiped across each line as it is picked, and a rubber stamp when the admin rules.

**Signature elements** (spend boldness here, keep everything else quiet):
1. *Highlighter swipe* — marking an item collected animates a yellow highlighter band across the
   row (left → right, ~280 ms, slightly irregular edge via a skewed pseudo-element). Unticking
   fades it out. Respect `prefers-reduced-motion` (no animation, band just appears).
2. *Rubber stamp* — approved/returned checklists show a rotated, inked stamp (`VERIFIED` in stamp
   green / `RETURNED` in stamp red) with a double border and slightly uneven ink (CSS mask or
   noise via SVG data URI). It thumps in once (scale 1.4 → 1, 180 ms) when the admin rules.

**Tokens** (`:root` in `tally.css`; dark theme redefines them under
`@media (prefers-color-scheme: dark)`):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#EEF2F6` | `#0E1520` | page ground (carbonless copy blue-grey) |
| `--sheet` | `#FBFCFD` | `#162131` | cards / checklist sheet |
| `--ink` | `#14213D` | `#E4EAF3` | primary text |
| `--ink-soft` | `#4A5A75` | `#9DAAC0` | secondary text |
| `--rule` | `#C9D2DD` | `#2A3A50` | hairlines, table rules, inputs |
| `--carbon` | `#2F4B7C` | `#8FB0E8` | links, primary buttons, focus ring |
| `--highlight` | `#FFE45C` | `#FFE45C` (text on it stays `#14213D`) | collected band |
| `--stamp-green` | `#1E7F4F` | `#4CC38A` | approved |
| `--stamp-red` | `#C23B22` | `#FF7A5C` | returned / errors / destructive |
| `--amber` | `#B7791F` | `#F2B84B` | submitted / needs review |

**Type** (Google Fonts):
- Display: **Big Shoulders Display** 700/800 — aisle-signage condensed caps. Used sparingly:
  page titles, invoice numbers in headers, stamp text, big counts.
  Fallback: `"Arial Narrow", "Roboto Condensed", sans-serif`.
- Body: **Public Sans** 400/500/600. Fallback: `system-ui, sans-serif`.
- Data: **IBM Plex Mono** 400/500 — invoice numbers in lists, SKUs, quantities, timestamps.
  Fallback: `ui-monospace, Consolas, monospace`.
- Scale: 12 / 14 / 16 / 20 / 28 / 40 / 56 px. Body 16px on staff (mobile), 14px tables on admin.

**Layout rules:** 4px spacing grid; radius 6px for controls and 10px for sheets (paper, not pills);
checklist rows have a faint left margin rule like ruled paper; min tap target 44px on staff pages;
visible `:focus-visible` ring `2px solid var(--carbon)` offset 2px; no horizontal page scroll at
320px; tables scroll inside their own container.

**Status chips** (class `chip chip--<status>`): draft (ink-soft outline), open (carbon outline),
in_progress (carbon filled light), submitted (amber filled — "Needs review"), approved
(stamp-green), returned (stamp-red). Human labels: Draft, Ready to pick, Picking, Needs review,
Verified, Returned.

**Copy voice:** plain verbs, sentence case, specific. Buttons say what happens: "Publish
checklist", "Mark collected", "Add photos", "Submit for review", "Approve", "Return to staff".
Empty states invite the next action.

## 9. Admin UI (`/admin/`) — hash routes

- Shell: left rail (collapses to top bar < 900px) with wordmark "TALLY", nav: **Queue**,
  **Upload invoice**, **Staff accounts**; bottom: notification bell with unread badge, signed-in
  name, "Change password", "Sign out".
- `#/queue` (default): segmented filter tabs with counts — Needs review (submitted), In progress
  (open+in_progress+returned via `status=active`), Drafts, Verified, All; search box (number or
  customer). Rows: invoice number (mono), customer, status chip, progress `11/12` with thin bar,
  photos count, relative time. Click → detail. Live refresh on SSE `invoice` events.
- `#/upload`: drop zone (drag & drop or browse; PDF/JPG/PNG/WEBP) → "Reading invoice…" progress →
  navigate to `#/invoice/:id` (draft editor).
- `#/invoice/:id`, **draft/open/in_progress/returned** → editor: header fields (invoice number,
  customer, date), extraction method + warnings banner, "View original" link (new tab), editable
  line table (description, SKU, qty, unit, delete row; "Add line"; keyboard-friendly), buttons
  "Save changes", "Re-read invoice" (draft only), "Publish checklist" (draft only), "Delete".
  Non-draft editors also show staff progress (collected ticks read-only) and photos so far.
- `#/invoice/:id`, **submitted** → review: two panes. Left: photo viewer (large image, thumbnail
  strip, click to open full-screen lightbox with zoom/pan and arrow-key navigation). Right: the
  checklist with staff ticks (highlighter bands) + staff notes, a per-item OK / Issue toggle for
  cross-checking, submit note from staff, summary "11 of 12 collected". Actions: "Approve"
  (optional note) and "Return to staff" (required note). Outcome plays the stamp.
- `#/invoice/:id`, **approved** → read-only record with VERIFIED stamp, photos, checklist, review
  note, event timeline.
- `#/staff`: users table (name, username, role, active toggle), "Add staff account" form
  (display name, username, password, role default staff), reset password per user.
- Notifications: bell dropdown listing notifications (click → marks read, navigates to invoice).
  New `notification` SSE event → toast "Priya submitted INV-1042 for review" with "Review" action,
  badge increment, document title prefix `(n)`, and a browser `Notification` if permission was
  granted (ask via a small "Enable desktop alerts" button in the dropdown, never on load).

## 10. Staff UI (`/staff/`) — mobile-first, hash routes

- Top bar: wordmark, bell (notifications about approved/returned), name, "Sign out".
- `#/` home: large search field "Invoice number or customer name" (search on submit and debounced
  300 ms while typing); results as ticket cards (invoice number big mono, customer, status chip,
  progress). Below: "Your checklists" from `/checklists/mine` — returned ones first with the admin's
  note preview. Empty states: "Search for a checklist to start picking."
- `#/checklist/:id`: sticky header with invoice number (display font), customer, progress
  `7 of 12 collected` + bar. If returned: red banner with admin's review note, and items the admin
  marked `issue` get a red left marker. Item rows: whole row is a button toggling collected
  (optimistic update, revert + toast on failure), qty right-aligned mono `× 6 carton`, SKU small
  mono; a small "Add note" link expands an inline note field saved on blur. Collected rows show
  the highlighter band.
  Photos section: "Take or add photos" button (`<input type="file" accept="image/*" multiple
  capture="environment">` plus a separate non-capture input for choosing from gallery), upload
  progress, thumbnail grid with remove (×) on own photos, tap → lightbox.
  Sticky bottom bar: "Submit for review" — disabled with hint "Add a photo to submit" when no
  photos; if items uncollected, opens a sheet asking for a note ("Which items weren't collected and
  why?") before submitting. After submit: confirmation state "Sent to admin for review", checklist
  becomes read-only with chip "Needs review". Locked states (submitted/approved) are read-only.

## 11. Security checklist

- bcrypt cost 10; constant-ish failure path for unknown users (still run a compare against a dummy hash).
- Sessions: random 32-byte token; expired sessions rejected and purged on startup. Deleting a
  session also ends the SSE streams it opened.
- Password checks (login and "current password") are rate-limited per subject + IP, with the attempt
  reserved before the asynchronous bcrypt compare so concurrent requests cannot exceed the limit.
- Every route enforces role server-side; never trust the UI.
- Upload validation by magic bytes (PDF `%PDF`, JPEG `FF D8 FF`, PNG `89 50 4E 47`, WEBP `RIFF....WEBP`,
  HEIC `ftypheic|ftypheix|ftyphevc|ftypmif1|ftypmsf1` at offset 4), not just the client mime type.
  Rejected files are deleted.
- Path traversal: stored names are server-generated; resolve and verify base dir on read.
- Output escaping on the frontend: build DOM with `textContent` / a tiny `h()` helper — never
  `innerHTML` with user or extracted data.
- `helmet` is not installed; set basic headers manually: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`.
- Multer errors (`LIMIT_FILE_SIZE` → 413, `LIMIT_FILE_COUNT`/`LIMIT_UNEXPECTED_FILE` → 400) are
  mapped to JSON errors by the error handler. Other errors that carry a 4xx status (e.g. Express's
  `URIError` for a bad percent-escape) keep that status with a generic message unless they are marked
  `expose`. Unknown errors → 500 `{ error: "Something went wrong" }` and logged.
- Extracted `raw_text` is capped (500,000 characters) before it is stored or returned.
