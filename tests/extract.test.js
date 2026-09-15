import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-extract-'));

// Local strategies only. OCR language data is cached outside the repo and reused between runs.
process.env.EXTRACTOR = 'local';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.DATA_DIR = process.env.TALLY_TEST_OCR_DATA_DIR || path.join(os.tmpdir(), 'tally-test-ocr');

const { extractInvoice } = await import('../server/extract/index.js');
const { ensureOcr, terminateOcr, ocrLimits } = await import('../server/extract/ocr.js');
const { renderPdfPages, pdfLimits } = await import('../server/extract/pdf-text.js');
const { imageInfo, prepareForOcr, imageLimits } = await import('../server/extract/image.js');
const { buildClaudeRequest, claudeSkipReason, InvoiceSchema, extractWithClaude } = await import('../server/extract/claude.js');
const { createCanvas, loadImage } = await import('@napi-rs/canvas');

/** A one-page PDF whose content stream is `mb` megabytes of text operators, deflated. */
function flateBombPdf(mb) {
  const unit = Buffer.from('BT /F1 12 Tf 10 10 Td (AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA) Tj ET\n');
  const content = Buffer.alloc(mb * 1024 * 1024);
  for (let i = 0; i + unit.length <= content.length; i += unit.length) unit.copy(content, i);
  const stream = zlib.deflateSync(content);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(obj);
    length += obj.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** JPEG APP1 segment holding only an EXIF Orientation tag, little-endian ("II") or big-endian ("MM"). */
function exifSegment(littleEndian, orientation) {
  const tiff = Buffer.alloc(26);
  const u16 = (v, at) => (littleEndian ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
  const u32 = (v, at) => (littleEndian ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
  tiff.write(littleEndian ? 'II' : 'MM', 0, 'latin1');
  u16(42, 2); u32(8, 4); u16(1, 8); u16(0x0112, 10); u16(3, 12); u32(1, 14); u16(orientation, 18); u32(0, 22);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/** us-invoice.png stored rotated 90° counter-clockwise with EXIF Orientation=6, as phone cameras do. */
async function sidewaysJpeg(littleEndian) {
  const img = await loadImage(fs.readFileSync(path.join(FIXTURES, 'us-invoice.png')));
  const canvas = createCanvas(img.height, img.width);
  const ctx = canvas.getContext('2d');
  ctx.translate(0, img.width);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, 0, 0);
  const jpeg = await canvas.encode('jpeg', 92);
  return Buffer.concat([jpeg.subarray(0, 2), exifSegment(littleEndian, 6), jpeg.subarray(2)]);
}

const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));
const mimeOf = (name) => (name.endsWith('.pdf') ? 'application/pdf' : 'image/png');
const ocrProblem = await ensureOcr().then(() => null, (err) => err.message);
const ocrSkip = ocrProblem ? `OCR language data unavailable: ${ocrProblem}` : false;

after(async () => {
  await terminateOcr();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const run = (filePath, mimeType, originalName = path.basename(filePath)) => extractInvoice({ filePath, mimeType, originalName });

function assertShape(r) {
  assert.deepEqual(Object.keys(r).sort(), ['customer_name', 'invoice_date', 'invoice_number', 'items', 'method', 'raw_text', 'warnings']);
  assert.ok(['claude', 'pdf-text', 'ocr', 'none'].includes(r.method));
  assert.ok(Array.isArray(r.warnings) && r.warnings.every((w) => typeof w === 'string'));
  for (const it of r.items) {
    assert.equal(typeof it.description, 'string');
    assert.equal(typeof it.quantity, 'number');
    assert.ok(it.quantity > 0);
  }
}

const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
// An OCR item "matches" when the quantity is right and most description words were read correctly.
function ocrMatches(got, want) {
  if (got.quantity !== want.quantity) return false;
  const have = new Set(words(got.description));
  const need = words(want.description);
  return need.filter((w) => have.has(w)).length >= Math.ceil(need.length * 0.6);
}

test('fixtures include the three text-layer invoices', () => {
  for (const name of ['gst-tax-invoice.pdf', 'us-invoice.pdf', 'delivery-challan.pdf']) {
    assert.ok(expected[name], `${name} listed in expected.json`);
    assert.ok(fs.existsSync(path.join(FIXTURES, name)), `${name} exists (run npm run sample-invoices)`);
  }
});

for (const [name, want] of Object.entries(expected).filter(([, e]) => e.method === 'pdf-text')) {
  test(`pdf-text: ${name} extracts exact header and items`, async () => {
    const r = await run(path.join(FIXTURES, name), 'application/pdf');
    assertShape(r);
    assert.equal(r.method, 'pdf-text');
    assert.equal(r.invoice_number, want.invoice_number);
    assert.equal(r.customer_name, want.customer_name);
    assert.equal(r.invoice_date, want.invoice_date);
    assert.deepEqual(r.items, want.items);
    assert.deepEqual(r.warnings, []);
    assert.ok(r.raw_text && r.raw_text.includes(want.invoice_number));
  });
}

for (const [name, want] of Object.entries(expected).filter(([, e]) => e.method === 'ocr')) {
  test(`ocr: ${name} finds at least 80% of items with correct quantities`, { skip: ocrSkip, timeout: 180_000 }, async () => {
    const r = await run(path.join(FIXTURES, name), mimeOf(name));
    assertShape(r);
    assert.equal(r.method, 'ocr');
    assert.ok(r.warnings.some((w) => /OCR/.test(w)), 'warns that OCR was used');
    assert.equal(r.invoice_number, want.invoice_number);
    assert.equal(r.invoice_date, want.invoice_date);
    assert.ok(r.customer_name && r.customer_name.startsWith(want.customer_name), `customer ${r.customer_name}`);
    const found = want.items.filter((w) => r.items.some((g) => ocrMatches(g, w)));
    assert.ok(found.length >= Math.ceil(want.items.length * 0.8),
      `matched ${found.length}/${want.items.length}: ${JSON.stringify(r.items)}`);
    assert.ok(r.items.length <= want.items.length + 1, 'no flood of junk lines');
  });
}

test('scanned PDFs are rendered page by page, capped at the page limit', async () => {
  const { default: PDFDocument } = await import('pdfkit');
  const pdf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A6' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
    for (let i = 0; i < 7; i++) {
      if (i) doc.addPage();
      doc.rect(20, 20, 60, 60).fill('#000000');
    }
    doc.end();
  });
  const r = await renderPdfPages(pdf, { maxPages: 5, width: 300 });
  assert.equal(r.images.length, 5);
  assert.equal(r.total, 7);
  assert.equal(r.truncated, true);
  assert.deepEqual([...r.images[0].subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('never throws: missing, empty, damaged and unsupported files', async () => {
  const cases = [
    ['missing.pdf', null, 'application/pdf'],
    ['empty.pdf', Buffer.alloc(0), 'application/pdf'],
    ['broken.pdf', Buffer.from('%PDF-1.4\nthis is not really a pdf'), 'application/pdf'],
    ['photo.heic', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(40)]), 'image/heic'],
    ['notes.txt', Buffer.from('just some text'), 'text/plain'],
  ];
  for (const [name, data, mime] of cases) {
    const file = path.join(TMP, name);
    if (data) fs.writeFileSync(file, data);
    const r = await run(file, mime);
    assertShape(r);
    assert.equal(r.method, 'none', name);
    assert.deepEqual(r.items, [], name);
    assert.ok(r.warnings.length && /manually/.test(r.warnings.join(' ')), `${name}: ${r.warnings}`);
  }
  assert.ok((await extractInvoice()).method === 'none');
});

test('never throws: corrupt image', { skip: ocrSkip, timeout: 120_000 }, async () => {
  const file = path.join(TMP, 'corrupt.png');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]));
  const r = await run(file, 'image/png');
  assertShape(r);
  assert.equal(r.method, 'none');
  assert.deepEqual(r.items, []);
});

