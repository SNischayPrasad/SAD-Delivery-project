import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceText, parseDate } from '../server/extract/heuristics.js';

const item = (description, quantity, sku = null, unit) => ({ description, sku, quantity, ...(unit !== undefined ? { unit } : {}) });

function check(text, expected) {
  const r = parseInvoiceText(text);
  const got = r.items.map((it, i) => {
    const e = expected.items[i] || {};
    return 'unit' in e ? it : { description: it.description, sku: it.sku, quantity: it.quantity };
  });
  assert.equal(r.invoice_number, expected.invoice_number, 'invoice_number');
  assert.equal(r.customer_name, expected.customer_name, 'customer_name');
  assert.equal(r.invoice_date, expected.invoice_date, 'invoice_date');
  assert.deepEqual(got, expected.items);
  return r;
}

test('US invoice, pdf-parse single spaces, SKU first, $ amounts, shipping row', () => {
  check(`ACME SUPPLY CO.
123 Market Street, Springfield
INVOICE
Invoice #: 10482
Date: Sep 1, 2026
Bill To:
Harbor Cafe LLC
45 Ocean Ave, Portland
Item # Description Qty Unit Price Amount
OM-1L Oat Milk 1L carton 6 $3.20 $19.20
CUP-12 Paper Cups 12oz (sleeve of 50) 10 $4.50 $45.00
CB-2M Charging Cable 2m 3-pin 2 $12.99 $25.98
Shipping 1 $15.00 $15.00
Subtotal $105.18
Tax (8%) $8.41
Total $113.59`, {
    invoice_number: '10482', customer_name: 'Harbor Cafe LLC', invoice_date: '2026-09-01',
    items: [item('Oat Milk 1L carton', 6, 'OM-1L'), item('Paper Cups 12oz (sleeve of 50)', 10, 'CUP-12'),
      item('Charging Cable 2m 3-pin', 2, 'CB-2M')],
  });
});

test('Indian GST tax invoice, tab separated, HSN column, qty with units, CGST/SGST rows', () => {
  check(`TAX INVOICE
Sharma Distributors Pvt Ltd
GSTIN: 27AABCS1234F1Z5
Invoice No.\tGST/2026-27/0142\tDated\t03/09/2026
Buyer (Bill to)
Sharma Kirana Stores
Plot 7, MIDC, Pune
S.No\tDescription of Goods\tHSN/SAC\tQty\tRate\tper\tAmount
1\tBasmati Rice 5kg bag\t1006\t10 bag\t650.00\tbag\t6,500.00
2\tToor Dal 1kg\t0713\t25 kg\t142.00\tkg\t3,550.00
3\tSunflower Oil 1L pouch\t1512\t12 pcs\t185.50\tpcs\t2,226.00
\t\t\t\tTaxable Value\t12,276.00
CGST @ 2.5%\t306.90
SGST @ 2.5%\t306.90
Total\t12,889.80`, {
    invoice_number: 'GST/2026-27/0142', customer_name: 'Sharma Kirana Stores', invoice_date: '2026-09-03',
    items: [item('Basmati Rice 5kg bag', 10, null, 'bag'), item('Toor Dal 1kg', 25, null, 'kg'),
      item('Sunflower Oil 1L pouch', 12, null, 'pcs')],
  });
});

test('EU invoice, quantity before description, EUR comma decimals and 1.250,00', () => {
  check(`Rechnung / Invoice
Invoice Number: RE-2026-0917
Invoice Date: 14.09.2026
Customer: Café Lindenhof GmbH
Qty  Description  Unit Price  Total
3  Espresso Beans 1kg  EUR 24,90  EUR 74,70
12  Ceramic Cup 0,2l  EUR 4,50  EUR 54,00
50  Paper Napkins 33x33cm  EUR 25,00  EUR 1.250,00
Subtotal EUR 1.378,70
VAT 19% EUR 261,95`, {
    invoice_number: 'RE-2026-0917', customer_name: 'Café Lindenhof GmbH', invoice_date: '2026-09-14',
    items: [item('Espresso Beans 1kg', 3), item('Ceramic Cup 0,2l', 12), item('Paper Napkins 33x33cm', 50)],
  });
});

