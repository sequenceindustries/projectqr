# Code Generator

**Create QR codes, barcodes, passwords and printable word puzzles in one free, browser-based toolkit.** No account required. Your values stay on your device.

Part of the Sequence Industries utility portfolio. Built with Astro and a small Fastify service for static hosting and anonymous usage events.

## Tools

| Route | Tool |
|---|---|
| `/` | QR and barcode directories, with quick generators |
| `/qr-code-generator` | QR codes for links, text, email, phone, SMS, WhatsApp, Wi-Fi, contacts and locations |
| `/custom-qr-code` | QR colours, patterns, corners, logo, margin and error correction |
| `/wifi-qr-code` | Wi-Fi QR code |
| `/vcard-qr-code` | Contact QR code |
| `/qr-code-scanner` | Scan QR codes with a camera or image |
| `/qr-code-reader` | Read QR codes from an image |
| `/batch-qr-code` | Create up to 500 QR codes from a CSV |
| `/barcode-generator` | Create Code 128, EAN-13/8, UPC-A, Code 39, ITF-14 and Data Matrix barcodes |
| `/password-generator` | Generate a secure random password locally with custom length and character types |
| `/url-shortener` | Shorten a link (optional custom ending) with a matching QR code; `/s/:code` redirects, `/s/:code+` previews |
| `/word-search-maker` | Create a printable word search with configurable directions and a separate answer key |

QR downloads include PNG, SVG, JPG and clipboard copy. Barcode downloads include SVG and PNG.

## Run it

```bash
npm install
npm run build
npm start
```

Development: `npm run dev:api` starts the events API on :8080 and `npm run dev` starts the site on :4321.

## Deploy (Railway)

1. Create a Railway service from this repo using `Dockerfile` and `railway.json`.
2. Set `SITE_URL` to the public origin; canonicals and the sitemap use it at build time.
3. Health check: `GET /healthz`.
4. URL shortener: add a Postgres database and set `DATABASE_URL` on the service. Tables are created automatically on start. Without it, the rest of the site works and the shortener says it's unavailable.

### URL shortener operations

The shortener is the only feature that stores data (see `server/links.ts`): destination, code, created time, total opens and a disabled flag. No IPs or per-click records.

- Review reports: `SELECT r.code, l.url, r.reason, r.created_at FROM short_link_reports r JOIN short_links l USING (code) ORDER BY r.created_at DESC;`
- Disable a link: `UPDATE short_links SET disabled = true, disabled_reason = 'phishing' WHERE code = 'abc1234';` (visitors then see a "link disabled" page, HTTP 410).
- Optional env: `SHORT_LINK_BASE_URL` (a shorter domain for links, pointing at this service), `SHORT_LINKS_PER_HOUR` (per visitor, default 30).

Optional environment settings are listed in `.env.example`.
