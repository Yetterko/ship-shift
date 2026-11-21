// Makes a slide-ready QR code for the demo link.
// Usage: node tools/qr.mjs https://your-demo-url [out-name]
// Writes <out-name>.svg (crisp at any size, best for slides) and <out-name>.png (1200px) into ./qr/
import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error('Usage: node tools/qr.mjs https://your-demo-url [out-name]');
  process.exit(1);
}
const name = process.argv[3] || 'ship-shift-qr';
const dir = path.resolve('qr');
await fs.mkdir(dir, { recursive: true });
const opts = { errorCorrectionLevel: 'H', margin: 4, color: { dark: '#2a2520', light: '#ffffff' } };
await fs.writeFile(path.join(dir, `${name}.svg`), await QRCode.toString(url, { ...opts, type: 'svg' }));
await QRCode.toFile(path.join(dir, `${name}.png`), url, { ...opts, width: 1200 });
console.log(`QR for ${url}\n  ${path.join(dir, name + '.svg')}\n  ${path.join(dir, name + '.png')}`);
console.log(await QRCode.toString(url, { type: 'terminal', small: true, errorCorrectionLevel: 'M' }));
