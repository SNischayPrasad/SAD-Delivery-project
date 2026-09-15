// extractInvoice(): picks Claude or local reading (pdf text layer / OCR) and never throws.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseInvoiceText, parseDate } from './heuristics.js';
import { readPdfText, renderPdfPages, hasUsableText, describePdfError } from './pdf-text.js';
import { ocrImage, OcrUnavailableError, OcrTimeoutError } from './ocr.js';
import { ImageTooLargeError, imageLimits } from './image.js';
import { extractWithClaude, hasClaudeCredentials, claudeSkipReason } from './claude.js';

const MAX_OCR_PAGES = 5;
const MAX_RAW_TEXT_CHARS = 500_000;
const OCR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);
const NO_TEXT_LAYER = 'This PDF has no text layer; add the lines manually or upload a photo/scan image';
const NO_ITEMS = 'No line items were found; add them manually';
const TEXT_TRUNCATED = 'This PDF is very long; only the first part of its text was read, so check for missing lines';

export async function extractInvoice({ filePath, mimeType, originalName } = {}) {
  try {
    return await extract({ filePath, mimeType, originalName });
  } catch (err) {
    console.error('[extract] unexpected failure:', err);
    return none(['Something went wrong while reading this invoice; add the lines manually']);
  }
}

async function extract({ filePath, mimeType, originalName }) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return none(['The uploaded file could not be opened; add the lines manually']);
  }
  if (!buffer.length) return none(['The uploaded file is empty; add the lines manually']);
  const type = detectType(buffer, mimeType, originalName);

  const warnings = [];
  const mode = String(process.env.EXTRACTOR || 'auto').trim().toLowerCase();
  const useClaude = mode === 'claude' || (mode !== 'local' && hasClaudeCredentials());
  if (useClaude) {
    const skip = claudeSkipReason({ mimeType: type, size: buffer.length });
    if (skip) {
      warnings.push(`AI extraction skipped (${skip}); used local text reading instead`);
    } else {
      const ai = await extractWithClaude({ buffer, mimeType: type });
      if (ai.ok) {
        const result = fromClaude(ai.data);
        if (type === 'application/pdf') result.raw_text = await readPdfText(buffer).then((r) => r.text || null, () => null);
        if (result.items.length) return result;
        // Claude read the header but no lines: see whether local reading does better.
        const local = await extractLocal(buffer, type);
        if (local.items.length) {
          return {
            ...local,
            invoice_number: result.invoice_number ?? local.invoice_number,
            customer_name: result.customer_name ?? local.customer_name,
            invoice_date: result.invoice_date ?? local.invoice_date,
            warnings: ['AI extraction found no line items; used local text reading for the lines', ...local.warnings],
          };
        }
        result.warnings.push(NO_ITEMS);
        return result;
      }
      warnings.push(`AI extraction failed (${ai.reason}); used local text reading instead`);
    }
  }
  const local = await extractLocal(buffer, type);
  return { ...local, warnings: [...warnings, ...local.warnings] };
}

async function extractLocal(buffer, type) {
  if (type === 'application/pdf') return extractPdf(buffer);
  if (type === 'image/heic' || type === 'image/heif') {
    return none(['HEIC images cannot be read automatically; add the lines manually or upload a JPEG or PNG']);
  }
  if (!OCR_TYPES.has(type)) return none(['This file type cannot be read automatically; add the lines manually']);
  let text;
  try {
    text = await ocrImage(buffer);
  } catch (err) {
    return none([ocrFailure(err)]);
  }
  if (!hasUsableText(text)) {
    return none(['No readable text was found in this image; add the lines manually or upload a sharper photo'], text || null);
  }
  return fromText('ocr', text, ['This invoice was read from an image with OCR; check the lines carefully']);
}

