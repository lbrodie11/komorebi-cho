// Compare two builds of the game, frame by frame and object by object: the check behind
// "this refactor is pixel-identical" and "this colour change touches only what it should".
//
//   npm i --no-save playwright@1.64.0 && npx playwright install chromium
//   node scripts/compare-builds.mjs http://localhost:4174/ http://localhost:4173/ [look=classic] [hours=12,19.25]
//
// Serve each build with `npx vite preview --outDir <dist> --port <port>` (a git worktree per commit).
// Pixels are read INSIDE a requestAnimationFrame, after the game's own frame has rendered: read
// from an ordinary task, the WebGL drawing buffer is already cleared and every frame compares as
// blank (that mistake once hid a real regression). A frame with almost no lit pixels is reported.
import { chromium } from 'playwright';

const [baseUrl, newUrl, look = 'classic', hoursArg = '12,19.25'] = process.argv.slice(2);
if (!baseUrl || !newUrl) {
  console.error('usage: compare-builds.mjs <base url> <new url> [look] [hours]');
  process.exit(2);
}
const hours = hoursArg.split(',').map(Number);
const views = {
  town: { zoom: 0, target: [0, 3.9, 0] },
  sento: { zoom: 2, target: [-11, 4, -10] },
  temple: { zoom: 2, target: [8, 3, -9] },
  cafe: { zoom: 2, target: [13, 3, 1] },
  apato: { zoom: 2, target: [-3, 3, -9] },
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

async function frames(url, hour) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto(`${url}?seed=1&hour=${hour}&freeze=1&pixel=${look}&diffusion=0`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (window.__komorebi?.frames ?? 0) > 5, null, { timeout: 120000 });
  const out = {};
  for (const [name, v] of Object.entries(views)) {
    await p.evaluate(([h, v]) => window.__komorebi.freeze({ hour: h, time: 10, zoom: v.zoom, target: v.target, yaw: Math.PI / 4 }), [hour, v]);
    await p.waitForTimeout(400);
    out[name] = await p.evaluate(
      () =>
        new Promise((res) =>
          requestAnimationFrame(() => {
            const c = document.getElementById('view');
            const t = document.createElement('canvas');
            t.width = c.width;
            t.height = c.height;
            const x = t.getContext('2d');
            x.drawImage(c, 0, 0);
            res(Array.from(x.getImageData(0, 0, t.width, t.height).data));
          }),
        ),
    );
  }
  await p.close();
  return out;
}

async function sceneGraph(url) {
  const p = await browser.newPage();
  await p.goto(`${url}?seed=1&freeze=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (window.__komorebi?.frames ?? 0) > 3, null, { timeout: 120000 });
  const list = await p.evaluate(() => {
    const out = [];
    const f = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
    window.__komorebi.world.scene.traverse((o) => {
      if (!o.isMesh && !o.isLine) return;
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements;
      const m = o.material;
      out.push(
        `${o.geometry.type}|${o.geometry.attributes.position?.count ?? 0}|${[e[12], e[13], e[14]].map(f)}|${[e[0], e[5], e[10]].map(f)}|${m?.color?.getHexString() ?? ''}|cs${o.castShadow ? 1 : 0}`,
      );
    });
    return out;
  });
  await p.close();
  return list.reduce((m, s) => m.set(s, (m.get(s) || 0) + 1), new Map());
}

let changed = 0;
for (const hour of hours) {
  const a = await frames(baseUrl, hour);
  const b = await frames(newUrl, hour);
  for (const name of Object.keys(views)) {
    const A = a[name],
      B = b[name];
    let diff = 0,
      lit = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (A[i] + A[i + 1] + A[i + 2] > 30) lit++;
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 6) diff++;
    }
    if (lit < 1000) console.log(`WARNING ${hour}h ${name}: the base frame looks blank (${lit} lit pixels)`);
    changed += diff;
    console.log(`${hour}h ${name}: ${diff} of ${A.length / 4} pixels differ`);
  }
}
const ga = await sceneGraph(baseUrl),
  gb = await sceneGraph(newUrl);
const only = (x, y) => [...x].filter(([k, n]) => (y.get(k) || 0) < n).map(([k, n]) => `${n - (y.get(k) || 0)}x ${k}`);
const oa = only(ga, gb),
  ob = only(gb, ga);
console.log(`\nscene graph: ${oa.length} kinds of object only in base, ${ob.length} only in new`);
for (const s of oa.slice(0, 20)) console.log(`  base: ${s}`);
for (const s of ob.slice(0, 20)) console.log(`  new:  ${s}`);
await browser.close();
process.exit(changed || oa.length || ob.length ? 1 : 0);
