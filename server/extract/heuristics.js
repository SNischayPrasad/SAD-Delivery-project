// Pure, synchronous text → invoice fields parser. Input is pdf-parse or OCR text.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december'];

const UNIT_WORDS = new Set(['pc', 'pcs', 'pce', 'piece', 'pieces', 'nos', 'unit', 'units', 'ea', 'each', 'box',
  'boxes', 'bx', 'kg', 'kgs', 'g', 'gm', 'gms', 'gram', 'grams', 'ltr', 'ltrs', 'l', 'lt', 'litre', 'litres',
  'liter', 'liters', 'ml', 'm', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'metres', 'ft', 'set', 'sets', 'pack',
  'packs', 'pkt', 'pkts', 'packet', 'packets', 'carton', 'cartons', 'ctn', 'ctns', 'dozen', 'doz', 'dz', 'pair',
  'pairs', 'roll', 'rolls', 'bag', 'bags', 'bottle', 'bottles', 'btl', 'btls', 'can', 'cans', 'case', 'cases',
  'tube', 'tubes', 'sheet', 'sheets', 'ream', 'reams', 'bundle', 'bundles', 'tin', 'tins', 'jar', 'jars',
  'sack', 'sacks', 'drum', 'drums', 'tray', 'trays', 'crate', 'crates', 'hr', 'hrs', 'hour', 'hours', 'sqft',
  'sqm', 'cm', 'mm', 'lb', 'lbs', 'oz', 'gal', 'kit', 'kits', 'coil', 'coils', 'bar', 'bars', 'loaf', 'loaves']);

const EMPTY = { invoice_number: null, customer_name: null, invoice_date: null, items: [] };

export function parseInvoiceText(text) {
  const lines = normalizeLines(typeof text === 'string' ? text : '');
  if (!lines.some((l) => /[a-z]{2}/i.test(l))) {
    return { ...EMPTY, items: [], warnings: ['No readable text found'] };
  }
  const warnings = [];
  const invoice_number = findInvoiceNumber(lines);
  const customer_name = findCustomer(lines);
  const table = findItems(lines);
  const invoice_date = findDate(lines, table.headerIndex);
  if (!invoice_number) warnings.push('Invoice number not found');
  if (!customer_name) warnings.push('Customer name not found');
  warnings.push(...table.warnings);
  return { invoice_number, customer_name, invoice_date, items: table.items, warnings };
}

// ---------------------------------------------------------------------------------------------
// Text normalisation

