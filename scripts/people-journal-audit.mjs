// Deep audit of the People panel, the resident card (Show me, Follow) and the Journal, in the real game.
//
// Playwright is not a project dependency. To run:
//   npm i --no-save playwright@1.64.0 axe-core@4.10.3 && npx playwright install chromium
//   npm run build && npx vite preview --port 4173   # in another terminal
//   node scripts/people-journal-audit.mjs http://localhost:4173 shots/
// Prints PASS/FAIL per check and "N/N passed"; exits 1 on any failure.
import { chromium } from 'playwright';
const [base, out] = process.argv.slice(2);
const res = [];
const check = (name, ok, detail = '') => {
  res.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
};
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const boot = async (q = '') => {
  await page.goto(base + '/' + q, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window.__komorebi?.frames ?? 0) > 5, null, { timeout: 180000 });
  await page.waitForTimeout(800);
  await page.mouse.click(640, 300);
  await page.keyboard.press('Escape');
};
const K = (f, a) => page.evaluate(f, a);
const ndc = (id) =>
  K((id) => {
    const k = window.__komorebi;
    const a = k.residents.agents.find((x) => x.p.id === id);
    const v = a.root.position.clone();
    v.y += 1;
    v.project(k.iso.camera);
    return { x: v.x, y: v.y, hidden: a.hidden };
  }, id);
