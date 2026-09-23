import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function run() {
  const svgPath = path.resolve('public/logo.svg');
  const svg = fs.readFileSync(svgPath);

  // iOS App Icon (180x180) with dark background so it looks stunning on iPhone Springboard
  const background = { r: 10, g: 15, b: 24, alpha: 1 };

  await sharp(svg)
    .resize(160, 160, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background })
    .png()
    .toFile('public/apple-touch-icon.png');

  // PWA / Desktop Icons (192, 512)
  await sharp(svg)
    .resize(172, 172, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background })
    .png()
    .toFile('public/icon-192.png');

  await sharp(svg)
    .resize(460, 460, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 26, bottom: 26, left: 26, right: 26, background })
    .png()
    .toFile('public/icon-512.png');

  console.log('App icons generated successfully');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
