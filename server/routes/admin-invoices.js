import fs from 'node:fs';
import { Router } from 'express';
import { INVOICE_DIR, PHOTO_DIR } from '../config.js';
import {
  stmt, nowIso, parseId, invoiceSearchWhere, transaction, logEvent,
} from '../db.js';
import { requireRole } from '../auth.js';
import { notifyUser, broadcastInvoice, invoiceParticipants } from '../notify.js';
import {
  INVOICE_STATUSES, ADMIN_EDITABLE_STATUSES, INVOICE_SELECT,
  invoiceSummaryJson, loadInvoiceDetail, httpError, bodyOf, invoiceLabel,
} from '../serializers.js';
import {
  invoiceUpload, acceptUpload, removeFile, resolveInside, safeOriginalName, INVOICE_KINDS,
} from '../uploads.js';
import { extractInvoice } from '../extract/index.js';

const router = Router();
router.use(requireRole('admin'));

const EXTRACTION_METHODS = ['claude', 'pdf-text', 'ocr', 'none'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// raw_text is stored and returned in every admin InvoiceDetail; a decompression bomb must not bloat either.
export const MAX_RAW_TEXT_CHARS = 500_000;

// ---- helpers ----

function textOrNull(value, max) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Normalizes extractor output defensively (it should never throw, but guard anyway). */
async function runExtraction(filePath, mimeType, originalName) {
  let result;
  try {
    result = await extractInvoice({ filePath, mimeType, originalName });
  } catch (err) {
    console.error('extractInvoice threw:', err);
    result = null;
  }
  if (!result || typeof result !== 'object') {
    return {
      invoice_number: null, customer_name: null, invoice_date: null, items: [], method: 'none',
      warnings: ['The invoice could not be read; add the lines manually'], raw_text: null,
    };
  }
  const items = (Array.isArray(result.items) ? result.items : [])
    .map((it) => ({
      description: textOrNull(it?.description, 300),
      sku: textOrNull(it?.sku, 100),
      quantity: Number(it?.quantity),
      unit: textOrNull(it?.unit, 50),
    }))
    .filter((it) => it.description && Number.isFinite(it.quantity) && it.quantity > 0);
  const date = textOrNull(result.invoice_date, 10);
  return {
    invoice_number: textOrNull(result.invoice_number, 100),
    customer_name: textOrNull(result.customer_name, 200),
    invoice_date: date && isValidDate(date) ? date : null,
    items,
    method: EXTRACTION_METHODS.includes(result.method) ? result.method : 'none',
    warnings: (Array.isArray(result.warnings) ? result.warnings : []).map(String),
    raw_text: typeof result.raw_text === 'string' ? result.raw_text.slice(0, MAX_RAW_TEXT_CHARS) : null,
  };
}

function insertItems(invoiceId, items) {
  const insert = stmt(
    'INSERT INTO checklist_items (invoice_id, position, description, sku, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)',
  );
  items.forEach((it, i) => insert.run(invoiceId, i + 1, it.description, it.sku ?? null, it.quantity, it.unit ?? null));
}

function getInvoice(req) {
  const id = parseId(req.params.id);
  const inv = id && stmt('SELECT id, invoice_number, customer_name, status, file_path, mime_type, original_filename, submitted_by FROM invoices WHERE id = ?').get(id);
  if (!inv) throw httpError(404, 'Invoice not found');
  return inv;
}

/**
 * Invoice numbers are unique among non-draft invoices, ignoring case in any script ('ÉTÉ-7' = 'été-7').
 * The unique index only folds ASCII; this check runs synchronously right before the write, so it cannot race.
 */
function assertNumberFree(number, exceptId) {
  const clash = stmt(
    "SELECT id FROM invoices WHERE tally_fold(invoice_number) = tally_fold(?) AND status <> 'draft' AND id <> ?",
  ).get(number, exceptId);
  if (clash) throw httpError(409, `Invoice number ${number} is already in use`);
}

function isUniqueViolation(err) {
  return /UNIQUE constraint failed/i.test(err?.message ?? '');
}

const detail = (id) => loadInvoiceDetail(id, { admin: true });

// ---- routes ----

router.post('/', invoiceUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Choose an invoice file to upload (PDF, JPEG, PNG or WEBP)' });
  }
  const originalName = safeOriginalName(req.file.originalname, 'invoice');
  const stored = await acceptUpload(req.file, INVOICE_KINDS, INVOICE_DIR);
  if (!stored) {
    return res.status(415).json({ error: 'Unsupported file type. Upload a PDF, JPEG, PNG or WEBP file.' });
  }
  let id;
  try {
    const ex = await runExtraction(stored.absPath, stored.mime, originalName);
    id = transaction(() => {
      const now = nowIso();
      const newId = Number(stmt(`
        INSERT INTO invoices (invoice_number, customer_name, invoice_date, status, file_path, original_filename,
          mime_type, extraction_method, extraction_warnings, raw_text, created_by, created_at, updated_at)
        VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        ex.invoice_number, ex.customer_name, ex.invoice_date, stored.relPath, originalName, stored.mime,
        ex.method, JSON.stringify(ex.warnings), ex.raw_text, req.user.id, now, now,
      ).lastInsertRowid);
      insertItems(newId, ex.items);
      logEvent(newId, 'created', req.user.id);
      return newId;
    });
  } catch (err) {
    await removeFile(stored.absPath);
    throw err;
  }
  res.status(201).json({ invoice: detail(id) });
});

router.get('/', (req, res) => {
  const { status, q } = req.query;
  const where = [];
  const params = [];
  if (typeof status === 'string' && status !== '' && status !== 'all') {
    if (status === 'active') {
      where.push("i.status IN ('open', 'in_progress', 'returned')");
    } else if (INVOICE_STATUSES.includes(status)) {
      where.push('i.status = ?');
      params.push(status);
    } else {
      return res.status(400).json({ error: 'Unknown status filter' });
    }
  } else if (status !== undefined && typeof status !== 'string') {
    return res.status(400).json({ error: 'Unknown status filter' });
  }
  if (typeof q === 'string' && q.trim()) {
    const search = invoiceSearchWhere(q.trim().slice(0, 100));
    where.push(search.sql);
    params.push(...search.params);
  }
  const sql = `${INVOICE_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE WHEN i.status = 'submitted' THEN 0 ELSE 1 END,
      CASE WHEN i.status = 'submitted' THEN i.submitted_at END ASC,
      i.updated_at DESC, i.id DESC`;
  res.json({ invoices: stmt(sql).all(...params).map(invoiceSummaryJson) });
});

router.get('/counts', (req, res) => {
  const counts = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, 0]));
  for (const row of stmt('SELECT status, COUNT(*) AS n FROM invoices GROUP BY status').all()) {
    counts[row.status] = row.n;
  }
  res.json(counts);
});

router.get('/:id', (req, res) => {
  const inv = getInvoice(req);
  res.json({ invoice: detail(inv.id) });
});

router.put('/:id', (req, res) => {
  const inv = getInvoice(req);
  if (!ADMIN_EDITABLE_STATUSES.includes(inv.status)) {
    return res.status(403).json({ error: `This invoice can't be edited while it is ${inv.status}` });
  }
  const b = bodyOf(req);
  const isDraft = inv.status === 'draft';

  const header = {};
  for (const [key, label, max] of [['invoice_number', 'Invoice number', 100], ['customer_name', 'Customer name', 200]]) {
    if (b[key] === undefined) continue;
    if (b[key] !== null && typeof b[key] !== 'string') throw httpError(400, `${label} must be text`);
    const value = typeof b[key] === 'string' ? b[key].trim() : '';
    if (value.length > max) throw httpError(400, `${label} must be ${max} characters or fewer`);
    header[key] = value || null;
  }
  if (b.invoice_date !== undefined) {
    const value = typeof b.invoice_date === 'string' ? b.invoice_date.trim() : b.invoice_date;
    if (value === null || value === '') header.invoice_date = null;
    else if (typeof value === 'string' && isValidDate(value)) header.invoice_date = value;
    else throw httpError(400, 'Invoice date must be a valid date (YYYY-MM-DD)');
  }
  const number = header.invoice_number !== undefined ? header.invoice_number : inv.invoice_number;
  const customer = header.customer_name !== undefined ? header.customer_name : inv.customer_name;
  if (!isDraft && !number) throw httpError(400, 'Invoice number is required');
  if (!isDraft && !customer) throw httpError(400, 'Customer name is required');

  let items = null;
  if (b.items !== undefined) {
    if (!Array.isArray(b.items)) throw httpError(400, 'items must be a list');
    const existingIds = new Set(stmt('SELECT id FROM checklist_items WHERE invoice_id = ?').all(inv.id).map((r) => r.id));
    const seen = new Set();
    items = b.items.map((raw, i) => {
      const line = `Line ${i + 1}`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, `${line} is not valid`);
      let itemId = null;
      if (raw.id !== undefined && raw.id !== null) {
        itemId = Number(raw.id);
        if (!Number.isInteger(itemId) || !existingIds.has(itemId)) {
          throw httpError(400, `${line} does not belong to this invoice`);
        }
        if (seen.has(itemId)) throw httpError(400, `${line} is listed twice`);
        seen.add(itemId);
      }
      const description = typeof raw.description === 'string' ? raw.description.trim() : '';
      if (!description) throw httpError(400, `${line}: description is required`);
      if (description.length > 300) throw httpError(400, `${line}: description must be 300 characters or fewer`);
      const quantity = typeof raw.quantity === 'number'
        ? raw.quantity
        : (typeof raw.quantity === 'string' && raw.quantity.trim() !== '' ? Number(raw.quantity) : NaN);
      if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(400, `${line}: quantity must be greater than 0`);
      for (const [key, label] of [['sku', 'SKU'], ['unit', 'unit']]) {
        if (raw[key] != null && typeof raw[key] !== 'string') throw httpError(400, `${line}: ${label} must be text`);
      }
      const sku = textOrNull(raw.sku, 1000);
      const unit = textOrNull(raw.unit, 1000);
      if (sku && sku.length > 100) throw httpError(400, `${line}: SKU must be 100 characters or fewer`);
      if (unit && unit.length > 50) throw httpError(400, `${line}: unit must be 50 characters or fewer`);
      return { id: itemId, description, sku, quantity, unit };
    });
    if (!isDraft && items.length === 0) {
      return res.status(422).json({ error: 'A published checklist needs at least one item' });
    }
  }

  if (!isDraft) assertNumberFree(number, inv.id);

  try {
    transaction(() => {
      const now = nowIso();
      stmt('UPDATE invoices SET invoice_number = ?, customer_name = ?, invoice_date = ?, updated_at = ? WHERE id = ?').run(
        number,
        customer,
        header.invoice_date !== undefined ? header.invoice_date : stmt('SELECT invoice_date FROM invoices WHERE id = ?').get(inv.id).invoice_date,
        now,
        inv.id,
      );
      if (items) {
        const keep = new Set(items.filter((it) => it.id).map((it) => it.id));
        for (const row of stmt('SELECT id FROM checklist_items WHERE invoice_id = ?').all(inv.id)) {
          if (!keep.has(row.id)) stmt('DELETE FROM checklist_items WHERE id = ?').run(row.id);
        }
        const update = stmt('UPDATE checklist_items SET position = ?, description = ?, sku = ?, quantity = ?, unit = ? WHERE id = ? AND invoice_id = ?');
        const insert = stmt('INSERT INTO checklist_items (invoice_id, position, description, sku, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)');
        items.forEach((it, i) => {
          if (it.id) update.run(i + 1, it.description, it.sku, it.quantity, it.unit, it.id, inv.id);
          else insert.run(inv.id, i + 1, it.description, it.sku, it.quantity, it.unit);
        });
      }
      logEvent(inv.id, 'edited', req.user.id);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw httpError(409, `Invoice number ${number} is already in use`);
    throw err;
  }
  res.json({ invoice: detail(inv.id) });
});

router.post('/:id/publish', (req, res) => {
  const inv = getInvoice(req);
  if (inv.status !== 'draft') return res.status(403).json({ error: 'Only drafts can be published' });
  if (!inv.invoice_number) return res.status(422).json({ error: 'Add the invoice number before publishing' });
  if (!inv.customer_name) return res.status(422).json({ error: 'Add the customer name before publishing' });
  const { n } = stmt('SELECT COUNT(*) AS n FROM checklist_items WHERE invoice_id = ?').get(inv.id);
  if (!n) return res.status(422).json({ error: 'Add at least one item before publishing' });
  assertNumberFree(inv.invoice_number, inv.id);
  try {
    transaction(() => {
      const now = nowIso();
      stmt("UPDATE invoices SET status = 'open', published_at = ?, updated_at = ? WHERE id = ?").run(now, now, inv.id);
      logEvent(inv.id, 'published', req.user.id);
      broadcastInvoice(inv.id, 'open');
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw httpError(409, `Invoice number ${inv.invoice_number} is already in use`);
    throw err;
  }
  res.json({ invoice: detail(inv.id) });
});

router.post('/:id/reextract', async (req, res) => {
  const inv = getInvoice(req);
  if (inv.status !== 'draft') return res.status(403).json({ error: 'Only drafts can be re-read' });
  const abs = resolveInside(INVOICE_DIR, inv.file_path);
  if (!abs || !fs.existsSync(abs)) {
    return res.status(422).json({ error: 'The original invoice file is missing' });
  }
  const ex = await runExtraction(abs, inv.mime_type, inv.original_filename);
  transaction(() => {
    const current = stmt('SELECT status FROM invoices WHERE id = ?').get(inv.id);
    if (!current) throw httpError(404, 'Invoice not found');
    if (current.status !== 'draft') throw httpError(403, 'Only drafts can be re-read');
    stmt(`UPDATE invoices SET invoice_number = ?, customer_name = ?, invoice_date = ?, extraction_method = ?,
      extraction_warnings = ?, raw_text = ?, updated_at = ? WHERE id = ?`).run(
      ex.invoice_number, ex.customer_name, ex.invoice_date, ex.method, JSON.stringify(ex.warnings), ex.raw_text,
      nowIso(), inv.id,
    );
    stmt('DELETE FROM checklist_items WHERE invoice_id = ?').run(inv.id);
    insertItems(inv.id, ex.items);
    logEvent(inv.id, 'reextracted', req.user.id);
  });
  res.json({ invoice: detail(inv.id) });
});

function parseReviewBody(req, inv, { noteRequired }) {
  const b = bodyOf(req);
  if (b.note != null && typeof b.note !== 'string') throw httpError(400, 'note must be text');
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (noteRequired && !note) throw httpError(400, 'Add a note telling staff what to fix');
  if (note.length > 1000) throw httpError(400, 'Note must be 1000 characters or fewer');

  let reviews = [];
  if (b.item_reviews != null) {
    if (!Array.isArray(b.item_reviews)) throw httpError(400, 'item_reviews must be a list');
    const itemIds = new Set(stmt('SELECT id FROM checklist_items WHERE invoice_id = ?').all(inv.id).map((r) => r.id));
    reviews = b.item_reviews.map((r) => {
      const itemId = Number(r?.item_id);
      if (!Number.isInteger(itemId) || !itemIds.has(itemId)) {
        throw httpError(400, 'item_reviews contains an item that is not on this invoice');
      }
      const status = r.review_status ?? null;
      if (status !== null && status !== 'ok' && status !== 'issue') {
        throw httpError(400, "review_status must be 'ok', 'issue' or null");
      }
      return { itemId, status };
    });
  }
  return { note: note || null, reviews };
}

function review(outcome) {
  return (req, res) => {
    const inv = getInvoice(req);
    const verb = outcome === 'approved' ? 'approved' : 'returned';
    if (inv.status !== 'submitted') {
      return res.status(403).json({ error: `Only submitted checklists can be ${verb}` });
    }
    const { note, reviews } = parseReviewBody(req, inv, { noteRequired: outcome === 'returned' });
    transaction(() => {
      const now = nowIso();
      stmt('UPDATE invoices SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?')
        .run(outcome, req.user.id, now, note, now, inv.id);
      const setReview = stmt('UPDATE checklist_items SET review_status = ? WHERE id = ? AND invoice_id = ?');
      for (const r of reviews) setReview.run(r.status, r.itemId, inv.id);
      logEvent(inv.id, outcome, req.user.id, note);
      if (inv.submitted_by) {
        const label = invoiceLabel(inv);
        const message = outcome === 'approved'
          ? `${req.user.display_name} approved ${label}`
          : `${req.user.display_name} returned ${label}: ${note.length > 140 ? `${note.slice(0, 139)}…` : note}`;
        notifyUser(inv.submitted_by, outcome, inv.id, message);
      }
      broadcastInvoice(inv.id, outcome);
    });
    res.json({ invoice: detail(inv.id) });
  };
}

router.post('/:id/approve', review('approved'));
router.post('/:id/return', review('returned'));

router.delete('/:id', async (req, res) => {
  const inv = getInvoice(req);
  const photoPaths = stmt('SELECT file_path FROM photos WHERE invoice_id = ?').all(inv.id).map((r) => r.file_path);
  const participants = invoiceParticipants(inv.id);
  transaction(() => {
    stmt('DELETE FROM invoices WHERE id = ?').run(inv.id);
    broadcastInvoice(inv.id, null, participants);
  });
  const files = [
    resolveInside(INVOICE_DIR, inv.file_path),
    ...photoPaths.map((p) => resolveInside(PHOTO_DIR, p)),
  ].filter(Boolean);
  await Promise.all(files.map(removeFile));
  res.status(204).end();
});

export default router;
