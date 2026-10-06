/**
 * Batch planning: CSV text → a validated list of QR codes to draw.
 * Pure and synchronous; drawing and zipping happen in the browser.
 */
import { buildPayload } from './payload.js';

export const BATCH = {
  maxRows: 500,
  maxBytes: 512 * 1024,
};

export type BatchType = 'url' | 'text';

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas/newlines inside quotes, CRLF or LF. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // Auto-detect ; or tab separated files (common from spreadsheets in some locales).
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = !firstLine.includes(',') && firstLine.includes(';') ? ';' : !firstLine.includes(',') && firstLine.includes('\t') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function slug(v: string): string {
  return v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export interface BatchItem {
  row: number;
  name: string;
  data: string;
  /** File name inside the ZIP, without extension decisions: always ends in .png here; callers swap the extension. */
  file: string;
}

export type BatchPlan =
  | { ok: true; items: BatchItem[]; errors: { row: number; message: string }[]; duplicates: number }
  | { ok: false; message: string };

const NAME_HEADERS = /^(name|label|title|filename|file)$/i;
const DATA_HEADERS = /^(url|link|links|website|content|text|data|value|urls)$/i;

export function planBatch(csv: string, type: BatchType = 'url'): BatchPlan {
  if (new TextEncoder().encode(csv).length > BATCH.maxBytes) return { ok: false, message: 'That file is too large. Keep it under 500 KB.' };
  const all = parseCsv(csv).map((r, i) => ({ cells: r.map((c) => c.trim()), row: i + 1 }));
  const rows = all.filter((r) => r.cells.some((c) => c !== ''));
  if (!rows.length) return { ok: false, message: 'Paste or upload a CSV with at least one row.' };

  let nameCol = rows[0].cells.length > 1 ? 0 : -1;
  let dataCol = rows[0].cells.length > 1 ? 1 : 0;
  let start = 0;
  const head = rows[0].cells;
  const hd = head.findIndex((c) => DATA_HEADERS.test(c));
  if (hd >= 0) {
    dataCol = hd;
    const hn = head.findIndex((c) => NAME_HEADERS.test(c));
    nameCol = hn >= 0 ? hn : head.length > 1 ? (hd === 0 ? 1 : 0) : -1;
    start = 1;
  } else if (!buildPayload(type, { url: head[dataCol], text: head[dataCol] }).ok) {
    // First row doesn't hold valid content: treat it as a header.
    start = 1;
  }

  const body = rows.slice(start);
  if (body.length > BATCH.maxRows) return { ok: false, message: `Up to ${BATCH.maxRows} rows at a time, please. This file has ${body.length}.` };
  if (!body.length) return { ok: false, message: 'Add at least one row below the header.' };

  const items: BatchItem[] = [];
  const errors: { row: number; message: string }[] = [];
  const usedFiles = new Map<string, number>();
  const seen = new Set<string>();
  let duplicates = 0;

  for (const { cells, row } of body) {
    const raw = cells[dataCol] ?? '';
    const name = (nameCol >= 0 ? cells[nameCol] : '') || '';
    if (!raw) {
      errors.push({ row, message: type === 'url' ? 'This row has no link.' : 'This row has no text.' });
      continue;
    }
    const r = buildPayload(type, { url: raw, text: raw });
    if (!r.ok) {
      errors.push({ row, message: r.message });
      continue;
    }
    if (seen.has(r.data)) duplicates++;
    seen.add(r.data);
    const display = name || `Row ${row}`;
    const base = slug(display) || `row-${row}`;
    const n = (usedFiles.get(base) ?? 0) + 1;
    usedFiles.set(base, n);
    items.push({ row, name: display, data: r.data, file: `${n > 1 ? `${base}-${n}` : base}.png` });
  }
  return { ok: true, items, errors, duplicates };
}