test('magic bytes win over a wrong client mime type', async () => {
  const r = await run(path.join(FIXTURES, 'us-invoice.pdf'), 'image/png', 'invoice.png');
  assert.equal(r.method, 'pdf-text');
  assert.equal(r.items.length, expected['us-invoice.pdf'].items.length);
});

test('EXTRACTOR=claude without credentials falls back to local reading with a warning', async () => {
  process.env.EXTRACTOR = 'claude';
  try {
    const r = await run(path.join(FIXTURES, 'delivery-challan.pdf'), 'application/pdf');
    assert.equal(r.method, 'pdf-text');
    assert.deepEqual(r.items, expected['delivery-challan.pdf'].items);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /^AI extraction failed \(.+\); used local text reading instead$/);
  } finally {
    process.env.EXTRACTOR = 'local';
  }
});

test('Claude request: document block for PDFs, image block for images, structured output format', () => {
  const pdf = buildClaudeRequest({ buffer: Buffer.from('%PDF-1.7'), mimeType: 'application/pdf' });
  assert.equal(pdf.model, process.env.CLAUDE_MODEL || 'claude-opus-5');
  assert.equal(pdf.max_tokens, 16000);
  const [doc, text] = pdf.messages[0].content;
  assert.deepEqual(doc, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.7').toString('base64') } });
  assert.equal(text.type, 'text');
  assert.equal(pdf.output_config.format.type, 'json_schema');
  assert.equal(typeof pdf.output_config.format.parse, 'function');
  assert.deepEqual(pdf.output_config.format.schema.required, ['invoice_number', 'customer_name', 'invoice_date', 'items']);
  assert.ok(!('temperature' in pdf) && !('thinking' in pdf));

  const png = buildClaudeRequest({ buffer: Buffer.from([0x89, 0x50]), mimeType: 'image/png' });
  assert.equal(png.messages[0].content[0].type, 'image');
  assert.equal(png.messages[0].content[0].source.media_type, 'image/png');

  const parsed = pdf.output_config.format.parse(JSON.stringify({
    invoice_number: 'INV-1', customer_name: null, invoice_date: '2026-09-01',
    items: [{ description: 'Widget', sku: null, quantity: 2, unit: 'pcs' }],
  }));
  assert.equal(parsed.items[0].quantity, 2);
  assert.equal(InvoiceSchema.safeParse({ invoice_number: null, customer_name: null, invoice_date: null, items: [{ description: 'x', sku: null, quantity: '2', unit: null }] }).success, false);
});

test('a PDF whose compressed stream inflates far beyond memory fails that upload, not the server', { timeout: 120_000 }, async () => {
  const saved = { ...pdfLimits };
  Object.assign(pdfLimits, { heapMb: 96, timeoutMs: 45_000 });
  try {
    const file = path.join(TMP, 'bomb.pdf');
    fs.writeFileSync(file, flateBombPdf(64));
    const rssBefore = process.memoryUsage().rss;
    const r = await run(file, 'application/pdf');
    assertShape(r);
    assert.equal(r.method, 'none');
    assert.match(r.warnings.join(' '), /^This PDF could not be read \((it needs too much memory to read|it took too long to read|the PDF reader stopped unexpectedly)\); add the lines manually$/);
    assert.ok(process.memoryUsage().rss - rssBefore < 150 * 1024 * 1024, 'the server process did not absorb the decoded stream');
  } finally {
    Object.assign(pdfLimits, saved);
  }
});

test('an image with huge pixel dimensions is refused from its header, before any decoding', async () => {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(32000, 16);
  header.writeUInt32BE(32000, 20);
  header[24] = 8;
  const file = path.join(TMP, 'huge.png');
  fs.writeFileSync(file, Buffer.concat([header, Buffer.alloc(64)]));
  const started = Date.now();
  const r = await run(file, 'image/png');
  assertShape(r);
  assert.equal(r.method, 'none');
  assert.match(r.warnings[0], /too large to read automatically \(32000 × 32000 pixels\)/);
  assert.ok(Date.now() - started < 2000, 'no OCR was attempted');
  assert.deepEqual(imageInfo(Buffer.concat([header, Buffer.alloc(64)])), { type: 'png', width: 32000, height: 32000, orientation: 1 });
});

test('EXIF orientation is read in both byte orders and applied before OCR', async () => {
  for (const littleEndian of [true, false]) {
    const jpeg = await sidewaysJpeg(littleEndian);
    const info = imageInfo(jpeg);
    assert.equal(info.orientation, 6, littleEndian ? 'II' : 'MM');
    assert.ok(info.width > info.height, 'stored sideways');
    const upright = imageInfo(await prepareForOcr(jpeg));
    assert.equal(upright.type, 'png');
    assert.ok(upright.height > upright.width, 'rotated upright');
    assert.equal(upright.orientation, 1);
  }
});

test('ocr: a sideways phone photo with little-endian EXIF orientation is read upright', { skip: ocrSkip, timeout: 180_000 }, async () => {
  const want = expected['us-invoice.png'];
  const file = path.join(TMP, 'sideways.jpg');
  fs.writeFileSync(file, await sidewaysJpeg(true));
  const r = await run(file, 'image/jpeg');
  // Read sideways, tesseract returns garbage: no customer and no items. (The invoice number is not asserted:
  // JPEG compression makes OCR misread the small "Invoice #" label even on an upright copy of this page.)
  assert.equal(r.method, 'ocr');
  assert.ok(r.customer_name && r.customer_name.startsWith(want.customer_name), `customer ${r.customer_name}`);
  const found = want.items.filter((w) => r.items.some((g) => ocrMatches(g, w)));
  assert.ok(found.length >= Math.ceil(want.items.length * 0.8), `matched ${found.length}/${want.items.length}: ${JSON.stringify(r.items)}`);
  assert.ok(r.items.length <= want.items.length + 1, 'no flood of junk lines');
});

test('images above the OCR pixel budget are scaled down, keeping their shape', async () => {
  const saved = { ...imageLimits };
  imageLimits.maxOcrPixels = 200_000;
  try {
    const png = fs.readFileSync(path.join(FIXTURES, 'us-invoice.png'));
    const before = imageInfo(png);
    const after = imageInfo(await prepareForOcr(png));
    assert.ok(after.width * after.height <= 200_000 * 1.01, `${after.width} × ${after.height}`);
    assert.ok(Math.abs(after.width / after.height - before.width / before.height) < 0.01, 'aspect ratio kept');
  } finally {
    Object.assign(imageLimits, saved);
  }
});

test('ocr: a recognition job over the time limit fails that upload and the next one still works', { skip: ocrSkip, timeout: 180_000 }, async () => {
  const file = path.join(FIXTURES, 'us-invoice.png');
  const saved = ocrLimits.recognizeTimeoutMs;
  ocrLimits.recognizeTimeoutMs = 1;
  let slow;
  try {
    slow = await run(file, 'image/png');
  } finally {
    ocrLimits.recognizeTimeoutMs = saved;
  }
  assertShape(slow);
  assert.equal(slow.method, 'none');
  assert.match(slow.warnings.join(' '), /took too long/);
  // The stuck worker was replaced, so the next job is not queued behind it.
  const r = await run(file, 'image/png');
  assert.equal(r.method, 'ocr');
  assert.equal(r.items.length >= Math.ceil(expected['us-invoice.png'].items.length * 0.8), true, JSON.stringify(r.items));
});

test('ocr: a scanned PDF carrying a small "Scanned with CamScanner" text stamp is still read with OCR', { skip: ocrSkip, timeout: 180_000 }, async () => {
  const { default: PDFDocument } = await import('pdfkit');
  const png = fs.readFileSync(path.join(FIXTURES, 'us-invoice.png'));
  const { width, height } = imageInfo(png);
  const pageWidth = 612;
  const pageHeight = Math.round((pageWidth * height) / width) + 30;
  const pdf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [pageWidth, pageHeight], margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
    doc.image(png, 0, 0, { width: pageWidth });
    doc.fontSize(7).fillColor('#888888').text('Scanned with CamScanner', 20, pageHeight - 16);
    doc.end();
  });
  const file = path.join(TMP, 'camscanner.pdf');
  fs.writeFileSync(file, pdf);
  const r = await run(file, 'application/pdf');
  const want = expected['us-invoice.png'];
  assert.equal(r.method, 'ocr', JSON.stringify(r.warnings));
  assert.ok(r.warnings.some((w) => /read with OCR/.test(w)));
  const found = want.items.filter((w) => r.items.some((g) => ocrMatches(g, w)));
  assert.ok(found.length >= Math.ceil(want.items.length * 0.8), `matched ${found.length}/${want.items.length}: ${JSON.stringify(r.items)}`);
});

