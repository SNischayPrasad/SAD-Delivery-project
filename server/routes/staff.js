import { Router } from 'express';
import { PHOTO_DIR } from '../config.js';
import {
  stmt, nowIso, parseId, foldText, invoiceSearchWhere, transaction, logEvent,
} from '../db.js';
import { requireRole } from '../auth.js';
import { notifyActiveAdmins, broadcastInvoice } from '../notify.js';
import {
  INVOICE_SELECT, STAFF_EDITABLE_STATUSES, invoiceSummaryJson, loadInvoiceSummary, loadInvoiceDetail,
  loadItem, loadPhotosByIds, httpError, bodyOf, invoiceLabel,
} from '../serializers.js';
import {
  photoUpload, acceptUpload, removeFile, removeUploadedFiles, resolveInside, safeOriginalName, PHOTO_KINDS,
} from '../uploads.js';

const router = Router();
router.use(requireRole('staff', 'admin'));

function getChecklist(idParam) {
  const id = parseId(idParam);
  const inv = id && stmt(
    "SELECT id, invoice_number, customer_name, status FROM invoices WHERE id = ? AND status <> 'draft'",
  ).get(id);
  if (!inv) throw httpError(404, 'Checklist not found');
  return inv;
}

function assertEditable(inv) {
  if (!STAFF_EDITABLE_STATUSES.includes(inv.status)) {
    throw httpError(403, `This checklist is locked while it is ${inv.status}`);
  }
}

/** Marks activity on the checklist: open → in_progress on first change, always bumps updated_at. */
function touchChecklist(inv) {
  const now = nowIso();
  if (inv.status === 'open') {
    stmt("UPDATE invoices SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'open'").run(now, inv.id);
    broadcastInvoice(inv.id, 'in_progress');
  } else {
    stmt('UPDATE invoices SET updated_at = ? WHERE id = ?').run(now, inv.id);
  }
}

router.get('/checklists/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.status(400).json({ error: 'Enter an invoice number or customer name to search' });
  const term = q.slice(0, 100);
  const search = invoiceSearchWhere(term);
  const rows = stmt(`${INVOICE_SELECT}
    WHERE i.status <> 'draft'
      AND ${search.sql}
    ORDER BY CASE WHEN tally_fold(i.invoice_number) = ? THEN 0 ELSE 1 END, i.updated_at DESC, i.id DESC
    LIMIT 50`).all(...search.params, foldText(term));
  res.json({ checklists: rows.map(invoiceSummaryJson) });
});

router.get('/checklists/mine', (req, res) => {
  const rows = stmt(`${INVOICE_SELECT}
    WHERE i.status IN ('in_progress', 'returned', 'submitted')
      AND EXISTS (SELECT 1 FROM invoice_events e WHERE e.invoice_id = i.id AND e.user_id = ?)
    ORDER BY CASE WHEN i.status = 'returned' THEN 0 ELSE 1 END, i.updated_at DESC, i.id DESC
    LIMIT 30`).all(req.user.id);
  res.json({ checklists: rows.map(invoiceSummaryJson) });
});

router.get('/checklists/:id', (req, res) => {
  const inv = getChecklist(req.params.id);
  res.json({ checklist: loadInvoiceDetail(inv.id) });
});

router.patch('/checklists/:id/items/:itemId', (req, res) => {
  const inv = getChecklist(req.params.id);
  const itemId = parseId(req.params.itemId);
  const item = itemId && stmt('SELECT id, description, collected, note FROM checklist_items WHERE id = ? AND invoice_id = ?').get(itemId, inv.id);
  if (!item) throw httpError(404, 'Item not found');
  assertEditable(inv);

  const b = bodyOf(req);
  const hasCollected = b.collected !== undefined;
  const hasNote = b.note !== undefined;
  if (hasCollected && typeof b.collected !== 'boolean') throw httpError(400, 'collected must be true or false');
  if (hasNote && b.note !== null && typeof b.note !== 'string') throw httpError(400, 'note must be text or null');
  const note = hasNote && typeof b.note === 'string' ? (b.note.trim() || null) : null;
  if (note && note.length > 500) throw httpError(400, 'Note must be 500 characters or fewer');
  if (!hasCollected && !hasNote) throw httpError(400, 'Nothing to update');

  const collectedChanged = hasCollected && Boolean(item.collected) !== b.collected;
  const noteChanged = hasNote && (item.note ?? null) !== note;
  if (collectedChanged || noteChanged) {
    transaction(() => {
      stmt('UPDATE checklist_items SET collected = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
        (collectedChanged ? b.collected : Boolean(item.collected)) ? 1 : 0,
        noteChanged ? note : item.note,
        req.user.id,
        nowIso(),
        item.id,
      );
      if (collectedChanged) {
        logEvent(inv.id, b.collected ? 'item_checked' : 'item_unchecked', req.user.id, item.description);
      }
      touchChecklist(inv);
    });
  }
  res.json({ item: loadItem(item.id), checklist: loadInvoiceSummary(inv.id) });
});

