"""
End-to-end browser checks for QR Tools.

Usage:
  npm run build && npm start               # one terminal
  npx tsx test/e2e/make_fixtures.ts         # once
  python3 test/e2e/run.py test/e2e/fixtures # another terminal (pip install playwright)

Every downloaded QR code is decoded by an independent pipeline (sharp + jsQR,
test/e2e/decode.ts) and compared byte-for-byte with what we meant to encode.
"""
import json
import os
import subprocess
import sys
import zipfile
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE_URL', 'http://localhost:8080')
FX = sys.argv[1] if len(sys.argv) > 1 else 'test/e2e/fixtures'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
AXE = open(os.path.join(ROOT, 'node_modules/axe-core/axe.min.js')).read()
CHROME = os.environ.get('CHROME_PATH') or (
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None
)
TMP = os.path.join(FX, '_downloads')
os.makedirs(TMP, exist_ok=True)

results = []
errors = []  # console errors / page errors across the run
to_decode = []  # (label, path, expected_text, expected_px)


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail and not ok else ''))


def fx(n):
    return os.path.abspath(os.path.join(FX, n))


def watch(page, label):
    page.on('pageerror', lambda e: errors.append(f'{label}: {e}'))
    page.on('console', lambda m: errors.append(f'{label}: {m.text}') if m.type == 'error' else None)


def axe(page, label):
    page.wait_for_timeout(300)
    # Injected via DevTools evaluation, which the page's CSP (rightly) doesn't block.
    if not page.evaluate('!!window.axe'):
        page.evaluate(AXE + '\n;0')
    res = page.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21aa','best-practice']})")
    serious = [v for v in res['violations'] if v['impact'] in ('serious', 'critical')]
    check(f'a11y: {label}', not serious, '; '.join(f"{v['id']} ({len(v['nodes'])}): {v['nodes'][0]['target']}" for v in serious))


def no_hscroll(page, label):
    w = page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
    check(f'no horizontal scroll: {label}', w[0] <= w[1], f'{w[0]} > {w[1]}')


def download(page, selector, name):
    with page.expect_download() as d:
        page.click(selector)
    path = os.path.join(TMP, name)
    d.value.save_as(path)
    return path, d.value.suggested_filename


def fill_type(page, qtype, values):
    if page.locator(f'[data-type-radio][value="{qtype}"]').count():
        page.check(f'[data-type-radio][value="{qtype}"]')
    g = f'[data-fields="{qtype}"]'
    for k, v in values.items():
        sel = f'{g} [data-f="{k}"]'
        tag = page.eval_on_selector(sel, 'e => e.tagName + ":" + (e.type||"")')
        if tag.startswith('SELECT'):
            page.select_option(sel, v)
        elif tag.endswith('checkbox'):
            page.set_checked(sel, bool(v))
        else:
            page.fill(sel, v)


def wait_ok(page, timeout=6000):
    page.wait_for_selector('[data-check][data-state="ok"]', timeout=timeout)


def events(page):
    return page.evaluate('window.__qrEvents || []')


