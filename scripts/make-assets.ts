// Regenerates brand assets in /public. Run: npx tsx scripts/make-assets.ts
// (Uses Bricolage Grotesque / Figtree if installed locally for og.png text.)
import sharp from 'sharp';
import fs from 'node:fs';
import { DEFAULT_DESIGN, encode, toSvg } from '../shared/qr/render.js';

const mark = (light = false) => {
  const ink = light ? '#ffffff' : '#13151f';
  return `<rect x="2" y="3" width="4" height="26" rx="1" fill="${ink}"/>
  <rect x="9" y="3" width="2" height="26" rx="1" fill="${ink}"/>
  <rect x="14" y="3" width="6" height="26" rx="1" fill="${ink}"/>
  <rect x="23" y="3" width="3" height="26" rx="1" fill="${ink}"/>
  <rect x="29" y="3" width="2" height="26" rx="1" fill="#c6f432"/>`;
};

fs.mkdirSync('public', { recursive: true });
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark()}</svg>`;
fs.writeFileSync('public/favicon.svg', favicon);
await sharp(Buffer.from(favicon), { density: 300 }).resize(32, 32).png().toFile('public/favicon-32.png');

const touch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" fill="#f5f4ef"/><g transform="translate(26 26) scale(4)">${mark()}</g></svg>`;
await sharp(Buffer.from(touch)).png().toFile('public/apple-touch-icon.png');
await sharp(Buffer.from(touch)).resize(512, 512).png().toFile('public/icon-512.png');

// The OG image carries a real, scannable QR code.
const target = process.env.SITE_URL || 'Create a code in seconds — Code Generator';
const qr = toSvg(encode(target, 'M'), { ...DEFAULT_DESIGN, moduleStyle: 'rounded', eyeStyle: 'rounded', margin: 2 }, 380)
  .replace('<svg ', '<svg x="740" y="125" ');
const og = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f5f4ef"/>
  <g transform="translate(80 80) scale(2)">${mark()}</g>
  <text x="160" y="124" font-family="BricoX" font-size="40" fill="#13151f">Code Generator</text>
  <text x="80" y="292" font-family="BricoX" font-size="74" letter-spacing="-2" fill="#13151f">Create any code</text>
  <text x="80" y="380" font-family="BricoX" font-size="74" letter-spacing="-2" fill="#13151f">in seconds.</text>
  <text x="80" y="462" font-family="Figtree Light" font-size="30" fill="#4b4f5e">Free · No account · Made in your browser</text>
  <rect x="720" y="105" width="420" height="420" rx="28" fill="#ffffff"/>
  <g stroke="#13151f" stroke-width="10" stroke-linecap="round" fill="none">
    <path d="M700 150V85h65M1160 150V85h-65M700 480v65h65M1160 480v65h-65"/>
  </g>
  ${qr}
  <rect x="80" y="508" width="140" height="14" rx="7" fill="#c6f432"/>
</svg>`;
await sharp(Buffer.from(og)).png().toFile('public/og.png');

fs.writeFileSync(
  'public/site.webmanifest',
  JSON.stringify(
    {
      name: 'Code Generator',
      short_name: 'Code Gen',
      start_url: '/',
      display: 'standalone',
      background_color: '#f5f4ef',
      theme_color: '#f5f4ef',
      icons: [
        { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2,
  ),
);
console.log('assets written');