test('delivery challan, SKU after description, UOM column, multi-line description, no prices', () => {
  check(`DELIVERY CHALLAN
Challan No: DC-7781
Date: 12-09-2026
Deliver To: Green Leaf Hotels
Sr. No.  Item Description  Item Code  Qty  UOM
1 Bath Towel, white cotton WT-500 40 pcs
  600 GSM, 70x140 cm
2 Liquid Hand Wash 5L refill LHW-5L 6 can
3 Toilet Roll 2-ply TR-2P 12 bundle
Received by: ________`, {
    invoice_number: 'DC-7781', customer_name: 'Green Leaf Hotels', invoice_date: '2026-09-12',
    items: [item('Bath Towel, white cotton 600 GSM, 70x140 cm', 40, 'WT-500', 'pcs'),
      item('Liquid Hand Wash 5L refill', 6, 'LHW-5L', 'can'), item('Toilet Roll 2-ply', 12, 'TR-2P', 'bundle')],
  });
});

test('OCR output with pipes, l-for-I and O-for-0 slips, and noise lines', () => {
  check(`| ‘ ~ — .
lnvoice No : INV-2291
Customer Name: Blue Door Bakery
Date: 2026-08-28
| # | Item | Qty | Price | Amount |
| 1 | Whole Wheat Flour 10kg | 4 | 18.5O | 74.00 |
| 2 | Brown Sugar 2kg bag | 3 | 6.25 | 18.75 |
~ .. _ ‘
| 3 | Baking Soda 500g | 10 | 1.20 | 12.00 |
Sub Total 104.75`, {
    invoice_number: 'INV-2291', customer_name: 'Blue Door Bakery', invoice_date: '2026-08-28',
    items: [item('Whole Wheat Flour 10kg', 4), item('Brown Sugar 2kg bag', 3), item('Baking Soda 500g', 10)],
  });
});

test('rate before qty, Rs prefixes, Indian lakh grouping, numbers inside descriptions', () => {
  check(`Mehta Electricals Supply
Invoice No: 2026/INV/77
Bill Date: 5 March 2026
Billed To: Mehta Electricals
Particulars Rate Qty Amount
LED Bulb 9W B22 Rs. 85.00 120 Rs. 10,200.00
Copper Wire 1.5 sq mm (90m coil) Rs. 1,450.00 8 Rs. 11,600.00
Industrial Panel Board 3-phase Rs. 1,25,000.00 1 Rs. 1,25,000.00
Total Rs. 1,46,800.00`, {
    invoice_number: '2026/INV/77', customer_name: 'Mehta Electricals', invoice_date: '2026-03-05',
    items: [item('LED Bulb 9W B22', 120), item('Copper Wire 1.5 sq mm (90m coil)', 8),
      item('Industrial Panel Board 3-phase', 1)],
  });
});

test('labels on their own lines, descriptions split above their numbers, tax-inclusive amounts', () => {
  check(`INVOICE
Invoice Number
INV-000512
Invoice Date
2026-07-19
Bill To
Northwind Traders
Description Qty Unit Price Tax % Amount
Wireless Keyboard and Mouse
Combo (Black)
5 29.99 10% 164.95
USB-C Hub 7-in-1 3 45.00 10% 148.50
Monitor Stand Adjustable
2 38.00 10% 83.60
Subtotal 360.00`, {
    invoice_number: 'INV-000512', customer_name: 'Northwind Traders', invoice_date: '2026-07-19',
    items: [item('Wireless Keyboard and Mouse Combo (Black)', 5), item('USB-C Hub 7-in-1', 3),
      item('Monitor Stand Adjustable', 2)],
  });
});

