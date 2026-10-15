# Code Generator

**Create QR codes, barcodes and passwords in one free, browser-based toolkit.** No account required. Your values stay on your device.

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

Optional environment settings are listed in `.env.example`.