// Reject before multer writes anything to disk.
function photoPrecheck(req, res, next) {
  try {
    assertEditable(getChecklist(req.params.id));
    next();
  } catch (err) {
    req.resume();
    next(err);
  }
}

router.post('/checklists/:id/photos', photoPrecheck, photoUpload, async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) return res.status(400).json({ error: 'Add at least one photo' });

  const accepted = [];
  const discardAccepted = () => Promise.all(accepted.map((a) => removeFile(a.absPath)));
  for (let i = 0; i < files.length; i++) {
    let stored;
    try {
      stored = await acceptUpload(files[i], PHOTO_KINDS, PHOTO_DIR);
    } catch (err) {
      // e.g. a rename blocked by antivirus: photos already moved into PHOTO_DIR have no row yet, so drop them.
      await removeUploadedFiles(files.slice(i));
      await discardAccepted();
      throw err;
    }
    if (!stored) {
      await removeUploadedFiles(files.slice(i + 1));
      await discardAccepted();
      return res.status(415).json({ error: 'Unsupported photo type. Use JPEG, PNG, WEBP or HEIC images.' });
    }
    accepted.push({ ...stored, originalName: safeOriginalName(files[i].originalname, 'photo') });
  }

  let ids;
  try {
    ids = transaction(() => {
      const inv = getChecklist(req.params.id); // re-check: status may have changed during upload
      assertEditable(inv);
      const now = nowIso();
      const insert = stmt('INSERT INTO photos (invoice_id, file_path, original_filename, mime_type, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)');
      const newIds = accepted.map((a) => Number(insert.run(inv.id, a.relPath, a.originalName, a.mime, req.user.id, now).lastInsertRowid));
      logEvent(inv.id, 'photo_added', req.user.id, String(accepted.length));
      touchChecklist(inv);
      return newIds;
    });
  } catch (err) {
    await discardAccepted();
    throw err;
  }
  const invoiceId = parseId(req.params.id);
  res.status(201).json({ photos: loadPhotosByIds(ids), checklist: loadInvoiceSummary(invoiceId) });
});

router.delete('/checklists/:id/photos/:photoId', async (req, res) => {
  const inv = getChecklist(req.params.id);
  const photoId = parseId(req.params.photoId);
  const photo = photoId && stmt('SELECT id, file_path, original_filename, uploaded_by FROM photos WHERE id = ? AND invoice_id = ?').get(photoId, inv.id);
  if (!photo) throw httpError(404, 'Photo not found');
  assertEditable(inv);
  if (req.user.role !== 'admin' && photo.uploaded_by !== req.user.id) {
    throw httpError(403, 'You can only remove photos you added');
  }
  transaction(() => {
    stmt('DELETE FROM photos WHERE id = ?').run(photo.id);
    logEvent(inv.id, 'photo_removed', req.user.id, photo.original_filename);
    stmt('UPDATE invoices SET updated_at = ? WHERE id = ?').run(nowIso(), inv.id);
  });
  const abs = resolveInside(PHOTO_DIR, photo.file_path);
  if (abs) await removeFile(abs);
  res.status(204).end();
});

router.post('/checklists/:id/submit', (req, res) => {
  const inv = getChecklist(req.params.id);
  assertEditable(inv);
  const b = bodyOf(req);
  if (b.note != null && typeof b.note !== 'string') throw httpError(400, 'note must be text');
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > 1000) throw httpError(400, 'Note must be 1000 characters or fewer');

  const { photos } = stmt('SELECT COUNT(*) AS photos FROM photos WHERE invoice_id = ?').get(inv.id);
  if (!photos) {
    return res.status(422).json({ error: 'Add at least one photo of the collected items before submitting' });
  }
  const { missing } = stmt('SELECT COUNT(*) AS missing FROM checklist_items WHERE invoice_id = ? AND collected = 0').get(inv.id);
  if (missing && !note) {
    return res.status(422).json({ error: 'Add a note explaining the items that were not collected' });
  }

  transaction(() => {
    const now = nowIso();
    // A resubmission starts a fresh review: the previous return's reviewer, time and note stay in the events.
    stmt(`UPDATE invoices SET status = 'submitted', submitted_by = ?, submitted_at = ?, submit_note = ?, updated_at = ?,
        reviewed_by = NULL, reviewed_at = NULL, review_note = NULL
      WHERE id = ?`).run(req.user.id, now, note || null, now, inv.id);
    stmt('UPDATE checklist_items SET review_status = NULL WHERE invoice_id = ?').run(inv.id);
    logEvent(inv.id, 'submitted', req.user.id, note || null);
    notifyActiveAdmins('submitted', inv.id, `${req.user.display_name} submitted ${invoiceLabel(inv)} for review`);
    broadcastInvoice(inv.id, 'submitted');
  });
  res.json({ checklist: loadInvoiceDetail(inv.id) });
});

export default router;
