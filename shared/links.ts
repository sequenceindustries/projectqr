/**
 * URL shortener rules shared by the browser (instant feedback) and the
 * server (the real gatekeeper). The server re-checks everything.
 */

export const LINK_LIMITS = {
  urlMax: 2048,
  aliasMin: 3,
  aliasMax: 32,
  codeLength: 7,
  reportMax: 500,
};

/** No 0/O, 1/l/I: generated codes are easy to read aloud and type. */
export const CODE_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

export const ALIAS_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const CODE_RE = /^[A-Za-z0-9-]{3,32}$/;

/** Aliases that would be confusing or impersonate the site. */
export const RESERVED_ALIASES = new Set([
  'about', 'admin', 'administrator', 'api', 'app', 'assets', 'auth', 'billing', 'dashboard', 'help', 'home', 'link', 'links', 'login',
  'logout', 'official', 'password', 'privacy', 'register', 'report', 'root', 'secure', 'security', 'settings', 'signin', 'signup',
  'staff', 'static', 'support', 'system', 'terms', 'verify', 'www', 'sequence', 'sequenceindustries',
]);

/** Other shorteners: chaining them hides the real destination, so we refuse. */
export const SHORTENER_HOSTS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'v.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at',
  'rb.gy', 't.ly', 'tiny.cc', 'shorte.st', 'adf.ly', 'bl.ink', 'short.io', 'lnkd.in', 'qrco.de', 's.id', 'trib.al', 'soo.gd', 'clck.ru',
]);

export type LinkCheck = { ok: true; url: string } | { ok: false; code: string; message: string };

function privateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * Validate and normalise a destination. `ownHosts` are this site's hosts
 * (short links to ourselves would loop or hide a destination).
 */
export function checkDestination(raw: unknown, ownHosts: string[] = []): LinkCheck {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, code: 'empty', message: 'Paste a link to shorten.' };
  let v = raw.trim();
  if (v.length > LINK_LIMITS.urlMax) return { ok: false, code: 'too_long', message: 'That link is too long. Links can be up to 2,048 characters.' };
  if (/\s/.test(v)) return { ok: false, code: 'invalid_url', message: 'Please enter a valid URL.' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false, code: 'invalid_url', message: 'Please enter a valid URL.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, code: 'bad_scheme', message: 'Only web links (http or https) can be shortened.' };
  if (u.username || u.password) return { ok: false, code: 'credentials', message: 'Links with a username or password in them can’t be shortened.' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, code: 'invalid_url', message: 'Please enter a valid URL.' };
  if (host.startsWith('[') || privateIpv4(host) || host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(host))
    return { ok: false, code: 'private_host', message: 'That link points to a private or local address, which other people can’t open.' };
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !/\.[a-z¡-￿0-9-]{2,}$/i.test(host)) return { ok: false, code: 'invalid_url', message: 'Please enter a valid URL.' };
  const bare = host.replace(/^www\./, '');
  if (ownHosts.map((h) => h.toLowerCase()).includes(host) || ownHosts.map((h) => h.toLowerCase()).includes(bare))
    return { ok: false, code: 'own_host', message: 'That’s already a link on this site — no need to shorten it.' };
  if (SHORTENER_HOSTS.has(bare)) return { ok: false, code: 'shortener', message: 'That’s already a short link. Shorten the full destination instead so people can see where it goes.' };
  return { ok: true, url: u.toString() };
}

export type AliasCheck = { ok: true; alias: string | null } | { ok: false; code: string; message: string };

export function checkAlias(raw: unknown): AliasCheck {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, alias: null };
  if (typeof raw !== 'string') return { ok: false, code: 'invalid_alias', message: 'Custom endings can use letters, numbers and dashes.' };
  const a = raw.trim().toLowerCase();
  if (a.length < LINK_LIMITS.aliasMin || a.length > LINK_LIMITS.aliasMax)
    return { ok: false, code: 'invalid_alias', message: `Custom endings must be ${LINK_LIMITS.aliasMin} to ${LINK_LIMITS.aliasMax} characters.` };
  if (!ALIAS_RE.test(a) || a.includes('--')) return { ok: false, code: 'invalid_alias', message: 'Custom endings can use letters, numbers and single dashes, and can’t start or end with a dash.' };
  if (RESERVED_ALIASES.has(a)) return { ok: false, code: 'reserved_alias', message: 'That ending is reserved. Please choose another.' };
  return { ok: true, alias: a };
}

export function randomCode(len = LINK_LIMITS.codeLength, rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  // Rejection sampling keeps every character equally likely.
  const max = 256 - (256 % CODE_ALPHABET.length);
  let out = '';
  while (out.length < len) {
    for (const b of rand(len * 2)) {
      if (b < max) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (out.length === len) break;
    }
  }
  return out;
}

export interface LinkInfo {
  code: string;
  url: string;
  shortUrl: string;
  createdAt: string;
  clicks: number;
  disabled: boolean;
}