GEN_CASES = [
    ('url', {'url': 'example.com/path?x=1&y=2'}, 'https://example.com/path?x=1&y=2'),
    ('text', {'text': 'Hello 👋 Ünïcode & <b>tags</b>\nline two'}, 'Hello 👋 Ünïcode & <b>tags</b>\nline two'),
    ('email', {'email': 'hi@example.com', 'subject': 'Hi there', 'body': 'Line & more'}, 'mailto:hi@example.com?subject=Hi%20there&body=Line%20%26%20more'),
    ('phone', {'phone': '+27 (82) 123-4567'}, 'tel:+27821234567'),
    ('sms', {'phone': '+27821234567', 'message': 'On my way: 5 min'}, 'SMSTO:+27821234567:On my way: 5 min'),
    ('whatsapp', {'phone': '+27 82 123 4567', 'message': 'Hi!'}, 'https://wa.me/27821234567?text=Hi!'),
    ('wifi', {'ssid': 'Café;Net', 'security': 'WPA', 'password': 'p@ss:w;rd,"\\x', 'hidden': True}, 'WIFI:T:WPA;S:Café\\;Net;P:p@ss\\:w\\;rd\\,\\"\\\\x;H:true;;'),
    ('vcard', {'firstName': 'Thandi', 'lastName': 'Nkosi', 'company': 'Sequence, Ltd', 'phone': '+27821234567', 'email': 't@example.com'},
     'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Nkosi;Thandi;;;\r\nFN:Thandi Nkosi\r\nORG:Sequence\\, Ltd\r\nTEL;TYPE=CELL:+27821234567\r\nEMAIL:t@example.com\r\nEND:VCARD'),
    ('location', {'lat': '-26.2041', 'lng': '28.0473'}, 'https://maps.google.com/?q=-26.2041,28.0473'),
]
PRIVATE_BITS = ['example', 'Café', 'Thandi', 'Nkosi', '27821234567', 'p@ss', 'Hello', 'tags', '26.2041', 'google', 'openai']


def test_generator(browser):
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    watch(page, 'home')
    page.goto(BASE + '/')
    check('home: placeholder before input', page.is_visible('[data-placeholder]'))
    check('home: downloads disabled before input', page.is_disabled('[data-dl="png"]'))
    axe(page, 'home (empty)')

    # Every type: live preview → scan check → PNG + SVG decode exactly.
    for qtype, values, expected in GEN_CASES:
        page.goto(BASE + '/')
        fill_type(page, qtype, values)
        page.click('[data-generate]')
        try:
            wait_ok(page)
            ok = True
        except Exception:
            ok = False
        check(f'generator {qtype}: scan check passed', ok, page.inner_text('[data-check]') if page.is_visible('[data-check]') else 'no status')
        if not ok:
            continue
        p, fn = download(page, '[data-dl="png"]', f'gen-{qtype}.png')
        to_decode.append((f'generator {qtype} PNG', p, expected, 1024))
        s, _ = download(page, '[data-dl="svg"]', f'gen-{qtype}.svg')
        to_decode.append((f'generator {qtype} SVG', s, expected, None))
        check(f'generator {qtype}: file name', fn.startswith('qr-code-') and fn.endswith('.png'), fn)
    axe(page, 'home (with QR)')

    # JPG + custom size.
    page.goto(BASE + '/')
    fill_type(page, 'url', {'url': 'https://example.com/jpg'})
    wait_ok(page)
    page.select_option('[data-size]', 'custom')
    page.fill('[data-size-custom]', '300')
    page.press('[data-size-custom]', 'Tab')
    j, _ = download(page, '[data-dl="jpg"]', 'gen-custom.jpg')
    to_decode.append(('JPG at custom 300px', j, 'https://example.com/jpg', 300))
    page.select_option('[data-size]', '4096')
    big, _ = download(page, '[data-dl="png"]', 'gen-4096.png')
    to_decode.append(('PNG at 4096px', big, 'https://example.com/jpg', 4096))
    page.select_option('[data-size]', '512')
    small, _ = download(page, '[data-dl="png"]', 'gen-512.png')
    to_decode.append(('PNG at 512px', small, 'https://example.com/jpg', 512))

    # Validation messages.
    for qtype, values, msg in [
        ('url', {'url': 'not a url'}, 'Please enter a valid URL.'),
        ('email', {'email': 'nope'}, 'Please enter a valid email address.'),
        ('wifi', {'ssid': ''}, 'Enter your Wi-Fi network name to continue.'),
        ('whatsapp', {'phone': '082 123 4567'}, 'Include the country code'),
    ]:
        page.goto(BASE + '/')
        fill_type(page, qtype, values)
        page.click('[data-generate]')
        txt = page.inner_text(f'[data-fields="{qtype}"]')
        check(f'validation {qtype}: "{msg}"', msg in txt, txt[:200])
        check(f'validation {qtype}: no download', page.is_disabled('[data-dl="png"]'))

    # Empty submit shows an error, not a crash.
    page.goto(BASE + '/')
    page.click('[data-generate]')
    check('validation: empty URL', 'Enter a link to continue.' in page.inner_text('[data-fields="url"]'))

    # Long text and too-long text.
    page.goto(BASE + '/')
    long = ('Fünf große Äpfel 🍎 ' * 100)[:1500]
    fill_type(page, 'text', {'text': long})
    wait_ok(page, 10000)
    p, _ = download(page, '[data-dl="png"]', 'gen-long.png')
    to_decode.append(('long Unicode text (1,500 chars)', p, long, 1024))
    page.click('summary:has-text("Customise design")')
    page.check('[data-ec][value="H"]', force=True)
    page.wait_for_timeout(300)
    err = page.inner_text('[data-form-error]') if page.is_visible('[data-form-error]') else ''
    check('too long at High EC explains itself', 'too much for this error-correction level' in err, err)

    # Keyboard: arrow keys move between types.
    page.goto(BASE + '/')
    page.focus('[data-type-radio][value="url"]')
    page.keyboard.press('ArrowRight')
    check('keyboard: arrow key switches type', page.is_visible('[data-fields="text"]'))

    # Analytics: names and no content.
    ev = events(page)
    ctx.close()
    return ev


