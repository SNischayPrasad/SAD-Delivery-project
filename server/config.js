import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

// Live ESM bindings: importers always see the values from the latest loadConfig() call.
export let PORT;
export let DATA_DIR;
export let DB_PATH;
export let UPLOAD_DIR;
export let INVOICE_DIR;
export let PHOTO_DIR;
export let TMP_UPLOAD_DIR;
export let SESSION_TTL_HOURS;
export let MAX_INVOICE_MB;
export let MAX_PHOTO_MB;
export let MAX_PHOTOS_PER_UPLOAD;
export let ADMIN_USERNAME;
export let ADMIN_PASSWORD;
export let ADMIN_PASSWORD_IS_DEFAULT;
export let EXTRACTOR;
export let CLAUDE_MODEL;

const warned = new Set();

/** Number from env; integers are floored before validation. Out-of-range values fall back with a warning. */
function num(name, value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (value === undefined || value === '') return fallback;
  let n = Number(value);
  if (Number.isFinite(n) && integer) n = Math.floor(n);
  if (!Number.isFinite(n) || n <= min || n > max) {
    const key = `${name}=${value}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`Ignoring ${name}=${JSON.stringify(value)}: it must be a number greater than ${min} and at most ${max}. Using ${fallback}.`);
    }
    return fallback;
  }
  return n;
}

function str(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/** Re-reads process.env (plus explicit overrides) into the exported bindings. */
export function loadConfig(overrides = {}) {
  const env = process.env;
  PORT = overrides.port ?? num('PORT', env.PORT, 3000, { min: -1, max: 65535, integer: true });
  DATA_DIR = path.resolve(overrides.dataDir ?? str(env.DATA_DIR, path.join(REPO_ROOT, 'data')));
  DB_PATH = path.join(DATA_DIR, 'tally.db');
  UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
  INVOICE_DIR = path.join(UPLOAD_DIR, 'invoices');
  PHOTO_DIR = path.join(UPLOAD_DIR, 'photos');
  TMP_UPLOAD_DIR = path.join(UPLOAD_DIR, 'tmp');
  // Session expiry must stay a valid ISO date below year 10000 (ISO strings are compared as text).
  SESSION_TTL_HOURS = num('SESSION_TTL_HOURS', env.SESSION_TTL_HOURS, 168, { max: 24 * 365 * 10 });
  MAX_INVOICE_MB = num('MAX_INVOICE_MB', env.MAX_INVOICE_MB, 20, { max: 1024 });
  MAX_PHOTO_MB = num('MAX_PHOTO_MB', env.MAX_PHOTO_MB, 15, { max: 1024 });
  MAX_PHOTOS_PER_UPLOAD = num('MAX_PHOTOS_PER_UPLOAD', env.MAX_PHOTOS_PER_UPLOAD, 10, { max: 100, integer: true });
  ADMIN_USERNAME = str(env.ADMIN_USERNAME, 'admin');
  ADMIN_PASSWORD_IS_DEFAULT = !(typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD !== '');
  ADMIN_PASSWORD = ADMIN_PASSWORD_IS_DEFAULT ? 'admin123' : env.ADMIN_PASSWORD;
  const extractor = str(env.EXTRACTOR, 'auto').toLowerCase();
  EXTRACTOR = ['auto', 'local', 'claude'].includes(extractor) ? extractor : 'auto';
  CLAUDE_MODEL = str(env.CLAUDE_MODEL, 'claude-opus-5');
  return getConfig();
}

export function getConfig() {
  return {
    PORT, DATA_DIR, DB_PATH, UPLOAD_DIR, INVOICE_DIR, PHOTO_DIR, TMP_UPLOAD_DIR, PUBLIC_DIR,
    SESSION_TTL_HOURS, MAX_INVOICE_MB, MAX_PHOTO_MB, MAX_PHOTOS_PER_UPLOAD,
    ADMIN_USERNAME, ADMIN_PASSWORD, EXTRACTOR, CLAUDE_MODEL,
  };
}

loadConfig();
