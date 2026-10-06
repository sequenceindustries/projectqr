# QR Tools

**The fastest place on the internet to create, customise and read QR codes.** Free, account-free, and everything runs in the browser.

Part of the Sequence Industries utility portfolio. Built on the ImageTools infrastructure (Astro + a small Fastify service on Railway). See [ARCHITECTURE.md](ARCHITECTURE.md).

## Tools

| Route | Tool |
|---|---|
| `/` | Homepage with the generator in the hero |
| `/qr-code-generator` | Flagship: URL, text, email, phone, SMS, WhatsApp, Wi-Fi, vCard, location |
| `/custom-qr-code` | Colours, pattern (square/rounded/dots), corner style, logo, margin, error correction |
| `/wifi-qr-code` | Wi-Fi only, "Scan to connect to Wi-Fi" |
| `/vcard-qr-code` | Contact card |
| `/qr-code-scanner` | Camera + upload + drag/drop + paste |
| `/qr-code-reader` | Upload-first; same decoder as the scanner |
| `/batch-qr-code` | CSV (paste or upload) → up to 500 PNG/SVG codes → ZIP |

Downloads: PNG (256–4096 px presets or custom 128–4096), SVG (vector, logo embedded), JPG, and copy-to-clipboard.

## Run it

```bash
npm install
npm run build     # static site (dist/) + server (build/)
npm start         # http://localhost:8080
```

Development: `npm run dev:api` (events API on :8080) and `npm run dev` (site on :4321).

## Test

```bash
npm test          # 100+ unit tests: every QR type/design/logo is rendered, rasterised and decoded back exactly; CSV planning; server
npm run test:e2e  # browser suite against a running server (pip install playwright)
```

The browser suite (158 checks) drives every tool in Chromium, downloads each PNG/SVG/JPG/ZIP and decodes it with an independent pipeline (sharp + jsQR), scans fixtures (rotated photo, low-res, inverted, JPG), runs the camera scanner against a fake video feed, checks permission-denied handling, mobile layouts (no horizontal scroll, ≥ 40 px tap targets), axe accessibility on every page, SEO tags, and that no QR content ever appears in analytics.

## Deploy (Railway)

1. Create a Railway service from this repo (Dockerfile + `railway.json`).
2. Set `SITE_URL` to the public origin (baked into canonicals and the sitemap at build time). Optionally re-run `npm run assets` with `SITE_URL` set so the QR code in `og.png` points to the live site.
3. Health check: `GET /healthz`. 256–512 MB RAM is plenty: the server only serves static files and analytics events.

Optional env (see `.env.example`): `PUBLIC_PLAUSIBLE_DOMAIN`, `PUBLIC_ADS_ENABLED`, `CSP_*` for an ad network later, `EVENTS_PER_MINUTE`.

## Adding a tool or QR type

- New page: add an entry to `src/data/tools.ts`. Routing, sitemap, cards, related links, prompts and JSON-LD are derived from it.
- New QR type: add a builder to `shared/qr/payload.ts` (+ tests in `test/qr.test.ts`), its fields to `src/data/fields.ts`, and a `describe()` branch so the scanner can explain it.
