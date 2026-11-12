/**
 * The short-link landing page: "/s/abc+" previews a link; the same page
 * explains unknown, disabled or temporarily unavailable links.
 */
import type { LinkInfo } from '../../shared/links';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function el(tag: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}

export async function mountLinkPage() {
  const title = $('[data-lp-title]');
  const eyebrow = $('[data-lp-eyebrow]');
  const body = $('[data-lp-body]');
  const actions = $('[data-lp-actions]');
  const report = $<HTMLFormElement>('[data-lp-report]');

  const m = /^\/s\/([^/]+?)(\+)?$/.exec(location.pathname);
  const code = m ? decodeURIComponent(m[1]) : '';
  if (!code) {
    title.textContent = 'That short link doesn’t exist.';
    body.replaceChildren(el('p', 'meta', 'Check the address for typos, or ask whoever shared it for the full link.'));
    return;
  }

  let info: LinkInfo | null = null;
  let status = 0;
  try {
    const res = await fetch(`/api/links/${encodeURIComponent(code)}`);
    status = res.status;
    if (res.ok) info = (await res.json()) as LinkInfo;
  } catch {
    status = 0;
  }

  if (!info) {
    title.textContent = status === 404 ? 'That short link doesn’t exist.' : 'Short links are unavailable right now.';
    body.replaceChildren(
      el('p', 'meta', status === 404 ? 'Check the address for typos, or ask whoever shared it for the full link.' : 'Please try again in a few minutes.'),
    );
    return;
  }

  if (info.disabled) {
    eyebrow.textContent = 'Link disabled';
    title.textContent = 'This link has been disabled.';
    body.replaceChildren(el('p', 'meta', 'It was reported and removed because it may lead to harmful or misleading content.'));
    return;
  }

  let host = '';
  try {
    host = new URL(info.url).hostname;
  } catch {
    /* stored URLs are validated */
  }
  eyebrow.textContent = info.shortUrl.replace(/^https?:\/\//, '');
  title.textContent = 'This link goes to:';
  const created = new Date(info.createdAt);
  body.replaceChildren(
    el('p', 'host', host),
    el('p', 'dest', info.url),
    el('p', 'meta', `Created ${created.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · opened ${info.clicks.toLocaleString()} time${info.clicks === 1 ? '' : 's'}`),
    el('p', 'meta', 'Only open it if you trust the website above.'),
  );
  const go = document.createElement('a');
  go.className = 'btn';
  go.href = info.url;
  go.rel = 'noopener noreferrer nofollow';
  go.textContent = `Continue to ${host}`;
  const rep = document.createElement('button');
  rep.type = 'button';
  rep.className = 'btn btn--quiet';
  rep.textContent = 'Report this link';
  rep.addEventListener('click', () => {
    report.hidden = false;
    $<HTMLTextAreaElement>('[data-lp-reason]').focus();
  });
  actions.replaceChildren(go, rep);

  report.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('[data-lp-report-msg]');
    const reason = $<HTMLTextAreaElement>('[data-lp-reason]').value.trim();
    if (!reason) {
      msg.textContent = 'Tell us briefly what’s wrong with this link.';
      return;
    }
    try {
      const res = await fetch(`/api/links/${encodeURIComponent(info!.code)}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        report.replaceChildren(el('p', 'meta', 'Thanks — we’ve received your report and will review this link.'));
        return;
      }
      msg.textContent = res.status === 429 ? 'Too many reports from this connection. Please try again later.' : 'We couldn’t send your report. Please try again.';
    } catch {
      msg.textContent = 'We couldn’t send your report. Please try again.';
    }
  });
}
