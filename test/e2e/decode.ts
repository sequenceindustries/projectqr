// Decodes QR images with an independent pipeline (sharp + jsQR). Usage: tsx decode.ts file...
// Prints JSON: { file: { text, width, height, format } }
import sharp from 'sharp';
import jsQR from 'jsqr';
const out: Record<string, unknown> = {};
for (const f of process.argv.slice(2)) {
  try {
    const meta = await sharp(f).metadata();
    const { data, info } = await sharp(f, { density: 150 }).flatten({ background: '#fff' }).resize({ width: Math.min(1200, meta.width ?? 1200) }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, { inversionAttempts: 'attemptBoth' });
    out[f] = { text: r?.data ?? null, width: meta.width, height: meta.height, format: meta.format };
  } catch (e) {
    out[f] = { error: String(e) };
  }
}
console.log(JSON.stringify(out));
