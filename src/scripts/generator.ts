/**
 * Generator controller. Everything happens on this device: build the
 * payload, encode, draw, scan-check, export. Analytics carry only the tool,
 * the QR type and option names — never what was typed.
 */
import { buildPayload, type Fields, type QrType } from '../../shared/qr/payload';
import { checkDesign, DEFAULT_DESIGN, encode, LIMITS, QrTooLongError, type Design, type EcLevel, type Matrix } from '../../shared/qr/render';
import { canvasBlob, drawToCanvas, loadDecoder, saveBlob, scanCheck, svgString, type LoadedLogo } from './qr/draw';
import { LogoError, readLogo } from './qr/logo';
import { track, trackOnce, trackView } from './analytics';

const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll<T>(sel));

const HEX_RE = /^#?[0-9a-f]{6}$/i;
const SHORT_HEX_RE = /^#?[0-9a-f]{3}$/i;
function normHex(v: string): string | null {
  const t = v.trim();
  if (HEX_RE.test(t)) return ('#' + t.replace('#', '')).toLowerCase();
  if (SHORT_HEX_RE.test(t))
    return (
      '#' +
      t
        .replace('#', '')
        .split('')
        .map((c) => c + c)
        .join('')
    ).toLowerCase();
  return null;
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountGenerators() {
  for (const root of $$(document, '[data-generator]')) {
    if (root.dataset.mounted) continue;
    root.dataset.mounted = '1';
    mount(root);
  }
}

function mount(root: HTMLElement) {
  const tool = root.dataset.tool ?? 'qr-code-generator';
  const form = $<HTMLFormElement>(root, '[data-form]')!;
  const stage = $(root, '[data-preview]')!;
  const placeholder = $(root, '[data-placeholder]')!;
  const checkEl = $(root, '[data-check]')!;
  const warningsEl = $(root, '[data-warnings]')!;
  const metaEl = $(root, '[data-meta]')!;
  const captionEl = $(root, '[data-caption]');
  const formError = $(root, '[data-form-error]')!;
  const dlBtns = $$<HTMLButtonElement>(root, '[data-dl]');
  const copyBtn = $<HTMLButtonElement>(root, '[data-copy]')!;
  const confirmWrap = $(root, '[data-confirm]')!;
  const confirmText = $(root, '[data-confirm-text]')!;
  const confirmBox = $<HTMLInputElement>(root, '[data-confirm-box]')!;
  const dlStatus = $(root, '[data-dl-status]')!;
  const sizeSel = $<HTMLSelectElement>(root, '[data-size]')!;
  const sizeCustom = $<HTMLInputElement>(root, '[data-size-custom]')!;
  const design = $(root, '[data-design]')!;

  let type = (root.dataset.type as QrType) ?? 'url';
  let ec: EcLevel = 'M';
  let userEc: EcLevel = 'M';
  let logo: LoadedLogo | null = null;
  const d: Design = { ...DEFAULT_DESIGN, logoScale: LIMITS.logoDefault };
  let current: { data: string; matrix: Matrix } | null = null;
  let readable: boolean | null = null;
  let designError = false;
  let attempted = false;
  const touched = new Set<string>();
  let timer: number | undefined;
  let checkToken = 0;

  trackView(tool);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && 'write' in navigator.clipboard) copyBtn.hidden = false;

  /* ---------- Fields ---------- */

  function group(): HTMLElement {
    return $(root, `[data-fields="${type}"]`)!;
  }

  function readFields(): Fields {
    const f: Record<string, string | boolean> = {};
    for (const el of $$<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(group(), '[data-f]')) {
      const key = el.dataset.f!;
      f[key] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
    }
    return f as Fields;
  }

  function hasInput(): boolean {
    return $$<HTMLInputElement | HTMLTextAreaElement>(group(), 'input[data-f]:not([type=checkbox]), textarea[data-f]').some((el) => el.value.trim() !== '');
  }

  function clearErrors() {
    for (const el of $$(root, '[data-err]')) el.textContent = '';
    for (const el of $$(root, '[data-f][aria-invalid]')) el.removeAttribute('aria-invalid');
    formError.hidden = true;
  }

  function showFieldError(field: string, message: string) {
    const input = $<HTMLElement>(group(), `[data-f="${field}"]`);
    const err = $(group(), `[data-err="${field}"]`);
    if (input && err) {
      input.setAttribute('aria-invalid', 'true');
      err.textContent = message;
    } else {
      formError.textContent = message;
      formError.hidden = false;
    }
  }

  // Wi-Fi: hide the password when "No password" is chosen.
  function syncWifi() {
    const g = $(root, '[data-fields="wifi"]');
    if (!g) return;
    const sec = $<HTMLSelectElement>(g, '[data-f="security"]')!.value;
    const wrap = $(g, '[data-wrap="password"]');
    if (wrap) wrap.hidden = sec === 'nopass';
  }

  for (const btn of $$<HTMLButtonElement>(root, '[data-pw-toggle]')) {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('aria-controls')!) as HTMLInputElement;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  }

  for (const r of $$<HTMLInputElement>(root, '[data-type-radio]')) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      type = r.value as QrType;
      for (const g of $$(root, '[data-fields]')) g.hidden = g.dataset.fields !== type;
      attempted = false;
      touched.clear();
      clearErrors();
      update(false);
    });
  }

  form.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('[data-f="security"]')) syncWifi();
    schedule();
  });
  form.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('[data-f="security"]')) syncWifi();
  });
  form.addEventListener('focusout', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset?.f) {
      touched.add(t.dataset.f);
      update(false);
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    attempted = true;
    track('qr_generation_started', { tool, type });
    const ok = update(true);
    if (ok && window.matchMedia('(max-width: 899px)').matches) {
      $(root, '[data-out]')!.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  });
  syncWifi();

  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => update(false), 120);
  }

  /* ---------- Render ---------- */

  function setDownloads(enabled: boolean) {
    for (const b of dlBtns) b.disabled = !enabled;
    copyBtn.disabled = !enabled;
  }

  function showPlaceholder() {
    current = null;
    readable = null;
    stage.classList.remove('is-stale');
    stage.replaceChildren(placeholder);
    stage.setAttribute('aria-label', 'QR code preview: nothing to show yet');
    checkEl.textContent = '';
    checkEl.removeAttribute('data-state');
    metaEl.textContent = '';
    warningsEl.replaceChildren();
    if (captionEl) captionEl.hidden = true;
    confirmWrap.hidden = true;
    setDownloads(false);
  }

  /** Returns true if a QR code was produced. */
  function update(explicit: boolean): boolean {
    clearErrors();
    if (!hasInput() && !explicit) {
      showPlaceholder();
      return false;
    }
    const res = buildPayload(type, readFields());
    if (!res.ok) {
      const show = explicit || attempted || touched.has(res.field) || current !== null;
      // While typing the first characters, don't nag; keep the last good code greyed out.
      if (show) showFieldError(res.field, res.message);
      if (explicit) track('qr_generation_failed', { tool, type, code: res.code });
      if (current) {
        stage.classList.add('is-stale');
        setDownloads(false);
        checkEl.textContent = '';
        checkEl.removeAttribute('data-state');
      } else showPlaceholder();
      if (explicit) $<HTMLElement>(group(), `[data-f="${res.field}"]`)?.focus();
      return false;
    }

    let matrix: Matrix;
    try {
      matrix = encode(res.data, ec);
    } catch (e) {
      const msg =
        e instanceof QrTooLongError
          ? ec === 'L'
            ? 'That’s more than one QR code can hold. Please shorten it.'
            : 'That’s too much for this error-correction level. Shorten it, or choose a lower level under Customise design.'
          : 'Something went wrong creating this QR code. Please try again.';
      formError.textContent = msg;
      formError.hidden = false;
      track('qr_generation_failed', { tool, type, code: e instanceof QrTooLongError ? 'too_long' : 'encode_error' });
      if (current) stage.classList.add('is-stale');
      setDownloads(false);
      return false;
    }

    const first = current === null;
    current = { data: res.data, matrix };
    draw();
    if (explicit || first) {
      if (!explicit) trackOnce(`start:${type}`, 'qr_generation_started', { tool, type });
      trackOnce(`done:${type}`, 'qr_generation_completed', { tool, type, ec });
    }
    if (explicit) track('qr_generation_completed', { tool, type, ec });
    return true;
  }

  function draw() {
    if (!current) return;
    const { matrix, data } = current;
    const svg = svgString(matrix, d, 512, logo);
    const tpl = document.createElement('template');
    tpl.innerHTML = svg;
    const el = tpl.content.firstElementChild as SVGSVGElement;
    el.classList.add('qr');
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('width');
    el.removeAttribute('height');
    stage.classList.remove('is-stale');
    stage.replaceChildren(el);
    stage.setAttribute('aria-label', `QR code preview (${type === 'vcard' ? 'contact' : type})`);
    if (captionEl) captionEl.hidden = false;
    metaEl.textContent = `Version ${matrix.version} · ${matrix.size}×${matrix.size} modules · Error correction ${matrix.ec}`;

    const warnings = checkDesign(d);
    designError = warnings.some((w) => w.level === 'error');
    warningsEl.replaceChildren(
      ...warnings.map((w) => {
        const p = document.createElement('p');
        p.className = `notice notice--${w.level === 'error' ? 'error' : 'warn'}`;
        p.textContent = w.message;
        return p;
      }),
    );
    setDownloads(true);
    verify(matrix, data);
  }

  async function verify(matrix: Matrix, data: string) {
    const token = ++checkToken;
    readable = null;
    checkEl.dataset.state = 'checking';
    checkEl.textContent = 'Checking it scans…';
    let ok = false;
    try {
      ok = await scanCheck(matrix, d, data, logo);
    } catch {
      ok = false;
    }
    if (token !== checkToken) return;
    readable = ok;
    checkEl.dataset.state = ok ? 'ok' : 'fail';
    checkEl.textContent = ok ? 'Scan check passed' : 'Scan check failed — try more contrast, a smaller logo or a simpler style';
    syncConfirm();
  }

  function syncConfirm() {
    const risky = designError || readable === false;
    confirmWrap.hidden = !risky;
    if (!risky) confirmBox.checked = false;
    confirmText.textContent = designError
      ? 'These colours don’t have enough contrast for phones to read the code.'
      : 'Our scan check couldn’t read this design. Phones may not be able to either.';
  }

  /* ---------- Design controls ---------- */

  const firstUse = (option: string, value: string) => trackOnce(`c:${option}`, 'customization_used', { tool, option, value });

  function setColour(name: 'fg' | 'bg' | 'eye', hex: string, from?: HTMLInputElement) {
    const wrap = $(design, `[data-colour="${name}"]`);
    if (!wrap) return;
    const picker = $<HTMLInputElement>(wrap, `[data-d="${name}"]`)!;
    const text = $<HTMLInputElement>(wrap, `[data-d="${name}-hex"]`)!;
    if (from !== picker) picker.value = hex;
    if (from !== text) text.value = hex.toUpperCase();
    text.removeAttribute('aria-invalid');
    if (name === 'eye') d.eye = hex;
    else d[name] = hex;
    if (name === 'fg' && eyeSame.checked) {
      d.eye = undefined;
      const ew = $(design, '[data-colour="eye"]');
      if (ew) {
        $<HTMLInputElement>(ew, '[data-d="eye"]')!.value = hex;
        $<HTMLInputElement>(ew, '[data-d="eye-hex"]')!.value = hex.toUpperCase();
      }
    }
  }

  const eyeSame = $<HTMLInputElement>(design, '[data-d="eye-same"]')!;
  const eyeWrap = $(design, '[data-eye-wrap]')!;
  eyeSame.addEventListener('change', () => {
    eyeWrap.hidden = eyeSame.checked;
    d.eye = eyeSame.checked ? undefined : $<HTMLInputElement>(design, '[data-d="eye"]')!.value;
    firstUse('eye_colour', eyeSame.checked ? 'same' : 'custom');
    draw();
  });

  for (const name of ['fg', 'bg', 'eye'] as const) {
    const wrap = $(design, `[data-colour="${name}"]`);
    if (!wrap) continue;
    const picker = $<HTMLInputElement>(wrap, `[data-d="${name}"]`)!;
    const text = $<HTMLInputElement>(wrap, `[data-d="${name}-hex"]`)!;
    picker.addEventListener('input', () => {
      setColour(name, picker.value.toLowerCase(), picker);
      firstUse(`colour_${name}`, 'picker');
      draw();
    });
    text.addEventListener('input', () => {
      const hex = normHex(text.value);
      if (!hex) {
        text.setAttribute('aria-invalid', 'true');
        return;
      }
      setColour(name, hex, text);
      firstUse(`colour_${name}`, 'hex');
      draw();
    });
    text.addEventListener('blur', () => {
      if (!normHex(text.value)) {
        text.value = (name === 'eye' ? d.eye ?? d.fg : d[name]).toUpperCase();
        text.removeAttribute('aria-invalid');
      }
    });
  }

  for (const b of $$<HTMLButtonElement>(design, '[data-preset]')) {
    b.addEventListener('click', () => {
      const [fg, bg] = b.dataset.preset!.split(',');
      setColour('fg', fg);
      setColour('bg', bg);
      if (!eyeSame.checked) setColour('eye', fg);
      firstUse('preset', b.getAttribute('aria-label')!.toLowerCase().replace(/\s+/g, '_'));
      draw();
    });
  }

  for (const r of $$<HTMLInputElement>(design, '[data-module]'))
    r.addEventListener('change', () => {
      d.moduleStyle = r.value as Design['moduleStyle'];
      firstUse('module_style', r.value);
      draw();
    });
  for (const r of $$<HTMLInputElement>(design, '[data-eye]'))
    r.addEventListener('change', () => {
      d.eyeStyle = r.value as Design['eyeStyle'];
      firstUse('eye_style', r.value);
      draw();
    });

  const margin = $<HTMLInputElement>(design, '[data-d="margin"]')!;
  const marginOut = $(design, '[data-margin-out]')!;
  const fill = (r: HTMLInputElement) => r.style.setProperty('--fill', `${((+r.value - +r.min) / (+r.max - +r.min)) * 100}%`);
  fill(margin);
  margin.addEventListener('input', () => {
    d.margin = Number(margin.value);
    marginOut.textContent = margin.value;
    fill(margin);
    firstUse('margin', 'changed');
    draw();
  });

  const ecRadios = $$<HTMLInputElement>(design, '[data-ec]');
  const ecNote = $(design, '[data-ec-note]')!;
  const ecNoteDefault = ecNote.textContent;
  function setEc(level: EcLevel) {
    ec = level;
    for (const r of ecRadios) r.checked = r.value === level;
  }
  for (const r of ecRadios)
    r.addEventListener('change', () => {
      if (!r.checked) return;
      userEc = r.value as EcLevel;
      setEc(userEc);
      firstUse('error_correction', r.value);
      update(false);
    });

  /* Logo */
  const logoInput = $<HTMLInputElement>(design, '[data-logo-input]')!;
  const logoThumb = $<HTMLImageElement>(design, '[data-logo-thumb]')!;
  const logoRemove = $<HTMLButtonElement>(design, '[data-logo-remove]')!;
  const logoErr = $(design, '[data-logo-error]')!;
  const logoSize = $(design, '[data-logo-size]')!;
  const logoScale = $<HTMLInputElement>(design, '[data-logo-scale]')!;
  const logoScaleOut = $(design, '[data-logo-scale-out]')!;
  const logoPick = $(design, '[data-logo-pick-label]')!;
  fill(logoScale);

  function lockEc(locked: boolean) {
    for (const r of ecRadios) r.disabled = locked && r.value !== 'H';
    ecNote.textContent = locked ? 'Set to High while a logo is added, so the code still scans with its centre covered.' : ecNoteDefault;
    setEc(locked ? 'H' : userEc);
  }

  logoInput.addEventListener('change', async () => {
    const file = logoInput.files?.[0];
    logoInput.value = '';
    if (!file) return;
    logoErr.textContent = '';
    try {
      logo = await readLogo(file);
    } catch (e) {
      logoErr.textContent = e instanceof LogoError ? e.message : 'Please upload a valid image.';
      return;
    }
    logoThumb.src = logo.dataUrl;
    logoThumb.hidden = false;
    logoRemove.hidden = false;
    logoSize.hidden = false;
    logoPick.textContent = 'Change logo';
    lockEc(true);
    track('logo_added', { tool });
    update(false);
  });
  logoRemove.addEventListener('click', () => {
    logo = null;
    logoThumb.hidden = true;
    logoThumb.removeAttribute('src');
    logoRemove.hidden = true;
    logoSize.hidden = true;
    logoPick.textContent = 'Add a logo';
    lockEc(false);
    update(false);
    logoInput.focus();
  });
  logoScale.addEventListener('input', () => {
    d.logoScale = Number(logoScale.value) / 100;
    logoScaleOut.textContent = `${logoScale.value}%`;
    fill(logoScale);
    firstUse('logo_size', 'changed');
    draw();
  });

  $(design, '[data-reset-design]')?.addEventListener('click', () => {
    setColour('fg', DEFAULT_DESIGN.fg);
    setColour('bg', DEFAULT_DESIGN.bg);
    eyeSame.checked = true;
    eyeWrap.hidden = true;
    d.eye = undefined;
    d.moduleStyle = 'square';
    d.eyeStyle = 'square';
    d.margin = DEFAULT_DESIGN.margin;
    margin.value = String(d.margin);
    marginOut.textContent = margin.value;
    fill(margin);
    for (const r of $$<HTMLInputElement>(design, '[data-module], [data-eye]')) r.checked = r.value === 'square';
    if (logo) logoRemove.click();
    userEc = 'M';
    setEc('M');
    update(false);
  });

  /* ---------- Download ---------- */

  function chosenSize(): number {
    if (sizeSel.value === 'custom') {
      const v = Math.round(Number(sizeCustom.value));
      return Math.max(LIMITS.sizeMin, Math.min(LIMITS.sizeMax, Number.isFinite(v) ? v : 1024));
    }
    return Number(sizeSel.value);
  }
  sizeSel.addEventListener('change', () => {
    sizeCustom.hidden = sizeSel.value !== 'custom';
    if (!sizeCustom.hidden) sizeCustom.focus();
  });
  sizeCustom.addEventListener('change', () => {
    sizeCustom.value = String(chosenSize());
  });

  function fileBase(): string {
    const nice: Record<QrType, string> = { url: 'link', text: 'text', email: 'email', phone: 'phone', sms: 'sms', whatsapp: 'whatsapp', wifi: 'wifi', vcard: 'contact', location: 'location' };
    return `qr-code-${nice[type]}`;
  }

  function gate(): boolean {
    if ((designError || readable === false) && !confirmBox.checked) {
      confirmWrap.hidden = false;
      confirmBox.focus();
      return false;
    }
    return true;
  }

  async function exportBlob(fmt: 'png' | 'svg' | 'jpg', px: number): Promise<Blob> {
    const { matrix } = current!;
    if (fmt === 'svg') return new Blob([svgString(matrix, d, px, logo)], { type: 'image/svg+xml' });
    const canvas = document.createElement('canvas');
    drawToCanvas(canvas, matrix, d, px, logo);
    return canvasBlob(canvas, fmt === 'jpg' ? 'image/jpeg' : 'image/png');
  }

  for (const b of dlBtns) {
    b.addEventListener('click', async () => {
      if (!current || !gate()) return;
      const fmt = b.dataset.dl as 'png' | 'svg' | 'jpg';
      const px = chosenSize();
      try {
        const blob = await exportBlob(fmt, px);
        saveBlob(blob, `${fileBase()}.${fmt}`);
        dlStatus.textContent = `Downloaded ${fmt.toUpperCase()}${fmt === 'svg' ? '' : ` (${px} × ${px})`}.`;
        track('qr_downloaded', { tool, type, format: fmt, size: fmt === 'svg' ? 0 : px, ec: current.matrix.ec });
      } catch {
        dlStatus.textContent = '';
        formError.textContent = 'Your browser couldn’t create that file. Try a smaller size or SVG.';
        formError.hidden = false;
      }
    });
  }

  copyBtn.addEventListener('click', async () => {
    if (!current || !gate()) return;
    try {
      const blob = exportBlob('png', Math.min(chosenSize(), 1024));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      dlStatus.textContent = 'Copied. Paste it into a document, chat or design tool.';
      track('qr_downloaded', { tool, type, format: 'clipboard' });
    } catch {
      dlStatus.textContent = 'Your browser blocked copying. Use Download PNG instead.';
    }
  });

  confirmBox.addEventListener('change', () => {
    if (confirmBox.checked) dlStatus.textContent = 'Downloads unlocked.';
  });

  // Warm the scan-check decoder when the visitor starts interacting.
  form.addEventListener('focusin', () => void loadDecoder(), { once: true });

  // Restore state on back/forward navigation (bfcache keeps field values).
  if (hasInput()) update(false);
  else showPlaceholder();
}
