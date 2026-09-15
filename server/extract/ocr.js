// tesseract.js OCR with one lazily created worker that is reused across calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createWorker, OEM } from 'tesseract.js';
import { prepareForOcr } from './image.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANG = 'eng';
// Same file tesseract.js fetches by default for LSTM-only English. We download it ourselves so a
// network failure surfaces as a clean error instead of a worker that never finishes loading.
const LANG_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';
const DOWNLOAD_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 60_000;
// PSM 6 (one uniform block) keeps table rows on one line; the default layout analysis splits columns.
const PARAMETERS = { tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' };

export class OcrUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}

export function ocrCacheDir() {
  return path.join(process.env.DATA_DIR || path.join(REPO_ROOT, 'data'), 'cache');
}

let workerPromise = null;

async function ensureLanguageData(dir) {
  const file = path.join(dir, `${LANG}.traineddata`);
  const existing = await fs.stat(file).catch(() => null);
  if (existing && existing.size > 1_000_000) return;
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    throw new OcrUnavailableError('the OCR cache folder could not be created');
  }
  let body;
  try {
    const res = await fetch(LANG_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = Buffer.from(await res.arrayBuffer());
  } catch {
    throw new OcrUnavailableError('OCR language data could not be downloaded; check the internet connection');
  }
  const data = body[0] === 0x1f && body[1] === 0x8b ? zlib.gunzipSync(body) : body;
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

async function startWorker() {
  const cachePath = ocrCacheDir();
  await ensureLanguageData(cachePath);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new OcrUnavailableError('the OCR engine failed to start'));
    };
    const timer = setTimeout(fail, START_TIMEOUT_MS);
    // errorHandler also prevents tesseract.js from throwing job errors as uncaught exceptions.
    createWorker(LANG, OEM.LSTM_ONLY, { cachePath, cacheMethod: 'readOnly', errorHandler: fail }).then(async (worker) => {
      if (settled) {
        await worker.terminate();
        return;
      }
      await worker.setParameters(PARAMETERS).catch(() => {});
      settled = true;
      clearTimeout(timer);
      resolve(worker);
    }, fail);
  });
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = startWorker().catch((err) => {
      workerPromise = null;
      throw err instanceof OcrUnavailableError ? err : new OcrUnavailableError('the OCR engine failed to start');
    });
  }
  return workerPromise;
}

// Resolves when OCR is ready; rejects with OcrUnavailableError otherwise.
export async function ensureOcr() {
  await getWorker();
}

/** Time limit for one recognize job (mutable so tests can tighten it). */
export const ocrLimits = { recognizeTimeoutMs: 120_000 };

export class OcrTimeoutError extends Error {
  constructor() {
    super('text recognition took too long');
    this.name = 'OcrTimeoutError';
  }
}

// image: Buffer (PNG/JPEG/WEBP/BMP) or file path. Returns the recognised text.
// Buffers are checked first (pixel limit, EXIF orientation); see image.js.
export async function ocrImage(image) {
  const input = Buffer.isBuffer(image) ? await prepareForOcr(image) : image;
  const worker = await getWorker();
  const job = worker.recognize(input);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OcrTimeoutError()), ocrLimits.recognizeTimeoutMs);
  });
  try {
    const { data } = await Promise.race([job, timeout]);
    return data.text || '';
  } catch (err) {
    if (err instanceof OcrTimeoutError) {
      // The shared worker is stuck on this job and every later call would queue behind it: replace it.
      job.catch(() => {});
      await terminateOcr();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function terminateOcr() {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // never started
  }
}