test('S.No + SKU + unit words, US month-first date, repeated header across pages, blank SKU', () => {
  check(`Invoice #INV-88213
Invoice Date: 08/15/2026
Sold To: Riverside Dental Clinic
No. SKU Product Qty Unit Price Total
1 GLV-M-100 Nitrile Gloves Medium 10 box $8.75 $87.50
2 MSK-3PLY Face Masks 3-ply 5 box $6.00 $30.00

-- 1 of 2 --

No. SKU Product Qty Unit Price Total
3 SYR-5ML Disposable Syringe 5ml 200 pcs $0.15 $30.00
4 Cotton Rolls 2 pack $4.25 $8.50
Subtotal $156.00`, {
    invoice_number: 'INV-88213', customer_name: 'Riverside Dental Clinic', invoice_date: '2026-08-15',
    items: [item('Nitrile Gloves Medium', 10, 'GLV-M-100', 'box'), item('Face Masks 3-ply', 5, 'MSK-3PLY', 'box'),
      item('Disposable Syringe 5ml', 200, 'SYR-5ML', 'pcs'), item('Cotton Rolls', 2, null, 'pack')],
  });
});

test('no table header: falls back to quantity × price = amount rows and warns', () => {
  const r = check(`RECEIPT
Bill No: 5521
Customer: Anita Rao
Date 01/02/2026
Masala Chai Premium 250g 2 120.00 240.00
Ginger Cookies 6 45.00 270.00
Thank you for shopping
Total 510.00`, {
    invoice_number: '5521', customer_name: 'Anita Rao', invoice_date: '2026-02-01',
    items: [item('Masala Chai Premium 250g', 2), item('Ginger Cookies', 6)],
  });
  assert.ok(r.warnings.includes('No item table header found'));
});

test('decimal quantities with units, Units column, delivery charge skipped, 2+ space columns', () => {
  check(`Fresh Farms Wholesale
INVOICE
Inv No: FF-3301        Date: 22 Aug 2026
Ship To: Olive Tree Restaurant
Product                          Units      Price/Unit     Line Total
Tomatoes (Roma)                  3.5 kg     2.40           8.40
Basil, fresh bunch               12         0.95           11.40
Mozzarella 250g ball             20 pcs     1.85           37.00
Delivery charge                  1          5.00           5.00
Amount Due                                                 61.80`, {
    invoice_number: 'FF-3301', customer_name: 'Olive Tree Restaurant', invoice_date: '2026-08-22',
    items: [item('Tomatoes (Roma)', 3.5, null, 'kg'), item('Basil, fresh bunch', 12, null, null),
      item('Mozzarella 250g ball', 20, null, 'pcs')],
  });
});

test('packing list: S.No, qty and unit before description, continuation line', () => {
  check(`PACKING LIST
Packing List No: PL-2026-118
Invoice No: INV-4410
Dated: 2nd September 2026
Consignee: Coastal Marine Supplies
S.No Qty Unit Description
1 24 rolls Duct Tape 48mm x 50m
2 6 box A4 Paper 80gsm (5 reams)
3 2 set Stainless Steel Shackle 10mm
   with safety pin
4 150 m Nylon Rope 12mm
Total Packages: 32`, {
    invoice_number: 'INV-4410', customer_name: 'Coastal Marine Supplies', invoice_date: '2026-09-02',
    items: [item('Duct Tape 48mm x 50m', 24, null, 'rolls'), item('A4 Paper 80gsm (5 reams)', 6, null, 'box'),
      item('Stainless Steel Shackle 10mm with safety pin', 2, null, 'set'), item('Nylon Rope 12mm', 150, null, 'm')],
  });
});

test('description-and-qty only table where descriptions end in numbers', () => {
  check(`Invoice: 7781-B
Customer
Lakeside School
Description Qty
Whiteboard Marker Set 4 colours 10
Cable 2m 3-pin 25
A4 Paper 80gsm 500 sheets 5
Stapler No. 10 3`, {
    invoice_number: '7781-B', customer_name: 'Lakeside School', invoice_date: null,
    items: [item('Whiteboard Marker Set 4 colours', 10), item('Cable 2m 3-pin', 25),
      item('A4 Paper 80gsm 500 sheets', 5), item('Stapler No. 10', 3)],
  });
});

