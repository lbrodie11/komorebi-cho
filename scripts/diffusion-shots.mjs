// Reproducible screenshots of the Film Diffusion reference views.
//
// Playwright is not a project dependency (visual tests arrive with prompt 15). To run:
//   npm i --no-save playwright@1.64.0 && npx playwright install chromium
//   npm run dev   # in another terminal
//   node scripts/diffusion-shots.mjs [baseUrl] [outDir] [levels%] [look]
// e.g. node scripts/diffusion-shots.mjs http://localhost:5173 shots/ 0,5,10,20 smooth
// look: smooth (the default look) or fine | classic | chunky (the palette pixel-art looks)
//
// Each view loads the seeded URL (deterministic warm-up), then pins time, camera and
// weather with __komorebi.freeze(), so the same build gives byte-identical PNGs.
// Writes <outDir>/<size>-<view>-<pct>.png and manifest.json (sha256 per file).
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [base = 'http://localhost:5173', outDir = 'shots', levelsArg = '0', look = 'smooth'] = process.argv.slice(2);
const levels = levelsArg.split(',').map(Number);

export const SIZES = [
  { name: '720p', width: 1280, height: 720, dpr: 1 },
  { name: '1080p2x', width: 1920, height: 1080, dpr: 2 },
];

/** The six reference views. `time` pins shader time; `target`/`zoom` frame the close-ups. */
export const VIEWS = [
  { name: 'noon-street', hour: 12, weather: 'clear' },
  { name: 'sunset', hour: 17.3, weather: 'clear' },
  { name: 'blue-hour', hour: 19.3, weather: 'clear' },
  { name: 'night-rain', hour: 22, weather: 'rain' },
  { name: 'park-foliage', hour: 12, weather: 'clear', zoom: 2, target: [-5.4, 3.2, 0.2] },
  { name: 'shop-windows', hour: 21, weather: 'clear', zoom: 2, target: [-10.4, 2.2, 2] },
];

fs.mkdirSync(outDir, { recursive: true });
const manifest = {};
const log = [];
// Real device pixel ratios, not Playwright's emulation: under emulated deviceScaleFactor, Chrome
// reports devicePixelContentBoxSize in CSS pixels, so the game would lay out a quarter-size canvas.
// A real window: --force-device-scale-factor plus a window tall enough for the browser's own chrome.
const CHROME_UI_H = 87;
for (const size of SIZES) {
  // PW_CHANNEL=chrome uses the installed Chrome (real GPU) instead of Playwright's Chromium
  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', `--force-device-scale-factor=${size.dpr}`, `--window-size=${size.width},${size.height + CHROME_UI_H}`],
  });
  const page = await (await browser.newContext({ viewport: null })).newPage();
  page.on('console', (m) => m.type() !== 'debug' && log.push(`[${size.name}] [${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[${size.name}] [pageerror] ${e.message}`));
  for (const v of VIEWS) {
    await page.goto(`${base}/?seed=1&hour=${v.hour}&season=spring&weather=${v.weather}&freeze=1&pixel=${look}`);
    await page.waitForFunction(() => (window.__komorebi?.frames ?? 0) > 5, null, { timeout: 60000 });
    await page.addStyleTag({ content: '#hud, .debug-overlay { display: none !important; }' });
    for (const pct of levels) {
      await page.evaluate(
        ([v, s]) => {
          const k = window.__komorebi;
          k.setDiffusion?.(s);
          k.freeze({ hour: v.hour, season: 'spring', weather: v.weather, time: 100, yaw: Math.PI / 4, zoom: v.zoom ?? 0, target: v.target ?? [0, 3.9, 0] });
        },
        [v, pct / 100],
      );
      // a few frames so resize, targets and the camera have all settled
      const f0 = await page.evaluate(() => window.__komorebi.frames);
      await page.waitForFunction((f) => window.__komorebi.frames > f + 4, f0);
      const file = path.join(outDir, `${size.name}-${v.name}-${pct}.png`);
      const png = await page.locator('#view').screenshot({ path: file });
      manifest[path.basename(file)] = createHash('sha256').update(png).digest('hex');
    }
  }
  const real = await page.evaluate(() => [window.innerWidth, window.innerHeight, window.devicePixelRatio]);
  if (real[0] !== size.width || real[1] !== size.height || real[2] !== size.dpr)
    log.push(`[${size.name}] window is ${real.join('×')}, wanted ${size.width}×${size.height}@${size.dpr}`);
  await browser.close();
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ base, levels, look, log, files: manifest }, null, 2));
console.log(`${Object.keys(manifest).length} shots → ${outDir}${log.length ? `\n${log.join('\n')}` : ''}`);
