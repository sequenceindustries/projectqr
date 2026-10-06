/**
 * Browser rendering: the shared vector geometry drawn onto a canvas for
 * PNG/JPG, plus the "scan check" that decodes every design before download.
 */
import { loadDecoder } from './decoder';
import { DEFAULT_DESIGN, fitLogo, geometry, safeColour, toSvg, type Design, type Matrix } from '../../../shared/qr/render';

export { loadDecoder };

export interface LoadedLogo {
  dataUrl: string;
  width: number;
  height: number;
  img: HTMLImageElement;
}

export function drawToCanvas(canvas: HTMLCanvasElement, m: Matrix, d: Design, px: number, logo?: LoadedLogo | null): CanvasRenderingContext2D {
  const g = geometry(m, { ...d, logoScale: logo ? d.logoScale : 0 });
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  // Whole pixels per module keep every edge crisp (fractional sizes blur
  // module edges and trip up some scanners); leftover pixels widen the margin.
  const k = px / g.total >= 1 ? Math.floor(px / g.total) : px / g.total;
  const off = Math.round((px - k * g.total) / 2);
  const fg = safeColour(d.fg, DEFAULT_DESIGN.fg);
  const bg = safeColour(d.bg, DEFAULT_DESIGN.bg);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, px, px);
  ctx.setTransform(k, 0, 0, k, off, off);
  ctx.fillStyle = fg;
  ctx.fill(new Path2D(g.modules));
  ctx.fillStyle = safeColour(d.eye, fg);
  ctx.fill(new Path2D(g.eyes), 'evenodd');
  if (g.logo && logo) {
    ctx.fillStyle = bg;
    ctx.fill(new Path2D(g.logo.plate));
    const f = fitLogo(logo, g.logo.x, g.logo.y, g.logo.w);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logo.img, f.x, f.y, f.w, f.h);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return ctx;
}

export function svgString(m: Matrix, d: Design, px: number, logo?: LoadedLogo | null): string {
  return toSvg(m, d, px, logo ? { dataUrl: logo.dataUrl, width: logo.width, height: logo.height } : null);
}

export function canvasBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), type, type === 'image/jpeg' ? 0.95 : undefined),
  );
}


/**
 * Decode the design the way a phone would see it: rendered small, then
 * read back. Passes only if the decoded text matches exactly.
 */
export async function scanCheck(m: Matrix, d: Design, expected: string, logo?: LoadedLogo | null): Promise<boolean> {
  const decode = await loadDecoder();
  const canvas = document.createElement('canvas');
  // Roughly the pixel size a phone camera captures a QR code at arm's length.
  const px = Math.max(240, Math.min(720, (m.size + d.margin * 2) * 5));
  const ctx = drawToCanvas(canvas, m, d, px, logo);
  const img = ctx.getImageData(0, 0, px, px);
  const r = decode(img.data, px, px, { inversionAttempts: 'attemptBoth' });
  return !!r && r.data === expected;
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