test('two-column header block glued by pdf-parse tabs; customer and number share lines', () => {
  check(`Bright Office Supplies Inc.
Bill To:\tInvoice No: BOS-5567
Pinecrest Law Group\tInvoice Date: 2026-06-30
220 Elm St\tDue Date: 2026-07-30
Qty\tItem\tDescription\tUnit Cost\tAmount
4\tTNR-85A\tToner Cartridge 85A Black\t64.00\t256.00
10\tPPR-A4\tCopy Paper A4 80gsm, 500 sheets\t5.49\t54.90
1\tCHR-ERG\tErgonomic Office Chair\t289.00\t289.00
Discount (10%)\t-59.99
Subtotal\t539.91`, {
    invoice_number: 'BOS-5567', customer_name: 'Pinecrest Law Group', invoice_date: '2026-06-30',
    items: [item('Toner Cartridge 85A Black', 4, 'TNR-85A'), item('Copy Paper A4 80gsm, 500 sheets', 10, 'PPR-A4'),
      item('Ergonomic Office Chair', 1, 'CHR-ERG')],
  });
});

test('heavy OCR garbage around a GST table with S.No, HSN, Qty, Rate, GST%, Amount', () => {
  check(`=~ :: -- ,, ..
TAX INVOICE ORIGINAL FOR RECIPIENT
Inv. No. : KT/0923     Date : 15-Sep-2026
Details of Receiver (Billed to)
Name : Krishna Textiles
. ' ~ ~
Sl No  Item Name  HSN  Qty  Rate  GST%  Amount
1  Cotton Saree 6.3m printed  5208  15 nos  850.00  5%  13,387.50
2  Silk Dupatta 2.5m  5007  8 nos  1,200.00  5%  10,080.00
 ~~ — '' ,
3  Polyester Lining 44in  5407  40 m  65.00  5%  2,730.00
Taxable Amount  24,395.00
IGST 5%  1,219.75`, {
    invoice_number: 'KT/0923', customer_name: 'Krishna Textiles', invoice_date: '2026-09-15',
    items: [item('Cotton Saree 6.3m printed', 15, null, 'nos'), item('Silk Dupatta 2.5m', 8, null, 'nos'),
      item('Polyester Lining 44in', 40, null, 'm')],
  });
});

test('tesseract layout: columns separated by runs of spaces, side-by-side Bill To / Ship To, misread label', () => {
  check(`Pacific Restaurant Supply Co.                            INVOICE
orders@pacificsupply.example (510) 555-0142                     nvolce #:
2150 Harbor Blvd, Oakland, CA 94607                                  Invoice # 10482
ep         PRY       ple (510)                                    Date: September 1, 2026
Bill To:                                                  Ship To:
Harbor Cafe LLC                                       Harbor Cafe - Pearl District
Item #             Description                                   Qty          Unit Price        Amount
OM-1L           Oat Milk Barista Edition 1L                       12             $3.20            $38.40
DSC-2PK         Espresso Machine Descaler 2-pack                   2            $18.99            $37.98
Shipping & Handling                                                1            $15.00            $15.00
Subtotal                                          $91.38`, {
    invoice_number: '10482', customer_name: 'Harbor Cafe LLC', invoice_date: '2026-09-01',
    items: [item('Oat Milk Barista Edition 1L', 12, 'OM-1L'), item('Espresso Machine Descaler 2-pack', 2, 'DSC-2PK')],
  });
});

test('empty and non-invoice input returns no items with warnings, never throws', () => {
  for (const input of ['', '   \n\n', '~~~ ||| ...', null, 12345]) {
    const r = parseInvoiceText(input);
    assert.deepEqual(r.items, []);
    assert.ok(r.warnings.length > 0);
  }
  const r = parseInvoiceText('Dear customer, please find attached our catalogue for 2026.');
  assert.deepEqual(r.items, []);
  assert.ok(r.warnings.includes('No item table header found'));
});

const rows = (r) => r.items.map((it) => [it.description, it.quantity]);

