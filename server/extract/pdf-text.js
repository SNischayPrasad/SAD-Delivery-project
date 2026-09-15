// PDF text layer and page rendering via pdf-parse 2.x (pdf.js + @napi-rs/canvas). Every call runs in a
// short-lived child process (pdf-child.js) with a heap cap and a time limit, so a hostile or broken PDF,
// such as a compressed stream that inflates to gigabytes, fails that one extraction instead of blocking
// or crashing the server. (Worker threads are not used: @napi-rs/canvas crashes on worker teardown.)
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHILD_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pdf-child.js');
const RENDER_WIDTH = 2000; // px; roughly 240 dpi for A4/Letter, a good size for tesseract

/** Limits for one PDF read (mutable so tests can tighten them). */
export const pdfLimits = {
  timeoutMs: 60_000,
  heapMb: 512,
  maxTextChars: 500_000, // text beyond this is cut off (reported as truncated)
  maxTextPages: 200,
};

export class PdfLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PdfLimitError';
  }
}

function runChild(job) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = fork(CHILD_SCRIPT, [], {
        execArgv: [`--max-old-space-size=${pdfLimits.heapMb}`],
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    let stderr = '';
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      settle(value);
    };
    const timer = setTimeout(() => finish(reject, new PdfLimitError('it took too long to read')), pdfLimits.timeoutMs);
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8000) stderr += chunk;
    });
    child.on('message', (msg) => {
      if (msg?.ok) {
        finish(resolve, msg.result);
      } else {
        const err = new Error(msg?.message || 'PDF reading failed');
        err.name = msg?.name || 'Error';
        finish(reject, err);
      }
    });
    child.on('error', (err) => finish(reject, err));
    // 'close' fires after the IPC channel has delivered everything, so a reply is never mistaken for a crash.
    child.on('close', () => {
      const memory = /heap|out of memory|allocation failed/i.test(stderr);
      finish(reject, new PdfLimitError(memory ? 'it needs too much memory to read' : 'the PDF reader stopped unexpectedly'));
    });
    child.send({ ...job, maxTextChars: pdfLimits.maxTextChars, maxTextPages: pdfLimits.maxTextPages }, (err) => {
      if (err) finish(reject, err);
    });
  });
}

/** { text, pages, truncated } — text is capped at pdfLimits.maxTextChars. */
export async function readPdfText(buffer) {
  const result = await runChild({ op: 'text', data: buffer });
  return { text: result.text, pages: result.pages, truncated: Boolean(result.truncated) };
}

// A scanned PDF usually has no text items at all; allow a little stray text (page numbers, stamps).
export function hasUsableText(text) {
  const compact = (text || '').replace(/\s+/g, '');
  return compact.length >= 20 && /[a-z]{3}/i.test(text);
}

export async function renderPdfPages(buffer, { maxPages = 5, width = RENDER_WIDTH } = {}) {
  const result = await runChild({ op: 'render', data: buffer, maxPages, width });
  return {
    images: result.images.map((u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)),
    total: result.total,
    truncated: result.total > result.images.length,
  };
}

export function describePdfError(err) {
  if (err instanceof PdfLimitError) return err.message;
  const name = err && err.name;
  if (name === 'PasswordException') return 'it is password protected';
  if (name === 'InvalidPDFException' || name === 'FormatError') return 'the file is damaged or not a valid PDF';
  return 'the PDF could not be parsed';
}
