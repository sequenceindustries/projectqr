# QR Tools architecture

## What was reused from ImageTools

`server/app.ts` scaffolding (security headers, CSP, rate limiting, page serving from memory, first-party analytics endpoint), `src/scripts/analytics.ts`, the registry-driven page pattern (`src/data/tools.ts` → `[tool].astro` → sitemap/JSON-LD), `Base.astro` SEO head, `AdSlot`, the type/spacing/button/input system in `global.css`, and the Dockerfile/Railway setup. What was dropped: uploads, sharp, AI models and the processing queue — QR Tools has no server-side processing at all.

## Shape

```
Browser (everything)                                   Node service (Fastify)
───────────────────────────────────────────────        ─────────────────────────────
shared/qr/payload.ts  type + fields → exact string     static pages (prebuilt, held in memory)
shared/qr/render.ts   qrcode core → matrix → vector    POST /api/events  whitelisted, content-free
                      geometry (modules, eyes, logo)   GET  /healthz
src/scripts/qr/draw.ts  geometry → SVG / canvas → PNG/JPG
                        scan check: re-decode with jsQR before download
src/scripts/scanner.ts  camera/upload → BarcodeDetector or jsQR → describe()
src/scripts/batch.ts    CSV → plan → codes → ZIP (fflate)
```

## Key decisions

- **Client-side only.** Generation, scanning, logo handling and ZIP building never touch the server, so "Your QR code is generated in your browser" is literally true, Wi-Fi passwords and contacts can't leak, and hosting cost is near zero.
- **One geometry, every output.** `geometry()` produces SVG path data; the SVG download uses it directly and the canvas uses the same strings via `Path2D`, so PNG, JPG, SVG and the preview cannot drift.
- **Correctness over decoration.** Styles never change the encoded data. Every design is re-decoded in the browser after each change ("Scan check passed"); low contrast blocks one-click download; logos force error correction H, are capped at 24 % of the width, sit on a cleared plate and never cover finder patterns; alignment patterns stay solid in the dots style; margin is 2–10 modules (warning below 4); PNG/JPG snap to whole pixels per module so edges stay crisp.
- **Static codes only.** No redirect service, no scan tracking, no database. Dynamic codes are a possible future premium product.
- **Logos are re-encoded.** PNG/JPG/WebP only (MIME + magic bytes + successful decode), ≤ 2 MB, 16–6000 px, aspect ≤ 4:1, redrawn to a ≤ 512 px PNG. SVG uploads are not accepted; the SVG export only embeds `data:image/png;base64` logos.
- **Lazy loading.** jsQR (47 KB gz) loads on first interaction; fflate only when a batch is generated. The scanner pages don't load the QR encoder.
- **Camera hygiene.** Starts only on tap; `Permissions-Policy: camera=(self)`; stops on result, "Stop", tab hidden or page hide; frames go to a local canvas only.

## Analytics

Events (`shared/events.ts`): `tool_view, qr_generation_started/completed/failed, qr_downloaded, qr_scanned, qr_decoded, customization_used, logo_added, batch_generation_started/completed`. Props are a whitelist of enum-like values (tool, type, format, size, ec, option, value, source, code, count, ms, referrer); the server truncates strings to 32 chars of `[\w.-]`, so URLs or free text can't be logged even by mistake. Events go to the structured log (and Plausible if configured). No cookies, no IPs.

## Monetisation hooks

`<AdSlot>` placements exist only below the tool content (`home-mid`, `tool-bottom`), never near the preview, controls, scanner or downloads, and render nothing until `PUBLIC_ADS_ENABLED=true`. Extend the CSP with `CSP_*` env vars for the chosen network.

## Known limits

- Batch: no logos; 500 rows / 512 KB per run.
- Canvas exports are capped at 4096 px (iOS Safari's canvas limit); SVG covers anything larger.
- The scanner returns one code per image.
- Rate limiting is in-memory per instance.