test('item names starting with totals or stop words (Notebook, Balance, Total, Tax) stay in the table', () => {
  const school = parseInvoiceText(`Invoice No: SCH-101
Customer: Little Oaks School
Description Qty Rate Amount
A4 Copier Paper 80gsm 10 250.00 2,500.00
Notebook Classmate 172 pages 50 40.00 2,000.00
Geometry Box 30 60.00 1,800.00
Total 6,300.00`);
  assert.deepEqual(rows(school), [['A4 Copier Paper 80gsm', 10], ['Notebook Classmate 172 pages', 50], ['Geometry Box', 30]]);

  const toys = parseInvoiceText(`Invoice No: TOY-7
Customer: Play Corner
Description\tQty\tRate\tAmount
Wooden Puzzle Set\t5\t12.00\t60.00
Balance Bike 12 inch\t2\t45.00\t90.00
Total Care Shampoo\t2\t45.00\t90.00
Tax Free Crayons\t3\t4.00\t12.00
Stacking Rings\t4\t8.50\t34.00
Subtotal\t286.00
Balance due\t286.00`);
  assert.deepEqual(rows(toys), [['Wooden Puzzle Set', 5], ['Balance Bike 12 inch', 2], ['Total Care Shampoo', 2],
    ['Tax Free Crayons', 3], ['Stacking Rings', 4]]);
});

test('long wrapped descriptions and a repeated page header block do not end the table', () => {
  const zoho = parseInvoiceText(`Invoice# INV-000231
Bill To
Northwind Offices
# Item & Description Qty Rate Amount
1 Office Chair 2.00 150.00 300.00
Ergonomic mesh back
Adjustable armrests
Lumbar support
Five year warranty
2 Desk Lamp 3.00 20.00 60.00
3 USB3 Hub 7-port 2.00 25.00 50.00
Sub Total 410.00`);
  assert.equal(zoho.invoice_number, 'INV-000231');
  assert.deepEqual(rows(zoho), [
    ['Office Chair Ergonomic mesh back Adjustable armrests Lumbar support Five year warranty', 2],
    ['Desk Lamp', 3], ['USB3 Hub 7-port', 2],
  ]);
  assert.equal(zoho.items[2].sku, null, '"Item & Description" is one column, not a SKU column');

  const twoPages = parseInvoiceText(`Acme Traders
12 Main Road, Pune
Tax Invoice
Invoice No: AT/2026/88
Bill To: Big Retail
S.No Description Qty Rate Amount
1 Widget A 10 5.00 50.00
2 Widget B 4 12.50 50.00
Acme Traders
12 Main Road, Pune
Tax Invoice (Page 2)
Invoice No: AT/2026/88
Bill To: Big Retail
S.No Description Qty Rate Amount
3 Widget C 2 30.00 60.00
4 Widget D 1 99.00 99.00
Total 259.00`);
  assert.deepEqual(rows(twoPages), [['Widget A', 10], ['Widget B', 4], ['Widget C', 2], ['Widget D', 1]]);
});

test('negative discount values never become the quantity', () => {
  const header = 'Invoice Number: FAK123456\nProduct Title Qty Gross Amount Discounts Taxable Value IGST Total';
  const row = 'Apple iPhone 15 (Black, 128 GB) 1 79900.00 -5000.00 63474.58 11425.42 74900.00';
  for (const text of [`${header}\n${row}\nTotal 74900.00`, `${header.replace(/ (Qty|Gross|Discounts|Taxable|IGST|Total)/g, '\t$1')}\n${row.replace(/ (?=[-\d])/g, '\t')}\nTotal\t74900.00`]) {
    assert.deepEqual(rows(parseInvoiceText(text)), [['Apple iPhone 15 (Black, 128 GB)', 1]]);
  }
  // An unrecognised column ("Offer") shifts the numbers; a plain count still wins over a money value.
  const shifted = parseInvoiceText(`Product Qty Gross Amount Offer Taxable Value IGST Total\n${row}\nTotal 74900.00`);
  assert.deepEqual(rows(shifted), [['Apple iPhone 15 (Black, 128 GB)', 1]]);
  const bracketed = parseInvoiceText('Description Qty Rate Discount Amount\nOak Shelf 3 40.00 (12.00) 108.00\nTotal 108.00');
  assert.deepEqual(rows(bracketed), [['Oak Shelf', 3]]);
});

