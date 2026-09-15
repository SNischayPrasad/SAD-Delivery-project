// Writes sample invoices into tests/fixtures/: three text PDFs, a PNG render, an image-only
// (scanned) PDF, and expected.json describing what extraction should find in each.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { renderPdfPages } from '../server/extract/pdf-text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'fixtures');
const FIXED_DATE = new Date('2026-09-01T09:00:00Z');
const LEFT = 40;
const WIDTH = 515;

const inr = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function makePdf(title, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: LEFT,
      info: { Title: title, Producer: 'Tally sample generator', CreationDate: FIXED_DATE, ModDate: FIXED_DATE },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

function rule(doc, y, weight = 0.5) {
  doc.moveTo(LEFT, y).lineTo(LEFT + WIDTH, y).lineWidth(weight).strokeColor('#555555').stroke();
}

// Draws a simple ruled table and returns the y position below it.
function drawTable(doc, y, columns, rows) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
  rule(doc, y - 4, 1);
  let x = LEFT;
  for (const col of columns) {
    doc.text(col.title, x + 3, y, { width: col.width - 6, align: col.align || 'left', lineBreak: false });
    x += col.width;
  }
  y += 16;
  rule(doc, y - 5);
  doc.font('Helvetica').fontSize(9);
  for (const row of rows) {
    let height = 0;
    x = LEFT;
    columns.forEach((col, i) => {
      const text = String(row[i] ?? '');
      doc.text(text, x + 3, y, { width: col.width - 6, align: col.align || 'left' });
      height = Math.max(height, doc.heightOfString(text, { width: col.width - 6 }));
      x += col.width;
    });
    y += height + 8;
    rule(doc, y - 4, 0.25);
  }
  return y + 4;
}

function totals(doc, y, pairs) {
  for (const [label, value, bold] of pairs) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    doc.text(label, 340, y, { width: 110, lineBreak: false });
    doc.text(value, 450, y, { width: 102, align: 'right', lineBreak: false });
    y += 15;
  }
  return y;
}

// ---------------------------------------------------------------------------------------------

const GST_ITEMS = [
  ['Basmati Rice Premium 5kg bag', '1006', 10, 'bag', 650],
  ['Toor Dal 1kg pack', '0713', 25, 'pack', 142],
  ['Sunflower Oil 1L pouch', '1512', 24, 'pcs', 185.5],
  ['Tata Salt 1kg', '2501', 50, 'pcs', 28],
  ['Parle-G Biscuits 800g', '1905', 12, 'box', 96],
  ['Surf Excel Detergent Powder 2kg', '3402', 8, 'pcs', 399],
];

