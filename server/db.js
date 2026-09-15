import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

const SCHEMA = `
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
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  invoice_number TEXT COLLATE NOCASE,
  customer_name TEXT,
  invoice_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','in_progress','submitted','approved','returned')),
  file_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('claude','pdf-text','ocr','none')),
  extraction_warnings TEXT NOT NULL DEFAULT '[]',
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
  note TEXT,
  review_status TEXT CHECK (review_status IN ('ok','issue')),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_events (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('submitted','approved','returned')),
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS checklist_items_invoice ON checklist_items(invoice_id, position);
CREATE INDEX IF NOT EXISTS photos_invoice ON photos(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_events_invoice ON invoice_events(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_events_user ON invoice_events(user_id, invoice_id);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`;

/** Live binding; valid after openDb(). */
export let db = null;

let statements = new Map();
let txDepth = 0;
let commitCallbacks = [];

export function openDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  // SQLite's LIKE and NOCASE only fold ASCII letters; searches and duplicate-number checks use this instead.
  db.function('tally_fold', { deterministic: true }, (value) => (typeof value === 'string' ? foldText(value) : value));
  db.exec(SCHEMA);
  statements = new Map();
  return db;
}

export function closeDb() {
  if (!db) return;
  db.close();
  db = null;
  statements = new Map();
}

/** Cached prepared statement for this connection. */
export function stmt(sql) {
  let s = statements.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

export const nowIso = () => new Date().toISOString();

/** Unicode-aware case folding for search and uniqueness checks ('É' → 'é', full-width 'ＩＮＶ' → 'inv'). */
export function foldText(text) {
  return String(text).normalize('NFKC').toLowerCase();
}

/**
 * Runs fn inside BEGIN/COMMIT (ROLLBACK on throw). Nested calls join the outer transaction.
 * fn must be synchronous.
 */
export function transaction(fn) {
  if (txDepth > 0) {
    txDepth++;
    try { return fn(); } finally { txDepth--; }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  let result;
  try {
    result = fn();
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    commitCallbacks = [];
    throw err;
  } finally {
    txDepth = 0;
  }
  const callbacks = commitCallbacks;
  commitCallbacks = [];
  for (const cb of callbacks) {
    try { cb(); } catch (err) { console.error('afterCommit callback failed:', err); }
  }
  return result;
}

/** Defers cb until the current transaction commits (runs immediately outside a transaction). */
export function afterCommit(cb) {
  if (txDepth > 0) commitCallbacks.push(cb);
  else cb();
}

/** Parses a positive integer route param; returns null when invalid. */
export function parseId(value) {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

/** Escapes % _ and \ for use with LIKE ... ESCAPE '\'. */
export function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * SQL condition + params: invoice_number or customer_name contains term, case-insensitively for any script.
 * Both sides go through tally_fold, and the term is folded before % _ \ are escaped.
 */
export function invoiceSearchWhere(term) {
  const pattern = likePattern(foldText(term));
  return {
    sql: "(tally_fold(i.invoice_number) LIKE ? ESCAPE '\\' OR tally_fold(i.customer_name) LIKE ? ESCAPE '\\')",
    params: [pattern, pattern],
  };
}

export function logEvent(invoiceId, type, userId, note = null) {
  stmt('INSERT INTO invoice_events (invoice_id, type, user_id, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(invoiceId, type, userId ?? null, note ?? null, nowIso());
}
