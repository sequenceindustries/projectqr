"""
Browser checks for the URL shortener. Needs a running server backed by
Postgres (DATABASE_URL) and SITE_URL pointing at BASE_URL.

  python3 test/e2e/shortener.py
"""
import json
import os
import subprocess
import sys
import tempfile
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE_URL', 'http://localhost:8080')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
AXE = open(os.path.join(ROOT, 'node_modules/axe-core/axe.min.js')).read()
CHROME = os.environ.get('CHROME_PATH') or None
results, errors = [], []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail and not ok else ''))


def axe(page, label):
    page.wait_for_timeout(200)
    if not page.evaluate('!!window.axe'):
        page.evaluate(AXE + '\n;0')
    res = page.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21aa','best-practice']})")
    bad = [v for v in res['violations'] if v['impact'] in ('serious', 'critical')]
    check(f'a11y: {label}', not bad, '; '.join(f"{v['id']}: {v['nodes'][0]['target']}" for v in bad))


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME)
        ctx = b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'])
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and '404' not in m.text and '409' not in m.text and '400' not in m.text else None)

        page.goto(BASE + '/url-shortener')
        axe(page, 'url-shortener (empty)')
        check('prefix shows this host', page.text_content('[data-short-prefix]') == BASE.split('//')[1] + '/s/')

        # Client-side validation.
        page.fill('[data-short-url]', 'javascript:alert(1)')
        page.click('[data-short-go]')
        check('rejects non-web links', 'Only web links' in page.inner_text('[data-short-url-err]'))
        page.fill('[data-short-url]', 'http://192.168.0.1/admin')
        page.click('[data-short-go]')
        check('rejects private addresses', 'private or local' in page.inner_text('[data-short-url-err]'))

        # Create a link.
        dest = 'https://example.com/spring/menu?table=12'
        page.fill('[data-short-url]', 'example.com/spring/menu?table=12')
        page.click('[data-short-go]')
        page.wait_for_selector('[data-short-result]:not([hidden])')
        short = page.get_attribute('[data-short-link]', 'href')
        check('shows a short link', short.startswith(BASE + '/s/') and len(short.split('/s/')[1]) == 7, short)
        check('shows the destination', page.inner_text('[data-short-dest]') == dest)
        page.click('[data-short-copy]')
        check('copy puts it on the clipboard', page.evaluate('navigator.clipboard.readText()') == short)
        with page.expect_download() as d:
            page.click('[data-short-dl="png"]')
        png = os.path.join(tempfile.mkdtemp(), 'short.png')
        d.value.save_as(png)
        out = subprocess.run(['npx', 'tsx', os.path.join(ROOT, 'test/e2e/decode.ts'), png], capture_output=True, text=True, cwd=ROOT)
        decoded = json.loads(out.stdout.strip().splitlines()[-1])[png]['text']
        check('QR code decodes to the short link', decoded == short, decoded)
        check('recent list shows it', short.replace('http://', '') in page.inner_text('[data-short-recent]'))
        axe(page, 'url-shortener (result)')

        # The short link redirects.
        r = ctx.request.get(short, max_redirects=0)
        check('short link redirects (302) to destination', r.status == 302 and r.headers['location'] == dest, f'{r.status} {r.headers.get("location")}')

        # Same destination → same code.
        page.click('[data-short-again]')
        page.fill('[data-short-url]', dest)
        page.click('[data-short-go]')
        page.wait_for_selector('[data-short-result]:not([hidden])')
        check('same destination reuses the link', page.get_attribute('[data-short-link]', 'href') == short)

        # Custom ending + taken.
        alias = 'menu-' + os.urandom(3).hex()
        page.click('[data-short-again]')
        page.fill('[data-short-url]', 'https://example.com/other')
        page.click('[data-short-custom] summary')
        page.fill('[data-short-alias]', alias.upper())
        page.click('[data-short-go]')
        page.wait_for_selector('[data-short-result]:not([hidden])')
        check('custom ending works (lowercased)', page.get_attribute('[data-short-link]', 'href') == f'{BASE}/s/{alias}')
        page.click('[data-short-again]')
        page.fill('[data-short-url]', 'https://example.com/third')
        page.click('[data-short-custom] summary') if not page.is_visible('[data-short-alias]') else None
        page.fill('[data-short-alias]', alias)
        page.click('[data-short-go]')
        page.wait_for_selector('[data-short-alias-err]:not(:empty)')
        check('taken ending explained', 'already taken' in page.inner_text('[data-short-alias-err]'))
        page.fill('[data-short-alias]', 'admin')
        page.click('[data-short-go]')
        check('reserved ending refused', 'reserved' in page.inner_text('[data-short-alias-err]'))

        # Preview page.
        page.goto(short + '+')
        page.wait_for_selector('text=This link goes to:')
        body = page.inner_text('[data-lp-card]')
        check('preview shows destination and opens', dest in body and 'opened ' in body, body)
        check('preview has continue link', page.get_attribute('[data-lp-actions] a', 'href') == dest)
        axe(page, 'link preview')
        page.click('text=Report this link')
        page.fill('[data-lp-reason]', 'Test report from e2e')
        page.click('text=Send report')
        page.wait_for_selector('text=we’ve received your report')
        check('report sent', True)

        page.goto(BASE + '/s/doesnotexist')
        page.wait_for_selector('text=doesn’t exist')
        check('unknown link explained (404)', True)

        # Mobile.
        m = b.new_context(viewport={'width': 360, 'height': 740}, is_mobile=True, has_touch=True)
        mp = m.new_page()
        mp.goto(BASE + '/url-shortener')
        mp.fill('[data-short-url]', 'https://example.com/' + 'very-long-path-segment/' * 8)
        mp.tap('[data-short-go]')
        mp.wait_for_selector('[data-short-result]:not([hidden])')
        w = mp.evaluate('[document.documentElement.scrollWidth, innerWidth]')
        check('mobile: no horizontal scroll', w[0] <= w[1], str(w))
        mp.goto(short + '+')
        w = mp.evaluate('[document.documentElement.scrollWidth, innerWidth]')
        check('mobile preview: no horizontal scroll', w[0] <= w[1], str(w))

        ev = page.evaluate('window.__qrEvents || []')
        b.close()

    check('no console or page errors', not errors, '; '.join(errors[:5]))
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