test('Tally table: wrapped header line, "5 %" rates and ledger rows stay out of descriptions', () => {
  const r = parseInvoiceText(`Sharma Traders
Invoice No.\tST/2026-27/0418\tDated\t10-Sep-2026
Buyer (Bill to)
Sharma Kirana Stores
Sl\tDescription of Goods\tHSN/SAC\tGST\tQuantity\tRate\tper\tAmount
No.\tRate
1\tBasmati Rice 5kg bag\t1006\t5 %\t10 bag\t650.00\tbag\t6,500.00
2\tToor Dal 1kg\t0713\t5 %\t20 kg\t120.00\tkg\t2,400.00
\t\t\t\tOutput CGST\t2.5\t%\t222.50
\t\t\t\tOutput SGST\t2.5\t%\t222.50
Total\t30\t\t\t\t9,345.00`);
  assert.equal(r.invoice_number, 'ST/2026-27/0418');
  assert.deepEqual(r.items, [
    { description: 'Basmati Rice 5kg bag', sku: null, quantity: 10, unit: 'bag' },
    { description: 'Toor Dal 1kg', sku: null, quantity: 20, unit: 'kg' },
  ]);
});

test('wrapped description lines with a number and unit are not separate items', () => {
  const r = parseInvoiceText(`Invoice No: GL-5512
Customer: Green Leaf Hotels
Description Qty Rate Amount
Bath Towel white cotton 40 250.00 10,000.00
Size 70x140 cm, weight 600 g
Hand Towel white 60 90.00 5,400.00
Pack of 12 pcs
Total 15,400.00`);
  assert.deepEqual(rows(r), [['Bath Towel white cotton Size 70x140 cm, weight 600 g', 40], ['Hand Towel white Pack of 12 pcs', 60]]);
});

test('vertically centred multi-line cells keep their first line with their own row', () => {
  const r = parseInvoiceText(`Invoice No: HC-2210
Customer: Harbor Cafe LLC
Description Qty Price Amount
Espresso Machine Descaler 2 18.99 37.98
Stainless Steel
Milk Jug 600ml 4 9.50 38.00
with lid
Subtotal 75.98`);
  assert.deepEqual(rows(r), [['Espresso Machine Descaler', 2], ['Stainless Steel Milk Jug 600ml with lid', 4]]);
});

test('invoice number comes from under its label, not from a phone number or GSTIN in the next cell', () => {
  assert.equal(parseInvoiceText('Invoice #\tPhone: (510) 555-0142\nINV-10482\tBill To: Big Co').invoice_number, 'INV-10482');
  assert.equal(parseInvoiceText('Invoice No.\tGSTIN 27AABCS1234F1Z5\nSD/0142\tState Name: Maharashtra').invoice_number, 'SD/0142');
});

test('"S.N." serial column is recognised, so serial numbers stay out of descriptions', () => {
  const r = parseInvoiceText(`Invoice No: B-551
Party Name: Gupta General Store
S.N. Item Name Qty Unit Price Amount
1 Sugar 50 Kg 42 2100
2 Salt 1 Kg Pack 20 Pcs 25 500
Grand Total 2600`);
  assert.deepEqual(r.items, [
    { description: 'Sugar', sku: null, quantity: 50, unit: 'Kg' },
    { description: 'Salt 1 Kg Pack', sku: null, quantity: 20, unit: 'Pcs' },
  ]);
});

test('a line with hundreds of numbers is parsed without stalling', () => {
  const numbers = Array.from({ length: 1200 }, (_, i) => `${(i % 97) + 1}.${String(i % 100).padStart(2, '0')}`).join(' ');
  const started = Date.now();
  parseInvoiceText(`Invoice No: X-1\nCustomer: Big Co\nItem ${numbers} 5% 12%\nDescription Qty Rate Amount\nWidget ${numbers} 2 3.00 6.00`);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});

test('parseDate formats', () => {
  assert.equal(parseDate('2026-09-01'), '2026-09-01');
  assert.equal(parseDate('01/09/2026'), '2026-09-01');
  assert.equal(parseDate('01-09-2026'), '2026-09-01');
  assert.equal(parseDate('09/25/2026'), '2026-09-25');
  assert.equal(parseDate('1 Sep 2026'), '2026-09-01');
  assert.equal(parseDate('01-Sep-2026'), '2026-09-01');
  assert.equal(parseDate('September 1, 2026'), '2026-09-01');
  assert.equal(parseDate('Sept 1 2026'), '2026-09-01');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('no date here'), null);
});
