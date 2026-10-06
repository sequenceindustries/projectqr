/**
 * QR matrix → vector geometry.
 *
 * One geometry builder feeds every output: the SVG download, the PNG/JPG
 * canvas (via Path2D, which accepts the same path data) and the live
 * preview. Styles never touch the encoded data; they only change how each
 * dark module is drawn, and every render is decoded again before download.
 */
// Core encoder only (no canvas/terminal renderers) keeps the browser bundle small.
// @ts-expect-error — CommonJS module without types; shape declared below.
import QRCodeCore from 'qrcode/lib/core/qrcode.js';
// @ts-expect-error — CommonJS module without types.
import Alignment from 'qrcode/lib/core/alignment-pattern.js';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';
export type ModuleStyle = 'square' | 'rounded' | 'dots';
export type EyeStyle = 'square' | 'rounded' | 'circle';

export interface Matrix {
  size: number;
  version: number;
  ec: EcLevel;
  /** Row-major, 1 = dark. */
  data: Uint8Array;
}

export interface Design {
  fg: string;
  bg: string;
  /** Colour of the three corner "eyes". Defaults to fg. */
  eye?: string;
  /** Quiet zone in modules. */
  margin: number;
  moduleStyle: ModuleStyle;
  eyeStyle: EyeStyle;
  /** Logo width as a fraction of the code width (excluding margin), 0 = none. */
  logoScale?: number;
}

export const DEFAULT_DESIGN: Design = {
  fg: '#15172e',
  bg: '#ffffff',
  margin: 4,
  moduleStyle: 'square',
  eyeStyle: 'square',
  logoScale: 0,
};

export const LIMITS = {
  marginMin: 2,
  marginMax: 10,
  logoMax: 0.24,
  logoDefault: 0.2,
  sizeMin: 128,
  /** Largest canvas every major browser (including iOS Safari) will allocate. */
  sizeMax: 4096,
};

export class QrTooLongError extends Error {
  constructor() {
    super('too_long');
  }
}

