// Accessibility scan: runs axe-core over the HUD in every state a player can reach (prompt 04's
// "axe-core scan has no serious violations"). The canvas is the game; axe checks the DOM around it.
//
//   npm i --no-save playwright@1.64.0 axe-core@4.10.3 && npx playwright install chromium
//   npm run build && npx vite preview --port 4173
//   node scripts/a11y-scan.mjs http://localhost:4173/
//
// Install both in one command: a second `npm i --no-save` removes the first.
// Exits 1 if any state has a serious or critical violation.
/* global axe */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const base = process.argv[2] ?? 'http://localhost:4173/';
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__komorebi?.frames ?? 0) > 3, null, { timeout: 90000 });
await page.addScriptTag({ content: axeSource });

const click = (label) => page.locator(`#hud button[aria-label="${label}"]`).click();
const states = [
  ['start', async () => {}],
  ['settings', () => click('Settings')],
  ['help', async () => (await page.keyboard.press('Escape'), click('Help (H)'))],
  ['journal', async () => (await page.keyboard.press('Escape'), click('Journal: memories and what happened lately (N)'))],
  [
    'journal with a memory',
    async () => {
      await page.keyboard.press('Escape');
      // a real placement and a real "noticed" event, as the simulation would emit it
      await page.evaluate(() => {
        const k = window.__komorebi;
        for (let x = -6; x <= 6; x += 0.5)
          for (let z = -3; z <= 8; z += 0.5)
            if (k.build.canPlace('bench', x, z, { ignoreResidents: true })) {
              k.build.place({ id: 'a11y-bench', kind: 'bench', x, z, ry: 0 }, false);
              k.bus.emit('noticed', { who: 'mitsuko', id: 'a11y-bench' });
              return;
            }
      });
      await click('Journal: memories and what happened lately (N)');
    },
  ],
  ['people', async () => (await page.keyboard.press('Escape'), click('Meet the neighbors (L)'))],
  ['card', () => page.locator('.people-list button').first().click()],
  ['build', async () => (await page.keyboard.press('Escape'), click('Build mode (B)'))],
  ['photo', async () => (await page.keyboard.press('Escape'), click('Photo mode (P)'))],
];

let serious = 0;
for (const [name, enter] of states) {
  await enter();
  await page.waitForTimeout(300);
  const res = await page.evaluate(async () => {
    // a story line mid-fade is leaving (aria-hidden, and kept in Notes): not text to read
    const r = await axe.run({ exclude: [['.story .line.fading']] }, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n').slice(1, 2).join('')}`),
    }));
  });
  const bad = res.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  serious += bad.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${name}: ${res.length} violation(s)`);
  for (const v of res) console.log(`   [${v.impact}] ${v.id}: ${v.help}\n      ${v.nodes.join('\n      ')}`);
}
await browser.close();
console.log(serious ? `\n${serious} serious/critical violation(s)` : '\nNo serious or critical violations.');
process.exit(serious ? 1 : 0);