function normalizeLines(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .split('\n')
    // Wide gaps (OCR with preserved spaces) and table pipes separate cells just like pdf-parse tabs.
    .map((l) => l.replace(/ {3,}/g, '\t').replace(/\s*[|¦│]\s*/g, '\t').replace(/[ ]+\t|\t[ ]+/g, '\t').replace(/\s+$/, '').replace(/^\s+/, ''))
    .filter((l) => l && !/^-- \d+ of \d+ --$/.test(l));
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// Invoice number

const INVOICE_LABELS = [
  /\b[il1]nvoice\s*(?:number|num\b|no\b\.?|nr\b\.?|#|id\b)/i,
  /\binv\b\.?\s*(?:no\b\.?|number|#)/i,
  /\bbill\s*(?:no\b\.?|number|#)/i,
  /\b[il1]nvoice\s*:/i,
  /\b(?:challan|delivery\s*(?:note|challan)|packing\s*(?:list|slip)|d\.?c\.?)\s*(?:no\b\.?|number|#)/i,
];

const DATE_TOKEN = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}$/;

const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
// A neighbouring cell that carries its own label ("Phone: …", "GSTIN …") never holds the invoice number.
const NEIGHBOUR_LABEL = /^\s*(?:ph(?:one)?|tel(?:ephone)?|mob(?:ile)?|cell|fax|e-?mail|web(?:site)?|gstin|gst|uin|pan|cin|tan|vat|tin|abn|ein|p\.?\s*o\b\.?|order|ref(?:erence)?|date|dated|due|state|place|a\/c|account|ifsc|swift|iban|contact|pin|zip)(?:\s*(?:no|number|#)\b\.?)?(?=[\s:#.]|$)/i;
const PHONE_CELL = /^[\s+().\d-]{7,}$/;

function invoiceToken(str) {
  const tokens = str.replace(/^[\s:#.=-]+/, '').split(/\s+/).slice(0, 3);
  for (const raw of tokens) {
    const tok = raw.replace(/^[(#:]+/, '').replace(/[.,;:)]+$/, '');
    if (!/\d/.test(tok) || DATE_TOKEN.test(tok) || GSTIN_SHAPE.test(tok)) continue;
    if (/^[A-Za-z0-9][A-Za-z0-9\-/_.]*$/.test(tok)) return tok;
  }
  return null;
}

function findInvoiceNumber(lines) {
  for (const label of INVOICE_LABELS) {
    for (let i = 0; i < lines.length; i++) {
      const m = label.exec(lines[i]);
      if (!m) continue;
      const cells = lines[i].slice(m.index + m[0].length).split('\t');
      const sameCell = invoiceToken(cells[0]);
      if (sameCell) return sameCell;
      const next = i + 1 < lines.length ? lines[i + 1] : null;
      // Column-style header: the value printed under the label, when that cell holds just a value.
      const labelCell = lines[i].slice(0, m.index).split('\t').length - 1;
      const under = next?.split('\t')[labelCell];
      if (under && under.trim().split(/\s+/).length <= 2 && !/[a-z]{3,}\s*:/i.test(under)) {
        const tok = invoiceToken(under);
        if (tok) return tok;
      }
      // The next cell on the label's own line, unless it is another field ("Phone: (510) 555-0142").
      const neighbour = cells.slice(1).find((c) => c.trim());
      if (neighbour && !NEIGHBOUR_LABEL.test(neighbour) && !PHONE_CELL.test(neighbour)) {
        const tok = invoiceToken(neighbour);
        if (tok) return tok;
      }
      if (next && cells.length === 1) {
        const fromNext = invoiceToken(next);
        if (fromNext && !/[a-z]{3,}\s*:/i.test(next.split(fromNext)[0])) return fromNext;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Customer

const CUSTOMER_LABELS = [
  /\b(?:bill(?:ed)?\s*to|sold\s*to|invoice\s*to|customer\s*name|details\s*of\s*(?:receiver|buyer))\b/i,
  /\b(?:buyer|customer|client(?:\s*name)?|party(?:\s*name)?)\b(?!\s*(?:'s|id\b|no\b|number|#|po\b|p\.o|gstin|code|copy|account|a\/c|ref|order|signature|sign))/i,
  /\b(?:ship(?:ped)?\s*to|deliver(?:ed|y)?\s*to|consignee)\b/i,
];

const LABEL_CUT = /\s(?:[il1]nvoice|inv\.?\s*(?:no|#|date)|bill\s*(?:no|date|#)|date|dated|gstin|gst\s*(?:no|in)|pan\b|phone|ph\.|tel\b|tel\.|mobile|mob\.|email|e-mail|ship(?:ped)?\s*to|bill(?:ed)?\s*to|sold\s*to|deliver(?:ed|y)?\s*to|consignee|place\s*of\s*supply|state\s*code|p\.?o\.?\s*(?:no|number|#)|order\s*(?:no|date|#)|due\b|terms|challan|attn|account\s*no)\b/i;

const NOT_A_NAME = /^(?:name|address|details|same\s+as\s+(?:above|billing)|n\/?a|gstin|state|phone|email)\b/i;

function cleanCustomer(value) {
  let v = ' ' + value.split('\t')[0];
  const cut = LABEL_CUT.exec(v);
  if (cut) v = v.slice(0, cut.index);
  v = v.replace(/^[\s:.,)\]-]+/, '').replace(/^name\s*[:-]\s*/i, '').replace(/^m\/s\.?\s*/i, '');
  v = clean(v.replace(/[\s,;:-]+$/, ''));
  if ((v.match(/[a-z]/gi) || []).length < 2 || NOT_A_NAME.test(v) || v.length > 80) return null;
  return v;
}

function findCustomer(lines) {
  for (const label of CUSTOMER_LABELS) {
    for (let i = 0; i < lines.length; i++) {
      const m = label.exec(lines[i]);
      if (!m) continue;
      let rest = lines[i].slice(m.index + m[0].length).replace(/^\s*\([^)]*\)/, '');
      const sep = /^\s*(?:name)?\s*[:-]/i.test(rest) || /^\s*$/.test(rest) || /^\t/.test(rest);
      if (!sep && !/to$/i.test(m[0])) continue; // "Customer Harbor" without a separator is too loose
      const same = cleanCustomer(rest);
      if (same) return same;
      // Next non-empty line, cell under the label when columns line up.
      const next = lines[i + 1];
      if (!next || /^[A-Za-z .]{2,20}\s*:/.test(next) && !/^name\s*:/i.test(next)) continue;
      const labelCell = lines[i].slice(0, m.index).split('\t').length - 1;
      const cells = next.split('\t');
      const value = cleanCustomer(cells.length > labelCell ? cells[labelCell] : cells[0]) || cleanCustomer(next);
      if (value && !INVOICE_LABELS.some((re) => re.test(value))) return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Date

const DATE_LABELS = [
  /\b(?:[il1]nvoice|inv\.?|bill|challan|document|doc\.?)\s*date\b/i,
  /\bdate\s*of\s*(?:invoice|issue)\b/i,
  /\bdated\b|\bdt\.?(?=\s*[:\d])/i,
  /(?<!(?:due|order|delivery|ship|shipping|supply|po|p\.o\.|payment|expiry|dispatch|lr|e-way|ack|birth|start|end|from|to)\s*)\bdate\b/i,
];

function validDate(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function monthIndex(word) {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return 0;
  const idx = MONTHS.findIndex((name) => name.startsWith(w) || (w === 'sept' && name === 'september'));
  return idx + 1;
}

const year4 = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));

export function parseDate(str) {
  const found = [];
  let m;
  const iso = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = iso.exec(str))) found.push({ at: m.index, v: validDate(+m[1], +m[2], +m[3]) });
  const num = /(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/.-])/g;
  while ((m = num.exec(str))) {
    const y = year4(m[3]);
    found.push({ at: m.index, v: validDate(y, +m[2], +m[1]) || validDate(y, +m[1], +m[2]) });
  }
  const dmy = /\b(\d{1,2})(?:st|nd|rd|th)?[\s/.,-]*([A-Za-z]{3,9})\.?[\s/.,-]*(\d{4}|\d{2})\b/g;
  while ((m = dmy.exec(str))) {
    const mon = monthIndex(m[2]);
    if (mon) found.push({ at: m.index, v: validDate(year4(m[3]), mon, +m[1]) });
  }
  const mdy = /\b([A-Za-z]{3,9})\.?\s*(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/g;
  while ((m = mdy.exec(str))) {
    const mon = monthIndex(m[1]);
    if (mon) found.push({ at: m.index, v: validDate(+m[3], mon, +m[2]) });
  }
  const best = found.filter((f) => f.v).sort((a, b) => a.at - b.at)[0];
  return best ? best.v : null;
}

function findDate(lines, headerIndex) {
  for (const label of DATE_LABELS) {
    for (let i = 0; i < lines.length; i++) {
      const m = label.exec(lines[i]);
      if (!m) continue;
      const rest = lines[i].slice(m.index + m[0].length);
      const same = parseDate(rest.split('\t').slice(0, 2).join(' ')) || parseDate(rest);
      if (same) return same;
      if (i + 1 < lines.length) {
        const labelCell = lines[i].slice(0, m.index).split('\t').length - 1;
        const cells = lines[i + 1].split('\t');
        const next = (cells.length > labelCell && parseDate(cells[labelCell])) || parseDate(lines[i + 1]);
        if (next) return next;
      }
    }
  }
  const end = headerIndex >= 0 ? headerIndex : Math.min(lines.length, 25);
  for (let i = 0; i < end; i++) {
    if (/\b(?:due|order|delivery|ship|expiry|valid)\b/i.test(lines[i])) continue;
    const d = parseDate(lines[i]);
    if (d) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Item table

const DESC_WORD = /\b(?:description|particulars|items?|products?|goods|article|details|name|material)\b/i;
const QTY_WORD = /\b(?:qty|qnty|quantity|quantities|units)\b|\bno\.?\s*of\s*(?:units|items|pcs|packages)\b/i;

const ROLE_PATTERNS = [
  ['sno', /\b(?:s\.?\s*no|sr\.?\s*no|sl\.?\s*no|serial\s*no|sno|sr|sl|sn)\b\.?|\bs\.\s*n\b\.?|^\s*#|^\s*no\b\.?/gi],
  ['hsn', /\bhsn(?:\s*\/\s*sac)?(?:\s*code)?\b|\bsac(?:\s*code)?\b/gi],
  ['sku', /\b(?:sku|item\s*code|product\s*code|part\s*(?:no|number)|item\s*(?:no\b\.?|number|id\b)|model(?:\s*no)?|art(?:icle)?\.?\s*(?:no|code)|cat(?:alog(?:ue)?)?\.?\s*no|upc|ean|barcode|code|ref)\b|\b(?:item|part)\s*#/gi],
  ['desc', /\b(?:item\s*description|product\s*description|description(?:\s*of\s*goods(?:\s*\/?\s*services)?)?|item\s*name|product\s*name|particulars|goods|items?|products?|article|details|name|material)\b/gi],
  ['qty', /\b(?:qty|qnty|quantity|units|no\.?\s*of\s*(?:units|items|pcs|packages))\b\.?|\bpcs\b/gi],
  ['price', /\b(?:unit\s*(?:price|cost|rate)|price\s*(?:\/|per)\s*unit|rate(?:\s*per\s*unit)?|price|mrp|cost|each)\b/gi],
  ['unit', /\b(?:unit|uom|u\.o\.m|per|measure)\b/gi],
  ['disc', /\bdisc(?:ounts?)?\b\.?(?:\s*%)?/gi],
  ['tax', /\b(?:tax|gst|vat|igst|cgst|sgst)\b(?:\s*(?:rate|%))?|%/gi],
  ['amount', /\b(?:amount|amt|line\s*total|total|net\s*amount|taxable\s*(?:value|amount)|value|ext(?:ended)?\.?\s*(?:price|amount)?|subtotal)\b/gi],
];

const WEAK_DESC = /^(?:items?|products?|article|name|goods|details|material)$/i;
const NUMERIC_ROLES = new Set(['qty', 'price', 'disc', 'tax', 'amount']);

// Totals / stop words end the table only when the line is not itself an item row (see isItemRow).
const TOTALS_LINE = /^\W*(?:sub\s*-?\s*total|grand\s*total|total\b|net\s*(?:total|amount|payable)|amount\s*(?:due|payable|in\s*words|chargeable)|balance\b(?:\s*due)?|taxable\b|tax\b(?!\s*invoice)|(?:c|s|i|ut)?gst\b|vat\b|round(?:ing)?\s*off|less\s*:)/i;
const STOP_LINE = /^\W*(?:terms(?:\s*(?:&|and)\s*conditions)?\b|notes?\b|remarks?\b|bank\s*details\b|payment\s*(?:terms|details|instructions)\b|thank\s*you\b|declaration\b|authori[sz]ed\s*signatory\b|e\.?\s*&\s*o\.?\s*e\b|received\s*by\b|signature\b|for\s+[A-Z][A-Za-z]+\s)/i;
// Tax ledger rows inside the table body ("Output CGST 2.5 % 251.25"), wherever the tax word sits.
const TAX_LEDGER = /\b(?:(?:c|s|i|ut)?gst|vat|cess|tax(?:es)?)\b(?!\s*invoice)/i;
// Words a totals line is made of; an item row still has a real word after removing them.
const TOTALS_VOCAB = /\b(?:sub|grand|totals?|net|amount|amt|due|payable|in|words|chargeable|balance|brought|carried|forward|taxable|tax|value|(?:c|s|i|ut)?gst|vat|cess|round|rounding|off|less|qty|quantity|items?|packages?|pcs|nos|rs|inr|usd|eur|gbp|output|input|rate|of|and|to|be|paid|page|continued|summary|invoice|payment|discount)\b/gi;
// Second line of a wrapped header (Tally prints "Sl / No." and "GST / Rate" over two lines).
const HEADER_CONT_WORD = /^(?:no\.?|#|rate|%|code|per|sac|hsn(?:\/sac)?|value|amount|amt\.?|of|goods|services|unit|uom|qty\.?|disc\.?|\(?(?:rs|inr|usd|eur|gbp)\.?\)?|tax|gst|cgst|sgst|igst|utgst|description|items?|particulars|quantity|mrp|total|price|cost|each|&|\/|-|name|marks?|pkgs?|nos\.?|in|taxable)$/i;
const MAX_ARITHMETIC_NUMBERS = 14;
const MAX_LOOKAHEAD_LINES = 40;
const NON_GOODS = /^(?:shipping|freight|postage|courier|delivery|handling|packing|service|transport(?:ation)?|installation\s*charges?)(?:\s*(?:&|and)\s*(?:handling|forwarding))?(?:\s*(?:charges?|fees?|cost))?\b|\bdiscount\b|\bcoupon\b|round(?:ing)?\s*off|surcharge|\b(?:shipping|delivery|freight|handling|courier)\s*(?:charges?|fees?)\b/i;

function isHeaderContinuation(line) {
  const words = line.replace(/\t/g, ' ').trim().split(/\s+/);
  return !/\d/.test(line) && words.length <= 8 && words.every((w) => HEADER_CONT_WORD.test(w));
}

// A line that starts like a totals / stop / tax line but is a real item ("Notebook …", "Balance Bike 2 45.00 90.00").
function isItemRow(line, roles) {
  if (/^\W*[a-z][a-z\s.&/-]*:/i.test(line)) return false; // "Total Packages: 32", "Notes: …"
  const hasMoney = roles.includes('price') || roles.includes('amount');
  const row = parseRow(line, roles, { requireArithmetic: hasMoney });
  if (row.kind !== 'item') return false;
  return /[a-z]{3,}/i.test(row.description.replace(TOTALS_VOCAB, ' '));
}

function isHeaderLine(line) {
  if (!DESC_WORD.test(line) || !QTY_WORD.test(line)) return false;
  if (/\d[.,]\d{2}\b/.test(line) || TOTALS_LINE.test(line)) return false;
  return line.split(/\s+/).length <= 18;
}

export function headerRoles(header) {
  // Tabs separate cells; keep multi-word labels ("Item Description") from matching across them.
  const text = header.replace(/\t/g, '');
  const hits = [];
  for (const [role, re] of ROLE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0].trim()) { re.lastIndex++; continue; }
      hits.push({ role, at: m.index, end: m.index + m[0].length });
    }
  }
  hits.sort((a, b) => a.at - b.at || (b.end - b.at) - (a.end - a.at));
  const roles = [];
  let lastEnd = -1;
  let weakDesc = -1;
  let weakEnd = -1;
  for (const h of hits) {
    if (h.at < lastEnd) continue;
    lastEnd = h.end;
    let role = h.role;
    const word = text.slice(h.at, h.end);
    if (role === 'desc' && roles.includes('desc')) {
      // "Item | Description": the generic word names a code column.
      if (weakDesc !== roles.indexOf('desc') || WEAK_DESC.test(word)) continue;
      // "Item & Description" (Zoho) names a single column.
      if (/^\s*(?:&|and|\+|\/)\s*$/i.test(text.slice(weakEnd, h.at))) {
        weakDesc = -1;
        continue;
      }
      roles[weakDesc] = 'sku';
      weakDesc = -1;
    } else if (role === 'desc' && WEAK_DESC.test(word)) {
      weakDesc = roles.length;
      weakEnd = h.end;
    }
    if (role === 'qty' && roles.includes('qty')) role = 'unit';
    if (role === 'sno' && roles.length) continue;
    roles.push(role);
  }
  return roles;
}

// Numbers: US 1,250.00 · Indian 1,25,000.00 · EU 1.250,00 · currency prefixes · "250/-" · OCR O/l slips.
function parseNumber(raw) {
  let t = raw.replace(/^(?:rs\.?|inr|usd|eur|gbp|[₹$€£])/i, '').replace(/\/-$/, '').replace(/^@/, '');
  // Negative money ("-5000.00", "(50.00)") stays a number so it keeps its column; it is never a quantity.
  let negative = false;
  const paren = /^\((\d[\d,.]*[.,]\d{2})\)$/.exec(t);
  if (paren) {
    t = paren[1];
    negative = true;
  } else if (/^-\d/.test(t)) {
    t = t.slice(1);
    negative = true;
  }
  if (/^[\dOoIl.,]+$/.test(t) && (t.match(/\d/g) || []).length >= 2) t = t.replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t) || /^\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(t) && !/^\.\d+$/.test(t)) return null;
  const dec = t.includes('.') ? t.split('.')[1].length : 0;
  return { value: negative ? -Number(t) : Number(t), dec };
}

const CURRENCY_TOKEN = /^(?:rs\.?|inr|usd|eur|gbp|[₹$€£])$/i;
const NOISE_TOKEN = /^[-_=~:;,.'"`*•·]+$/;

function tokenize(line) {
  const tokens = [];
  line.split('\t').forEach((cell, cellIndex) => {
    for (const text of cell.trim().split(/\s+/)) {
      if (!text || NOISE_TOKEN.test(text) || CURRENCY_TOKEN.test(text)) continue;
      const last = tokens[tokens.length - 1];
      if (text === '%' && last && last.num !== null && !last.pct && !last.unit) {
        // "5 %" printed with a space (Tally) is one percent value.
        last.pct = true;
        last.text += '%';
        continue;
      }
      const tok = { text, cell: cellIndex, num: null, dec: 0, pct: false, unit: null, isUnitWord: false };
      const bare = text.replace(/[,;]$/, '');
      const pct = /^@?(\d+(?:\.\d+)?)%$/.exec(bare);
      const withUnit = /^(\d+(?:[.,]\d+)?)([A-Za-z]+)\.?$/.exec(bare);
      if (pct) { tok.num = Number(pct[1]); tok.pct = true; }
      else if (withUnit && UNIT_WORDS.has(withUnit[2].toLowerCase())) {
        const n = parseNumber(withUnit[1]);
        if (n) { tok.num = n.value; tok.dec = n.dec; tok.unit = withUnit[2]; }
      } else {
        const n = parseNumber(bare);
        if (n) { tok.num = n.value; tok.dec = n.dec; }
        else if (UNIT_WORDS.has(bare.toLowerCase().replace(/\.$/, ''))) tok.isUnitWord = true;
      }
      tokens.push(tok);
    }
  });
  return tokens;
}

const isQtyValue = (t) => t && t.num !== null && !t.pct && t.num > 0 && t.num < 1e6;
const integerLike = (t) => t.num !== null && !t.pct && t.num > 0 && Number.isInteger(t.num) && (t.dec === 0 || /\.0+$/.test(t.text));
const unitOf = (tokens, i) => tokens[i].unit || (tokens[i + 1] && tokens[i + 1].isUnitWord ? tokens[i + 1].text.replace(/\.$/, '') : null);

function looksLikeCode(tok, role) {
  if (!tok || tok.pct || tok.unit) return false;
  const t = tok.text.replace(/[,;]$/, '');
  if (role === 'hsn') return /^\d{4,8}$/.test(t);
  if (/^\d{4,}$/.test(t)) return true;
  if (t.length < 3 || !/\d/.test(t) || /[a-z]/.test(t)) return false;
  if (/^\d+(?:[.,]\d+)*$/.test(t)) return false;
  return /^[A-Z0-9][A-Z0-9\-_/.#]*$/.test(t);
}

// In a code column, a token that fills its own cell may be a letters-only code like "CHR-ERG".
function codeAt(tokens, i, role) {
  const tok = tokens[i];
  if (looksLikeCode(tok, role)) return true;
  if (role !== 'sku' || !tok || tok.num !== null || tok.unit) return false;
  const alone = tokens[i - 1]?.cell !== tok.cell && tokens[i + 1]?.cell !== tok.cell;
  return alone && /^[A-Z0-9][A-Za-z0-9]*(?:[-_/.#][A-Za-z0-9]+)+$/.test(tok.text);
}

const near = (x, y) => Math.abs(x - y) <= Math.max(0.011, Math.abs(y) * 0.005);

// Find quantity × price ≈ amount among the numeric tokens; returns token indices.
function arithmetic(tokens, qtyBeforePrice, expectedQty) {
  // Only positive values can be a quantity, price or amount. The search is O(n³), so a line with a long run of
  // numbers only considers the rightmost few (where the quantity / price / amount columns are).
  const idx = tokens.map((t, i) => (t.num !== null && !t.pct && t.num > 0 ? i : -1)).filter((i) => i >= 0).slice(-MAX_ARITHMETIC_NUMBERS);
  const rates = tokens.filter((t) => t.pct).map((t) => t.num);
  let best = null;
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const x = tokens[idx[a]].num;
      const y = tokens[idx[b]].num;
      if (!x || !y) continue;
      for (let c = b + 1; c < idx.length; c++) {
        const z = tokens[idx[c]].num;
        const ok = near(x * y, z) || rates.some((r) => near(x * y * (1 + r / 100), z));
        if (!ok) continue;
        const q = qtyBeforePrice ? idx[a] : idx[b];
        const p = qtyBeforePrice ? idx[b] : idx[a];
        let score = 0;
        if (integerLike(tokens[q])) score += 2;
        if (q === expectedQty) score += 2;
        if (tokens[q].unit || (tokens[q + 1] && tokens[q + 1].isUnitWord)) score += 1;
        if (idx[c] === idx[idx.length - 1]) score += 1;
        score += c / 100; // prefer the rightmost triple when otherwise equal
        if (!best || score > best.score) best = { q, p, a: idx[c], score };
      }
    }
  }
  return best;
}

// Parse one table row according to the header's column roles.
export function parseRow(line, roles, { requireArithmetic = false } = {}) {
  const tokens = tokenize(line);
  if (!tokens.length) return { kind: 'noise' };
  const d = roles.indexOf('desc');
  const pre = d >= 0 ? roles.slice(0, d) : [];
  const post = d >= 0 ? roles.slice(d + 1) : roles;
  let quantity = null;
  let unit = null;
  let sku = null;
  let i = 0;

  // Columns before the description, consumed left to right.
  if (!pre.includes('sno') && /^\(?\d{1,3}[.)]$/.test(tokens[0].text) && tokens.length > 2) i = 1;
  for (const role of pre) {
    const tok = tokens[i];
    if (!tok) break;
    if (role === 'sno' && /^\(?\d{1,4}[.)]?$/.test(tok.text) && tokens.length > 1) i++;
    else if ((role === 'sku' || role === 'hsn') && codeAt(tokens, i, role)) { if (role === 'sku') sku = tok.text; i++; }
    else if (role === 'qty' && isQtyValue(tok)) {
      quantity = tok.num; unit = unitOf(tokens, i); i += tok.unit || !unit ? 1 : 2;
    } else if (role === 'unit' && tok.isUnitWord) { unit = tok.text; i++; }
    else if (NUMERIC_ROLES.has(role) && tok.num !== null) i++;
  }
  const rest = tokens.slice(i);
  const postNumeric = post.filter((r) => NUMERIC_ROLES.has(r));
  const qtyPos = postNumeric.indexOf('qty');
  const priceBeforeQty = post.indexOf('price') >= 0 && post.indexOf('price') < post.indexOf('qty');

  // Numeric tail: numbers, percents, and unit words that follow a number.
  let tailStart = rest.length;
  while (tailStart > 0) {
    const t = rest[tailStart - 1];
    if (t.num !== null || (t.isUnitWord && tailStart > 1 && rest[tailStart - 2].num !== null)) tailStart--;
    else break;
  }
  const tailNums = [];
  for (let k = tailStart; k < rest.length; k++) if (rest[k].num !== null) tailNums.push(k);

  let descEnd = rest.length;
  let qIdx = -1;
  let proof = 'columns'; // 'arithmetic' (qty × price = amount), 'columns' (enough numeric columns) or 'fallback'
  if (quantity === null && qtyPos >= 0) {
    const expected = tailNums.length >= postNumeric.length ? tailNums[tailNums.length - postNumeric.length + qtyPos] : -1;
    const tri = arithmetic(rest, !priceBeforeQty, expected);
    if (tri) {
      qIdx = tri.q;
      descEnd = Math.min(tri.q, tri.p, tri.a);
      proof = 'arithmetic';
    } else if (requireArithmetic) {
      return { kind: 'text' };
    } else if (tailNums.length >= postNumeric.length && postNumeric.length) {
      qIdx = expected;
      // A money value (74900.00) in the quantity slot while a smaller plain count sits to its left: the
      // header has a column this parser did not recognise, so trust the count.
      if (rest[qIdx].dec >= 2) {
        const plain = tailNums.filter((k) => k < qIdx && rest[k].dec === 0 && isQtyValue(rest[k]) && rest[k].num < rest[qIdx].num);
        if (plain.length) qIdx = plain[plain.length - 1];
      }
      descEnd = Math.min(tailNums[tailNums.length - postNumeric.length], qIdx);
    } else if (tailNums.length) {
      proof = 'fallback';
      const withUnit = tailNums.filter((k) => rest[k].unit || (rest[k + 1] && rest[k + 1].isUnitWord));
      const ints = tailNums.filter((k) => integerLike(rest[k]));
      // Prefer a plain count over a 2-decimal money value that happens to be whole (74900.00).
      const plain = ints.filter((k) => rest[k].dec === 0);
      const counts = plain.length ? plain : ints;
      if (withUnit.length) qIdx = withUnit[0];
      else if (counts.length) qIdx = qtyPos === postNumeric.length - 1 ? counts[counts.length - 1] : counts[0];
      else if (qtyPos === 0) qIdx = tailNums[0];
      if (postNumeric.length >= 2 && tailNums.length < 2 && !(qIdx >= 0 && unitOf(rest, qIdx))) qIdx = -1;
      descEnd = qIdx >= 0 ? Math.min(qIdx, tailNums[0]) : rest.length;
    }
    if (qIdx >= 0 && isQtyValue(rest[qIdx])) {
      quantity = rest[qIdx].num;
      unit = unitOf(rest, qIdx);
    } else {
      qIdx = -1;
      descEnd = rest.length;
    }
  } else if (quantity !== null && postNumeric.length) {
    // Quantity came before the description; strip trailing price/amount columns.
    const take = Math.min(tailNums.length, postNumeric.length);
    if (take) descEnd = tailNums[tailNums.length - take];
  }
  if (quantity === null) return { kind: 'text' };

  // Code / unit / tax-rate columns sitting between the description and the quantity.
  const qtyRole = post.indexOf('qty');
  const between = qtyRole >= 0 ? post.slice(0, qtyRole) : post.filter((r) => !NUMERIC_ROLES.has(r));
  for (const role of between.reverse()) {
    const tok = rest[descEnd - 1];
    if (!tok || descEnd - 1 < 1) break;
    if (role === 'unit' && tok.isUnitWord) { unit = unit || tok.text; descEnd--; }
    else if ((role === 'sku' || role === 'hsn') && codeAt(rest, descEnd - 1, role)) { if (role === 'sku') sku = tok.text; descEnd--; }
    else if ((role === 'tax' || role === 'disc') && tok.num !== null && (tok.pct || tok.cell !== rest[descEnd - 2].cell)) descEnd--;
  }
  // A code column after the numbers (e.g. "Description Qty SKU").
  if (!sku && post.includes('sku') && post.indexOf('sku') > qtyRole && qtyRole >= 0) {
    const tok = rest.slice(qIdx + 1).find((t) => looksLikeCode(t, 'sku'));
    if (tok) sku = tok.text;
  }

  let description = clean(rest.slice(0, descEnd).map((t) => t.text).join(' '))
    .replace(/^[\s\-:;,.*•]+/, '').replace(/[\s\-:;,*•]+$/, '');
  if ((description.match(/[a-z]/gi) || []).length < 2) description = '';
  return { kind: description ? 'item' : 'numbers', description, sku, quantity, unit: unit ? unit.replace(/\.$/, '') : null, proof };
}

const looksLikeText = (line) => {
  const letters = (line.match(/[a-z]/gi) || []).length;
  const visible = line.replace(/\s/g, '').length;
  return /[a-z]{3,}/i.test(line) && letters / Math.max(visible, 1) >= 0.3;
};

// Reads the table body into rows plus the text lines between them, then decides which row each text line
// belongs to (assignText).
function readTable(lines, start, roles) {
  const hasMoney = roles.includes('price') || roles.includes('amount');
  const rows = [];
  const gaps = [[]]; // gaps[k]: text lines just before rows[k]; the last entry holds the lines after the last row
  let proved = false; // some row showed quantity × price = amount
  let continuesAt = -1;
  const gap = () => gaps[gaps.length - 1];
  const addRow = (row) => {
    rows.push(row);
    gaps.push([]);
    if (row.proof === 'arithmetic') proved = true;
  };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (TOTALS_LINE.test(line) && !isItemRow(line, roles)) break;
    if (isHeaderLine(line)) {
      gap().length = 0; // repeated header on the next page: the lines before it were page furniture
      continue;
    }
    if (STOP_LINE.test(line) && rows.length && !isItemRow(line, roles)) break;
    if (!/[a-z0-9]/i.test(line)) continue;
    if (TAX_LEDGER.test(line) && /\d/.test(line) && !isItemRow(line, roles)) {
      // A tax ledger row is never part of a description; it separates the text around it like a row would.
      if (rows.length) addRow({ skip: true, description: '' });
      else gap().length = 0;
      continue;
    }
    const row = parseRow(line, roles);
    const prev = rows[rows.length - 1];
    if (row.kind === 'numbers') {
      if (gap().length) addRow({ ...row, numbersOnly: true });
    } else if (row.kind === 'item') {
      // "10 rolls per bundle": a wrapped description line that happens to start with a number.
      const wrapped = !gap().length && prev && !prev.skip && !row.sku && /^[a-z]/.test(row.description) && /^[A-Z0-9]/.test(prev.description);
      // "Pack of 12 pcs": a number and unit inside a wrapped description, once real rows proved their arithmetic.
      const loose = hasMoney && proved && row.proof === 'fallback';
      if (wrapped || loose) gap().push(clean(line.replace(/\t/g, ' ')));
      else addRow(row);
    } else if (row.kind === 'text' && looksLikeText(line)) {
      if (NON_GOODS.test(line)) continue;
      gap().push(clean(line.replace(/\t/g, ' ')));
      // A long run of text ends the table unless more rows (or a repeated header) follow soon.
      if (gap().length > 3 && rows.length && i >= continuesAt) {
        continuesAt = findTableContinuation(lines, i + 1, roles);
        if (continuesAt < 0) break;
      }
    }
  }
  return assignText(rows, gaps);
}

// Index of the next row or repeated header within reach, or -1 when the table has ended.
function findTableContinuation(lines, from, roles) {
  const hasMoney = roles.includes('price') || roles.includes('amount');
  for (let j = from; j < Math.min(lines.length, from + MAX_LOOKAHEAD_LINES); j++) {
    const line = lines[j];
    if (isHeaderLine(line)) return j;
    if ((TOTALS_LINE.test(line) || STOP_LINE.test(line)) && !isItemRow(line, roles)) return -1;
    const row = parseRow(line, roles, { requireArithmetic: hasMoney });
    if (row.kind === 'item' || (hasMoney && row.kind === 'numbers')) return j;
  }
  return -1;
}

const continuesText = (text) => /^[a-z(]/.test(text);

function assignText(rows, gaps) {
  if (!rows.length) return [];
  const { above, below } = centredLayout(rows, gaps) || topAlignedLayout(rows, gaps);
  const items = [];
  rows.forEach((row, k) => {
    if (row.skip) return;
    const description = clean([...above[k], row.description, ...below[k]].filter(Boolean).join(' '));
    if (!description || NON_GOODS.test(description.replace(/\(.*?\)/g, '').trim())) return;
    items.push({ description, sku: row.sku, quantity: row.quantity, unit: row.unit });
  });
  return items;
}

// Default: text between rows continues the row above, unless it clearly opens the next row's description.
function topAlignedLayout(rows, gaps) {
  const n = rows.length;
  const above = rows.map(() => []);
  const below = rows.map(() => []);
  for (let k = 0; k < n; k++) {
    const lines = gaps[k];
    if (!lines.length) continue;
    const row = rows[k];
    const forward = k === 0 || row.numbersOnly || continuesText(row.description || '')
      || /(?:[,&/-]|\b(?:and|of|with|for))$/i.test(lines[lines.length - 1]);
    if (forward) above[k] = lines;
    else below[k - 1] = lines;
  }
  if (gaps[n].length <= 2) below[n - 1] = [...below[n - 1], ...gaps[n]];
  return { above, below };
}

// Vertically centred cells (Tally / Zoho / Busy PDFs): a row's extra description lines sit evenly above and
// below its numbers. Used only when every gap fits that pattern exactly and something points to it: text
// before the first row, a numbers-only row, or a lowercase continuation below a row that also has text above.
function centredLayout(rows, gaps) {
  const n = rows.length;
  const above = [];
  const below = [];
  let carry = gaps[0];
  for (let k = 0; k < n; k++) {
    if (carry.some(continuesText) || (rows[k].numbersOnly && !carry.length)) return null;
    above[k] = carry;
    const next = gaps[k + 1];
    const need = carry.length;
    if (next.length < need || (k === n - 1 && next.length !== need)) return null;
    below[k] = next.slice(0, need);
    carry = next.slice(need);
  }
  if (!above.some((lines) => lines.length)) return null;
  const evidence = gaps[0].length > 0 || rows.some((r) => r.numbersOnly) || below.some((lines) => lines.some(continuesText));
  return evidence ? { above, below } : null;
}

function findItems(lines) {
  const warnings = [];
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    let header = null;
    let start = i + 1;
    if (isHeaderLine(lines[i])) header = lines[i];
    else if (DESC_WORD.test(lines[i]) && i + 1 < lines.length && QTY_WORD.test(lines[i + 1]) && !isHeaderLine(lines[i + 1])
      && !/\d/.test(lines[i]) && !/\d/.test(lines[i + 1]) && lines[i].split(/\s+/).length <= 8) {
      header = `${lines[i]}\t${lines[i + 1]}`;
      start = i + 2;
    }
    if (!header) continue;
    if (headerIndex < 0) headerIndex = i;
    const roles = headerRoles(header);
    if (!roles.includes('desc') || !roles.includes('qty')) continue;
    while (start < lines.length && isHeaderContinuation(lines[start])) start++;
    const items = readTable(lines, start, roles);
    if (items.length) return { items, warnings, headerIndex: i };
  }
  // No usable header: accept only lines that prove themselves with quantity × price = amount.
  const items = [];
  const fallbackRoles = ['desc', 'qty', 'price', 'amount'];
  for (const line of lines) {
    if ((TOTALS_LINE.test(line) && !isItemRow(line, fallbackRoles)) || !/[a-z]/i.test(line)) continue;
    const row = parseRow(line, fallbackRoles, { requireArithmetic: true });
    if (row.kind === 'item' && !NON_GOODS.test(row.description)) {
      items.push({ description: row.description, sku: row.sku, quantity: row.quantity, unit: row.unit });
    }
  }
  if (headerIndex < 0) warnings.push('No item table header found');
  else warnings.push('Item table header found but no lines could be read from it');
  if (items.length) warnings.push('Lines were guessed from rows where quantity × price = amount; check them');
  return { items, warnings, headerIndex };
}