def test_custom(browser):
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    watch(page, 'custom')
    page.goto(BASE + '/custom-qr-code')
    check('custom: design panel visible', page.is_visible('[data-module][value="dots"]') or page.is_visible('text=Pattern'))
    url = 'https://example.com/custom-design'
    fill_type(page, 'url', {'url': url})
    wait_ok(page)
    page.click('[data-preset="#3525d8,#ffffff"]')
    page.check('[data-module][value="dots"]', force=True)
    page.check('[data-eye][value="circle"]', force=True)
    page.uncheck('[data-d="eye-same"]')
    page.fill('[data-d="eye-hex"]', '#B42335')
    wait_ok(page)
    page.set_input_files('[data-logo-input]', fx('logo.png'))
    page.wait_for_selector('[data-logo-thumb]:not([hidden])')
    check('logo: error correction locked to H', page.is_checked('[data-ec][value="H"]') and page.is_disabled('[data-ec][value="L"]'))
    wait_ok(page)
    page.fill('[data-logo-scale]', '24')
    page.dispatch_event('[data-logo-scale]', 'input')
    wait_ok(page)
    s, _ = download(page, '[data-dl="svg"]', 'custom-logo.svg')
    to_decode.append(('custom: dots + circle eyes + colours + max logo (SVG)', s, url, None))
    page.select_option('[data-size]', '2048')
    p, _ = download(page, '[data-dl="png"]', 'custom-logo.png')
    to_decode.append(('custom: dots + circle eyes + colours + max logo (PNG 2048)', p, url, 2048))
    svg = open(s).read()
    check('custom SVG embeds the logo as PNG data', '<image' in svg and 'data:image/png;base64,' in svg)
    for st in ['rounded', 'square']:
        page.check(f'[data-module][value="{st}"]', force=True)
        page.check(f'[data-eye][value="{st}"]', force=True)
        wait_ok(page)
        f, _ = download(page, '[data-dl="png"]', f'custom-{st}.png')
        to_decode.append((f'custom: {st} style + logo', f, url, 2048))
    # Wide logo.
    page.set_input_files('[data-logo-input]', fx('logo-wide.png'))
    page.wait_for_timeout(300)
    wait_ok(page)
    check('logo: wide logo accepted', page.inner_text('[data-logo-error]') == '')
    # Invalid logos.
    page.set_input_files('[data-logo-input]', fx('logo-fake.png'))
    page.wait_for_timeout(300)
    check('logo: fake image rejected', 'valid image' in page.inner_text('[data-logo-error]'), page.inner_text('[data-logo-error]'))
    page.set_input_files('[data-logo-input]', fx('logo-huge.png'))
    page.wait_for_timeout(300)
    check('logo: over 2 MB rejected', '2 MB' in page.inner_text('[data-logo-error]'), page.inner_text('[data-logo-error]'))
    page.click('[data-logo-remove]')
    check('logo removed: EC unlocked', not page.is_disabled('[data-ec][value="L"]'))
    # Low contrast is blocked behind a confirmation.
    page.fill('[data-d="fg-hex"]', '#DDDDDD')
    page.fill('[data-d="bg-hex"]', '#FFFFFF')
    page.wait_for_timeout(400)
    warn = page.inner_text('[data-warnings]')
    check('low contrast: warning shown', 'too similar' in warn, warn)
    page.click('[data-dl="png"]')
    check('low contrast: download needs confirmation', page.is_visible('[data-confirm]') and page.evaluate("document.activeElement.matches('[data-confirm-box]')"))
    page.check('[data-confirm-box]')
    p, _ = download(page, '[data-dl="png"]', 'custom-lowcontrast.png')
    check('low contrast: download allowed after confirming', os.path.getsize(p) > 0)
    # Inverted warns.
    page.fill('[data-d="fg-hex"]', '#FFFFFF')
    page.fill('[data-d="bg-hex"]', '#111111')
    page.wait_for_timeout(400)
    check('inverted: warning shown', 'Light codes on dark' in page.inner_text('[data-warnings]'))
    page.click('[data-reset-design]')
    wait_ok(page)
    check('reset: back to clean design', page.inner_text('[data-warnings]').strip() == '')
    axe(page, 'custom-qr-code')
    ev = events(page)
    ctx.close()
    return ev


