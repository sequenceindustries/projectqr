/**
 * URL shortener controller. Validates in the browser for instant feedback,
 * then asks the server (which re-checks everything) to store the link.
 * Analytics never include the link itself.
 */
import { checkAlias, checkDestination, type LinkInfo } from '../../shared/links';
import { DEFAULT_DESIGN, encode, toSvg } from '../../shared/qr/render';
import { canvasBlob, drawToCanvas, saveBlob } from './qr/draw';
import { track, trackView } from './analytics';

const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;
const RECENT_KEY = 'cg.shortLinks';
const RECENT_MAX = 10;

type Recent = { shortUrl: string; url: string; at: number };

function readRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((r) => r && typeof r.shortUrl === 'string' && typeof r.url === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function writeRecent(list: Recent[]) {
  try {
    if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    else localStorage.removeItem(RECENT_KEY);
  } catch {
    /* storage blocked: the list just won't persist */
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function mountShorteners() {
  for (const root of document.querySelectorAll<HTMLElement>('[data-shortener]')) {
    if (root.dataset.mounted) continue;
    root.dataset.mounted = '1';
    mount(root);
  }
}

function mount(root: HTMLElement) {
  const tool = 'url-shortener';
  const form = $<HTMLFormElement>(root, '[data-short-form]');
  const urlIn = $<HTMLInputElement>(root, '[data-short-url]');
  const urlErr = $(root, '[data-short-url-err]');
  const aliasIn = $<HTMLInputElement>(root, '[data-short-alias]');
  const aliasErr = $(root, '[data-short-alias-err]');
  const custom = $<HTMLDetailsElement>(root, '[data-short-custom]');
  const errEl = $(root, '[data-short-error]');
  const go = $<HTMLButtonElement>(root, '[data-short-go]');
  const out = $(root, '[data-short-result]');
  const link = $<HTMLAnchorElement>(root, '[data-short-link]');
  const dest = $(root, '[data-short-dest]');
  const status = $(root, '[data-short-status]');
  const qrBox = $(root, '[data-short-qr]');
  const preview = $<HTMLAnchorElement>(root, '[data-short-preview]');
  const recentBox = $(root, '[data-short-recent]');
  const recentList = $(root, '[data-short-recent-list]');

  $(root, '[data-short-prefix]').textContent = `${location.host}/s/`;
  let current: LinkInfo | null = null;
  trackView(tool);

  const clear = () => {
    urlErr.textContent = '';
    aliasErr.textContent = '';
    urlIn.removeAttribute('aria-invalid');
    aliasIn.removeAttribute('aria-invalid');
    errEl.hidden = true;
  };
  const fail = (code: string, message: string, field?: 'url' | 'alias') => {
    if (field === 'url') {
      urlErr.textContent = message;
      urlIn.setAttribute('aria-invalid', 'true');
      urlIn.focus();
    } else if (field === 'alias') {
      custom.open = true;
      aliasErr.textContent = message;
      aliasIn.setAttribute('aria-invalid', 'true');
      aliasIn.focus();
    } else {
      errEl.textContent = message;
      errEl.hidden = false;
    }
    track('short_link_failed', { tool, code });
  };

  function renderRecent() {
    const list = readRecent();
    recentBox.hidden = !list.length;
    recentList.replaceChildren(
      ...list.map((r) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = r.shortUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = r.shortUrl.replace(/^https?:\/\//, '');
        const small = document.createElement('small');
        small.textContent = r.url;
        small.title = r.url;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn--quiet btn--small';
        b.textContent = 'Copy';
        b.setAttribute('aria-label', `Copy ${a.textContent}`);
        b.addEventListener('click', async () => {
          b.textContent = (await copyText(r.shortUrl)) ? 'Copied' : 'Copy failed';
          setTimeout(() => (b.textContent = 'Copy'), 1600);
        });
        li.append(a, b, small);
        return li;
      }),
    );
  }
  $(root, '[data-short-clear]').addEventListener('click', () => {
    writeRecent([]);
    renderRecent();
    urlIn.focus();
  });
  renderRecent();

  function show(info: LinkInfo) {
    current = info;
    link.href = info.shortUrl;
    link.textContent = info.shortUrl.replace(/^https?:\/\//, '');
    dest.textContent = info.url;
    preview.href = `${info.shortUrl}+`;
    status.textContent = '';
    const tpl = document.createElement('template');
    tpl.innerHTML = toSvg(encode(info.shortUrl, 'M'), DEFAULT_DESIGN, 280);
    const svg = tpl.content.firstElementChild!;
    svg.setAttribute('aria-hidden', 'true');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    qrBox.replaceChildren(svg);
    out.hidden = false;
    out.focus({ preventScroll: true });
    out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    const list = readRecent().filter((r) => r.shortUrl !== info.shortUrl);
    writeRecent([{ shortUrl: info.shortUrl, url: info.url, at: Date.now() }, ...list]);
    renderRecent();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear();
    const d = checkDestination(urlIn.value, [location.hostname]);
    if (!d.ok) return fail(d.code, d.message, 'url');
    const a = checkAlias(aliasIn.value);
    if (!a.ok) return fail(a.code, a.message, 'alias');
    go.disabled = true;
    go.textContent = 'Shortening…';
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: d.url, alias: a.alias ?? undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = body?.error?.code ?? 'server_error';
        const msg = res.status === 429 ? 'You’ve made a lot of links in a short time. Please try again in a little while.' : body?.error?.message ?? 'Something went wrong. Please try again.';
        return fail(code, msg, code === 'alias_taken' || code.endsWith('_alias') ? 'alias' : ['invalid_url', 'bad_scheme', 'private_host', 'own_host', 'shortener', 'credentials', 'too_long'].includes(code) ? 'url' : undefined);
      }
      track('short_link_created', { tool, value: a.alias ? 'custom' : 'auto' });
      show(body as LinkInfo);
    } catch {
      fail('network', 'We couldn’t reach the server. Check your connection and try again.');
    } finally {
      go.disabled = false;
      go.textContent = 'Shorten link';
    }
  });

  $(root, '[data-short-copy]').addEventListener('click', async () => {
    if (!current) return;
    const ok = await copyText(current.shortUrl);
    status.textContent = ok ? 'Copied to your clipboard.' : 'Copy failed — press and hold the link to copy it.';
    if (ok) track('short_link_copied', { tool });
  });

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-short-dl]')) {
    b.addEventListener('click', async () => {
      if (!current) return;
      const fmt = b.dataset.shortDl as 'png' | 'svg';
      const m = encode(current.shortUrl, 'M');
      const name = `qr-code-${current.code}.${fmt}`;
      if (fmt === 'svg') saveBlob(new Blob([toSvg(m, DEFAULT_DESIGN, 1024)], { type: 'image/svg+xml' }), name);
      else {
        const c = document.createElement('canvas');
        drawToCanvas(c, m, DEFAULT_DESIGN, 1024);
        saveBlob(await canvasBlob(c, 'image/png'), name);
      }
      status.textContent = `Downloaded ${fmt.toUpperCase()}.`;
      track('qr_downloaded', { tool, type: 'url', format: fmt });
    });
  }

  $(root, '[data-short-again]').addEventListener('click', () => {
    out.hidden = true;
    current = null;
    form.reset();
    clear();
    urlIn.focus();
  });
}
