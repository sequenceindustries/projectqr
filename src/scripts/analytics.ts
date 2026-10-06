/**
 * First-party, cookie-free analytics.
 * Events go to /api/events (structured server logs) and, if configured,
 * to Plausible. QR contents, file names and anything a visitor typed are
 * never sent: only the tool id and short enum-like values.
 */

type Props = Record<string, string | number | undefined>;

let source: string | null = null;

/** Coarse traffic source: search, social, internal, other or direct. */
export function trafficSource(): string {
  if (source) return source;
  const ref = document.referrer;
  if (!ref) return (source = 'direct');
  try {
    const host = new URL(ref).hostname;
    if (host === location.hostname) source = 'internal';
    else if (/google\.|bing\.|duckduckgo\.|yahoo\.|yandex\.|baidu\.|ecosia\./.test(host)) source = 'search';
    else if (/facebook\.|instagram\.|t\.co$|twitter\.|x\.com|reddit\.|linkedin\.|pinterest\.|tiktok\./.test(host)) source = 'social';
    else source = 'other';
  } catch {
    source = 'other';
  }
  return source;
}

declare global {
  interface Window {
    plausible?: (name: string, opts?: { props?: Props }) => void;
    __qrEvents?: Array<{ name: string; props: Props }>;
  }
}

export function track(name: string, props: Props = {}) {
  const clean: Props = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined) clean[k] = v;
  (window.__qrEvents ??= []).push({ name, props: clean });
  try {
    const body = JSON.stringify({ name, props: clean });
    if (!navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'text/plain' }))) {
      fetch('/api/events', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
    }
  } catch {
    /* analytics must never break the tool */
  }
  try {
    window.plausible?.(name, { props: clean });
  } catch {
    /* ignore */
  }
}

/** Fire once per page load: which tool, and a coarse traffic source. */
export function trackView(tool: string) {
  track('tool_view', { tool, referrer: trafficSource() });
}

const once = new Set<string>();
/** Track an event only the first time a given key is seen on this page view. */
export function trackOnce(key: string, name: string, props: Props = {}) {
  if (once.has(key)) return;
  once.add(key);
  track(name, props);
}
