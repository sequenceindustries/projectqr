/**
 * Scanner / reader controller. Camera frames and images are decoded on
 * this device (native BarcodeDetector when the browser has one, jsQR
 * otherwise) and never leave it. The camera only starts after a tap, and
 * stops as soon as a code is found or the page is hidden.
 */
import { describe as describeQr, type Decoded } from '../../shared/qr/payload';
import { loadDecoder } from './qr/decoder';
import { track, trackView } from './analytics';

const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll<T>(sel));

const MAX_UPLOAD = 15 * 1024 * 1024;
const MSG = {
  notFound: "We couldn't detect a QR code in this image.",
  notFoundTip: "We couldn't detect a QR code in this image. Try a sharper photo, crop closer to the code, or make sure the whole code is visible.",
  badFile: 'Please upload a valid image.',
  tooBig: 'That image is over 15 MB. Please use a smaller one.',
  noCamera: "Camera access isn't available. You can upload a QR image instead.",
  blocked: 'Camera access was blocked. Allow it in your browser’s site settings, or upload a QR image instead.',
  busy: 'Your camera is being used by another app. Close it and try again, or upload a QR image instead.',
};

interface Detector {
  detect(src: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
  }
}

let native: Promise<Detector | null> | null = null;
function nativeDetector(): Promise<Detector | null> {
  return (native ??= (async () => {
    try {
      if (!window.BarcodeDetector) return null;
      const formats = (await window.BarcodeDetector.getSupportedFormats?.()) ?? [];
      return formats.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    } catch {
      return null;
    }
  })());
}

/** jsQR over a few scales: huge photos and tiny screenshots both decode better resized. */
async function decodeCanvasMulti(img: CanvasImageSource, w: number, h: number, canvas: HTMLCanvasElement): Promise<string | null> {
  const jsqr = await loadDecoder();
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const longSide = Math.max(w, h);
  const targets = [1200, 800, 1800, 500].map((t) => Math.min(t / longSide, longSide < 400 ? 3 : 1));
  const tried = new Set<number>();
  for (const k of targets) {
    const cw = Math.max(1, Math.round(w * k));
    const ch = Math.max(1, Math.round(h * k));
    if (tried.has(cw)) continue;
    tried.add(cw);
    canvas.width = cw;
    canvas.height = ch;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    const data = ctx.getImageData(0, 0, cw, ch);
    const r = jsqr(data.data, cw, ch, { inversionAttempts: 'attemptBoth' });
    if (r?.data) return r.data;
  }
  return null;
}

export function mountScanners() {
  for (const root of $$(document, '[data-scanner]')) {
    if (root.dataset.mounted) continue;
    root.dataset.mounted = '1';
    mount(root);
  }
}