function gstInvoice(doc) {
  doc.font('Helvetica-Bold').fontSize(16).text('Shree Ganesh Traders', LEFT, 40, { lineBreak: false });
  doc.fontSize(13).text('TAX INVOICE', 380, 42, { width: 175, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9);
  doc.text('14 Market Yard, Gultekdi, Pune 411037', LEFT, 62, { lineBreak: false });
  doc.text('GSTIN: 27AAKFS4521M1Z3   Phone: +91 20 2426 1188', LEFT, 75, { lineBreak: false });
  rule(doc, 96, 1);

  const left = [['Buyer (Bill to)', true], ['Sharma Kirana Stores', false], ['Shop 5, Baner Road, Pune 411045', false],
    ['GSTIN: 27ABCPS7788K1Z9', false]];
  const right = ['Invoice No: SGT/2026-27/0418', 'Invoice Date: 03/09/2026', 'Place of Supply: Maharashtra (27)'];
  left.forEach(([text, bold], i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(text, LEFT, 108 + i * 14, { lineBreak: false }));
  doc.font('Helvetica');
  right.forEach((text, i) => doc.text(text, 340, 108 + i * 14, { lineBreak: false }));

  const columns = [
    { title: 'S.No', width: 32 }, { title: 'Description of Goods', width: 183 }, { title: 'HSN', width: 50 },
    { title: 'Qty', width: 40, align: 'right' }, { title: 'Unit', width: 40 }, { title: 'Rate', width: 70, align: 'right' },
    { title: 'Amount', width: 100, align: 'right' },
  ];
  const rows = GST_ITEMS.map(([d, hsn, q, u, rate], i) => [i + 1, d, hsn, q, u, inr(rate), inr(q * rate)]);
  let y = drawTable(doc, 186, columns, rows);
  const taxable = GST_ITEMS.reduce((s, [, , q, , rate]) => s + q * rate, 0);
  const cgst = Math.round(taxable * 2.5) / 100;
  y = totals(doc, y, [['Taxable Value', inr(taxable)], ['CGST @ 2.5%', inr(cgst)], ['SGST @ 2.5%', inr(cgst)],
    ['Total', `Rs. ${inr(taxable + 2 * cgst)}`, true]]);
  doc.font('Helvetica').fontSize(8);
  doc.text('Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', LEFT, y + 20, { width: WIDTH });
  doc.font('Helvetica-Bold').text('for Shree Ganesh Traders', 380, y + 60, { width: 175, align: 'right' });
  doc.font('Helvetica').text('Authorised Signatory', 380, y + 95, { width: 175, align: 'right' });
}

const US_ITEMS = [
  ['OM-1L', 'Oat Milk Barista Edition 1L', 12, 3.2],
  ['CUP-12', 'Paper Cups 12oz, sleeve of 50', 20, 4.5],
  ['LID-12', 'Sip Lids for 12oz Cups', 20, 2.1],
  ['DSC-2PK', 'Espresso Machine Descaler 2-pack', 2, 18.99],
  ['NAP-1000', 'Dinner Napkins 2-ply (case of 1,000)', 3, 24],
];

function usInvoice(doc) {
  doc.font('Helvetica-Bold').fontSize(15).text('Pacific Restaurant Supply Co.', LEFT, 40, { lineBreak: false });
  doc.font('Helvetica').fontSize(9);
  doc.text('2150 Harbor Blvd, Oakland, CA 94607', LEFT, 60, { lineBreak: false });
  doc.text('orders@pacificsupply.example  (510) 555-0142', LEFT, 73, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(22).text('INVOICE', 400, 38, { width: 155, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9);
  ['Invoice #: 10482', 'Date: September 1, 2026', 'Due Date: October 1, 2026', 'Terms: Net 30']
    .forEach((t, i) => doc.text(t, 400, 68 + i * 13, { width: 155, align: 'right', lineBreak: false }));

  doc.font('Helvetica-Bold').text('Bill To:', LEFT, 140, { lineBreak: false }).text('Ship To:', 300, 140, { lineBreak: false });
  doc.font('Helvetica');
  ['Harbor Cafe LLC', '45 Ocean Ave', 'Portland, OR 97201'].forEach((t, i) => doc.text(t, LEFT, 154 + i * 13, { lineBreak: false }));
  ['Harbor Cafe - Pearl District', '1020 NW Glisan St', 'Portland, OR 97209'].forEach((t, i) => doc.text(t, 300, 154 + i * 13, { lineBreak: false }));

  const columns = [
    { title: 'Item #', width: 70 }, { title: 'Description', width: 215 }, { title: 'Qty', width: 50, align: 'right' },
    { title: 'Unit Price', width: 85, align: 'right' }, { title: 'Amount', width: 95, align: 'right' },
  ];
  const rows = [...US_ITEMS.map(([sku, d, q, p]) => [sku, d, q, usd(p), usd(q * p)]), ['', 'Shipping & Handling', 1, usd(15), usd(15)]];
  let y = drawTable(doc, 225, columns, rows);
  const subtotal = US_ITEMS.reduce((s, [, , q, p]) => s + q * p, 0) + 15;
  const tax = Math.round(subtotal * 8.5) / 100;
  y = totals(doc, y, [['Subtotal', usd(subtotal)], ['Sales Tax (8.5%)', usd(tax)], ['Total Due', usd(subtotal + tax), true]]);
  doc.font('Helvetica').fontSize(9).text('Thank you for your business! Please include the invoice number with your payment.', LEFT, y + 30, { width: WIDTH });
}

const CHALLAN_ITEMS = [
  [40, 'pcs', 'WT-500', 'Bath Towel, white cotton, 600 GSM, 70x140 cm, hotel logo embroidered on the border'],
  [60, 'pcs', 'HT-300', 'Hand Towel 40x60 cm'],
  [6, 'can', 'LHW-5L', 'Liquid Hand Wash 5L refill, lavender'],
  [12, 'bundle', 'TR-2P', 'Toilet Roll 2-ply premium, 10 rolls per bundle, individually wrapped for guest rooms'],
  [2, 'box', 'GB-30', 'Garbage Bags 30 gal, heavy duty'],
];

function deliveryChallan(doc) {
  doc.font('Helvetica-Bold').fontSize(15).text('Metro Linen & Hygiene Supplies', LEFT, 40, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).text('Unit 9, Bhosari MIDC, Pune 411026', LEFT, 60, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(14).text('DELIVERY CHALLAN', LEFT, 90, { width: WIDTH, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(9);
  doc.text('Challan No: DC-7781', LEFT, 125, { lineBreak: false });
  doc.text('Date: 12-09-2026', LEFT, 139, { lineBreak: false });
  doc.text('Vehicle: MH12 AB 4521', LEFT, 153, { lineBreak: false });
  doc.font('Helvetica-Bold').text('Deliver To:', 320, 125, { lineBreak: false });
  doc.font('Helvetica').text('Green Leaf Hotels', 320, 139, { lineBreak: false });
  doc.text('Plot 22, Hinjewadi Phase 1, Pune', 320, 153, { lineBreak: false });

  const columns = [
    { title: 'Qty', width: 45, align: 'right' }, { title: 'Unit', width: 50 }, { title: 'Item Code', width: 80 },
    { title: 'Description', width: 340 },
  ];
  let y = drawTable(doc, 190, columns, CHALLAN_ITEMS);
  const packages = CHALLAN_ITEMS.reduce((s, [q]) => s + q, 0);
  doc.font('Helvetica-Bold').text(`Total Packages: ${packages}`, LEFT, y + 6, { lineBreak: false });
  doc.font('Helvetica').text('Goods received in good condition.', LEFT, y + 40, { lineBreak: false });
  doc.text("Receiver's Signature", 380, y + 80, { width: 175, align: 'right', lineBreak: false });
}

function imageOnlyPdf(png) {
  return makePdf('Scanned invoice', (doc) => {
    doc.image(png, 0, 0, { width: doc.page.width });
  });
}

// ---------------------------------------------------------------------------------------------

const expectations = {
  gst: {
    invoice_number: 'SGT/2026-27/0418', customer_name: 'Sharma Kirana Stores', invoice_date: '2026-09-03',
    items: GST_ITEMS.map(([description, , quantity, unit]) => ({ description, sku: null, quantity, unit })),
  },
  us: {
    invoice_number: '10482', customer_name: 'Harbor Cafe LLC', invoice_date: '2026-09-01',
    items: US_ITEMS.map(([sku, description, quantity]) => ({ description, sku, quantity, unit: null })),
  },
  challan: {
    invoice_number: 'DC-7781', customer_name: 'Green Leaf Hotels', invoice_date: '2026-09-12',
    items: CHALLAN_ITEMS.map(([quantity, unit, sku, description]) => ({ description, sku, quantity, unit })),
  },
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const write = (name, data) => {
    fs.writeFileSync(path.join(OUT, name), data);
    console.log(`wrote tests/fixtures/${name} (${data.length} bytes)`);
  };
  const gst = await makePdf('Tax Invoice SGT/2026-27/0418', gstInvoice);
  const us = await makePdf('Invoice 10482', usInvoice);
  const challan = await makePdf('Delivery Challan DC-7781', deliveryChallan);
  write('gst-tax-invoice.pdf', gst);
  write('us-invoice.pdf', us);
  write('delivery-challan.pdf', challan);
  const expected = {
    'gst-tax-invoice.pdf': { method: 'pdf-text', ...expectations.gst },
    'us-invoice.pdf': { method: 'pdf-text', ...expectations.us },
    'delivery-challan.pdf': { method: 'pdf-text', ...expectations.challan },
  };

  // Page renders need pdf-parse's canvas backend; skip the OCR fixtures if it is unavailable.
  try {
    const usPng = (await renderPdfPages(us, { maxPages: 1, width: 1700 })).images[0];
    write('us-invoice.png', usPng);
    const gstPng = (await renderPdfPages(gst, { maxPages: 1, width: 1700 })).images[0];
    write('scanned-gst-invoice.pdf', await imageOnlyPdf(gstPng));
    expected['us-invoice.png'] = { method: 'ocr', ...expectations.us };
    expected['scanned-gst-invoice.pdf'] = { method: 'ocr', ...expectations.gst };
  } catch (err) {
    console.warn(`skipped PNG / scanned PDF fixtures: page rendering failed (${err.message})`);
  }
  write('expected.json', Buffer.from(`${JSON.stringify(expected, null, 2)}\n`));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
