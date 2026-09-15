import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { INVOICE_DIR, PHOTO_DIR } from '../config.js';
import { stmt, parseId } from '../db.js';
import { requireRole } from '../auth.js';
import { resolveInside, dispositionName } from '../uploads.js';

// Mounted at /api; guards are per route so other /api paths pass through untouched.
const router = Router();

async function sendStoredFile(res, baseDir, relPath, headers) {
  const abs = resolveInside(baseDir, relPath);
  let stat = null;
  if (abs) {
    try { stat = await fs.promises.stat(abs); } catch { stat = null; }
  }
  if (!stat || !stat.isFile()) return res.status(404).json({ error: 'File not found' });
  res.status(200).set({ ...headers, 'Content-Length': String(stat.size), 'X-Content-Type-Options': 'nosniff' });
  try {
    await pipeline(fs.createReadStream(abs), res);
  } catch (err) {
    if (!res.headersSent) throw err;
    res.destroy();
  }
}

router.get('/photos/:id', requireRole('admin', 'staff'), async (req, res) => {
  const id = parseId(req.params.id);
  const photo = id && stmt('SELECT file_path, mime_type FROM photos WHERE id = ?').get(id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  await sendStoredFile(res, PHOTO_DIR, photo.file_path, {
    'Content-Type': photo.mime_type,
    'Cache-Control': 'private, max-age=3600',
  });
});

router.get('/admin/invoices/:id/file', requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id);
  const inv = id && stmt('SELECT file_path, mime_type, original_filename FROM invoices WHERE id = ?').get(id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  await sendStoredFile(res, INVOICE_DIR, inv.file_path, {
    'Content-Type': inv.mime_type,
    'Content-Disposition': `inline; filename="${dispositionName(inv.original_filename)}"`,
    'Cache-Control': 'private, no-cache',
  });
});

export default router;
