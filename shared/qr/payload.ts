/**
 * QR content types → the exact string encoded in the QR code.
 *
 * Every builder validates its input and returns either the payload or a
 * plain-English error tied to the field that needs fixing. The same code
 * runs in the browser (generator, batch) and in tests, so what we test is
 * what ships.
 */

export type QrType = 'url' | 'text' | 'email' | 'phone' | 'sms' | 'whatsapp' | 'wifi' | 'vcard' | 'location';

export const QR_TYPES: { id: QrType; label: string }[] = [
  { id: 'url', label: 'URL' },
  { id: 'text', label: 'Text' },
  { id: 'wifi', label: 'Wi-Fi' },
  { id: 'vcard', label: 'Contact' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'sms', label: 'SMS' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'location', label: 'Location' },
];

export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';

export interface Fields {
  url?: string;
  text?: string;
  email?: string;
  subject?: string;
  body?: string;
  phone?: string;
  message?: string;
  ssid?: string;
  password?: string;
  security?: WifiSecurity | string;
  hidden?: boolean | string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  website?: string;
  address?: string;
  lat?: string;
  lng?: string;
}

export type BuildResult = { ok: true; data: string } | { ok: false; code: string; field: keyof Fields; message: string };

const fail = (code: string, field: keyof Fields, message: string): BuildResult => ({ ok: false, code, field, message });
const s = (v: unknown) => (typeof v === 'string' ? v : '').trim();

/** Limits keep payloads inside what a phone camera can comfortably read. */
export const MAX = {
  text: 2000,
  url: 2000,
  subject: 200,
  body: 1000,
  message: 1000,
  field: 200,
};

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function isEmail(v: string): boolean {
  return v.length <= 254 && EMAIL_RE.test(v);
}

/** Accepts "example.com" (adds https://) as well as full http(s) URLs. */
export function normaliseUrl(raw: string): string | null {
  let v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  if (!isIp && host !== 'localhost' && !/\.[a-z¡-￿0-9-]{2,}$/i.test(host)) return null;
  // Keep what the user typed (URL() would percent-encode non-ASCII paths and
  // punycode the host), only adding the scheme if it was missing.
  return /^https?:\/\//i.test(raw.trim()) ? raw.trim() : v;
}

/** Digits with an optional leading +. Spaces, dashes, dots and brackets are ignored. */
export function cleanPhone(raw: string): string | null {
  const v = raw.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d{3,20}$/.test(v)) return null;
  return v;
}

