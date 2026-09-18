/**
 * Builds the app icons from the Tanu mark (assets/brand/tanu-mark.png).
 *
 * Run after changing the logo: `npm run build:brand`
 * Needs sharp: `npm install --no-save sharp`
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(root, 'assets/brand/tanu-mark.png');
const out = (name) => path.join(root, 'assets', name);

/** The mark on its own, trimmed of surrounding white, as transparent PNG. */
async function mark(size, padding = 0) {
  const inner = Math.round(size * (1 - padding));
  const trimmed = await sharp(SOURCE)
    .flatten({ background: '#FFFFFF' })
    .trim({ threshold: 20 })
    .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .toBuffer();
  // Make white transparent so the mark can sit on any background.
  const { data, info } = await sharp(trimmed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r > 235 && g > 235 && b > 235) data[i + 3] = 0;
  }
  const cut = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await cut.toBuffer(), gravity: 'center' }])
    .png()
    .toBuffer();
}

/** The mark centred on a solid background, for the square app icon. */
async function onBackground(size, background, padding) {
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: await mark(size, padding), gravity: 'center' }])
    .png()
    .toBuffer();
}

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

await mkdir(path.join(root, 'assets'), { recursive: true });
const files = [
  // iOS/general icon: the mark on white, a little breathing room.
  ['icon.png', await onBackground(1024, WHITE, 0.16)],
  // Android adaptive: foreground inside the 66% safe zone, plain background.
  ['android-icon-foreground.png', await mark(1024, 0.34)],
  ['android-icon-background.png', await sharp({ create: { width: 1024, height: 1024, channels: 4, background: WHITE } }).png().toBuffer()],
  ['android-icon-monochrome.png', await mark(1024, 0.34)],
  ['splash-icon.png', await mark(1024, 0.18)],
  ['favicon.png', await onBackground(64, WHITE, 0.08)],
];
for (const [name, buffer] of files) {
  await sharp(buffer).toFile(out(name));
  console.log('wrote', name);
}