export function encode(data: string, ec: EcLevel): Matrix {
  let qr: { version: number; modules: { size: number; data: Uint8Array } };
  try {
    qr = (QRCodeCore as { create: (d: string, o: object) => typeof qr }).create(data, { errorCorrectionLevel: ec });
  } catch (e) {
    if (/too big|amount of data/i.test(String((e as Error)?.message))) throw new QrTooLongError();
    throw e;
  }
  return { size: qr.modules.size, version: qr.version, ec, data: qr.modules.data };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Is (x, y) inside one of the three 7×7 finder patterns? */
function inFinder(x: number, y: number, n: number): boolean {
  return (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
}

/** Module box hidden behind the logo, in module coordinates (excluding margin). */
export function logoBox(n: number, scale: number): { x: number; y: number; w: number } | null {
  if (!scale || scale <= 0) return null;
  const s = Math.min(scale, LIMITS.logoMax);
  // Same parity as n so the box sits exactly on the centre of the grid.
  let w = Math.round(n * s);
  if ((n - w) % 2) w += 1;
  const x = (n - w) / 2;
  return { x, y: x, w };
}

function rect(x0: number, y0: number, x1: number, y1: number, rtl = 0, rtr = 0, rbr = 0, rbl = 0): string {
  if (!rtl && !rtr && !rbr && !rbl) return `M${r3(x0)} ${r3(y0)}H${r3(x1)}V${r3(y1)}H${r3(x0)}Z`;
  let d = `M${r3(x0 + rtl)} ${r3(y0)}H${r3(x1 - rtr)}`;
  if (rtr) d += `A${rtr} ${rtr} 0 0 1 ${r3(x1)} ${r3(y0 + rtr)}`;
  d += `V${r3(y1 - rbr)}`;
  if (rbr) d += `A${rbr} ${rbr} 0 0 1 ${r3(x1 - rbr)} ${r3(y1)}`;
  d += `H${r3(x0 + rbl)}`;
  if (rbl) d += `A${rbl} ${rbl} 0 0 1 ${r3(x0)} ${r3(y1 - rbl)}`;
  d += `V${r3(y0 + rtl)}`;
  if (rtl) d += `A${rtl} ${rtl} 0 0 1 ${r3(x0 + rtl)} ${r3(y0)}`;
  return d + 'Z';
}

function circle(cx: number, cy: number, r: number): string {
  return `M${r3(cx - r)} ${r3(cy)}A${r} ${r} 0 1 0 ${r3(cx + r)} ${r3(cy)}A${r} ${r} 0 1 0 ${r3(cx - r)} ${r3(cy)}Z`;
}

/** Tiny overlap between touching modules hides anti-aliasing seams. */
const SEAM = 0.02;

export interface Geometry {
  /** Total width/height in modules, including the quiet zone. */
  total: number;
  /** Path data for data modules (fill-rule nonzero). */
  modules: string;
  /** Path data for the three finder patterns (fill-rule evenodd). */
  eyes: string;
  /** Logo plate and image area, in module units, if a logo is used. */
  logo: { plate: string; x: number; y: number; w: number } | null;
}

export function geometry(m: Matrix, d: Design): Geometry {
  const n = m.size;
  const o = Math.max(LIMITS.marginMin, Math.min(LIMITS.marginMax, Math.round(d.margin)));
  const box = logoBox(n, d.logoScale ?? 0);
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && m.data[y * n + x] === 1;
  const hidden = (x: number, y: number) => !!box && x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.w;
  const on = (x: number, y: number) => dark(x, y) && !inFinder(x, y, n) && !hidden(x, y);

  // Alignment patterns stay solid in the dot style: many readers locate them
  // by their ring shape, and a ring of dots is not a ring.
  const align = new Set<number>();
  if (d.moduleStyle === 'dots' && m.version > 1) {
    const coords: number[] = (Alignment as { getRowColCoords: (v: number) => number[] }).getRowColCoords(m.version);
    for (const cy of coords)
      for (const cx of coords) {
        if (inFinder(cx, cy, n)) continue;
        for (let yy = cy - 2; yy <= cy + 2; yy++) for (let xx = cx - 2; xx <= cx + 2; xx++) align.add(yy * n + xx);
      }
  }
  const inAlign = (x: number, y: number) => align.has(y * n + x);

  const parts: string[] = [];
  for (let y = 0; y < n; y++) {
    if (d.moduleStyle === 'square') {
      // Merge horizontal runs: smaller files, no vertical seams.
      let x = 0;
      while (x < n) {
        if (!on(x, y)) {
          x++;
          continue;
        }
        const start = x;
        while (x < n && on(x, y)) x++;
        const below = (() => {
          for (let i = start; i < x; i++) if (on(i, y + 1)) return true;
          return false;
        })();
        parts.push(rect(o + start, o + y, o + x, o + y + 1 + (below ? SEAM : 0)));
      }
      continue;
    }
    for (let x = 0; x < n; x++) {
      if (!on(x, y)) continue;
      const cx = o + x;
      const cy = o + y;
      const solid = d.moduleStyle === 'dots' && inAlign(x, y);
      if (d.moduleStyle === 'dots' && !solid) {
        parts.push(circle(cx + 0.5, cy + 0.5, 0.45));
        continue;
      }
      // Rounded: a corner is rounded only where neither neighbour on that corner is dark.
      const nb = (xx: number, yy: number) => on(xx, yy) && (!solid || inAlign(xx, yy));
      const t = nb(x, y - 1);
      const b = nb(x, y + 1);
      const l = nb(x - 1, y);
      const r = nb(x + 1, y);
      const R = 0.5;
      parts.push(
        rect(
          cx - (l ? SEAM : 0),
          cy - (t ? SEAM : 0),
          cx + 1 + (r ? SEAM : 0),
          cy + 1 + (b ? SEAM : 0),
          !t && !l ? R : 0,
          !t && !r ? R : 0,
          !b && !r ? R : 0,
          !b && !l ? R : 0,
        ),
      );
    }
  }

  const eyes: string[] = [];
  for (const [ex, ey] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ]) {
    const x = o + ex;
    const y = o + ey;
    if (d.eyeStyle === 'circle') {
      eyes.push(circle(x + 3.5, y + 3.5, 3.5), circle(x + 3.5, y + 3.5, 2.5), circle(x + 3.5, y + 3.5, 1.5));
    } else if (d.eyeStyle === 'rounded') {
      eyes.push(rect(x, y, x + 7, y + 7, 2, 2, 2, 2), rect(x + 1, y + 1, x + 6, y + 6, 1.3, 1.3, 1.3, 1.3), rect(x + 2, y + 2, x + 5, y + 5, 0.9, 0.9, 0.9, 0.9));
    } else {
      eyes.push(rect(x, y, x + 7, y + 7), rect(x + 1, y + 1, x + 6, y + 6), rect(x + 2, y + 2, x + 5, y + 5));
    }
  }

  let logo: Geometry['logo'] = null;
  if (box) {
    const pad = 0.15;
    logo = {
      plate: rect(o + box.x + pad, o + box.y + pad, o + box.x + box.w - pad, o + box.y + box.w - pad, 0.8, 0.8, 0.8, 0.8),
      x: o + box.x + 0.6,
      y: o + box.y + 0.6,
      w: box.w - 1.2,
    };
  }

  return { total: n + o * 2, modules: parts.join(''), eyes: eyes.join(''), logo };
}

const HEX = /^#[0-9a-f]{6}$/i;
export function safeColour(c: string | undefined, fallback: string): string {
  return c && HEX.test(c) ? c.toLowerCase() : fallback;
}

export interface Logo {
  /** PNG data URL, already re-encoded and size-limited by the browser. */
  dataUrl: string;
  width: number;
  height: number;
}

/** Fit an image of w×h into a square of side s, centred. */
export function fitLogo(logo: { width: number; height: number }, x: number, y: number, s: number) {
  const k = Math.min(s / logo.width, s / logo.height);
  const w = logo.width * k;
  const h = logo.height * k;
  return { x: x + (s - w) / 2, y: y + (s - h) / 2, w, h };
}

export function toSvg(m: Matrix, d: Design, px: number, logo?: Logo | null): string {
  const g = geometry(m, { ...d, logoScale: logo ? d.logoScale : 0 });
  const fg = safeColour(d.fg, DEFAULT_DESIGN.fg);
  const bg = safeColour(d.bg, DEFAULT_DESIGN.bg);
  const eye = safeColour(d.eye, fg);
  const crisp = d.moduleStyle === 'square' && d.eyeStyle === 'square' ? ' shape-rendering="crispEdges"' : '';
  let out =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${px}" height="${px}" viewBox="0 0 ${g.total} ${g.total}"${crisp}>` +
    `<rect width="${g.total}" height="${g.total}" fill="${bg}"/>` +
    `<path fill="${fg}" d="${g.modules}"/>` +
    `<path fill="${eye}" fill-rule="evenodd" d="${g.eyes}"/>`;
  if (g.logo && logo && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logo.dataUrl)) {
    const f = fitLogo(logo, g.logo.x, g.logo.y, g.logo.w);
    out +=
      `<path fill="${bg}" d="${g.logo.plate}"/>` +
      `<image x="${r3(f.x)}" y="${r3(f.y)}" width="${r3(f.w)}" height="${r3(f.h)}" preserveAspectRatio="xMidYMid meet" href="${logo.dataUrl}" xlink:href="${logo.dataUrl}"/>`;
  }
  return out + '</svg>';
}

