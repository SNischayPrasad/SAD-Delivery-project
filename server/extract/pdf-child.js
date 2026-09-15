// Child process used by pdf-text.js: reads one PDF (text layer or page images), replies once and exits.
// Running pdf.js here keeps a hostile PDF's memory use and CPU time out of the server process.
import { PDFParse, VerbosityLevel } from 'pdf-parse';

process.once('message', async (job) => {
  let reply;
  let parser = null;
  try {
    parser = new PDFParse({ data: new Uint8Array(job.data), verbosity: VerbosityLevel.ERRORS });
    reply = { ok: true, result: job.op === 'render' ? await render(parser, job) : await readText(parser, job) };
  } catch (err) {
    reply = { ok: false, name: err?.name || 'Error', message: String(err?.message || err) };
  } finally {
    await parser?.destroy().catch(() => {});
  }
  process.send(reply, () => process.exit(0));
});

async function readText(parser, { maxTextChars, maxTextPages }) {
  const result = await parser.getText({ first: maxTextPages, pageJoiner: '' });
  let text = result.pages.map((p) => p.text).join('\n');
  const truncated = text.length > maxTextChars || result.total > result.pages.length;
  if (text.length > maxTextChars) text = text.slice(0, maxTextChars);
  return { text, pages: result.total, truncated };
}

async function render(parser, { maxPages, width }) {
  const shot = await parser.getScreenshot({ first: maxPages, desiredWidth: width, imageDataUrl: false, imageBuffer: true });
  return { images: shot.pages.map((p) => p.data), total: shot.total };
}
