import { stmt } from './db.js';

export const INVOICE_STATUSES = ['draft', 'open', 'in_progress', 'submitted', 'approved', 'returned'];
export const ADMIN_EDITABLE_STATUSES = ['draft', 'open', 'in_progress', 'returned'];
export const STAFF_EDITABLE_STATUSES = ['open', 'in_progress', 'returned'];

// Every invoice column except raw_text (can be large), plus computed summary fields.
export const INVOICE_SELECT = `
  SELECT i.id, i.invoice_number, i.customer_name, i.invoice_date, i.status, i.file_path,
    i.original_filename, i.mime_type, i.extraction_method, i.extraction_warnings,
    i.submit_note, i.review_note, i.created_by, i.submitted_by, i.reviewed_by,
    i.created_at, i.updated_at, i.published_at, i.submitted_at, i.reviewed_at,
    (SELECT COUNT(*) FROM checklist_items c WHERE c.invoice_id = i.id) AS items_total,
    (SELECT COUNT(*) FROM checklist_items c WHERE c.invoice_id = i.id AND c.collected = 1) AS items_collected,
    (SELECT COUNT(*) FROM photos p WHERE p.invoice_id = i.id) AS photos_count,
    su.display_name AS submitted_by_name,
    ru.display_name AS reviewed_by_name
  FROM invoices i
  LEFT JOIN users su ON su.id = i.submitted_by
  LEFT JOIN users ru ON ru.id = i.reviewed_by`;

// ---- request / error helpers ----

/** Error carrying an HTTP status; the app error handler sends { error: message }. */
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/** JSON body as a plain object ({} when missing or not an object). */
export function bodyOf(req) {
  const body = req.body;
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

export function invoiceLabel(inv) {
  return `${inv.invoice_number ?? 'invoice'} (${inv.customer_name ?? 'unknown customer'})`;
}

// ---- row → JSON ----

export function userJson(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    active: Boolean(row.active),
    created_at: row.created_at,
  };
}

export function invoiceSummaryJson(row) {
  return {
    id: row.id,
    invoice_number: row.invoice_number ?? null,
    customer_name: row.customer_name ?? null,
    invoice_date: row.invoice_date ?? null,
    status: row.status,
    items_total: Number(row.items_total ?? 0),
    items_collected: Number(row.items_collected ?? 0),
    photos_count: Number(row.photos_count ?? 0),
    review_note: row.review_note ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    published_at: row.published_at ?? null,
    submitted_at: row.submitted_at ?? null,
    submitted_by_name: row.submitted_by_name ?? null,
    reviewed_at: row.reviewed_at ?? null,
    reviewed_by_name: row.reviewed_by_name ?? null,
  };
}

export function itemJson(row) {
  return {
    id: row.id,
    position: row.position,
    description: row.description,
    sku: row.sku ?? null,
    quantity: Number(row.quantity),
    unit: row.unit ?? null,
    collected: Boolean(row.collected),
    note: row.note ?? null,
    review_status: row.review_status ?? null,
    updated_by_name: row.updated_by_name ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function photoJson(row) {
  return {
    id: row.id,
    url: `/api/photos/${row.id}`,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    uploaded_by: row.uploaded_by,
    uploaded_by_name: row.uploaded_by_name ?? null,
    uploaded_at: row.uploaded_at,
  };
}

export function eventJson(row) {
  return {
    id: row.id,
    type: row.type,
    note: row.note ?? null,
    user_name: row.user_name ?? null,
    created_at: row.created_at,
  };
}

export function notificationJson(row) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    invoice_id: row.invoice_id ?? null,
    read: row.read_at != null,
    created_at: row.created_at,
  };
}

function parseWarnings(text) {
  try {
    const value = JSON.parse(text || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

// ---- loaders ----

export function getInvoiceRow(id) {
  return stmt(`${INVOICE_SELECT} WHERE i.id = ?`).get(id);
}

export function loadItemRows(invoiceId) {
  return stmt(`
    SELECT c.*, u.display_name AS updated_by_name
    FROM checklist_items c LEFT JOIN users u ON u.id = c.updated_by
    WHERE c.invoice_id = ? ORDER BY c.position, c.id`).all(invoiceId);
}

export function loadItem(itemId) {
  const row = stmt(`
    SELECT c.*, u.display_name AS updated_by_name
    FROM checklist_items c LEFT JOIN users u ON u.id = c.updated_by
    WHERE c.id = ?`).get(itemId);
  return row ? itemJson(row) : null;
}

export function loadPhotoRows(invoiceId) {
  return stmt(`
    SELECT p.*, u.display_name AS uploaded_by_name
    FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
    WHERE p.invoice_id = ? ORDER BY p.uploaded_at, p.id`).all(invoiceId);
}

export function loadPhotosByIds(ids) {
  if (!ids.length) return [];
  const rows = stmt(`
    SELECT p.*, u.display_name AS uploaded_by_name
    FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
    WHERE p.id IN (SELECT value FROM json_each(?)) ORDER BY p.id`).all(JSON.stringify(ids));
  return rows.map(photoJson);
}

export function loadEventRows(invoiceId) {
  return stmt(`
    SELECT e.*, u.display_name AS user_name
    FROM invoice_events e LEFT JOIN users u ON u.id = e.user_id
    WHERE e.invoice_id = ? ORDER BY e.created_at DESC, e.id DESC`).all(invoiceId);
}

export function loadInvoiceSummary(id) {
  const row = getInvoiceRow(id);
  return row ? invoiceSummaryJson(row) : null;
}

/** InvoiceDetail. admin=true adds file_url, events and raw_text. */
export function loadInvoiceDetail(id, { admin = false } = {}) {
  const row = getInvoiceRow(id);
  if (!row) return null;
  const detail = {
    ...invoiceSummaryJson(row),
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    extraction_method: row.extraction_method,
    extraction_warnings: parseWarnings(row.extraction_warnings),
    submit_note: row.submit_note ?? null,
    review_note: row.review_note ?? null,
    items: loadItemRows(id).map(itemJson),
    photos: loadPhotoRows(id).map(photoJson),
  };
  if (admin) {
    detail.file_url = `/api/admin/invoices/${id}/file`;
    detail.raw_text = stmt('SELECT raw_text FROM invoices WHERE id = ?').get(id)?.raw_text ?? null;
    detail.events = loadEventRows(id).map(eventJson);
  }
  return detail;
}
