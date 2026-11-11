import { describe, it, expect } from 'vitest';
import { GROOVE, bassNote, humanise, noteFits, phraseCurve, voiceLead, type Voice } from '../src/audio/theory';
import { PASS_ORDER, PIECES, variation, type PieceId } from '../src/audio/themes';
import { BarClock, Director, MIN_DWELL, layersFor, sceneFor, type Mood } from '../src/audio/director';
import { Rng } from '../src/core/rng';

const ids = Object.keys(PIECES) as PieceId[];

describe('music theory (prompt 11)', () => {
  it('voice-leads every progression without any voice moving more than an octave', () => {
    for (const id of ids) {
      const p = PIECES[id];
      let prev: number[] | null = null;
      for (let pass = 0; pass < 3; pass++)
        for (const step of p.chords) {
          const v = voiceLead(prev, p.key, step);
          expect(v.length).toBeGreaterThan(1);
          if (prev) {
            const a = [...prev].sort((x, y) => x - y);
            v.forEach((n, i) => expect(Math.abs(n - a[Math.min(i, a.length - 1)]!)).toBeLessThanOrEqual(12));
          }
          expect(v[v.length - 1]! - v[0]!).toBeLessThanOrEqual(14); // one hand
          prev = v;
        }
    }
  });

  it('keeps the bass in the low register', () => {
    for (const id of ids) for (const s of PIECES[id].chords) expect(bassNote(PIECES[id].key, s)).toBeGreaterThanOrEqual(34);
  });

  it('bounds humanisation by each instrument’s groove template, seeded', () => {
    const rng = new Rng(1);
    for (const v of Object.keys(GROOVE) as Voice[])
      for (let i = 0; i < 200; i++) {
        const h = humanise(rng, v, i / 200);
        const g = GROOVE[v];
        expect(h.offset * 1000).toBeGreaterThanOrEqual(g.late - g.jitter - 1e-9);
        expect(h.offset * 1000).toBeLessThanOrEqual(g.late + g.jitter + 1e-9);
        expect(h.vel).toBeGreaterThan(0);
        expect(h.vel).toBeLessThanOrEqual(1);
      }
    // the snare sits behind the kick (laid back)
    expect(GROOVE.snare.late - GROOVE.snare.jitter).toBeGreaterThanOrEqual(GROOVE.kick.late);
    expect(phraseCurve(0.5)).toBeGreaterThan(phraseCurve(0));
  });
});

describe('the themes (prompt 11)', () => {
  it('fits every note of every piece and variation to its harmony', () => {
    for (const id of ids) {
      const p = PIECES[id];
      for (const v of new Set(PASS_ORDER)) {
        const line = variation(p, v);
        expect(line.length).toBeGreaterThan(4);
        line.forEach((x, i) => {
          const prev = line[i - 1],
            next = line[i + 1];
          const ok = noteFits(
            p.key + x.n,
            prev ? p.key + prev.n : null,
            next ? p.key + next.n : null,
            x.at === 0 || x.at === 4,
            p.key,
            p.chords[x.bar]!,
            p.mode,
          );
          expect(ok, `${id}/${v} bar ${x.bar} at ${x.at}: ${x.n}`).toBe(true);
          expect(x.at + x.len).toBeLessThanOrEqual(8);
        });
      }
    }
  });

  it('opens every piece with the same motif (falling, then back up a step)', () => {
    for (const id of ids) {
      const bar0 = PIECES[id].melody.filter((x) => x.bar === 0).map((x) => x.n);
      expect(bar0.length).toBe(4);
      expect(bar0[0]! > bar0[1]! && bar0[1]! > bar0[2]! && bar0[3]! > bar0[2]!).toBe(true);
    }
  });

  it('writes variations that differ from the theme', () => {
    for (const id of ids) {
      const theme = JSON.stringify(variation(PIECES[id], 'theme'));
      for (const v of ['altered', 'displaced', 'sequence'] as const) expect(JSON.stringify(variation(PIECES[id], v))).not.toBe(theme);
    }
  });
});

const mood = (hour: number, rain = 0, season: Mood['season'] = 'spring'): Mood => ({ hour, rain, season, activity: 0.5 });

describe('the music director (prompt 11)', () => {
  it('picks pieces for the time and weather', () => {
    expect(sceneFor(mood(7))).toBe('morning');
    expect(sceneFor(mood(14))).toBe('afternoon');
    expect(sceneFor(mood(19.5))).toBe('lastTrain');
    expect(sceneFor(mood(1, 0.8))).toBe('rainMidnight');
  });

  it('changes piece only on a phrase boundary after the minimum dwell, once, however the mood flips', () => {
    const d = new Director(new Rng(2));
    const changes: number[] = [];
    let last = d.piece;
    for (let i = 0; i < 64; i++) {
      // fast-forward: the hour jumps every bar
      const b = d.nextBar(i * 3.4, mood(i % 2 ? 7 : 14));
      if (b.piece !== last && last !== null) changes.push(i);
      last = b.piece;
    }
    // every change came at a bar index where the piece had dwelt MIN_DWELL bars and on an 8-bar line
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) expect(c % 8).toBe(0);
    for (let k = 1; k < changes.length; k++) expect(changes[k]! - changes[k - 1]!).toBeGreaterThanOrEqual(MIN_DWELL);
  });

  it('rests after a piece, then comes back with its theme', () => {
    const d = new Director(new Rng(3));
    let t = 0;
    const bars: (string | null)[] = [];
    for (let i = 0; i < 200; i++) {
      const b = d.nextBar(t, mood(14));
      bars.push(b.piece);
      t += 3.2;
    }
    const firstRest = bars.indexOf(null);
    expect(firstRest).toBeGreaterThan(0);
    const back = bars.findIndex((p, i) => i > firstRest && p !== null);
    expect(back).toBeGreaterThan(firstRest);
    expect((back - firstRest) * 3.2).toBeGreaterThanOrEqual(60 - 3.2); // a minute or more of silence
  });

  it('thins the drums and brings in a pad in rain, changing layers only on 4-bar lines', () => {
    expect(layersFor(mood(14, 0.8), 'afternoon').drums).toBeLessThan(layersFor(mood(14, 0), 'afternoon').drums);
    expect(layersFor(mood(14, 0.8), 'afternoon').pad).toBeGreaterThan(0.5);
    const d = new Director(new Rng(4));
    let prev = '';
    for (let i = 0; i < 24; i++) {
      const b = d.nextBar(i * 3, mood(14, i % 3 === 0 ? 0.9 : 0));
      const now = JSON.stringify(b.layers);
      if (i > 0 && now !== prev) expect(b.bar % 4).toBe(0);
      prev = now;
    }
  });

  it('keeps time on its own clock: bars never drift, whatever the simulation does', () => {
    const c = new BarClock();
    c.start(10, 70);
    let t = 0;
    for (let i = 0; i < (70 * 10) / 4; i++) t = c.next(); // ten minutes of bars
    expect(t).toBeCloseTo(10 + ((70 * 10) / 4 - 1) * (240 / 70), 9);
  });
});
