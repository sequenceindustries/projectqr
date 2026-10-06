/**
 * Round-trip tests: every QR type and design is encoded, rendered to SVG,
 * rasterised by an independent renderer (librsvg via sharp) and decoded by
 * an independent reader (jsQR). A code only passes if the decoded text is
 * byte-for-byte what we meant to encode.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { buildPayload, describe as describeQr, type Fields, type QrType } from '../shared/qr/payload.js';
import { checkDesign, DEFAULT_DESIGN, encode, geometry, LIMITS, logoBox, QrTooLongError, toSvg, type Design, type EcLevel, type Logo } from '../shared/qr/render.js';
import { parseCsv, planBatch } from '../shared/qr/batch.js';

async function decodeSvg(svg: string, px?: number, opts: { blur?: number; rotate?: number; scaleDown?: number } = {}): Promise<string | null> {
  let img = sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#ffffff' });
  if (px) img = img.resize(px, px);
  let buf = await img.png().toBuffer();
  if (opts.rotate) buf = await sharp(buf).rotate(opts.rotate, { background: '#ffffff' }).png().toBuffer();
  if (opts.blur) buf = await sharp(buf).blur(opts.blur).png().toBuffer();
  if (opts.scaleDown) {
    const meta = await sharp(buf).metadata();
    buf = await sharp(buf).resize(Math.round(meta.width! / opts.scaleDown)).png().toBuffer();
  }
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, { inversionAttempts: 'attemptBoth' });
  return r ? r.data : null;
}

async function roundTrip(data: string, design: Partial<Design> = {}, ec: EcLevel = 'M', px = 600, logo?: Logo) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const m = encode(data, logo ? 'H' : ec);
  return decodeSvg(toSvg(m, d, px, logo));
}

function build(type: QrType, f: Fields): string {
  const r = buildPayload(type, f);
  if (!r.ok) throw new Error(`${type}: ${r.message}`);
  return r.data;
}

const cases: [QrType, Fields, string][] = [
  ['url', { url: 'https://example.com/path?q=1&b=2#x' }, 'https://example.com/path?q=1&b=2#x'],
  ['url', { url: 'example.com' }, 'https://example.com'],
  ['text', { text: 'Hello, world! Ünïcödé — 日本語 — 😀🎉' }, 'Hello, world! Ünïcödé — 日本語 — 😀🎉'],
  ['email', { email: 'hi@example.com', subject: 'Hello there', body: 'Line 1\nLine & 2' }, 'mailto:hi@example.com?subject=Hello%20there&body=Line%201%0ALine%20%26%202'],
  ['phone', { phone: '+27 (82) 123-4567' }, 'tel:+27821234567'],
  ['sms', { phone: '+27821234567', message: 'Running late: 10 min' }, 'SMSTO:+27821234567:Running late: 10 min'],
  ['whatsapp', { phone: '+27 82 123 4567', message: 'Hi! Is this available?' }, 'https://wa.me/27821234567?text=Hi!%20Is%20this%20available%3F'],
  ['wifi', { ssid: 'Café;Net', password: 'p@ss:w;rd,"\\', security: 'WPA', hidden: true }, 'WIFI:T:WPA;S:Café\\;Net;P:p@ss\\:w\\;rd\\,\\"\\\\;H:true;;'],
  ['wifi', { ssid: 'Guest', security: 'nopass' }, 'WIFI:T:nopass;S:Guest;;'],
  ['wifi', { ssid: 'Old', password: 'abcde', security: 'WEP' }, 'WIFI:T:WEP;S:Old;P:abcde;;'],
  ['location', { lat: '-26.2041', lng: '28.0473' }, 'https://maps.google.com/?q=-26.2041,28.0473'],
];

describe('payloads encode exactly and decode back', () => {
  for (const [type, fields, expected] of cases) {
    it(`${type}: ${expected.slice(0, 40)}`, async () => {
      const data = build(type, fields);
      expect(data).toBe(expected);
      expect(await roundTrip(data)).toBe(expected);
    });
  }

  it('vCard with all fields', async () => {
    const data = build('vcard', {
      firstName: 'Thandi',
      lastName: 'Nkosi',
      company: 'Sequence Industries, Ltd; SA',
      title: 'Head of Product',
      phone: '+27 82 123 4567',
      email: 'thandi@example.com',
      website: 'example.com',
      address: '1 Main Road\nCape Town',
    });
    expect(data).toContain('N:Nkosi;Thandi;;;');
    expect(data).toContain('ORG:Sequence Industries\\, Ltd\\; SA');
    expect(data).toContain('URL:https://example.com');
    expect(data).toContain('ADR:;;1 Main Road\\, Cape Town;;;;');
    expect(await roundTrip(data)).toBe(data);
    const d = describeQr(data);
    expect(d.kind).toBe('vcard');
    if (d.kind === 'vcard') {
      expect(d.name).toBe('Thandi Nkosi');
      expect(d.fields.find((f) => f.label === 'Company')?.value).toBe('Sequence Industries, Ltd; SA');
    }
  });

  it('vCard with only a name (optional fields missing)', async () => {
    const data = build('vcard', { firstName: 'Sam' });
    expect(data).toBe('BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Sam;;;\r\nFN:Sam\r\nEND:VCARD');
    expect(await roundTrip(data)).toBe(data);
  });

  it('long URL (1,500 chars) at every error-correction level', async () => {
    const url = 'https://example.com/' + 'a1b2c3d4e5'.repeat(148);
    for (const ec of ['L', 'M', 'Q'] as EcLevel[]) expect(await roundTrip(url, {}, ec, 1400)).toBe(url);
    // High error correction holds ~1,270 bytes; the app explains this instead of failing silently.
    expect(() => encode(url, 'H')).toThrow(QrTooLongError);
  });

  it('long text (2,000 chars, Unicode)', async () => {
    const text = 'Fünf große Äpfel. '.repeat(111).slice(0, 2000);
    expect(build('text', { text })).toBe(text);
    expect(await roundTrip(text, {}, 'L', 1600)).toBe(text);
  });

  it('text over capacity is rejected cleanly', () => {
    expect(() => encode('x'.repeat(3000), 'H')).toThrow(QrTooLongError);
  });
});

describe('validation', () => {
  const bad: [QrType, Fields, string][] = [
    ['url', {}, 'Enter a link to continue.'],
    ['url', { url: 'not a url' }, 'Please enter a valid URL.'],
    ['url', { url: 'javascript:alert(1)' }, 'Please enter a valid URL.'],
    ['url', { url: 'ftp://example.com' }, 'Please enter a valid URL.'],
    ['url', { url: 'localhostx' }, 'Please enter a valid URL.'],
    ['text', { text: '   ' }, 'Enter some text to continue.'],
    ['email', { email: 'nope' }, 'Please enter a valid email address.'],
    ['email', { email: 'a@b' }, 'Please enter a valid email address.'],
    ['phone', { phone: 'call me' }, 'Please enter a valid phone number.'],
    ['whatsapp', { phone: '082 123 4567' }, 'Include the country code, for example +27 82 123 4567.'],
    ['wifi', { ssid: '' }, 'Enter your Wi-Fi network name to continue.'],
    ['wifi', { ssid: 'Home', password: 'short', security: 'WPA' }, 'WPA passwords are 8 to 63 characters long.'],
    ['wifi', { ssid: 'Home', security: 'WPA' }, 'Enter the Wi-Fi password, or choose "No password".'],
    ['wifi', { ssid: 'x'.repeat(33), security: 'nopass' }, 'Wi-Fi network names can be at most 32 characters.'],
    ['vcard', {}, 'Add a name or company to continue.'],
    ['vcard', { firstName: 'A', email: 'bad' }, 'Please enter a valid email address.'],
    ['vcard', { firstName: 'A', website: 'nope nope' }, 'Please enter a valid URL.'],
    ['location', { lat: '91', lng: '0' }, 'Latitude must be a number between -90 and 90.'],
    ['location', { lat: '0', lng: 'abc' }, 'Longitude must be a number between -180 and 180.'],
  ];
  for (const [type, f, msg] of bad) {
    it(`${type} rejects ${JSON.stringify(f).slice(0, 40)}`, () => {
      const r = buildPayload(type, f);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toBe(msg);
    });
  }
  it('WhatsApp accepts 00-prefixed international numbers', () => {
    expect(build('whatsapp', { phone: '0027821234567' })).toBe('https://wa.me/27821234567');
  });
});

describe('designs still decode', () => {
  const url = 'https://sequence.industries/qr?campaign=launch';
  const designs: [string, Partial<Design>][] = [
    ['default', {}],
    ['rounded modules', { moduleStyle: 'rounded' }],
    ['dots', { moduleStyle: 'dots' }],
    ['rounded eyes', { eyeStyle: 'rounded' }],
    ['circle eyes', { eyeStyle: 'circle' }],
    ['dots + circle eyes', { moduleStyle: 'dots', eyeStyle: 'circle' }],
    ['brand colours', { fg: '#4234f5', bg: '#fff8e1', eye: '#c2283a' }],
    ['dark green on cream', { fg: '#0f5132', bg: '#fdf6e3' }],
    ['minimum margin', { margin: 2 }],
    ['wide margin', { margin: 10 }],
  ];
  for (const [name, d] of designs) {
    for (const ec of ['L', 'M', 'Q', 'H'] as EcLevel[]) {
      it(`${name} @ ${ec}`, async () => {
        expect(await roundTrip(url, d, ec)).toBe(url);
      });
    }
  }

  it('renders at small and large sizes', async () => {
    const m = encode(url, 'M');
    for (const px of [LIMITS.sizeMin, 256, 512, 1024, 2048]) expect(await decodeSvg(toSvg(m, DEFAULT_DESIGN, px))).toBe(url);
  });

  it('survives rotation, blur and low resolution', async () => {
    const svg = toSvg(encode(url, 'Q'), DEFAULT_DESIGN, 800);
    expect(await decodeSvg(svg, undefined, { rotate: 17 })).toBe(url);
    expect(await decodeSvg(svg, undefined, { blur: 1.5 })).toBe(url);
    expect(await decodeSvg(svg, undefined, { scaleDown: 5 })).toBe(url);
  });
});

async function makeLogo(w: number, h: number): Promise<Logo> {
  // A busy, high-contrast logo is the worst case for scanners.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#e63946"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="#000"/><rect x="0" y="0" width="${w / 3}" height="${h / 3}" fill="#000"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { dataUrl: 'data:image/png;base64,' + png.toString('base64'), width: w, height: h };
}

describe('logos', () => {
  const url = 'https://example.com/menu';
  it('square logo at default and maximum size decodes', async () => {
    const logo = await makeLogo(200, 200);
    for (const scale of [0.12, LIMITS.logoDefault, LIMITS.logoMax]) {
      expect(await roundTrip(url, { logoScale: scale }, 'H', 800, logo)).toBe(url);
      expect(await roundTrip(url, { logoScale: scale, moduleStyle: 'dots', eyeStyle: 'circle', fg: '#4234f5' }, 'H', 800, logo)).toBe(url);
    }
  });
  it('wide logo keeps its aspect ratio', async () => {
    const logo = await makeLogo(400, 100);
    const svg = toSvg(encode(url, 'H'), { ...DEFAULT_DESIGN, logoScale: 0.24 }, 800, logo);
    expect(svg).toMatch(/<image [^>]*height="[\d.]+"/);
    expect(await decodeSvg(svg)).toBe(url);
  });
  it('logo with a dense payload (vCard) decodes', async () => {
    const data = build('vcard', { firstName: 'Thandi', lastName: 'Nkosi', company: 'Sequence', phone: '+27821234567', email: 't@example.com', website: 'example.com' });
    expect(await roundTrip(data, { logoScale: LIMITS.logoMax }, 'H', 1000, await makeLogo(120, 120))).toBe(data);
  });
  it('logo size is capped', () => {
    const box = logoBox(33, 0.9)!;
    expect(box.w / 33).toBeLessThanOrEqual(LIMITS.logoMax + 2 / 33);
  });
  it('ignores a logo that is not a PNG data URL (no external or script content in SVG)', () => {
    const svg = toSvg(encode(url, 'H'), { ...DEFAULT_DESIGN, logoScale: 0.2 }, 400, { dataUrl: 'https://evil.example/x.svg', width: 10, height: 10 });
    expect(svg).not.toContain('evil');
    expect(svg).not.toContain('<image');
  });
});

describe('design checks', () => {
  it('blocks near-identical colours', () => {
    expect(checkDesign({ ...DEFAULT_DESIGN, fg: '#cccccc', bg: '#dddddd' }).some((w) => w.level === 'error')).toBe(true);
  });
  it('warns about inverted codes and small margins', () => {
    const codes = checkDesign({ ...DEFAULT_DESIGN, fg: '#ffffff', bg: '#000000', margin: 2 }).map((w) => w.code);
    expect(codes).toContain('inverted');
    expect(codes).toContain('small_margin');
  });
  it('default design is clean', () => {
    expect(checkDesign(DEFAULT_DESIGN)).toEqual([]);
  });
  it('rejects unsafe colour strings in SVG', () => {
    const svg = toSvg(encode('x', 'M'), { ...DEFAULT_DESIGN, fg: 'red"/><script>alert(1)</script>' }, 100);
    expect(svg).not.toContain('script');
  });
  it('geometry has three eyes and no modules under the logo', () => {
    const m = encode('https://example.com', 'H');
    const g = geometry(m, { ...DEFAULT_DESIGN, logoScale: 0.2 });
    expect(g.eyes.match(/M/g)!.length).toBe(9);
    expect(g.logo).not.toBeNull();
  });
});

describe('decoded content descriptions', () => {
  it('Wi-Fi with escapes', () => {
    const d = describeQr('WIFI:T:WPA;S:Café\\;Net;P:p@ss\\:w\\;rd;H:true;;');
    expect(d).toMatchObject({ kind: 'wifi', ssid: 'Café;Net', password: 'p@ss:w;rd', security: 'WPA/WPA2', hidden: true });
  });
  it('URL, email, phone, SMS, geo and text', () => {
    expect(describeQr('https://example.com').kind).toBe('url');
    expect(describeQr('mailto:a@b.co?subject=Hi%20there')).toMatchObject({ kind: 'email', email: 'a@b.co', subject: 'Hi there' });
    expect(describeQr('tel:+27821234567')).toMatchObject({ kind: 'phone', phone: '+27821234567' });
    expect(describeQr('SMSTO:+2782:hello: there')).toMatchObject({ kind: 'sms', phone: '+2782', message: 'hello: there' });
    expect(describeQr('geo:-26.2,28.04')).toMatchObject({ kind: 'location', lat: '-26.2', lng: '28.04' });
    expect(describeQr('javascript:alert(1)').kind).toBe('text');
    expect(describeQr('just words').kind).toBe('text');
  });
});

describe('batch CSV', () => {
  it('parses quotes, commas, CRLF and BOM', () => {
    const rows = parseCsv('﻿Name,URL\r\n"Acme, Inc","https://acme.com/?a=1,2"\r\n"Say ""hi""",https://x.com\n');
    expect(rows).toEqual([
      ['Name', 'URL'],
      ['Acme, Inc', 'https://acme.com/?a=1,2'],
      ['Say "hi"', 'https://x.com'],
    ]);
  });
  it('plans rows: header detection, invalid rows, duplicate names, missing values', () => {
    const plan = planBatch(
      'Name,URL\nGoogle,https://google.com\nOpenAI,https://openai.com\nSequence Industries,https://example.com\nBroken,not a url\n,https://nameless.com\nGoogle,https://google.com/2\nEmpty,\n\n',
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.items.map((i) => i.file)).toEqual(['google.png', 'openai.png', 'sequence-industries.png', 'row-6.png', 'google-2.png']);
    expect(plan.items[3].name).toBe('Row 6');
    expect(plan.errors.map((e) => e.row)).toEqual([5, 8]);
    expect(plan.errors[0].message).toBe('Please enter a valid URL.');
  });
  it('accepts a single column of links without a header', () => {
    const plan = planBatch('https://a.com\nhttps://b.com\n');
    expect(plan.ok && plan.items.length).toBe(2);
  });
  it('accepts text in the second column', () => {
    const plan = planBatch('Name,Content\nNote,Hello there\n', 'text');
    expect(plan.ok && plan.items[0].data).toBe('Hello there');
  });
  it('enforces the row limit', () => {
    const csv = 'Name,URL\n' + Array.from({ length: 501 }, (_, i) => `n${i},https://e.com/${i}`).join('\n');
    const plan = planBatch(csv);
    expect(plan.ok).toBe(false);
  });
  it('every planned item decodes', async () => {
    const plan = planBatch('Name,URL\nA,https://a.com\nB,https://b.com/ünï\n');
    if (!plan.ok) throw new Error('plan failed');
    for (const it of plan.items) expect(await roundTrip(it.data)).toBe(it.data);
  });
});
