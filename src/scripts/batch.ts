/**
 * Batch: CSV → many QR codes → one ZIP, entirely in the browser.
 * The ZIP library loads only when a batch is generated.
 */
import { BATCH, planBatch, type BatchItem, type BatchType } from '../../shared/qr/batch';
import { DEFAULT_DESIGN, encode, QrTooLongError, toSvg, type Design, type EcLevel } from '../../shared/qr/render';
import { canvasBlob, drawToCanvas, loadDecoder, saveBlob } from './qr/draw';
import { track, trackView } from './analytics';

const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll<T>(sel));
const tick = () => new Promise((r) => setTimeout(r, 0));

const EXAMPLE = 'Name,URL\nGoogle,https://google.com\nOpenAI,https://openai.com\nSequence Industries,https://example.com\n';
const PREVIEW_MAX = 24;

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function mountBatch() {
  for (const root of $$(document, '[data-batch]')) {
    if (root.dataset.mounted) continue;
    root.dataset.mounted = '1';
    mount(root);
  }
}

function mount(root: HTMLElement) {
  const tool = root.dataset.tool ?? 'batch-qr-code';
  const csv = $<HTMLTextAreaElement>(root, '[data-csv]')!;
  const fileIn = $<HTMLInputElement>(root, '[data-csv-file]')!;
  const errEl = $(root, '[data-b-error]')!;
  const run = $<HTMLButtonElement>(root, '[data-b-run]')!;
  const out = $(root, '[data-b-out]')!;
  const count = $(root, '[data-b-count]')!;
  const progress = $<HTMLProgressElement>(root, '[data-b-progress]')!;
  const zipBtn = $<HTMLButtonElement>(root, '[data-b-zip]')!;
  const issues = $(root, '[data-b-issues]')!;
  const errList = $(root, '[data-b-errors]')!;
  const grid = $(root, '[data-b-grid]')!;
  const more = $(root, '[data-b-more]')!;
  const sizeWrap = $(root, '[data-b-size-wrap]')!;

  let files: { name: string; data: Uint8Array }[] = [];
  let running = false;

  trackView(tool);

  const err = (m: string) => {
    errEl.textContent = m;
    errEl.hidden = !m;
  };

  $(root, '[data-example]')!.addEventListener('click', () => {
    csv.value = EXAMPLE;
    csv.focus();
  });

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    err('');
    if (f.size > BATCH.maxBytes) return err('That file is too large. Keep it under 500 KB.');
    const text = await f.text();
    // Spreadsheets saved as .xlsx or other binaries are not CSV.
    if (text.includes('\u0000') || /^PK\u0003\u0004/.test(text)) return err('That doesn’t look like a CSV file. In your spreadsheet app, choose File → Save as / Download → CSV.');
    csv.value = text;
  });

  const colour = (name: 'fg' | 'bg') => {
    const w = $(root, `[data-colour="${name}"]`)!;
    const picker = $<HTMLInputElement>(w, `[data-d="${name}"]`)!;
    const hex = $<HTMLInputElement>(w, `[data-d="${name}-hex"]`)!;
    picker.addEventListener('input', () => (hex.value = picker.value.toUpperCase()));
    hex.addEventListener('input', () => {
      const v = hex.value.trim().replace(/^#?/, '#');
      if (/^#[0-9a-f]{6}$/i.test(v)) picker.value = v.toLowerCase();
    });
    return () => picker.value.toLowerCase();
  };
  const fg = colour('fg');
  const bg = colour('bg');

  const fmtRadios = $$<HTMLInputElement>(root, '[data-b-fmt]');
  const fmt = () => (fmtRadios.find((r) => r.checked)?.value ?? 'png') as 'png' | 'svg';
  for (const r of fmtRadios) r.addEventListener('change', () => (sizeWrap.hidden = fmt() === 'svg'));

  run.addEventListener('click', async () => {
    if (running) return;
    err('');
    const type = ($$<HTMLInputElement>(root, '[data-b-type]').find((r) => r.checked)?.value ?? 'url') as BatchType;
    const raw = csv.value.trim() ? csv.value : '';
    if (!raw) {
      err('Paste your list or upload a CSV file first.');
      csv.focus();
      return;
    }
    const plan = planBatch(raw, type);
    if (!plan.ok) {
      err(plan.message);
      return;
    }
    if (!plan.items.length) {
      err(`None of the rows could be used. ${plan.errors[0] ? `Row ${plan.errors[0].row}: ${plan.errors[0].message}` : ''}`);
      return;
    }

    const design: Design = { ...DEFAULT_DESIGN, fg: fg(), bg: bg() };
    const ec = $<HTMLSelectElement>(root, '[data-b-ec]')!.value as EcLevel;
    const px = Number($<HTMLSelectElement>(root, '[data-b-size]')!.value);
    const format = fmt();

    running = true;
    run.disabled = true;
    zipBtn.disabled = true;
    files = [];
    grid.replaceChildren();
    errList.replaceChildren();
    out.hidden = false;
    progress.hidden = false;
    progress.value = 0;
    count.textContent = `Creating ${plan.items.length} QR codes…`;
    track('batch_generation_started', { tool, count: plan.items.length, format });
    const started = performance.now();

    const skipped = [...plan.errors];
    const manifest: string[] = ['file,name,content'];
    const jsqr = await loadDecoder();
    const canvas = document.createElement('canvas');
    const check = document.createElement('canvas');
    let unreadable = 0;
    const enc = new TextEncoder();

    for (let i = 0; i < plan.items.length; i++) {
      const it: BatchItem = plan.items[i];
      let matrix;
      try {
        matrix = encode(it.data, ec);
      } catch (e) {
        skipped.push({ row: it.row, message: e instanceof QrTooLongError ? 'Too long for one QR code at this error-correction level.' : 'Couldn’t create this QR code.' });
        continue;
      }
      const name = it.file.replace(/\.png$/, `.${format}`);
      if (format === 'svg') files.push({ name, data: enc.encode(toSvg(matrix, design, 1024)) });
      else {
        drawToCanvas(canvas, matrix, design, px);
        files.push({ name, data: new Uint8Array(await (await canvasBlob(canvas, 'image/png')).arrayBuffer()) });
      }
      // Scan-check every code at a small size.
      const cpx = Math.max(200, (matrix.size + design.margin * 2) * 4);
      const ctx = drawToCanvas(check, matrix, design, cpx);
      const r = jsqr(ctx.getImageData(0, 0, cpx, cpx).data, cpx, cpx, { inversionAttempts: 'attemptBoth' });
      if (r?.data !== it.data) unreadable++;
      manifest.push([name, it.name, it.data].map(csvCell).join(','));

      if (i < PREVIEW_MAX) {
        const li = document.createElement('li');
        const tpl = document.createElement('template');
        tpl.innerHTML = toSvg(matrix, design, 160);
        const svg = tpl.content.firstElementChild!;
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `QR code: ${it.name}`);
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        const label = document.createElement('span');
        label.textContent = it.name;
        label.title = it.name;
        li.append(svg, label);
        grid.append(li);
      }
      if (i % 10 === 9) {
        progress.value = Math.round(((i + 1) / plan.items.length) * 100);
        await tick();
      }
    }
    files.push({ name: 'qr-codes.csv', data: enc.encode(manifest.join('\r\n') + '\r\n') });

    progress.hidden = true;
    const made = files.length - 1;
    const parts = [`${made} QR code${made === 1 ? '' : 's'} ready`];
    if (skipped.length) parts.push(`${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped`);
    if (plan.duplicates) parts.push(`${plan.duplicates} duplicate${plan.duplicates === 1 ? '' : 's'}`);
    count.textContent = parts.join(' · ');
    if (unreadable) err(`${unreadable} code${unreadable === 1 ? '' : 's'} failed our scan check. Try darker colours or a higher error-correction level.`);

    issues.hidden = !skipped.length;
    for (const s of skipped.sort((a, b) => a.row - b.row).slice(0, 50)) {
      const li = document.createElement('li');
      li.textContent = `Row ${s.row}: ${s.message}`;
      errList.append(li);
    }
    more.textContent = made > PREVIEW_MAX ? `Showing the first ${PREVIEW_MAX}. All ${made} are in the ZIP, with a qr-codes.csv index.` : made ? 'The ZIP also includes qr-codes.csv, an index of every file.' : '';
    zipBtn.disabled = made === 0;
    track('batch_generation_completed', { tool, count: made, format, ms: performance.now() - started, code: skipped.length ? 'some_skipped' : 'ok' });
    running = false;
    run.disabled = false;
    out.focus({ preventScroll: true });
    out.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });

  zipBtn.addEventListener('click', async () => {
    if (!files.length) return;
    zipBtn.disabled = true;
    try {
      const { zipSync } = await import('fflate');
      const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
      // PNGs are already compressed; store them. Text compresses well.
      for (const f of files) entries[f.name] = [f.data, { level: f.name.endsWith('.png') ? 0 : 6 }];
      const zip = zipSync(entries);
      saveBlob(new Blob([zip], { type: 'application/zip' }), 'qr-codes.zip');
      track('qr_downloaded', { tool, format: 'zip', count: files.length - 1 });
    } catch {
      err('Your browser couldn’t build the ZIP. Try fewer rows or a smaller size.');
    } finally {
      zipBtn.disabled = false;
    }
  });
}