/** Wi-Fi (ZXing MECARD-style) escaping: backslash, semicolon, comma, colon and quote. */
export function escapeWifi(v: string): string {
  return v.replace(/([\\;,:"])/g, '\\$1');
}

/** vCard 3.0 text escaping. */
export function escapeVcard(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '').replace(/([,;])/g, '\\$1');
}

function bytes(v: string): number {
  return new TextEncoder().encode(v).length;
}

export function buildPayload(type: QrType, f: Fields): BuildResult {
  switch (type) {
    case 'url': {
      const raw = s(f.url);
      if (!raw) return fail('empty', 'url', 'Enter a link to continue.');
      if (raw.length > MAX.url) return fail('too_long', 'url', 'That link is too long for a reliable QR code.');
      const url = normaliseUrl(raw);
      if (!url) return fail('invalid_url', 'url', 'Please enter a valid URL.');
      return { ok: true, data: url };
    }

    case 'text': {
      const text = typeof f.text === 'string' ? f.text : '';
      if (!text.trim()) return fail('empty', 'text', 'Enter some text to continue.');
      if (text.length > MAX.text) return fail('too_long', 'text', `Keep it under ${MAX.text.toLocaleString('en')} characters so phones can read it.`);
      return { ok: true, data: text };
    }

    case 'email': {
      const email = s(f.email);
      if (!email) return fail('empty', 'email', 'Enter an email address to continue.');
      if (!isEmail(email)) return fail('invalid_email', 'email', 'Please enter a valid email address.');
      const subject = s(f.subject);
      const body = typeof f.body === 'string' ? f.body.trim() : '';
      if (subject.length > MAX.subject) return fail('too_long', 'subject', 'Keep the subject under 200 characters.');
      if (body.length > MAX.body) return fail('too_long', 'body', 'Keep the message under 1,000 characters.');
      const q: string[] = [];
      if (subject) q.push('subject=' + encodeURIComponent(subject));
      if (body) q.push('body=' + encodeURIComponent(body));
      return { ok: true, data: `mailto:${email}${q.length ? '?' + q.join('&') : ''}` };
    }

    case 'phone': {
      const raw = s(f.phone);
      if (!raw) return fail('empty', 'phone', 'Enter a phone number to continue.');
      const phone = cleanPhone(raw);
      if (!phone) return fail('invalid_phone', 'phone', 'Please enter a valid phone number.');
      return { ok: true, data: `tel:${phone}` };
    }

    case 'sms': {
      const raw = s(f.phone);
      if (!raw) return fail('empty', 'phone', 'Enter a phone number to continue.');
      const phone = cleanPhone(raw);
      if (!phone) return fail('invalid_phone', 'phone', 'Please enter a valid phone number.');
      const msg = typeof f.message === 'string' ? f.message.trim() : '';
      if (msg.length > MAX.message) return fail('too_long', 'message', 'Keep the message under 1,000 characters.');
      // SMSTO: is understood by both iOS and Android camera apps.
      return { ok: true, data: `SMSTO:${phone}:${msg}` };
    }

    case 'whatsapp': {
      const raw = s(f.phone);
      if (!raw) return fail('empty', 'phone', 'Enter a WhatsApp number to continue.');
      const phone = cleanPhone(raw);
      if (!phone) return fail('invalid_phone', 'phone', 'Please enter a valid phone number.');
      const digits = phone.replace(/^\+/, '').replace(/^00/, '');
      if (!phone.startsWith('+') && !phone.startsWith('00') && digits.startsWith('0'))
        return fail('needs_country_code', 'phone', 'Include the country code, for example +27 82 123 4567.');
      if (digits.length < 7 || digits.length > 15) return fail('invalid_phone', 'phone', 'Please enter a valid phone number with its country code.');
      const msg = typeof f.message === 'string' ? f.message.trim() : '';
      if (msg.length > MAX.message) return fail('too_long', 'message', 'Keep the message under 1,000 characters.');
      return { ok: true, data: `https://wa.me/${digits}${msg ? '?text=' + encodeURIComponent(msg) : ''}` };
    }

    case 'wifi': {
      const ssid = typeof f.ssid === 'string' ? f.ssid : '';
      if (!ssid.trim()) return fail('empty', 'ssid', 'Enter your Wi-Fi network name to continue.');
      if (bytes(ssid) > 32) return fail('too_long', 'ssid', 'Wi-Fi network names can be at most 32 characters.');
      const sec: WifiSecurity = f.security === 'WEP' ? 'WEP' : f.security === 'nopass' ? 'nopass' : 'WPA';
      const password = typeof f.password === 'string' ? f.password : '';
      const hidden = f.hidden === true || f.hidden === 'true';
      if (sec !== 'nopass') {
        if (!password) return fail('empty', 'password', 'Enter the Wi-Fi password, or choose "No password".');
        if (sec === 'WPA' && !(password.length >= 8 && password.length <= 63) && !/^[0-9a-f]{64}$/i.test(password))
          return fail('invalid_password', 'password', 'WPA passwords are 8 to 63 characters long.');
        if (password.length > 64) return fail('invalid_password', 'password', 'That password is too long for Wi-Fi.');
      }
      let data = `WIFI:T:${sec};S:${escapeWifi(ssid)};`;
      if (sec !== 'nopass') data += `P:${escapeWifi(password)};`;
      if (hidden) data += 'H:true;';
      return { ok: true, data: data + ';' };
    }

    case 'vcard': {
      const first = s(f.firstName);
      const last = s(f.lastName);
      const company = s(f.company);
      const title = s(f.title);
      const email = s(f.email);
      const websiteRaw = s(f.website);
      const address = typeof f.address === 'string' ? f.address.trim() : '';
      const phoneRaw = s(f.phone);
      if (!first && !last && !company) return fail('empty', 'firstName', 'Add a name or company to continue.');
      for (const [k, v] of [['firstName', first], ['lastName', last], ['company', company], ['title', title]] as const)
        if (v.length > MAX.field) return fail('too_long', k, 'Keep each field under 200 characters.');
      if (address.length > 300) return fail('too_long', 'address', 'Keep the address under 300 characters.');
      let phone = '';
      if (phoneRaw) {
        const p = cleanPhone(phoneRaw);
        if (!p) return fail('invalid_phone', 'phone', 'Please enter a valid phone number.');
        phone = p;
      }
      if (email && !isEmail(email)) return fail('invalid_email', 'email', 'Please enter a valid email address.');
      let website = '';
      if (websiteRaw) {
        const u = normaliseUrl(websiteRaw);
        if (!u) return fail('invalid_url', 'website', 'Please enter a valid URL.');
        website = u;
      }
      const full = [first, last].filter(Boolean).join(' ') || company;
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeVcard(last)};${escapeVcard(first)};;;`, `FN:${escapeVcard(full)}`];
      if (company) lines.push(`ORG:${escapeVcard(company)}`);
      if (title) lines.push(`TITLE:${escapeVcard(title)}`);
      if (phone) lines.push(`TEL;TYPE=CELL:${phone}`);
      if (email) lines.push(`EMAIL:${email}`);
      if (website) lines.push(`URL:${website}`);
      // One free-text address goes in the street component; phones show it as written.
      if (address) lines.push(`ADR:;;${escapeVcard(address.replace(/\s*\n\s*/g, ', '))};;;;`);
      lines.push('END:VCARD');
      return { ok: true, data: lines.join('\r\n') };
    }

    case 'location': {
      const latRaw = s(f.lat).replace(',', '.');
      const lngRaw = s(f.lng).replace(',', '.');
      if (!latRaw) return fail('empty', 'lat', 'Enter a latitude to continue.');
      if (!lngRaw) return fail('empty', 'lng', 'Enter a longitude to continue.');
      const num = /^-?\d{1,3}(\.\d{1,10})?$/;
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (!num.test(latRaw) || !(lat >= -90 && lat <= 90)) return fail('invalid_location', 'lat', 'Latitude must be a number between -90 and 90.');
      if (!num.test(lngRaw) || !(lng >= -180 && lng <= 180)) return fail('invalid_location', 'lng', 'Longitude must be a number between -180 and 180.');
      // A map link opens on every phone; bare geo: URIs are ignored by some iPhone camera apps.
      return { ok: true, data: `https://maps.google.com/?q=${latRaw},${lngRaw}` };
    }
  }
}

/** Human description of decoded QR content, used by the scanner and reader. */
export type Decoded =
  | { kind: 'url'; label: string; url: string }
  | { kind: 'wifi'; label: string; ssid: string; password: string; security: string; hidden: boolean }
  | { kind: 'email'; label: string; email: string; subject: string; body: string; url: string }
  | { kind: 'phone'; label: string; phone: string; url: string }
  | { kind: 'sms'; label: string; phone: string; message: string; url: string }
  | { kind: 'vcard'; label: string; name: string; fields: { label: string; value: string }[] }
  | { kind: 'location'; label: string; lat: string; lng: string; url: string }
  | { kind: 'text'; label: string };

function unescapeWifi(v: string): string {
  return v.replace(/\\(.)/g, '$1');
}

/** Splits "K:v;K:v;;" honouring backslash escapes. */
function wifiFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const colon = body.indexOf(':', i);
    if (colon < 0) break;
    const key = body.slice(i, colon).toUpperCase();
    let j = colon + 1;
    let val = '';
    while (j < body.length && body[j] !== ';') {
      if (body[j] === '\\' && j + 1 < body.length) {
        val += body[j] + body[j + 1];
        j += 2;
      } else val += body[j++];
    }
    if (key) out[key] = unescapeWifi(val);
    i = j + 1;
    while (body[i] === ';') i++;
  }
  return out;
}