// PHONE_ONLY=1 skips the desktop pass (the phone pass then finds an empty Journal, which is fine)
if (!process.env.PHONE_ONLY) {
  await boot();
  await K(() => {
    const k = window.__komorebi;
    k.world.weather.setMode('clear');
    k.clock.setHour(12.5);
  });
  await page.waitForTimeout(3000);

  // ── People ──
  await page.keyboard.press('l');
  const rows = await page
    .locator('.people-list button.person')
    .evaluateAll((els) => els.map((e) => ({ name: e.querySelector('.name, span')?.textContent ?? '', text: e.textContent })));
  check('People lists 14 neighbors', rows.length === 14, String(rows.length));
  check(
    'every row says what they are doing, in words',
    rows.every((r) => r.text.length > 5 && !/task\.|persona\.|undefined|\{/.test(r.text)),
    rows
      .filter((r) => /task\.|persona\.|undefined|\{/.test(r.text))
      .map((r) => r.text)
      .join(' | '),
  );
  const ids = await K(() => window.__komorebi.residents.agents.map((a) => a.p.id));
  let cardsOk = 0;
  const bad = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('l');
    if (!(await page.locator('.people').evaluate((e) => e.classList.contains('open')))) await page.keyboard.press('l');
    await page.locator('.people-list button.person').nth(i).click();
    const c = await page.locator('.card').evaluate((e) => ({
      open: e.classList.contains('open'),
      h: e.querySelector('h3')?.textContent,
      role: e.querySelector('.role')?.textContent,
      p: e.querySelector('p')?.textContent,
      now: e.querySelector('.doing')?.textContent,
      text: e.textContent,
    }));
    const ok = c.open && c.h && c.role && c.p && /^Now: .+/.test(c.now ?? '') && !/task\.|persona\.|noun\.|undefined|\{/.test(c.text);
    if (ok) cardsOk++;
    else bad.push(JSON.stringify(c).slice(0, 200));
    const peopleOpen = await page.locator('.people').evaluate((e) => e.classList.contains('open'));
    if (peopleOpen) bad.push(`people panel stayed open for row ${i}`);
  }
  check('clicking each of the 14 opens a complete card', cardsOk === 14 && !bad.length, bad.join(' || '));
  await page.screenshot({ path: `${out}/card.png` });

  // Show me: someone out and about, far from the view's centre
  const pickVisible = () =>
    K(() => {
      const k = window.__komorebi;
      const a = k.residents.agents
        .filter((x) => !x.hidden)
        .sort((p, q) => Math.hypot(q.x - k.iso.target.x, q.z - k.iso.target.z) - Math.hypot(p.x - k.iso.target.x, p.z - k.iso.target.z))[0];
      return a ? a.p.id : null;
    });
  const openCardFor = async (id) => {
    if (!(await page.locator('.people').evaluate((e) => e.classList.contains('open')))) await page.keyboard.press('l');
    await page.locator('.people-list button.person').nth(ids.indexOf(id)).click();
    await page.waitForTimeout(150);
  };
  for (const z of ['fit', 2]) {
    if (z === 2)
      await K(() => {
        const k = window.__komorebi;
        k.iso.setZoomNow(2);
      });
    await page.waitForTimeout(600);
    const id = await pickVisible();
    await openCardFor(id);
    const before = await ndc(id);
    await page.locator('.card button.show-me', { hasText: /^Show me$/ }).click();
    await page.waitForTimeout(2500);
    const after = await ndc(id);
    check(
      `Show me brings a visible neighbor toward the middle (zoom ${z})`,
      Math.hypot(after.x, after.y) < 0.4 && Number(await K(() => window.__komorebi.iso.zoomGoal)) >= 1.5 - 1e-6,
      `${id}: before ${before.x.toFixed(2)},${before.y.toFixed(2)} after ${after.x.toFixed(2)},${after.y.toFixed(2)} zoom ${await K(() => window.__komorebi.iso.zoom.toFixed(2))}`,
    );
  }
  // Show me for someone indoors
  const hid = await K(() => window.__komorebi.residents.agents.find((x) => x.hidden)?.p.id ?? null);
  if (hid) {
    await K(() => {
      const k = window.__komorebi;
      k.iso.setZoomNow(2);
      k.iso.targetGoal.set(12, k.iso.targetGoal.y, 8);
      k.iso.target.copy(k.iso.targetGoal);
    });
    await openCardFor(hid);
    const t0 = await K(() => {
      const g = window.__komorebi.iso.targetGoal;
      return [g.x, g.z];
    });
    await page.locator('.card button.show-me', { hasText: /^Show me$/ }).click();
    await page.waitForTimeout(1500);
    const t1 = await K(() => {
      const g = window.__komorebi.iso.targetGoal;
      return [g.x, g.z];
    });
    const door = await K((id) => {
      const a = window.__komorebi.residents.agents.find((x) => x.p.id === id);
      return a.hiddenAt;
    }, hid);
    const dn = await K((d) => {
      const k = window.__komorebi;
      const v = new k.iso.target.constructor(d[0], 1, d[1]).project(k.iso.camera);
      return [v.x, v.y];
    }, door);
    check(
      'Show me for someone indoors brings the door they went in by into view',
      !!door && Math.abs(dn[0]) < 0.9 && Math.abs(dn[1]) < 0.9 && Math.hypot(t1[0] - t0[0], t1[1] - t0[1]) > 3,
      `ndc ${dn.map((v) => v.toFixed(2))} ` + `${hid}: goal ${t0.map((v) => v.toFixed(1))} -> ${t1.map((v) => v.toFixed(1))}, door ${door}`,
    );
  } else check('someone is indoors at 12:30 (test setup)', false);

  // Follow
  const fid = await pickVisible();
  await openCardFor(fid);
  const follow = page.locator('.card button.show-me', { hasText: /^Follow$/ });
  check('Follow is offered in Smooth', await follow.isVisible());
  await follow.click();
  check('Follow shows pressed', (await follow.getAttribute('aria-pressed')) === 'true');
  await K(() => {
    window.__komorebi.clock.speed = 6;
  });
  let worst = 0,
    stillOn = true,
    hiddenSeen = false;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(700);
    const p = await ndc(fid);
    if (p.hidden) {
      hiddenSeen = true;
      break;
    }
    worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
    if ((await follow.getAttribute('aria-pressed')) !== 'true') {
      stillOn = false;
      break;
    }
  }
  check(
    'Follow keeps them in view while they walk, and stays on',
    stillOn && worst < 0.85,
    `worst |ndc| ${worst.toFixed(2)}, on ${stillOn}, went indoors ${hiddenSeen}`,
  );
  await K(() => {
    window.__komorebi.clock.speed = 1;
  });
  // another card: not pressed there; back: pressed
  const other = ids.find((x) => x !== fid);
  await openCardFor(other);
  check('Follow is not shown pressed on someone else’s card', (await follow.getAttribute('aria-pressed')) === 'false');
  await openCardFor(fid);
  check('…and is pressed again on the followed person’s card', (await follow.getAttribute('aria-pressed')) === 'true');
  await page.keyboard.press('Escape');
  check('Esc stops following (first press)', (await follow.getAttribute('aria-pressed')) === 'false');
  await openCardFor(fid);
  await follow.click();
  await page.mouse.move(300, 400);
  await page.mouse.down();
  await page.mouse.move(420, 460, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('a pan stops following', (await follow.getAttribute('aria-pressed')) === 'false');
  await openCardFor(fid);
  await follow.click();
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(600);
  check('a zoom stops following', (await follow.getAttribute('aria-pressed')) === 'false');
  await K(() => window.__komorebi.setPixel('classic'));
  check('Follow is hidden in the pixel looks', !(await follow.isVisible()));
  await K(() => window.__komorebi.setPixel('smooth'));
  // night: everyone asleep, cards still work
  await K(() => {
    const k = window.__komorebi;
    k.clock.setHour(23.5);
    k.clock.speed = 6;
  });
  await page.waitForTimeout(25000);
  await K(() => {
    window.__komorebi.clock.speed = 1;
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await page.waitForTimeout(1200);
  const night = await page.locator('.people-list button.person').evaluateAll((els) => els.map((e) => e.textContent));
  check(
    'late at night the list is still in words, and says who is asleep',
    night.every((t) => !/task\.|undefined/.test(t)) && night.filter((t) => /Asleep/.test(t)).length >= 1,
    `${night.filter((t) => /Asleep/.test(t)).length} asleep`,
  );
  await page.screenshot({ path: `${out}/people-night.png` });
  const si = night.findIndex((t) => /Asleep/.test(t));
  await page.locator('.people-list button.person').nth(Math.max(0, si)).click();
  check('a sleeping neighbor’s card opens and says so', /Now: Asleep/.test(await page.locator('.card .doing').textContent()));
  const sid = ids[Math.max(0, si)];
  await page.locator('.card button.show-me', { hasText: /^Show me$/ }).click();
  await page.waitForTimeout(1500);
  const sl = await K((id) => {
    const k = window.__komorebi;
    const a = k.residents.agents.find((x) => x.p.id === id);
    const g = k.iso.targetGoal;
    return { d: a.hiddenAt ? Math.hypot(g.x - a.hiddenAt[0], g.z - a.hiddenAt[1]) : -1 };
  }, sid);
  check('Show me on a sleeping neighbor goes to their door', sl.d >= 0 && sl.d < 3, JSON.stringify(sl));
  await page.keyboard.press('Escape');

  // ── Journal ──
  await K(() => window.__komorebi.clock.setHour(13));
  await page.waitForTimeout(1500);
  await page.keyboard.press('n');
  check('N opens the Journal', await page.locator('.notes').evaluate((e) => e.classList.contains('open')));
  check('with no memories it says so', /No memories yet/.test(await page.locator('.journal').textContent()));
  await page.keyboard.press('Escape');
  // place three things and let the real events make memories
  const placed = await K(() => {
    const k = window.__komorebi;
    const out = [];
    const spots = [];
    for (let x = -7; x <= 7; x += 1.5) for (let z = -3; z <= 8; z += 1.5) spots.push([x, z]);
    for (const [id, kind] of [
      ['pa1', 'bench'],
      ['pa2', 'lantern'],
      ['pa3', 'planter'],
    ]) {
      const sp = spots.find(([x, z]) => k.build.canPlace(kind, x, z, { ignoreResidents: true }));
      if (sp) {
        k.build.place({ id, kind, x: sp[0], z: sp[1], ry: 0 }, true);
        out.push(id);
        spots.splice(spots.indexOf(sp), 1);
      }
    }
    return out;
  });
  check('test objects placed', placed.length === 3, placed.join(','));
  await K(() => {
    const k = window.__komorebi;
    let a = k.residents.agents.filter((x) => !x.hidden);
    if (a.length < 2) a = k.residents.agents;
    k.bus.emit('noticed', { who: a[0].p.id, id: 'pa1' });
    k.bus.emit('used', { who: a[0].p.id, id: 'pa1', with: [a[1].p.id] });
    k.bus.emit('noticed', { who: a[1].p.id, id: 'pa2' });
  });
  await page.waitForTimeout(500);
  const count = await K(() => window.__komorebi.memories.memories.length);
  check('events made memories', count === 3, String(count));
  await page.keyboard.press('n');
  await page.waitForTimeout(1500);
  const J = () =>
    page.locator('.journal').evaluate((e) => ({
      title: e.querySelector('.mem-title')?.textContent,
      when: e.querySelector('.mem-when')?.textContent,
      cap: e.querySelector('.mem-caption')?.textContent,
      imgs: [...e.querySelectorAll('.mem-img img')].map((i) => ({ ok: i.complete && i.naturalWidth > 50, alt: i.alt, len: i.src.length })),
      older: [...e.querySelectorAll('.mem-list button')].map((b) => b.textContent),
      text: e.textContent,
    }));
  let j = await J();
  check(
    'the newest memory is open with a title, a date and a caption',
    !!j.title && /^Day \d+ · \w+ · \d/.test(j.when ?? '') && (j.cap ?? '').length > 10 && !/memory\.|noun\.|persona\.|\{/.test(j.text),
    JSON.stringify({ t: j.title, w: j.when, c: j.cap }),
  );
  check(
    'its three panels are drawn, each with a text alternative',
    j.imgs.length === 3 && j.imgs.every((i) => i.ok && i.len > 2000 && i.alt.length > 10),
    JSON.stringify(j.imgs.map((i) => [i.ok, i.len])),
  );
  const distinct = await page.locator('.journal .mem-img img').evaluateAll((els) => new Set(els.map((e) => e.src)).size);
  check('the three cuts are three different pictures', distinct === 3, String(distinct));
  check('earlier memories are listed, and can be told apart', j.older.length === 2 && new Set(j.older).size === 2, j.older.join(' | '));
  await page.screenshot({ path: `${out}/journal.png` });
  await page.locator('.journal .mem-list button').first().click();
  await page.waitForTimeout(1200);
  const j2 = await J();
  check(
    'an earlier memory opens (and moves focus to its title)',
    j2.cap !== j.cap &&
      j2.imgs.length === 3 &&
      j2.imgs.every((i) => i.ok) &&
      (await page.evaluate(() => document.activeElement?.classList.contains('mem-title'))),
    `${j2.title} / ${j2.cap}`,
  );
  const frameOk = await K(() => {
    const k = window.__komorebi;
    return { z: k.iso.zoom, vis: k.residents.agents.filter((a) => a.root.visible).length };
  });
  // remove the object: its memories still draw
  await page.keyboard.press('Escape');
  const st0 = await K(() => {
    const k = window.__komorebi;
    return { zoom: k.iso.zoom, hour: k.clock.hour.toFixed(2), rain: k.world.weather.rain };
  });
  await K(() => window.__komorebi.build.remove('pa1'));
  await page.keyboard.press('n');
  await page.waitForTimeout(1500);
  const j3 = await J();
  check('memories of a removed thing still draw', j3.imgs.length === 3 && j3.imgs.every((i) => i.ok));
  const st1 = await K(() => {
    const k = window.__komorebi;
    return { zoom: k.iso.zoom, hour: k.clock.hour.toFixed(2), rain: k.world.weather.rain };
  });
  check(
    'drawing memories leaves the camera, clock and weather as they were',
    st0.zoom === st1.zoom && st0.rain === st1.rain && Math.abs(st0.hour - st1.hour) < 0.2,
    JSON.stringify([st0, st1]) + JSON.stringify(frameOk),
  );
  await K(() => window.__komorebi.setPixel('classic'));
  await page.waitForTimeout(1500);
  const j4 = await J();
  check('panels redraw in another look', j4.imgs.length === 3 && j4.imgs.every((i) => i.ok));
  await K(() => window.__komorebi.setPixel('smooth'));
  const notes = await page.locator('.notes-list li').evaluateAll((els) => els.map((e) => e.textContent));
  check(
    'Lately lists what happened, dated, in words',
    notes.length > 0 && notes.every((n) => /Day \d+/.test(n) && !/story\.|noun\.|persona\.|\{/.test(n)),
    notes.slice(0, 3).join(' | '),
  );
  check('Lately does not keep the "Now playing" lines', !notes.some((n) => /Now playing/.test(n)));
  await page.keyboard.press('Escape');
  check('Escape closes the Journal', !(await page.locator('.notes').evaluate((e) => e.classList.contains('open'))));
  // reload: the journal is still there
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.waitForTimeout(500);
  await boot();
  const after = await K(() => window.__komorebi.memories.memories.length);
  check('memories survive a reload', after === 3, String(after));
  await page.keyboard.press('n');
  await page.waitForTimeout(1500);
  const j5 = await J();
  check('…and draw after it', j5.imgs.length === 3 && j5.imgs.every((i) => i.ok), JSON.stringify(j5.imgs.map((i) => i.ok)));
}
// phone
// the same browser profile, so the phone sees the town (and the memories) the desktop pass saved
const phone = await ctx.newPage();
await phone.setViewportSize({ width: 390, height: 844 });
await phone.goto(base + '/', { timeout: 180000, waitUntil: 'domcontentloaded' });
await phone.waitForFunction(() => (window.__komorebi?.frames ?? 0) > 5, null, { timeout: 180000 });
await phone.waitForTimeout(800);
await phone.mouse.click(195, 400);
await phone.keyboard.press('Escape');
await phone.locator('.top-right button', { hasText: /^People$/ }).click();
await phone.waitForTimeout(500);
const pr = await phone.locator('.people').evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, bottom: r.bottom, scroll: e.scrollHeight > e.clientHeight };
});
check('phone: the People panel fits the screen width', pr.left >= 0 && pr.right <= 390, JSON.stringify(pr));
await phone.screenshot({ path: `${out}/phone-people.png` });
await phone.locator('.people-list button.person').nth(3).click();
await phone.waitForTimeout(400);
const pc = await phone.locator('.card').evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { open: e.classList.contains('open'), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
});
check('phone: the card opens on screen', pc.open && pc.left >= 0 && pc.right <= 390 && pc.bottom <= 844 && pc.top >= 0, JSON.stringify(pc));
await phone.screenshot({ path: `${out}/phone-card.png` });
await phone.keyboard.press('Escape');
await phone.locator('.top-right button', { hasText: /^Journal$/ }).click();
await phone.waitForTimeout(1500);
const pj = await phone.locator('.notes').evaluate((e) => {
  const r = e.getBoundingClientRect();
  return {
    open: e.classList.contains('open'),
    left: r.left,
    right: r.right,
    imgs: e.querySelectorAll('.mem-img img').length,
    empty: /No memories yet/.test(e.textContent),
    wide: [...e.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().right > 391).length,
  };
});
check(
  'phone: the Journal fits the screen and draws its panels',
  pj.open && pj.left >= 0 && pj.right <= 390 && (pj.imgs === 3 || pj.empty) && pj.wide === 0,
  JSON.stringify(pj),
);
await phone.screenshot({ path: `${out}/phone-journal.png` });
console.log(errs.length ? 'PAGE ERRORS: ' + errs.slice(0, 5).join(' | ') : 'no page errors');
console.log(`${res.filter(Boolean).length}/${res.length} passed`);
if (res.some((r) => !r)) process.exitCode = 1;
await b.close();