function mount(root: HTMLElement) {
  const tool = root.dataset.tool ?? 'qr-code-scanner';
  const drop = $(root, '[data-drop]')!;
  const cam = $(root, '[data-cam]')!;
  const video = $<HTMLVideoElement>(root, '[data-video]')!;
  const canvas = $<HTMLCanvasElement>(root, '[data-canvas]')!;
  const errEl = $(root, '[data-scan-error]')!;
  const statusEl = $(root, '[data-scan-status]')!;
  const result = $(root, '[data-result]')!;
  const rLabel = $(root, '[data-r-label]')!;
  const rBody = $(root, '[data-r-body]')!;
  const rActions = $(root, '[data-r-actions]')!;
  const switchBtn = $<HTMLButtonElement>(root, '[data-cam-switch]')!;
  const torchBtn = $<HTMLButtonElement>(root, '[data-cam-torch]')!;

  let stream: MediaStream | null = null;
  let scanning = false;
  let facing: 'environment' | 'user' = 'environment';
  let lastTick = 0;
  let busy = false;

  trackView(tool);

  function error(msg: string) {
    errEl.textContent = msg;
    errEl.hidden = !msg;
  }

  /* ---------- Results ---------- */

  function btn(label: string, cls = 'btn btn--quiet'): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    return b;
  }
  function link(label: string, href: string, cls = 'btn'): HTMLAnchorElement {
    const a = document.createElement('a');
    a.className = cls;
    a.textContent = label;
    a.href = href;
    if (/^https?:/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
    }
    return a;
  }
  function copyBtn(label: string, value: string): HTMLButtonElement {
    const b = btn(label);
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value);
        b.textContent = 'Copied';
      } catch {
        // Fallback for browsers without async clipboard access.
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        b.textContent = ok ? 'Copied' : 'Press and hold to copy';
      }
      setTimeout(() => (b.textContent = label), 1800);
    });
    return b;
  }
  function textBlock(v: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'r-text';
    p.textContent = v;
    return p;
  }
  function dl(rows: [string, string][]): HTMLElement {
    const el = document.createElement('dl');
    for (const [k, v] of rows) {
      if (!v) continue;
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      el.append(dt, dd);
    }
    return el;
  }
  function note(v: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'r-warn';
    p.textContent = v;
    return p;
  }

  function show(text: string, source: string) {
    const d: Decoded = describeQr(text);
    track('qr_decoded', { tool, source, type: d.kind });
    rLabel.textContent = d.label;
    rBody.replaceChildren();
    rActions.replaceChildren();

    switch (d.kind) {
      case 'url': {
        let host = '';
        try {
          host = new URL(d.url).hostname;
        } catch {
          /* already validated */
        }
        rBody.append(textBlock(d.url), note(`Opens ${host}. Check the address before you open links from QR codes you don’t trust.`));
        rActions.append(link('Open link', d.url), copyBtn('Copy result', text));
        break;
      }
      case 'wifi':
        rBody.append(
          dl([
            ['Network', d.ssid],
            ['Password', d.password || (d.security === 'None' ? 'None' : '')],
            ['Security', d.security],
            ['Hidden', d.hidden ? 'Yes' : ''],
          ]),
          note('On most phones, scanning this code with the camera app joins the network directly.'),
        );
        if (d.password) rActions.append(copyBtn('Copy password', d.password));
        rActions.append(copyBtn('Copy network name', d.ssid), copyBtn('Copy result', text));
        break;
      case 'vcard': {
        rBody.append(dl([['Name', d.name], ...d.fields.map((f) => [f.label, f.value] as [string, string])]));
        const save = btn('Save contact (.vcf)', 'btn');
        save.addEventListener('click', () => {
          const blob = new Blob([text], { type: 'text/vcard' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(d.name || 'contact').replace(/[^\w-]+/g, '-').slice(0, 40) || 'contact'}.vcf`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        });
        rActions.append(save, copyBtn('Copy result', text));
        break;
      }
      case 'email':
        rBody.append(dl([['To', d.email], ['Subject', d.subject], ['Message', d.body]]));
        rActions.append(link('Write email', d.url), copyBtn('Copy address', d.email));
        break;
      case 'phone':
        rBody.append(textBlock(d.phone));
        rActions.append(link('Call', d.url), copyBtn('Copy number', d.phone));
        break;
      case 'sms':
        rBody.append(dl([['To', d.phone], ['Message', d.message]]));
        rActions.append(link('Send text', d.url), copyBtn('Copy result', text));
        break;
      case 'location':
        rBody.append(dl([['Latitude', d.lat], ['Longitude', d.lng]]));
        rActions.append(link('Open in maps', d.url), copyBtn('Copy coordinates', `${d.lat},${d.lng}`));
        break;
      default:
        rBody.append(textBlock(text));
        rActions.append(copyBtn('Copy result', text));
    }
    result.hidden = false;
    result.focus({ preventScroll: true });
    result.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  $(root, '[data-again]')!.addEventListener('click', () => {
    result.hidden = true;
    error('');
    statusEl.textContent = '';
    if (root.dataset.mode === 'scanner' && !drop.hidden) $<HTMLButtonElement>(drop, '[data-cam-start]')?.focus();
    else if (root.dataset.mode === 'scanner') startCamera();
    else $<HTMLInputElement>(root, '[data-file]')?.focus();
  });

  /* ---------- Images ---------- */

  async function handleFile(file: File, source: 'upload' | 'paste' | 'drop') {
    error('');
    result.hidden = true;
    if (!file.type.startsWith('image/')) return error(MSG.badFile);
    if (file.size > MAX_UPLOAD) return error(MSG.tooBig);
    track('qr_scanned', { tool, source: source === 'upload' ? 'upload' : source });
    statusEl.textContent = 'Reading image…';
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('bad'));
        img.src = url;
      });
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;
      let text: string | null = null;
      const det = await nativeDetector();
      if (det) {
        try {
          text = (await det.detect(img))[0]?.rawValue ?? null;
        } catch {
          text = null;
        }
      }
      if (!text) text = await decodeCanvasMulti(img, w, h, canvas);
      statusEl.textContent = '';
      if (text) {
        stopCamera();
        show(text, source === 'upload' ? 'upload' : source);
      } else error(MSG.notFoundTip);
    } catch {
      statusEl.textContent = '';
      error(MSG.badFile);
    } finally {
      URL.revokeObjectURL(url);
      // Drop pixel data from the work canvas.
      canvas.width = canvas.height = 1;
    }
  }

  for (const input of $$<HTMLInputElement>(root, '[data-file]')) {
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) void handleFile(f, 'upload');
    });
  }

  let depth = 0;
  root.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    depth++;
    drop.classList.add('is-over');
  });
  root.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  root.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      drop.classList.remove('is-over');
    }
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove('is-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) void handleFile(f, 'drop');
  });
  document.addEventListener('paste', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) {
      e.preventDefault();
      void handleFile(f, 'paste');
    }
  });

  /* ---------- Camera ---------- */

  async function startCamera() {
    error('');
    result.hidden = true;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) return error(MSG.noCamera);
    statusEl.textContent = 'Waiting for camera permission…';
    track('qr_scanned', { tool, source: 'camera' });
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) {
      statusEl.textContent = '';
      const name = (e as DOMException)?.name;
      return error(name === 'NotAllowedError' || name === 'SecurityError' ? MSG.blocked : name === 'NotReadableError' ? MSG.busy : MSG.noCamera);
    }
    statusEl.textContent = '';
    video.srcObject = stream;
    drop.hidden = true;
    cam.hidden = false;
    try {
      await video.play();
    } catch {
      /* autoplay with muted+playsinline is allowed; ignore */
    }
    // Offer switching only when there is more than one camera (labels are available after permission).
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      switchBtn.hidden = devices.filter((d) => d.kind === 'videoinput').length < 2;
    } catch {
      switchBtn.hidden = true;
    }
    const track0 = stream.getVideoTracks()[0];
    const caps = (track0?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    torchBtn.hidden = !caps.torch;
    torchBtn.setAttribute('aria-pressed', 'false');
    scanning = true;
    void nativeDetector();
    void loadDecoder();
    requestAnimationFrame(loop);
  }

  function stopCamera() {
    scanning = false;
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    video.srcObject = null;
    cam.hidden = true;
    drop.hidden = false;
    canvas.width = canvas.height = 1;
  }

  async function loop(now: number) {
    if (!scanning) return;
    requestAnimationFrame(loop);
    if (busy || now - lastTick < 120 || video.readyState < 2) return;
    lastTick = now;
    busy = true;
    try {
      const text = await decodeFrame();
      if (text && scanning) {
        navigator.vibrate?.(60);
        stopCamera();
        show(text, 'camera');
      }
    } finally {
      busy = false;
    }
  }

  async function decodeFrame(): Promise<string | null> {
    const det = await nativeDetector();
    if (det) {
      try {
        const r = await det.detect(video);
        if (r[0]?.rawValue) return r[0].rawValue;
        return null;
      } catch {
        /* fall back to jsQR */
      }
    }
    const jsqr = await loadDecoder();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    // Decode the central square (where the reticle is), at most 640 px.
    const side = Math.min(vw, vh);
    const k = Math.min(1, 640 / side);
    const s = Math.round(side * k);
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s);
    return jsqr(img.data, s, s, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  }

  for (const b of $$<HTMLButtonElement>(root, '[data-cam-start]')) b.addEventListener('click', () => void startCamera());
  $(root, '[data-cam-stop]')!.addEventListener('click', () => {
    stopCamera();
    $<HTMLButtonElement>(drop, '[data-cam-start]')?.focus();
  });
  switchBtn.addEventListener('click', async () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    stopCamera();
    await startCamera();
  });
  torchBtn.addEventListener('click', async () => {
    const t = stream?.getVideoTracks()[0];
    if (!t) return;
    const on = torchBtn.getAttribute('aria-pressed') !== 'true';
    try {
      await t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      torchBtn.setAttribute('aria-pressed', String(on));
    } catch {
      torchBtn.hidden = true;
    }
  });

  // Never leave the camera running in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) stopCamera();
  });
  window.addEventListener('pagehide', stopCamera);
}