function unescapeVcard(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

export function describe(text: string): Decoded {
  const t = text.trim();
  if (/^WIFI:/i.test(t)) {
    const f = wifiFields(t.slice(5));
    const sec = (f.T || 'nopass').toUpperCase();
    return {
      kind: 'wifi',
      label: 'Wi-Fi network detected',
      ssid: f.S ?? '',
      password: f.P ?? '',
      security: sec === 'NOPASS' || sec === '' ? 'None' : sec === 'WEP' ? 'WEP' : 'WPA/WPA2',
      hidden: /^true$/i.test(f.H ?? ''),
    };
  }
  if (/^BEGIN:VCARD/i.test(t)) {
    const unfolded = t.replace(/\r?\n[ \t]/g, '');
    const fields: { label: string; value: string }[] = [];
    let name = '';
    for (const line of unfolded.split(/\r?\n/)) {
      const m = /^([A-Z-]+)(;[^:]*)?:(.*)$/i.exec(line);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const v = m[3];
      if (key === 'FN') name = unescapeVcard(v);
      else if (key === 'N' && !name) name = v.split(';').slice(0, 2).reverse().map(unescapeVcard).join(' ').trim();
      else if (key === 'ORG') fields.push({ label: 'Company', value: v.split(/(?<!\\);/).map(unescapeVcard).filter(Boolean).join(' ') });
      else if (key === 'TITLE') fields.push({ label: 'Job title', value: unescapeVcard(v) });
      else if (key === 'TEL') fields.push({ label: 'Phone', value: v });
      else if (key === 'EMAIL') fields.push({ label: 'Email', value: v });
      else if (key === 'URL') fields.push({ label: 'Website', value: v });
      else if (key === 'ADR') fields.push({ label: 'Address', value: v.split(/(?<!\\);/).map(unescapeVcard).filter(Boolean).join(', ') });
    }
    return { kind: 'vcard', label: 'Contact card detected', name, fields };
  }
  if (/^mailto:/i.test(t)) {
    const [addr, query = ''] = t.slice(7).split('?');
    const p = new URLSearchParams(query);
    return { kind: 'email', label: 'Email address detected', email: decodeURIComponent(addr), subject: p.get('subject') ?? '', body: p.get('body') ?? '', url: t };
  }
  if (/^tel:/i.test(t)) return { kind: 'phone', label: 'Phone number detected', phone: t.slice(4), url: t };
  if (/^(SMSTO|SMS):/i.test(t)) {
    const rest = t.replace(/^(SMSTO|SMS):/i, '');
    const idx = rest.indexOf(':');
    const phone = idx < 0 ? rest : rest.slice(0, idx);
    const message = idx < 0 ? '' : rest.slice(idx + 1);
    return { kind: 'sms', label: 'Text message detected', phone, message, url: `sms:${phone}${message ? '?&body=' + encodeURIComponent(message) : ''}` };
  }
  const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(t);
  if (geo) return { kind: 'location', label: 'Location detected', lat: geo[1], lng: geo[2], url: `https://maps.google.com/?q=${geo[1]},${geo[2]}` };
  if (/^https?:\/\/\S+$/i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol === 'http:' || u.protocol === 'https:') return { kind: 'url', label: 'Link detected', url: t };
    } catch {
      /* fall through */
    }
  }
  return { kind: 'text', label: 'Text detected' };
}
