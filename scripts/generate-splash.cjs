/* eslint-disable @typescript-eslint/no-require-imports -- a standalone CommonJS script, run directly with node */
/**
 * Generates the iOS launch screens in public/icons/splash/.
 *
 *   node scripts/generate-splash.cjs
 *
 * Flat app-background colour with the app icon centred — the same two
 * backgrounds the app uses (`--canvas` in globals.css, light and dark), so the
 * hand-off from launch screen to first paint has no colour jump.
 *
 * Needs `sharp`, which Next.js installs for itself. Under pnpm it is not on the
 * default resolution path, so if `require('sharp')` fails run:
 *   NODE_PATH=<path to the pnpm-store sharp parent dir> node scripts/generate-splash.cjs
 *
 * Keep SIZES in step with lib/pwa/splash.ts (tests/splash.test.ts checks that
 * every listed image exists).
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

/** [CSS width, CSS height, device pixel ratio] — portrait. */
const SIZES = [
  [440, 956, 3],
  [402, 874, 3],
  [430, 932, 3],
  [393, 852, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 3],
  [414, 896, 2],
  [375, 667, 2],
  [1024, 1366, 2],
  [834, 1194, 2],
  [820, 1180, 2],
  [810, 1080, 2],
];

/** `--canvas` from app/globals.css. */
const BACKGROUNDS = { light: '#f5f6f8', dark: '#0f1319' };

/** Icon width as a share of the launch screen's width, and its corner radius. */
const ICON_SHARE = 0.24;
const CORNER_SHARE = 0.2237; // iOS app-icon corner radius ratio

const root = path.join(__dirname, '..');
const iconPath = path.join(root, 'public', 'icons', 'icon-512.png');
const outDir = path.join(root, 'public', 'icons', 'splash');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  for (const [width, height, ratio] of SIZES) {
    const pxWidth = width * ratio;
    const pxHeight = height * ratio;
    const iconSize = Math.round(pxWidth * ICON_SHARE);
    const radius = Math.round(iconSize * CORNER_SHARE);

    const mask = Buffer.from(
      `<svg width="${iconSize}" height="${iconSize}"><rect width="${iconSize}" height="${iconSize}" rx="${radius}" ry="${radius}"/></svg>`,
    );
    const icon = await sharp(iconPath)
      .resize(iconSize, iconSize)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    for (const [scheme, background] of Object.entries(BACKGROUNDS)) {
      const file = path.join(outDir, `${scheme}-${width}x${height}@${ratio}x.png`);

      await sharp({
        create: { width: pxWidth, height: pxHeight, channels: 3, background },
      })
        .composite([{ input: icon, gravity: 'centre' }])
        .png({ compressionLevel: 9, palette: true })
        .toFile(file);
    }
  }

  console.log(`Wrote ${SIZES.length * 2} launch screens to ${path.relative(root, outDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
