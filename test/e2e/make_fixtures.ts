// Builds browser-test fixtures. Run: npx tsx test/e2e/make_fixtures.ts [dir]
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_DESIGN, encode, toSvg } from '../../shared/qr/render.js';

const dir = process.argv[2] ?? 'test/e2e/fixtures';
fs.mkdirSync(dir, { recursive: true });
const out = (n: string) => path.join(dir, n);
const qrPng = (data: string, px: number, design = {}) => sharp(Buffer.from(toSvg(encode(data, 'M'), { ...DEFAULT_DESIGN, ...design }, px))).flatten({ background: '#fff' }).png().toBuffer();

// Clean screenshot of a URL code.
await fs.promises.writeFile(out('qr-url.png'), await qrPng('https://example.com/scan-me', 600));
// Wi-Fi code as JPG.
await sharp(await qrPng('WIFI:T:WPA;S:Café\\;Net;P:p@ss\\:word!;;', 500)).jpeg({ quality: 80 }).toFile(out('qr-wifi.jpg'));
// Low-resolution code.
await sharp(await qrPng('Low res text', 600)).resize(110).png().toFile(out('qr-lowres.png'));
// A photo-like scene: small, rotated code on a textured background.
const scene = Buffer.alloc(1600 * 1200 * 3);
for (let i = 0; i < scene.length; i++) scene[i] = 90 + ((i * 2654435761) >>> 26);
const rotated = await sharp(await qrPng('https://example.com/in-a-photo', 360)).rotate(23, { background: '#ffffff' }).png().toBuffer();
await sharp(scene, { raw: { width: 1600, height: 1200, channels: 3 } }).composite([{ input: rotated, left: 700, top: 420 }]).jpeg({ quality: 85 }).toFile(out('qr-photo.jpg'));
// Dark mode screenshot: light code on a dark background.
await fs.promises.writeFile(out('qr-inverted.png'), await qrPng('Inverted!', 500, { fg: '#ffffff', bg: '#111111' }));
// No QR at all.
await sharp({ create: { width: 400, height: 300, channels: 3, background: '#7a9' } }).png().toFile(out('no-qr.png'));
// A text file pretending to be an image.
fs.writeFileSync(out('fake.png'), 'this is not an image');

// Logos.
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" rx="60" fill="#e63946"/><circle cx="150" cy="150" r="80" fill="#fff"/></svg>')).png().toFile(out('logo.png'));
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="150"><rect width="400" height="150" fill="#123"/></svg>')).png().toFile(out('logo-wide.png'));
fs.writeFileSync(out('logo-fake.png'), 'GIF89a nope');
// > 2 MB logo (noise PNG does not compress).
const noise = Buffer.alloc(1200 * 1200 * 3);
for (let i = 0; i < noise.length; i++) noise[i] = (i * 2246822519) >>> 24;
await sharp(noise, { raw: { width: 1200, height: 1200, channels: 3 } }).png({ compressionLevel: 0 }).toFile(out('logo-huge.png'));

// CSVs.
fs.writeFileSync(out('small.csv'), 'Name,URL\nGoogle,https://google.com\nOpenAI,https://openai.com\nSequence Industries,https://example.com\n');
fs.writeFileSync(out('messy.csv'), 'Name,URL\r\nGood,https://good.com\r\nBad,not a url\r\n,https://nameless.com\r\nGood,https://good.com/2\r\nGood,https://good.com/2\r\nEmpty,\r\n');
fs.writeFileSync(out('large.csv'), 'Name,URL\n' + Array.from({ length: 300 }, (_, i) => `Table ${i + 1},https://example.com/menu?table=${i + 1}`).join('\n'));
fs.writeFileSync(out('too-many.csv'), 'Name,URL\n' + Array.from({ length: 501 }, (_, i) => `n${i},https://e.com/${i}`).join('\n'));

// Fake camera feed (Y4M) showing a QR code, for Chromium's fake capture device.
{
  const W = 640, H = 480;
  const code = await sharp(await qrPng('https://example.com/from-camera', 300)).greyscale().extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const y = Buffer.alloc(W * H, 200);
  const ox = (W - code.info.width) >> 1, oy = (H - code.info.height) >> 1;
  for (let r = 0; r < code.info.height; r++) code.data.copy(y, (oy + r) * W + ox, r * code.info.width, (r + 1) * code.info.width);
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv]);
  fs.writeFileSync(out('camera.y4m'), Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
}
console.log('fixtures written to', dir);
