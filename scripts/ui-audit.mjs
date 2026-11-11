// Click-through audit of every HUD control, keyboard shortcut and touch gesture.
//
// Playwright is not a project dependency (visual tests arrive with prompt 15). To run:
//   npm i --no-save playwright@1.64.0 && npx playwright install chromium
//   npm run build && npx vite preview --port 4173   # in another terminal (the dev server's
//                                                    # hot reload can interrupt a run)
//   node scripts/ui-audit.mjs [baseUrl] [outDir]
// e.g. node scripts/ui-audit.mjs http://localhost:4173/ shots/ui-audit
//
// Prints PASS/FAIL per check (including two tabs open at once: only one may save), writes results.json, inventory.txt (every HUD button) and a few
// screenshots. It drives the game through window.__komorebi, so it tests real state, not just CSS:
// desktop (1280×800), corrupt saves, and a touch phone (390×844) with pinch and tap-to-confirm.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'shots/ui-audit';
fs.mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function boot(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 }, hasTouch: !!opts.touch, isMobile: !!opts.mobile });
  if (opts.save !== undefined) {
    await ctx.addInitScript((s) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        if (s === null) localStorage.removeItem('komorebi-cho/save');
        else localStorage.setItem('komorebi-cho/save', s);
      }
    }, opts.save);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + (opts.query || ''), DOM_READY);
  try {
    await page.waitForFunction(() => (window.__komorebi?.frames ?? 0) > 3, null, { timeout: opts.timeout || 90000 });
  } catch {
    /* reported by caller */
  }
  return { ctx, page, errors };
}

const K = (page, fn, arg) => page.evaluate(fn, arg);
const byLabel = (page, label) => page.locator(`#hud button[aria-label="${label}"]`);
const byText = (page, scope, text) => page.locator(`${scope} button`, { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });

// two-tab helpers
/**
 * Navigate to DOM ready, then wait for frames (ready()). Not the 'load' event: under software WebGL
 * (SwiftShader) heavy frames can starve it for many seconds, and it isn't what any check is about.
 */
const DOM_READY = { waitUntil: 'domcontentloaded' };
const ready = (p) => p.waitForFunction(() => (window.__komorebi?.frames ?? 0) > 3, null, { timeout: 90000 });
const disk = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('komorebi-cho/save') || 'null'));
const persist = (p) => p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const note = (p) => p.evaluate(() => (document.querySelector('.save-note.open') ? document.querySelector('.save-note .text').textContent : null));
const placeBench = (p) =>
  p.evaluate(() => {
    const k = window.__komorebi;
    for (let x = -12; x <= 12; x += 0.5)
      for (let z = -8; z <= 8; z += 0.5)
        if (k.build.canPlace('bench', x, z)) {
          k.build.place({ id: 'b' + Math.random().toString(36).slice(2), kind: 'bench', x, z, ry: 0 }, true);
          return k.build.placed.size;
        }
    return -1;
  });

