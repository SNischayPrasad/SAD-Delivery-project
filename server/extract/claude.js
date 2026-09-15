// Claude structured-output extraction. Returns { ok, data } or { ok: false, reason } — never throws.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

export const CLAUDE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MAX_CLAUDE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CLAUDE_PDF_BYTES = 22 * 1024 * 1024; // base64 inflates by 4/3; request limit is 32 MB
const REQUEST_OPTIONS = { timeout: 120_000, maxRetries: 1 };

export const InvoiceSchema = z.object({
  invoice_number: z.string().nullable(),
  customer_name: z.string().nullable(),
  invoice_date: z.string().nullable(),
  items: z.array(z.object({
    description: z.string(),
    sku: z.string().nullable(),
    quantity: z.number(),
    unit: z.string().nullable(),
  })),
});

const PROMPT = `Read this invoice for a warehouse picking checklist.
- invoice_number: the invoice (or bill / challan) number exactly as printed.
- customer_name: the buyer or bill-to party, not the seller.
- invoice_date: the invoice date as YYYY-MM-DD; null if missing or ambiguous.
- items: one entry per physical goods line, in printed order. description: product text as printed, without the code; sku: the item code / SKU / part number if printed, else null (HSN/SAC tax codes are not SKUs); quantity: the number of units to pick, as a number (never the price or amount); unit: e.g. pcs, kg, box, or null.
- Skip lines that are not goods: shipping, delivery or service charges, discounts, taxes, subtotals, totals.
Use null for anything not printed.`;

export function hasClaudeCredentials(env = process.env) {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
}

// Why a file cannot be sent to Claude, or null when it can.
export function claudeSkipReason({ mimeType, size }) {
  if (mimeType === 'application/pdf') return size > MAX_CLAUDE_PDF_BYTES ? 'the PDF is too large to send' : null;
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'HEIC images are not supported';
  if (!CLAUDE_IMAGE_TYPES.has(mimeType)) return 'this file type is not supported';
  if (size > MAX_CLAUDE_IMAGE_BYTES) return 'the image is larger than 5 MB';
  return null;
}

export function buildClaudeRequest({ buffer, mimeType }) {
  const source = { type: 'base64', media_type: mimeType, data: buffer.toString('base64') };
  const fileBlock = mimeType === 'application/pdf' ? { type: 'document', source } : { type: 'image', source };
  return {
    model: process.env.CLAUDE_MODEL || 'claude-opus-5',
    max_tokens: 16000,
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: PROMPT }] }],
    output_config: { format: zodOutputFormat(InvoiceSchema) },
  };
}

export async function extractWithClaude({ buffer, mimeType }) {
  if (!hasClaudeCredentials()) return { ok: false, reason: 'no API credentials are configured' };
  try {
    const client = new Anthropic(); // resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN itself
    // messages.create (not messages.parse): parse() validates the text before stop_reason can be checked,
    // so a refusal or a cut-off response would surface as a generic client error.
    const response = await client.messages.create(buildClaudeRequest({ buffer, mimeType }), REQUEST_OPTIONS);
    if (response.stop_reason === 'refusal') return { ok: false, reason: 'the model declined to read this file' };
    if (response.stop_reason === 'max_tokens') return { ok: false, reason: 'the response was cut off' };
    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'no structured result was returned' };
    }
    const parsed = InvoiceSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: 'the result did not match the expected format' };
    return { ok: true, data: parsed.data };
  } catch (err) {
    const reason = describeError(err);
    console.warn(`[extract] Claude extraction failed: ${reason}`);
    return { ok: false, reason };
  }
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'invalid API credentials';
  if (err instanceof Anthropic.PermissionDeniedError) return 'the API key is not allowed to do this';
  if (err instanceof Anthropic.NotFoundError) return 'model not found';
  if (err instanceof Anthropic.RateLimitError) return 'rate limited, try again later';
  if (err instanceof Anthropic.BadRequestError) return 'the API rejected the request';
  if (err instanceof Anthropic.InternalServerError) return 'the API had a server error';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'the request timed out';
  if (err instanceof Anthropic.APIConnectionError) return 'could not reach the API';
  if (err instanceof Anthropic.APIError) return `API error${err.status ? ` ${err.status}` : ''}`;
  if (err instanceof Anthropic.AnthropicError) return 'the AI client is not configured correctly';
  return 'unexpected error';
}
