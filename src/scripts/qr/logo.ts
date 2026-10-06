/**
 * Logo intake. Nothing is uploaded: the file is checked, decoded and
 * re-encoded as a small PNG in the browser. Re-encoding strips metadata
 * and anything that isn't pixels; SVG files are not accepted at all.
 */
import type { LoadedLogo } from './draw';

export const LOGO_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  minSide: 16,
  maxSide: 6000,
  /** Re-encoded logo is at most this many pixels on its long side. */
  outSide: 512,
};

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export class LogoError extends Error {}

function sniff(b: Uint8Array): 'png' | 'jpeg' | 'webp' | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new LogoError('Please upload a valid image.'));
    img.src = src;
  });
}

export async function readLogo(file: File): Promise<LoadedLogo> {
  if (!TYPES.has(file.type)) throw new LogoError('Please upload a valid image (PNG, JPG or WebP).');
  if (file.size > LOGO_LIMITS.maxBytes) throw new LogoError('That image is over 2 MB. Please use a smaller logo.');
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniff(head)) throw new LogoError('Please upload a valid image.');

  const url = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new LogoError('Please upload a valid image.');
  if (Math.min(w, h) < LOGO_LIMITS.minSide) throw new LogoError('That image is too small. Use a logo at least 16 pixels wide.');
  if (Math.max(w, h) > LOGO_LIMITS.maxSide) throw new LogoError('That image is too large. Use a logo under 6000 pixels wide.');
  if (Math.max(w, h) / Math.min(w, h) > 4) throw new LogoError('That logo is very wide. Use a squarer version so it fits inside the QR code.');

  const k = Math.min(1, LOGO_LIMITS.outSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cw, ch);
  const dataUrl = c.toDataURL('image/png');
  return { dataUrl, width: cw, height: ch, img: await loadImage(dataUrl) };
}