/* ---------- Colour checks ---------- */

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface DesignWarning {
  level: 'error' | 'warn';
  code: string;
  message: string;
}

/** Rules that predict poor scanning. "error" blocks a one-click download. */
export function checkDesign(d: Design): DesignWarning[] {
  const out: DesignWarning[] = [];
  const fg = safeColour(d.fg, DEFAULT_DESIGN.fg);
  const bg = safeColour(d.bg, DEFAULT_DESIGN.bg);
  const eye = safeColour(d.eye, fg);
  const c = Math.min(contrast(fg, bg), contrast(eye, bg));
  if (c < 2.5) out.push({ level: 'error', code: 'low_contrast', message: 'The colours are too similar. Phones won’t be able to read this QR code — choose a darker code or a lighter background.' });
  else if (c < 4) out.push({ level: 'warn', code: 'weak_contrast', message: 'Low contrast between colours can make scanning slow or unreliable. A darker code colour helps.' });
  if (lum(fg) > lum(bg) || lum(eye) > lum(bg))
    out.push({ level: 'warn', code: 'inverted', message: 'Light codes on dark backgrounds don’t work with every scanner. A dark code on a light background is safest.' });
  if (d.margin < 4) out.push({ level: 'warn', code: 'small_margin', message: 'Make sure there is enough clear space around your QR code when you print or place it.' });
  return out;
}