test('Claude refusals and cut-off responses are reported as such, not as a configuration problem', async () => {
  const saved = { fetch: globalThis.fetch, key: process.env.ANTHROPIC_API_KEY };
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  const reply = (body) => async () => new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 }, ...body,
  }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  const input = { buffer: Buffer.from('%PDF-1.7'), mimeType: 'application/pdf' };
  try {
    globalThis.fetch = reply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"invoice_number":"INV-1","items":[' }] });
    assert.deepEqual(await extractWithClaude(input), { ok: false, reason: 'the response was cut off' });
    globalThis.fetch = reply({ stop_reason: 'refusal', content: [{ type: 'text', text: 'I cannot help with that.' }] });
    assert.deepEqual(await extractWithClaude(input), { ok: false, reason: 'the model declined to read this file' });
    globalThis.fetch = reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"invoice_number":"INV-1"}' }] });
    assert.deepEqual(await extractWithClaude(input), { ok: false, reason: 'the result did not match the expected format' });
    const data = { invoice_number: 'INV-1', customer_name: 'Big Co', invoice_date: '2026-09-01', items: [{ description: 'Widget', sku: null, quantity: 2, unit: 'pcs' }] };
    globalThis.fetch = reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(data) }] });
    assert.deepEqual(await extractWithClaude(input), { ok: true, data });
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
  }
});

test('Claude is skipped for HEIC and for images over 5 MB, not for normal PDFs and images', () => {
  assert.match(claudeSkipReason({ mimeType: 'image/heic', size: 1000 }), /HEIC/);
  assert.match(claudeSkipReason({ mimeType: 'image/jpeg', size: 6 * 1024 * 1024 }), /5 MB/);
  assert.equal(claudeSkipReason({ mimeType: 'image/jpeg', size: 1024 }), null);
  assert.equal(claudeSkipReason({ mimeType: 'application/pdf', size: 8 * 1024 * 1024 }), null);
});