def test_dedicated(browser):
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    watch(page, 'wifi/vcard')
    page.goto(BASE + '/wifi-qr-code')
    check('wifi page: no type selector', page.locator('[data-type-radio]').count() == 0)
    fill_type(page, 'wifi', {'ssid': 'Guest', 'security': 'nopass'})
    check('wifi: password hidden for no-password networks', not page.is_visible('[data-fields="wifi"] [data-f="password"]'))
    wait_ok(page)
    check('wifi: "Scan to connect to Wi-Fi" caption', page.is_visible('text=Scan to connect to Wi-Fi'))
    p, _ = download(page, '[data-dl="png"]', 'wifi-open.png')
    to_decode.append(('wifi page: open network', p, 'WIFI:T:nopass;S:Guest;;', 1024))
    fill_type(page, 'wifi', {'ssid': 'Office 5G', 'security': 'WEP', 'password': 'abcde'})
    wait_ok(page)
    s, _ = download(page, '[data-dl="svg"]', 'wifi-wep.svg')
    to_decode.append(('wifi page: WEP', s, 'WIFI:T:WEP;S:Office 5G;P:abcde;;', None))
    page.click('[data-pw-toggle]')
    check('wifi: show password toggle', page.get_attribute('[data-fields="wifi"] [data-f="password"]', 'type') == 'text')
    axe(page, 'wifi-qr-code')

    page.goto(BASE + '/vcard-qr-code')
    check('vcard: headline', page.inner_text('h1') == 'Create a digital contact QR code.')
    fill_type(page, 'vcard', {'firstName': 'Sam'})
    wait_ok(page)
    p, _ = download(page, '[data-dl="png"]', 'vcard-min.png')
    to_decode.append(('vcard: only a name (optional fields missing)', p, 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Sam;;;\r\nFN:Sam\r\nEND:VCARD', 1024))
    fill_type(page, 'vcard', {'firstName': 'Sam', 'website': 'sam.dev', 'address': '1 Main Rd\nCape Town'})
    wait_ok(page)
    s, _ = download(page, '[data-dl="svg"]', 'vcard-addr.svg')
    to_decode.append(('vcard: website + multi-line address', s, 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Sam;;;\r\nFN:Sam\r\nURL:https://sam.dev\r\nADR:;;1 Main Rd\\, Cape Town;;;;\r\nEND:VCARD', None))
    axe(page, 'vcard-qr-code')

    page.goto(BASE + '/qr-code-generator')
    links = page.eval_on_selector_all('.prompts a', 'as => as.map(a => a.getAttribute("href"))')
    check('generator page: internal links to wifi/scanner/custom', all(x in links for x in ['/wifi-qr-code', '/qr-code-scanner', '/custom-qr-code']), str(links))
    axe(page, 'qr-code-generator')
    ctx.close()


def scan_upload(page, file):
    page.set_input_files('[data-file]', fx(file))
    page.wait_for_selector('[data-result]:not([hidden]), [data-scan-error]:not([hidden])', timeout=10000)
    if page.is_visible('[data-result]'):
        return 'ok', page.inner_text('[data-r-label]'), page.inner_text('[data-r-body]')
    return 'err', page.inner_text('[data-scan-error]'), ''


def test_scanner(browser):
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900})
    page = ctx.new_page()
    watch(page, 'scanner')
    page.goto(BASE + '/qr-code-scanner')
    axe(page, 'qr-code-scanner')
    for f, label, contains in [
        ('qr-url.png', 'Link detected', 'https://example.com/scan-me'),
        ('qr-wifi.jpg', 'Wi-Fi network detected', 'Café;Net'),
        ('qr-photo.jpg', 'Link detected', 'https://example.com/in-a-photo'),
        ('qr-lowres.png', 'Text detected', 'Low res text'),
        ('qr-inverted.png', 'Text detected', 'Inverted!'),
    ]:
        page.goto(BASE + '/qr-code-scanner')
        st, lab, body = scan_upload(page, f)
        check(f'scanner upload {f}: {label}', st == 'ok' and lab == label and contains in body, f'{st} {lab} {body[:80]}')
    page.goto(BASE + '/qr-code-scanner')
    scan_upload(page, 'qr-url.png')
    href = page.get_attribute('[data-r-actions] a', 'href')
    rel = page.get_attribute('[data-r-actions] a', 'rel') or ''
    check('scanner: Open Link is safe (noopener, exact URL)', href == 'https://example.com/scan-me' and 'noopener' in rel, f'{href} {rel}')
    check('scanner: Copy Result present', page.is_visible('text=Copy result'))
    axe(page, 'qr-code-scanner (result)')
    page.goto(BASE + '/qr-code-scanner')
    st, msg, _ = scan_upload(page, 'no-qr.png')
    check('scanner: no QR → friendly message', st == 'err' and "We couldn't detect a QR code in this image." in msg, msg)
    st, msg, _ = scan_upload(page, 'fake.png')
    check('scanner: fake image → "Please upload a valid image."', st == 'err' and msg == 'Please upload a valid image.', msg)

    # Drag and drop.
    page.goto(BASE + '/qr-code-scanner')
    data = open(fx('qr-url.png'), 'rb').read()
    page.evaluate(
        """async (bytes) => {
          const dt = new DataTransfer();
          dt.items.add(new File([new Uint8Array(bytes)], 'drop.png', { type: 'image/png' }));
          const t = document.querySelector('[data-drop]');
          for (const type of ['dragenter', 'dragover', 'drop']) t.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        }""",
        list(data),
    )
    page.wait_for_selector('[data-result]:not([hidden])', timeout=8000)
    check('scanner: drag and drop', 'scan-me' in page.inner_text('[data-r-body]'))

    page.goto(BASE + '/qr-code-reader')
    st, lab, body = scan_upload(page, 'qr-url.png')
    check('reader: upload → result', st == 'ok' and 'scan-me' in body)
    axe(page, 'qr-code-reader')
    ev = events(page)
    ctx.close()
    return ev


def test_camera(p):
    args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={fx("camera.y4m")}']
    b = p.chromium.launch(executable_path=CHROME, args=args)
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, permissions=['camera'])
    page = ctx.new_page()
    watch(page, 'camera')
    page.goto(BASE + '/qr-code-scanner')
    check('camera: not started before tap', page.evaluate('!document.querySelector("[data-video]").srcObject'))
    page.click('[data-cam-start]')
    try:
        page.wait_for_selector('[data-result]:not([hidden])', timeout=15000)
        body = page.inner_text('[data-r-body]')
    except Exception:
        body = page.inner_text('[data-scan-error]') if page.is_visible('[data-scan-error]') else 'timeout'
    check('camera: scans a code from the camera feed', 'from-camera' in body, body[:100])
    check('camera: stopped after a result', page.evaluate('!document.querySelector("[data-video]").srcObject'))
    ctx.close()
    b.close()

    # Permission denied.
    b = p.chromium.launch(executable_path=CHROME, args=['--use-fake-device-for-media-stream'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    page = ctx.new_page()
    watch(page, 'camera-denied')
    page.goto(BASE + '/qr-code-scanner')
    page.evaluate("() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); }")
    page.click('[data-cam-start]')
    page.wait_for_selector('[data-scan-error]:not([hidden])')
    check('camera: denied → helpful message', 'upload a QR image instead' in page.inner_text('[data-scan-error]'))
    page.evaluate("Object.defineProperty(navigator, 'mediaDevices', { value: undefined })")
    page.click('[data-cam-start]')
    check('camera: unavailable → spec message', page.inner_text('[data-scan-error]') == "Camera access isn't available. You can upload a QR image instead.")
    ctx.close()
    b.close()


def test_batch(browser):
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    watch(page, 'batch')
    page.goto(BASE + '/batch-qr-code')
    axe(page, 'batch-qr-code')
    page.click('[data-example]')
    page.click('[data-b-run]')
    page.wait_for_selector('[data-b-zip]:not([disabled])', timeout=10000)
    check('batch: example → 3 codes', page.inner_text('[data-b-count]').startswith('3 QR codes ready'), page.inner_text('[data-b-count]'))
    z, _ = download(page, '[data-b-zip]', 'batch-small.zip')
    with zipfile.ZipFile(z) as zf:
        names = sorted(zf.namelist())
        check('batch zip: named files + index', names == ['google.png', 'openai.png', 'qr-codes.csv', 'sequence-industries.png'], str(names))
        out = os.path.join(TMP, 'batch-small')
        zf.extractall(out)
    for n, url in [('google.png', 'https://google.com'), ('openai.png', 'https://openai.com'), ('sequence-industries.png', 'https://example.com')]:
        to_decode.append((f'batch: {n}', os.path.join(out, n), url, 1024))
    axe(page, 'batch-qr-code (results)')

    # Upload a messy CSV, SVG output.
    page.set_input_files('[data-csv-file]', fx('messy.csv'))
    page.wait_for_timeout(300)
    page.check('[data-b-fmt][value="svg"]', force=True)
    page.click('[data-b-run]')
    page.wait_for_selector('[data-b-zip]:not([disabled])', timeout=10000)
    cnt = page.inner_text('[data-b-count]')
    check('batch messy: counts', cnt == '4 QR codes ready · 2 rows skipped · 1 duplicate', cnt)
    errs = page.inner_text('[data-b-errors]')
    check('batch messy: skipped rows explained', 'Row 3: Please enter a valid URL.' in errs and 'Row 7: This row has no link.' in errs, errs)
    z, _ = download(page, '[data-b-zip]', 'batch-messy.zip')
    with zipfile.ZipFile(z) as zf:
        names = sorted(zf.namelist())
        check('batch messy: duplicates renamed, missing name handled', names == ['good-2.svg', 'good-3.svg', 'good.svg', 'qr-codes.csv', 'row-4.svg'], str(names))
        zf.extractall(os.path.join(TMP, 'batch-messy'))
    to_decode.append(('batch SVG: row-4.svg', os.path.join(TMP, 'batch-messy', 'row-4.svg'), 'https://nameless.com', None))

    page.set_input_files('[data-csv-file]', fx('too-many.csv'))
    page.wait_for_timeout(200)
    page.click('[data-b-run]')
    check('batch: row limit enforced', 'Up to 500 rows' in page.inner_text('[data-b-error]'))

    page.check('[data-b-fmt][value="png"]', force=True)
    page.select_option('[data-b-size]', '512')
    page.set_input_files('[data-csv-file]', fx('large.csv'))
    page.wait_for_timeout(200)
    page.click('[data-b-run]')
    page.wait_for_selector('[data-b-zip]:not([disabled])', timeout=90000)
    check('batch: 300-row CSV', page.inner_text('[data-b-count]').startswith('300 QR codes ready'), page.inner_text('[data-b-count]'))
    check('batch: 300-row CSV all pass scan check', page.is_hidden('[data-b-error]'))
    z, _ = download(page, '[data-b-zip]', 'batch-large.zip')
    with zipfile.ZipFile(z) as zf:
        check('batch: 300 files + index in ZIP', len(zf.namelist()) == 301)
        zf.extract('table-300.png', os.path.join(TMP, 'batch-large'))
    to_decode.append(('batch: table-300.png', os.path.join(TMP, 'batch-large', 'table-300.png'), 'https://example.com/menu?table=300', 512))

    page.fill('[data-csv]', '')
    page.click('[data-b-run]')
    check('batch: empty input message', 'Paste your list' in page.inner_text('[data-b-error]'))
    ev = events(page)
    ctx.close()
    return ev


def test_mobile(browser):
    ctx = browser.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    page = ctx.new_page()
    watch(page, 'mobile')
    for path in ['/', '/qr-code-generator', '/qr-code-scanner', '/qr-code-reader', '/wifi-qr-code', '/vcard-qr-code', '/custom-qr-code', '/batch-qr-code', '/about', '/privacy', '/missing-page']:
        page.goto(BASE + path)
        no_hscroll(page, f'mobile {path}')
    page.goto(BASE + '/')
    page.tap('[data-type-radio][value="wifi"]')
    fill_type(page, 'wifi', {'ssid': 'Home', 'password': 'supersecret'})
    page.tap('[data-generate]')
    wait_ok(page)
    no_hscroll(page, 'mobile home with QR')
    inview = page.evaluate("(() => { const r = document.querySelector('[data-out]').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 })()")
    check('mobile: Generate scrolls the QR into view', inview)
    small_list = page.evaluate("""[...document.querySelectorAll('button, .btn, [data-type-radio] + span, summary')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).map(e => e.outerHTML.slice(0, 80))""")
    small = page.evaluate("""[...document.querySelectorAll('button, .btn, [data-type-radio] + span, summary')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect()).filter(r => r.height < 40).length""")
    check('mobile: tap targets ≥ 40px', small == 0, str(small_list))
    p, _ = download(page, '[data-dl="png"]', 'mobile-wifi.png')
    to_decode.append(('mobile: wifi PNG', p, 'WIFI:T:WPA;S:Home;P:supersecret;;', 1024))
    page.click('summary:has-text("Customise design")')
    no_hscroll(page, 'mobile customiser open')
    axe(page, 'mobile home')
    ctx.close()


def test_seo(browser):
    ctx = browser.new_context()
    page = ctx.new_page()
    titles, descs = set(), set()
    for path in ['/', '/qr-code-generator', '/qr-code-scanner', '/qr-code-reader', '/wifi-qr-code', '/vcard-qr-code', '/custom-qr-code', '/batch-qr-code']:
        r = page.goto(BASE + path)
        t = page.title()
        d = page.get_attribute('meta[name=description]', 'content')
        canon = page.get_attribute('link[rel=canonical]', 'href')
        og = page.get_attribute('meta[property="og:title"]', 'content')
        h1 = page.locator('h1').count()
        ld = page.eval_on_selector_all('script[type="application/ld+json"]', 'ss => ss.map(s => JSON.parse(s.textContent)["@type"])')
        csp = r.headers.get('content-security-policy', '')
        ok = r.status == 200 and t and d and canon.endswith(path if path != '/' else '/') and og and h1 == 1 and len(t) <= 65 and len(d) <= 165 and "script-src 'self'" in csp
        if path != '/':
            ok = ok and 'FAQPage' in ld and page.locator('.faq details').count() >= 3 and page.locator('#rel-h').count() == 1
        check(f'seo {path}', ok, f'title={len(t)} desc={len(d) if d else 0} h1={h1} ld={ld}')
        titles.add(t)
        descs.add(d)
    check('seo: titles and descriptions unique', len(titles) == 8 and len(descs) == 8)
    r = page.goto(BASE + '/sitemap.xml')
    body = page.content()
    check('sitemap lists every tool', all(s in body for s in ['qr-code-generator', 'qr-code-scanner', 'qr-code-reader', 'wifi-qr-code', 'vcard-qr-code', 'custom-qr-code', 'batch-qr-code']))
    r = page.goto(BASE + '/robots.txt')
    check('robots.txt points to sitemap', 'Sitemap:' in page.content())
    r = page.goto(BASE + '/not-a-page')
    check('404 for unknown route', r.status == 404)
    r = page.goto(BASE + '/qr-generator')
    check('alias redirects', page.url.endswith('/qr-code-generator'))
    ctx.close()


def check_analytics(all_events, log_path):
    names = {e['name'] for e in all_events}
    if log_path and os.path.exists(log_path):
        for l in open(log_path):
            if '"analytics"' in l:
                names.add(json.loads(l).get('name'))
    needed = {'tool_view', 'qr_generation_started', 'qr_generation_completed', 'qr_generation_failed', 'qr_downloaded', 'qr_scanned', 'qr_decoded',
              'customization_used', 'logo_added', 'batch_generation_started', 'batch_generation_completed'}
    check('analytics: every required event fires', needed <= names, str(needed - names))
    check('analytics: every event has a tool id', all(e['props'].get('tool') for e in all_events))
    blob = json.dumps(all_events)
    leaks = [b for b in PRIVATE_BITS if b.lower() in blob.lower()]
    check('analytics: no QR contents in client events', not leaks, str(leaks))
    if log_path and os.path.exists(log_path):
        lines = [l for l in open(log_path) if '"analytics"' in l]
        server_leaks = [b for b in PRIVATE_BITS if any(b.lower() in l.lower() for l in lines)]
        check('analytics: server log received events', len(lines) > 20, str(len(lines)))
        check('analytics: no QR contents in server logs', not server_leaks, str(server_leaks))
        check('server log: no IP addresses', not any('remoteAddress' in l or '"ip"' in l for l in open(log_path)))


def decode_all():
    paths = [p for _, p, _, _ in to_decode]
    out = subprocess.run(['npx', 'tsx', os.path.join(ROOT, 'test/e2e/decode.ts'), *paths], capture_output=True, text=True, cwd=ROOT)
    res = json.loads(out.stdout.strip().splitlines()[-1])
    for label, p, expected, px in to_decode:
        r = res.get(p, {})
        ok = r.get('text') == expected and (px is None or (r.get('width') == px and r.get('height') == px))
        check(f'decodes: {label}', ok, f"got {r.get('text')!r} {r.get('width')}x{r.get('height')}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME)
        evs = []
        evs += test_generator(browser)
        evs += test_custom(browser)
        test_dedicated(browser)
        evs += test_scanner(browser)
        evs += test_batch(browser)
        test_mobile(browser)
        test_seo(browser)
        browser.close()
        test_camera(p)
    decode_all()
    check_analytics(evs, os.environ.get('SERVER_LOG'))
    # The deliberate visit to a missing page logs one expected 404.
    real_errors = [e for e in errors if 'status of 404' not in e]
    check('no console errors or page errors', not real_errors, '\n  '.join(real_errors[:10]))
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
