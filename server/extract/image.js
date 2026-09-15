// Image checks before OCR: pixel limits from the file header (no decoding) and EXIF orientation.

export const imageLimits = {
  maxOcrPixels: 25_000_000, // larger images are scaled down before OCR
  maxDecodePixels: 100_000_000, // larger images are refused without decoding them
};

export class ImageTooLargeError extends Error {
  constructor({ width, height }) {
    super(`the image is ${width} × ${height} pixels`);
    this.name = 'ImageTooLargeError';
    this.width = width;
    this.height = height;
  }
}

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** { type, width, height, orientation } read from the header, or null when the format is not recognised. */
export function imageInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 26) return null;
  try {
    if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') {
      return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), orientation: 1 };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) return jpegInfo(buf);
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return webpInfo(buf);
    if (buf.toString('latin1', 0, 3) === 'GIF') {
      return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), orientation: 1 };
    }
    if (buf.toString('latin1', 0, 2) === 'BM') {
      return { type: 'bmp', width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)), orientation: 1 };
    }
  } catch {
    return null; // truncated header
  }
  return null;
}

function jpegInfo(buf) {
  let orientation = 1;
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) return null;
    const marker = buf[pos + 1];
    if (marker === 0xff) { pos += 1; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { pos += 2; continue; }
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2) return null;
    if (marker === 0xe1 && buf.toString('latin1', pos + 4, pos + 10) === 'Exif\0\0') {
      orientation = exifOrientation(buf, pos + 10, pos + 2 + length) || orientation;
    }
    if (SOF_MARKERS.has(marker)) {
      return { type: 'jpeg', width: buf.readUInt16BE(pos + 7), height: buf.readUInt16BE(pos + 5), orientation };
    }
    if (marker === 0xda) return null; // image data before any frame header
    pos += 2 + length;
  }
  return null;
}

// Orientation tag (0x0112) from IFD0, in either byte order ("II" little-endian or "MM" big-endian).
function exifOrientation(buf, tiff, end) {
  if (tiff + 8 > end) return 0;
  const order = buf.toString('latin1', tiff, tiff + 2);
  if (order !== 'II' && order !== 'MM') return 0;
  const le = order === 'II';
  const u16 = (at) => (le ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const u32 = (at) => (le ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 0;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 0;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 0;
    }
  }
  return 0;
}

function webpInfo(buf) {
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, orientation: 1 };
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, orientation: 1 };
  }
  if (chunk === 'VP8X') return { type: 'webp', width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1, orientation: 1 };
  return null;
}

/**
 * Returns an image buffer ready for tesseract: upright (EXIF orientation applied, since tesseract.js only
 * understands big-endian EXIF) and at most maxOcrPixels. Throws ImageTooLargeError above maxDecodePixels.
 */
export async function prepareForOcr(buffer) {
  const info = imageInfo(buffer);
  if (!info) return buffer;
  const pixels = info.width * info.height;
  if (!(pixels > 0)) return buffer;
  if (pixels > imageLimits.maxDecodePixels) throw new ImageTooLargeError(info);
  if (info.orientation === 1 && pixels <= imageLimits.maxOcrPixels) return buffer;

  let canvasLib;
  try {
    canvasLib = await import('@napi-rs/canvas');
  } catch {
    if (pixels > imageLimits.maxOcrPixels) throw new ImageTooLargeError(info);
    return buffer;
  }
  const img = await canvasLib.loadImage(buffer); // applies EXIF orientation (both byte orders)
  const scale = Math.min(1, Math.sqrt(imageLimits.maxOcrPixels / (img.width * img.height)));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.encode('png');
}