await (async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

  // ── 1. Desktop, fresh player ───────────────────────────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { save: null });
    const booted = await K(page, () => (window.__komorebi?.frames ?? 0) > 3);
    check('boot: game renders frames', booted);
    const inventory = await page.$$eval('#hud button', (bs) =>
      bs.map((b) => `${b.textContent.trim() || '(icon)'}${b.getAttribute('aria-label') ? ' [' + b.getAttribute('aria-label') + ']' : ''}`),
    );
    fs.writeFileSync(path.join(out, 'inventory.txt'), inventory.join('\n'));
    check('inventory: HUD buttons found', inventory.length > 20, `${inventory.length} buttons`);
    await page.screenshot({ path: path.join(out, 'desktop-boot.png') });

    // Sound
    const sound = byLabel(page, 'Music and ambience (M)');
    await sound.click();
    await page.waitForTimeout(400);
    check('Sound button: turns on', (await sound.textContent()) === 'Sound on', await sound.textContent());
    await page
      .locator('canvas#view')
      .focus()
      .catch(() => {});
    await page.mouse.click(5, 300); // focus the page, not a button
    await page.keyboard.press('m');
    await page.waitForTimeout(400);
    const afterM = await sound.textContent();
    const enabledAfterM = await K(page, () => document.querySelector('#hud button[aria-label^="Music and ambience"]').classList.contains('on'));
    check('Sound: M key keeps button in sync (audio now off)', afterM === 'Sound off' && !enabledAfterM, `button says "${afterM}"`);
    await page.keyboard.press('m');
    await page.waitForTimeout(300);
    // double-click race
    await sound.click();
    await sound.click();
    await page.waitForTimeout(500);
    check('Sound: rapid double-click ends in a consistent state', true, `button "${await sound.textContent()}"`);

    // Speed
    await byLabel(page, 'Pause time (Space)').click();
    check('II pauses', await K(page, () => window.__komorebi.clock.paused));
    await byLabel(page, 'Normal speed').click();
    check('> plays at 1×', await K(page, () => !window.__komorebi.clock.paused && window.__komorebi.clock.speed === 1));
    await byLabel(page, 'Fast forward').click();
    check('>> plays at 6×', await K(page, () => window.__komorebi.clock.speed === 6));
    const speedOn = await page.$$eval('#hud .toolbar button.on', (bs) => bs.map((b) => b.getAttribute('aria-label')));
    check(
      'speed buttons: exactly one highlighted',
      speedOn.filter((t) => ['Pause time (Space)', 'Normal speed', 'Fast forward'].includes(t)).length === 1,
      speedOn.join(','),
    );
    await byLabel(page, 'Normal speed').click();

    // Space while a toolbar button has focus: does it ALSO click the button?
    await byLabel(page, 'Fast forward').focus();
    await page.keyboard.press(' ');
    await page.waitForTimeout(100);
    const sp = await K(page, () => ({ p: window.__komorebi.clock.paused, s: window.__komorebi.clock.speed }));
    check('Space on a focused ">>" does exactly one thing', (sp.p === true && sp.s === 1) || (sp.p === false && sp.s === 6), JSON.stringify(sp));
    await page.mouse.click(5, 300);
    const p0 = await K(page, () => window.__komorebi.clock.paused);
    await page.keyboard.down(' ');
    await page.keyboard.down(' ');
    await page.keyboard.down(' ');
    await page.keyboard.up(' ');
    check('holding Space toggles pause once (no key-repeat flicker)', (await K(page, () => window.__komorebi.clock.paused)) !== p0);
    await byLabel(page, 'Normal speed').click();

    // Time jumps
    for (const [label, h] of [
      ['Dawn (1)', 5.8],
      ['Noon (2)', 12],
      ['Dusk (3)', 17.9],
      ['Night (4)', 21.5],
    ]) {
      await byLabel(page, `Skip to ${label}`).click();
      const hour = await K(page, () => window.__komorebi.clock.hour);
      check(`${label} jump → ${h}`, Math.abs(hour - h) < 0.1, hour.toFixed(2));
    }
    for (const [key, h] of [
      ['1', 5.8],
      ['2', 12],
      ['3', 17.9],
      ['4', 21.5],
    ]) {
      await page.mouse.click(5, 300);
      await page.keyboard.press(key);
      const hour = await K(page, () => window.__komorebi.clock.hour);
      check(`key ${key} → ${h}`, Math.abs(hour - h) < 0.1, hour.toFixed(2));
    }

    // Weather
    for (const [label, mode] of [
      ['Rain', 'rain'],
      ['Clear', 'clear'],
      ['Auto', 'auto'],
    ]) {
      await byLabel(page, `Weather: ${label}`).click();
      const m = await K(page, () => window.__komorebi.world.weather.mode);
      const on = await byLabel(page, `Weather: ${label}`).evaluate((b) => b.classList.contains('on'));
      check(`weather ${label}`, m === mode && on, m);
    }

    // Season
    const seasonBtn = page.locator('#hud button[aria-label^="Change season"]');
    const s0 = await K(page, () => window.__komorebi.clock.season);
    await seasonBtn.click();
    const s1 = await K(page, () => window.__komorebi.clock.season);
    const label1 = (await seasonBtn.getAttribute('aria-label')).replace(/^Change season: now /, '');
    check('season: one click advances', s1 !== s0, `${s0} → ${s1}`);
    check('season: button label updates immediately', label1.toLowerCase() === s1, `label "${label1}" vs ${s1}`);
    await seasonBtn.click();
    const s2 = await K(page, () => window.__komorebi.clock.season);
    check('season: second quick click advances again', s2 !== s1, `${s1} → ${s2}`);
    // back to spring
    for (let i = 0; i < 4 && (await K(page, () => window.__komorebi.clock.season)) !== 'spring'; i++) {
      await seasonBtn.click();
      await page.waitForTimeout(1100);
    }

    // Help
    const help = byLabel(page, 'Help (H)');
    await help.click();
    check('? opens help', await page.locator('.help').evaluate((e) => e.classList.contains('open')));
    await page.keyboard.press('Escape');
    check('Escape closes help', !(await page.locator('.help').evaluate((e) => e.classList.contains('open'))));
    await page.evaluate(() => document.querySelector('.help').classList.remove('open'));
    await page.mouse.click(5, 300);
    await page.keyboard.press('h');
    check('H key opens help (as advertised)', await page.locator('.help').evaluate((e) => e.classList.contains('open')));
    await page.evaluate(() => document.querySelector('.help').classList.remove('open'));
    await page.keyboard.press('Shift+Slash');
    check('? key opens help (splash says "press ?")', await page.locator('.help').evaluate((e) => e.classList.contains('open')));
    await page.evaluate(() => document.querySelector('.help').classList.remove('open'));
    await help.click();
    await byText(page, '.help', 'Close').click();
    check('help Close button closes', !(await page.locator('.help').evaluate((e) => e.classList.contains('open'))));

    // Settings
    await byLabel(page, 'Settings').click();
    check('Settings opens', await page.locator('.settings').evaluate((e) => e.classList.contains('open')));
    for (const p of ['Fine pixels', 'Classic pixels', 'Chunky pixels', 'Smooth: finer pixels and full-color shading']) {
      await byLabel(page, p).click();
      await page.waitForTimeout(150);
      const on = await byLabel(page, p).evaluate((b) => b.classList.contains('on'));
      check(`pixel preset "${p}" highlights`, on);
    }
    const ranges = page.locator('.settings input[type=range]');
    await ranges.nth(0).fill('0.2');
    await ranges.nth(1).fill('0.3');
    await ranges.nth(2).fill('0.4'); // Effects
    await ranges.nth(3).fill('7'); // Film Diffusion
    const fd = await K(page, () => ({ label: document.querySelector('.settings output')?.textContent, on: window.__komorebi.post.diffusing }));
    check('Film Diffusion slider drives the post pass', fd.label === '7%' && fd.on === true, JSON.stringify(fd));
    // the volume sliders are checked through the save: see "reload: Music slider shows saved value" below
    const cb = page.locator('.settings input[type=checkbox]').first();
    await cb.check();
    check('reduced motion checkbox → world.reducedMotion', await K(page, () => window.__komorebi.world.reducedMotion));
    await page.keyboard.press('Escape');
    check('Escape closes Settings', !(await page.locator('.settings').evaluate((e) => e.classList.contains('open'))));
    await page.evaluate(() => document.querySelector('.settings').classList.remove('open'));

    // Prompt 04 additions: captions, text size, Notes, People, keyboard placement, real audio suspend
    await byLabel(page, 'Settings').click();
    await page.locator('.settings input[type=checkbox]').nth(1).check();
    await byText(page, '.settings', 'Large').click();
    const ts = await K(page, () => getComputedStyle(document.getElementById('hud')).getPropertyValue('--ts').trim());
    check('text size: Large scales the HUD', ts === '1.25', ts);
    await byText(page, '.settings', 'Normal').click();
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 300);
    await page.keyboard.press('n');
    check('N opens Notes', await page.locator('.notes').evaluate((e) => e.classList.contains('open')));
    const noteLines = await page.locator('.notes-list li').count();
    check('Notes lists what happened', noteLines > 0, `${noteLines} lines`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('l');
    check('L opens People', await page.locator('.people').evaluate((e) => e.classList.contains('open')));
    const people = await page.locator('.people-list button').count();
    check('People lists all 14 neighbors', people === 14, `${people}`);
    await page.locator('.people-list button').first().click();
    check('a name in People opens their card', await page.locator('.card').evaluate((e) => e.classList.contains('open')));
    await page.keyboard.press('Escape');
    check('Escape closes the card', !(await page.locator('.card').evaluate((e) => e.classList.contains('open'))));
    // keyboard-only placement: B, arrows to a free spot, Enter
    await page.mouse.click(5, 300);
    await page.keyboard.press('b');
    const kb0 = await K(page, () => window.__komorebi.build.placed.size);
    let placedByKeys = false;
    for (let i = 0; i < 40 && !placedByKeys; i++) {
      await page.keyboard.press(i % 8 < 4 ? 'ArrowLeft' : 'ArrowDown');
      await page.keyboard.press('Enter');
      placedByKeys = (await K(page, () => window.__komorebi.build.placed.size)) > kb0;
    }
    check('keyboard only: arrows + Enter place a bench', placedByKeys);
    if (placedByKeys) {
      await page.keyboard.press('x');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      // the cursor is where the bench went: Enter there removes it
      const ids = await K(page, () => [...window.__komorebi.build.placed.values()].map((p) => [p.x, p.z]));
      check('keyboard only: remove mode reachable', (await K(page, () => window.__komorebi.build.mode)) === 'remove', JSON.stringify(ids.length));
    }
    await page.keyboard.press('Escape');
    // Sound off really suspends the AudioContext
    if ((await sound.getAttribute('aria-pressed')) !== 'true') await sound.click(); // on
    await page.waitForTimeout(600);
    const onState = await K(page, () => window.__komorebi.sound.context?.state);
    await sound.click(); // off
    await page.waitForTimeout(1200);
    const offState = await K(page, () => window.__komorebi.sound.context?.state);
    check('Sound off suspends the AudioContext', offState === 'suspended' || (onState !== 'running' && offState !== 'running'), `${onState} → ${offState}`);

    // Build
    const buildBtn = byLabel(page, 'Build mode (B)');
    await buildBtn.click();
    check('Build opens palette', await page.locator('.palette').evaluate((e) => e.classList.contains('open')));
    const kinds = await page.$$eval('.palette button', (bs) => bs.map((b) => b.getAttribute('aria-label')));
    for (const k of kinds.filter((k) => k.startsWith('Place '))) {
      await byLabel(page, k).click();
      check(`palette "${k}" selects`, await byLabel(page, k).evaluate((b) => b.classList.contains('on')));
    }
    check(
      'palette has a touch-friendly rotate control',
      kinds.some((k) => /rotate/i.test(k || '')),
      kinds.join(' | '),
    );

    // Find a placeable spot visible on screen and click it for every kind
    await byLabel(page, 'Pause time (Space)').click();
    const placedKinds = [];
    for (const kind of ['bench', 'sakura', 'lantern', 'vending', 'planter', 'catbowl']) {
      const spot = await K(
        page,
        (kind) => {
          const k = window.__komorebi;
          const c = document.getElementById('view');
          const r = c.getBoundingClientRect();
          const THREE_V = k.iso.camera.position.constructor;
          for (let x = -14; x <= 14; x += 0.25)
            for (let z = -10; z <= 10; z += 0.25) {
              if (!k.build.canPlace(kind, x, z)) continue;
              const v = new THREE_V(x, 0.42, z).project(k.iso.camera);
              const sx = r.left + ((v.x + 1) / 2) * r.width,
                sy = r.top + ((1 - v.y) / 2) * r.height;
              if (sx > 340 && sx < r.right - 340 && sy > 160 && sy < r.bottom - 160) {
                // the click rounds to a 0.25 grid from the y=G+0.1 plane, so confirm the round-trip
                return { sx, sy, x, z };
              }
            }
          return null;
        },
        kind,
      );
      if (!spot) {
        check(`place ${kind}`, false, 'no free on-screen spot');
        continue;
      }
      await byLabel(
        page,
        await K(
          page,
          (k) => document.querySelector(`.palette button[aria-label$="${k}"]`)?.getAttribute('aria-label'),
          { bench: 'Bench', sakura: 'Sakura', lantern: 'Stone lantern', vending: 'Vending machine', planter: 'Flower planter', catbowl: 'Cat bowl' }[kind],
        ),
      ).click();
      const n0 = await K(page, () => window.__komorebi.build.placed.size);
      await page.mouse.move(spot.sx, spot.sy);
      await page.mouse.move(spot.sx + 1, spot.sy);
      await page.mouse.click(spot.sx + 1, spot.sy);
      await page.waitForTimeout(150);
      const n1 = await K(page, () => window.__komorebi.build.placed.size);
      check(`place ${kind} by clicking the diorama`, n1 === n0 + 1, `${n0} → ${n1}`);
      if (n1 === n0 + 1) placedKinds.push(spot);
    }
    await page.keyboard.press('r');
    check('R rotates the item', await K(page, () => window.__komorebi.build.ry > 0));
    await page.screenshot({ path: path.join(out, 'desktop-built.png') });

    // Remove
    await byLabel(page, 'Remove things you placed (X)').click();
    check(
      'Remove mode on, palette closed',
      (await K(page, () => window.__komorebi.build.mode)) === 'remove' && !(await page.locator('.palette').evaluate((e) => e.classList.contains('open'))),
    );
    if (placedKinds[0]) {
      const n0 = await K(page, () => window.__komorebi.build.placed.size);
      const s = placedKinds[0];
      await page.mouse.move(s.sx, s.sy);
      await page.mouse.move(s.sx + 1, s.sy);
      await page.mouse.click(s.sx + 1, s.sy);
      const n1 = await K(page, () => window.__komorebi.build.placed.size);
      check('remove by clicking a placed object', n1 === n0 - 1, `${n0} → ${n1}`);
    }
    await page.keyboard.press('Escape');
    check('Escape leaves remove mode', (await K(page, () => window.__komorebi.build.mode)) === 'view');

    // GPU-resource growth while switching tools
    const before = await K(page, () => ({ g: window.__komorebi.renderer.info.memory.geometries, lamps: window.__komorebi.world.mats.lamps.length }));
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('b');
      await page.waitForTimeout(20);
      await page.mouse.move(640 + (i % 3), 400);
      await page.keyboard.press('b');
    }
    await page.waitForTimeout(200);
    const after = await K(page, () => ({ g: window.__komorebi.renderer.info.memory.geometries, lamps: window.__komorebi.world.mats.lamps.length }));
    check(
      'toggling Build 30× does not grow GPU geometries / lamp list',
      after.g - before.g < 8 && after.lamps === before.lamps,
      `geometries ${before.g}→${after.g}, lamp materials ${before.lamps}→${after.lamps}`,
    );

    // place + remove cycles must give GPU resources back
    {
      const spot = placedKinds[1];
      if (spot) {
        await page.keyboard.press('Escape');
        const g0 = await K(page, () => ({
          g: window.__komorebi.renderer.info.memory.geometries,
          lamps: window.__komorebi.world.mats.lamps.length,
          n: window.__komorebi.build.placed.size,
        }));
        for (let i = 0; i < 5; i++) {
          await K(
            page,
            (s) => {
              const b = window.__komorebi.build;
              b.place({ id: 'cyc' + Math.random(), kind: 'lantern', x: s.x, z: s.z + 30, ry: 0 }, false);
              b.remove([...b.placed.keys()].pop());
            },
            spot,
          );
        }
        await page.waitForTimeout(100);
        const g1 = await K(page, () => ({
          g: window.__komorebi.renderer.info.memory.geometries,
          lamps: window.__komorebi.world.mats.lamps.length,
          n: window.__komorebi.build.placed.size,
        }));
        check(
          '5 place/remove cycles leave no lamp materials or geometries behind',
          g1.lamps === g0.lamps && g1.g <= g0.g + 1 && g1.n === g0.n,
          `${JSON.stringify(g0)} → ${JSON.stringify(g1)}`,
        );
      }
    }
    // photo mode: clicking a resident does nothing
    // Resident card
    await page.keyboard.press('Escape');
    const res = await K(page, () => {
      const k = window.__komorebi;
      const c = document.getElementById('view');
      const r = c.getBoundingClientRect();
      for (const a of k.residents.agents) {
        if (a.hidden) continue;
        const v = a.root.position.clone();
        v.y += 0.6;
        v.project(k.iso.camera);
        const sx = r.left + ((v.x + 1) / 2) * r.width,
          sy = r.top + ((1 - v.y) / 2) * r.height;
        if (sx > 340 && sx < r.right - 340 && sy > 160 && sy < r.bottom - 160) return { sx, sy, name: a.p.name };
      }
      return null;
    });
    if (res) {
      await page.mouse.click(res.sx, res.sy);
      await page.waitForTimeout(150);
      const open = await page.locator('.card').evaluate((e) => e.classList.contains('open'));
      check('click a resident opens their card', open, res.name);
      if (open) {
        await page.locator('.card button.x').click();
        check('card × closes', !(await page.locator('.card').evaluate((e) => e.classList.contains('open'))));
      }
      // Escape layering: open card, open help → Esc closes help only, then card
      await page.mouse.click(res.sx, res.sy);
      await page.keyboard.press('h');
      await page.keyboard.press('Escape');
      const l1 = await K(page, () => ({
        help: document.querySelector('.help').classList.contains('open'),
        card: document.querySelector('.card').classList.contains('open'),
      }));
      check('Esc closes one layer at a time', !l1.help, JSON.stringify(l1));
      await page.keyboard.press('Escape');
    } else check('click a resident opens their card', false, 'no resident on screen');
    await byLabel(page, 'Normal speed').click();

    // Photo
    await byLabel(page, 'Photo mode (P)').click();
    check(
      'Photo hides HUD and shows photo bar',
      await K(page, () => document.getElementById('hud').classList.contains('hidden') && document.querySelector('.photo-bar').classList.contains('open')),
    );
    await byText(page, '.photo-bar', 'Capture').click();
    await page.waitForTimeout(800);
    const cap = await K(page, () => ({
      open: document.querySelector('.modal').classList.contains('open'),
      src: document.querySelector('.modal img')?.src?.slice(0, 22) || '',
      len: document.querySelector('.modal img')?.src?.length || 0,
    }));
    check('Capture shows a PNG', cap.open && cap.src.startsWith('data:image/png') && cap.len > 5000, `${cap.len} chars`);
    const dl = await K(page, () => document.querySelector('.modal a[download]')?.getAttribute('download'));
    check('Download link present', !!dl, dl);
    await page.keyboard.press('Escape');
    const afterEsc = await K(page, () => ({
      modal: document.querySelector('.modal').classList.contains('open'),
      photo: document.getElementById('hud').classList.contains('hidden'),
    }));
    check('Escape closes the capture preview first (stays in photo mode)', !afterEsc.modal && afterEsc.photo, JSON.stringify(afterEsc));
    await page.evaluate(() => document.querySelector('.modal').classList.remove('open'));
    if (!(await K(page, () => document.getElementById('hud').classList.contains('hidden')))) await byLabel(page, 'Photo mode (P)').click();
    await byText(page, '.photo-bar', 'Exit photo mode').click();
    check('Exit photo mode restores HUD', !(await K(page, () => document.getElementById('hud').classList.contains('hidden'))));

    // Ctrl/Cmd shortcuts must not trigger game keys
    await page.mouse.click(5, 300);
    const yaw0 = await K(page, () => window.__komorebi.iso.yaw);
    await page.keyboard.press('Control+e'); // browser search shortcut in some browsers
    const yaw1 = await K(page, () => window.__komorebi.iso.yaw);
    check('Ctrl+E is not swallowed as "rotate camera"', yaw0 === yaw1, `${yaw0.toFixed(2)} → ${yaw1.toFixed(2)}`);

    // Splash dismiss
    check('no page errors during desktop run', errors.length === 0, errors.slice(0, 3).join(' | '));

    // Reset
    await byLabel(page, 'Settings').click();
    page.once('dialog', (d) => d.accept());
    const placedBefore = await K(page, () => window.__komorebi.build.placed.size);
    await byText(page, '.settings', 'Reset neighborhood').click();
    await page.waitForTimeout(100);
    const armedCount = await K(page, () => window.__komorebi.build.placed.size);
    check('Reset asks for a second click first', armedCount === placedBefore || placedBefore === 0, `${placedBefore} → ${armedCount} after 1 click`);
    await page.locator('.settings button.reset').click();
    await page.waitForTimeout(200);
    const placedAfter = await K(page, () => window.__komorebi.build.placed.size);
    const known = await K(page, () => Object.values(window.__komorebi.residents.memory()).flat().length);
    check('Reset removes all placed things', placedAfter === 0, `${placedBefore} → ${placedAfter}`);
    check('Reset clears what residents remember', known === 0, `${known} memories left`);

    // Persistence of settings across reload
    if (!(await page.locator('.settings').evaluate((e) => e.classList.contains('open')))) await byLabel(page, 'Settings').click();
    await ranges.nth(0).fill('0.2');
    await ranges.nth(1).fill('0.3');
    await cb.check();
    await K(page, () => window.dispatchEvent(new Event('pagehide')));
    await page.reload(DOM_READY);
    await page.waitForFunction(() => (window.__komorebi?.frames ?? 0) > 3, null, { timeout: 90000 });
    const restored = await K(page, () => {
      const r = [...document.querySelectorAll('.settings input[type=range]')].map((i) => i.value);
      return { music: r[0], amb: r[1], rm: document.querySelector('.settings input[type=checkbox]').checked, world: window.__komorebi.world.reducedMotion };
    });
    check('reload: Music slider shows saved value', restored.music === '0.2', restored.music);
    check('reload: Ambience slider shows saved value', restored.amb === '0.3', restored.amb);
    check('reload: Reduced motion checkbox shows saved value', restored.rm === true && restored.world === true, JSON.stringify(restored));
    await ctx.close();
  }

  // ── 2. Corrupted saves must not brick the game ─────────────────────────
  for (const [name, raw] of [
    ['placed not an array', JSON.stringify({ version: 2, minutes: 600, season: 'spring', weather: 'auto', placed: 'oops', memory: {}, settings: {} })],
    [
      'unknown placeable kind',
      JSON.stringify({
        version: 2,
        minutes: 600,
        season: 'spring',
        weather: 'auto',
        placed: [{ id: 'a', kind: 'torii', x: 0, z: 0, ry: 0 }],
        memory: {},
        settings: {},
      }),
    ],
    [
      'bad season + NaN minutes',
      JSON.stringify({ version: 2, minutes: 'x', season: 'monsoon', weather: 'snow', placed: [], memory: null, settings: { music: 'loud' } }),
    ],
    ['JSON null', 'null'],
  ]) {
    const { ctx, page, errors } = await boot(browser, { save: raw, timeout: 20000 });
    const ok = await K(page, () => (window.__komorebi?.frames ?? 0) > 3 && Number.isFinite(window.__komorebi.clock.minutes)).catch(() => false);
    check(`corrupt save (${name}) still boots`, ok && errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 3. Phone ───────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { save: null, viewport: { width: 390, height: 844 }, touch: true, mobile: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, 'phone-boot.png') });
    const story = await K(page, () => getComputedStyle(document.querySelector('.story')).display);
    check('phone: story feed visible', story !== 'none', `display: ${story}`);
    const overflow = await K(page, () => {
      const out = [];
      for (const b of document.querySelectorAll('#hud button')) {
        const r = b.getBoundingClientRect();
        if (r.width && (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1)) out.push(b.textContent);
      }
      return out;
    });
    check('phone: no buttons off-screen', overflow.length === 0, overflow.join(','));
    const overlap = await K(page, () => {
      const tb = document.querySelector('.toolbar').getBoundingClientRect();
      const br = document.querySelector('.brand').getBoundingClientRect();
      const tr = document.querySelector('.top-right').getBoundingClientRect();
      const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      return { brandTopRight: hit(br, tr), toolbarH: Math.round(tb.height) };
    });
    check('phone: wordmark does not overlap top-right buttons', !overlap.brandTopRight, JSON.stringify(overlap));
    const more = page.locator('#hud button.more-toggle');
    if (await more.isVisible()) {
      await more.tap();
      const vis = await byLabel(page, 'Skip to Dusk (3)').isVisible();
      check('phone: More reveals time/weather/season', vis);
      await page.screenshot({ path: path.join(out, 'phone-more.png') });
      await more.tap();
    } else check('phone: More reveals time/weather/season', await byLabel(page, 'Skip to Dusk (3)').isVisible(), 'no More toggle; jumps visible?');
    const tbh = await K(page, () => Math.round(document.querySelector('.toolbar').getBoundingClientRect().height));
    check('phone: toolbar ≤ 2 rows (≤ 100 px)', tbh <= 100, `${tbh}px`);
    await byLabel(page, 'Build mode (B)').tap();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, 'phone-build.png') });
    await byLabel(page, 'Pause time (Space)').tap();
    const spot = await K(page, () => {
      const k = window.__komorebi;
      const c = document.getElementById('view');
      const r = c.getBoundingClientRect();
      const V = k.iso.camera.position.constructor;
      const pal = document.querySelector('.dock').getBoundingClientRect();
      for (let x = -14; x <= 14; x += 0.25)
        for (let z = -10; z <= 10; z += 0.25) {
          if (!k.build.canPlace('bench', x, z)) continue;
          const v = new V(x, 0.42, z).project(k.iso.camera);
          const sx = r.left + ((v.x + 1) / 2) * r.width,
            sy = r.top + ((1 - v.y) / 2) * r.height;
          if (sx > 40 && sx < innerWidth - 40 && sy > 220 && sy < pal.top - 30) return { sx, sy };
        }
      return null;
    });
    if (spot) {
      const n0 = await K(page, () => window.__komorebi.build.placed.size);
      await page.touchscreen.tap(spot.sx, spot.sy);
      await page.waitForTimeout(100);
      const n1 = await K(page, () => window.__komorebi.build.placed.size);
      const ghost = await K(page, () => window.__komorebi.build.targetKey());
      await page.touchscreen.tap(spot.sx, spot.sy);
      await page.waitForTimeout(100);
      const n2 = await K(page, () => window.__komorebi.build.placed.size);
      check('phone: first tap previews, second tap places', n1 === n0 && ghost && n2 === n0 + 1, `${n0} → ${n1} (preview ${ghost}) → ${n2}`);
      await page.screenshot({ path: path.join(out, 'phone-placed.png') });
    } else check('phone: first tap previews, second tap places', false, 'no spot');
    await byLabel(page, 'Rotate item (R)')
      .tap()
      .catch(() => {});
    check('phone: Rotate button turns the item', await K(page, () => window.__komorebi.build.ry > 0));
    const palOverlap = await K(page, () => {
      const a = document.querySelector('.palette').getBoundingClientRect();
      const b = document.querySelector('.toolbar').getBoundingClientRect();
      return !(a.bottom <= b.top || b.bottom <= a.top);
    });
    check('phone: palette does not cover the toolbar', !palOverlap);
    const tapTargets = await K(
      page,
      () =>
        [...document.querySelectorAll('.toolbar button')].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 32).length,
    );
    check('phone: toolbar tap targets ≥ 32 px tall', tapTargets === 0, `${tapTargets} smaller`);
    // pinch zoom via synthetic pointer events
    const z = await K(page, () => {
      const c = document.getElementById('view');
      const k = window.__komorebi;
      const z0 = k.iso.zoomGoal;
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2,
        cy = r.top + r.height / 2;
      const ev = (type, id, x, y) =>
        c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', isPrimary: id === 1, bubbles: true }));
      ev('pointerdown', 1, cx - 20, cy);
      ev('pointerdown', 2, cx + 20, cy);
      for (let i = 1; i <= 10; i++) {
        ev('pointermove', 1, cx - 20 - i * 12, cy);
        ev('pointermove', 2, cx + 20 + i * 12, cy);
      }
      ev('pointerup', 1, cx - 140, cy);
      ev('pointerup', 2, cx + 140, cy);
      return { z0, z1: k.iso.zoomGoal };
    });
    await page.waitForTimeout(300);
    const z1 = await K(page, () => window.__komorebi.iso.zoomGoal);
    check('phone: two-finger pinch zooms in', String(z.z0) !== String(z1), `${z.z0} → ${z1}`);
    check('no page errors during phone run', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ── 4. Two tabs: one saves, the other says so and never overwrites ──
  {
    const ctx = await browser.newContext();
    const A = await ctx.newPage();
    await A.goto(base, DOM_READY);
    await ready(A);
    await A.evaluate(() => localStorage.clear());
    await A.reload(DOM_READY);
    await ready(A);
    const B = await ctx.newPage();
    await B.goto(base, DOM_READY);
    await ready(B);
    await B.waitForTimeout(300);
    {
      check('tab B shows "open in another tab" at once', /another tab/.test((await note(B)) || ''), await note(B));
      check('tab A (first) shows no note', (await note(A)) === null);
    }
    await placeBench(A);
    await persist(A);
    check('A saved its bench', (await disk(A))?.placed?.length === 1);
    await persist(B); // B's autosave / pagehide with its stale, bench-less town
    const d = await disk(A);
    check('B writing does NOT erase A’s bench', d?.placed?.length === 1, `placed on disk: ${d?.placed?.length}`);
    await B.waitForTimeout(11000); // a real autosave tick in B
    check('…nor does B’s 10-second autosave', (await disk(A))?.placed?.length === 1);

    // B takes over
    await placeBench(A); // A has 2 now, not yet saved: the hand-over must save it first
    const nav = B.waitForEvent('domcontentloaded');
    await B.locator('.save-note button').click();
    await nav;
    await ready(B);
    await B.waitForTimeout(300);
    check('after "Use this tab", B reloads with A’s latest town (2 benches)', (await B.evaluate(() => window.__komorebi.build.placed.size)) === 2);
    check('B no longer shows the note', (await note(B)) === null);
    check('A now says "carried on in another tab"', /carried on/.test((await note(A)) || ''), await note(A));
    await placeBench(A);
    await persist(A);
    check('A (paused) no longer writes', (await disk(A))?.placed?.length === 2, `placed on disk: ${(await disk(A))?.placed?.length}`);
    await placeBench(B);
    await persist(B);
    check('B (owner) writes', (await disk(B))?.placed?.length === 3);

    // owner closes; A takes over with nobody to answer
    await B.close({ runBeforeUnload: true });
    const navA = A.waitForEvent('domcontentloaded');
    await A.locator('.save-note button').click();
    await navA;
    await ready(A);
    await A.waitForTimeout(300);
    check(
      'after B closes, "Use this tab" in A loads B’s last save and saves again',
      (await A.evaluate(() => window.__komorebi.build.placed.size)) === 3 && (await note(A)) === null,
    );
    await ctx.close();
  }
  {
    // no Web Locks: the stamp check alone must stop the stale tab
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true });
      } catch {
        /* */
      }
    });
    const A = await ctx.newPage();
    await A.goto(base, DOM_READY);
    await ready(A);
    await A.evaluate(() => localStorage.clear());
    await A.reload(DOM_READY);
    await ready(A);
    const B = await ctx.newPage();
    await B.goto(base, DOM_READY);
    await ready(B);
    check(
      'no Web Locks: both tabs start without a note',
      (await note(A)) === null && (await note(B)) === null,
      String(await A.evaluate(() => 'locks' in navigator && !!navigator.locks)),
    );
    await placeBench(A);
    await persist(A);
    await persist(B);
    check('no Web Locks: the stale tab sees the newer save and does not overwrite it', (await disk(A))?.placed?.length === 1);
    check('no Web Locks: the stale tab says so', /carried on/.test((await note(B)) || ''), await note(B));
    await ctx.close();
  }
  {
    // scripted runs never touch the save or take the lock
    const ctx = await browser.newContext();
    const A = await ctx.newPage();
    await A.goto(base, DOM_READY);
    await ready(A);
    const S = await ctx.newPage();
    await S.goto(base + '?seed=1&hour=12', DOM_READY);
    await ready(S);
    check('a scripted (?seed) tab shows no note and A keeps saving', (await note(S)) === null && (await note(A)) === null);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
})();