async function extractPdf(buffer) {
  let layer;
  try {
    layer = await readPdfText(buffer);
  } catch (err) {
    return none([`This PDF could not be read (${describePdfError(err)}); add the lines manually`]);
  }
  let fromLayer = null;
  if (hasUsableText(layer.text)) {
    fromLayer = fromText('pdf-text', layer.text, layer.truncated ? [TEXT_TRUNCATED] : []);
    if (fromLayer.items.length) return fromLayer;
  }
  // No lines from the text layer: a scanned PDF, or a scan carrying a little text of its own ("Scanned with
  // CamScanner", a page number stamp). Render the first pages, read them with OCR and keep the better result.
  const scanned = await ocrPdfPages(buffer, fromLayer
    ? 'The text in this PDF had no line items, so its pages were read with OCR; check the lines carefully'
    : 'This PDF has no text layer; it was read with OCR, so check the lines carefully');
  if (!fromLayer) return scanned;
  return score(scanned) > score(fromLayer) ? scanned : fromLayer;
}

const score = (r) => r.items.length * 10 + (r.invoice_number ? 1 : 0) + (r.customer_name ? 1 : 0);

async function ocrPdfPages(buffer, note) {
  let rendered;
  try {
    rendered = await renderPdfPages(buffer, { maxPages: MAX_OCR_PAGES });
  } catch (err) {
    console.warn('[extract] PDF page rendering failed:', err && err.message);
    return none([NO_TEXT_LAYER]);
  }
  const pages = [];
  try {
    for (const image of rendered.images) pages.push(await ocrImage(image));
  } catch (err) {
    return none([NO_TEXT_LAYER, ocrFailure(err)]);
  }
  const ocrText = pages.join('\n');
  if (!hasUsableText(ocrText)) return none([NO_TEXT_LAYER], ocrText || null);
  const notes = [note];
  if (rendered.truncated) notes.push(`Only the first ${rendered.images.length} of ${rendered.total} pages were read; add any remaining lines manually`);
  return fromText('ocr', ocrText, notes);
}

function fromText(method, fullText, notes = []) {
  const text = fullText.length > MAX_RAW_TEXT_CHARS ? fullText.slice(0, MAX_RAW_TEXT_CHARS) : fullText;
  const parsed = parseInvoiceText(text);
  const items = cleanItems(parsed.items);
  const warnings = [...notes, ...parsed.warnings];
  if (!items.length) warnings.push(NO_ITEMS);
  return {
    invoice_number: parsed.invoice_number,
    customer_name: parsed.customer_name,
    invoice_date: parsed.invoice_date,
    items,
    method,
    warnings,
    raw_text: text,
  };
}

function fromClaude(data) {
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
  const date = str(data.invoice_date);
  return {
    invoice_number: str(data.invoice_number),
    customer_name: str(data.customer_name),
    invoice_date: date ? parseDate(date) : null,
    items: cleanItems(data.items),
    method: 'claude',
    warnings: [],
    raw_text: null,
  };
}

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    const description = typeof it?.description === 'string' ? it.description.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    const quantity = Number(it?.quantity);
    if (!description || !Number.isFinite(quantity) || quantity <= 0) continue;
    const opt = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
    out.push({ description, sku: opt(it.sku), quantity: Math.round(quantity * 1000) / 1000, unit: opt(it.unit) });
  }
  return out;
}

function none(warnings, raw_text = null) {
  return { invoice_number: null, customer_name: null, invoice_date: null, items: [], method: 'none', warnings, raw_text };
}

function ocrFailure(err) {
  if (err instanceof ImageTooLargeError) {
    const limit = Math.round(imageLimits.maxDecodePixels / 1_000_000);
    return `This image is too large to read automatically (${err.width} × ${err.height} pixels); upload a copy under ${limit} megapixels or add the lines manually`;
  }
  if (err instanceof OcrTimeoutError) return 'Reading this image took too long; add the lines manually or upload a smaller, sharper copy';
  if (err instanceof OcrUnavailableError) return `Text recognition is not available right now (${err.message}); add the lines manually`;
  return 'The image could not be read; add the lines manually or upload a JPEG or PNG';
}

// Trust the file's magic bytes over the client-supplied type.
function detectType(buffer, mimeType, originalName) {
  const head = buffer.subarray(0, 12);
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (/^ftyp(?:heic|heix|hevc|mif1|msf1)$/.test(head.subarray(4, 12).toString('latin1'))) return 'image/heic';
  if (head.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  const declared = String(mimeType || '').toLowerCase();
  if (declared) return declared === 'image/jpg' ? 'image/jpeg' : declared;
  const ext = path.extname(originalName || '').toLowerCase();
  return { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
}
