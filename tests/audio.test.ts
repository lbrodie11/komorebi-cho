import { describe, it, expect } from 'vitest';
import { GROOVE, bassNote, humanise, noteFits, phraseCurve, voiceLead, type Voice } from '../src/audio/theory';
import { PASS_ORDER, PIECES, variation, type PieceId } from '../src/audio/themes';
import { BarClock, Director, MIN_DWELL, formFor, layersFor, sceneFor, scenePool, type Mood } from '../src/audio/director';
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

describe('the pluck (prompt 11)', () => {
  /** The loop's period by autocorrelation, interpolated between samples. */
  const period = (x: Float32Array, guess: number): number => {
    const ac = (lag: number) => {
      let s = 0;
      for (let i = 400; i < 400 + 4000; i++) s += x[i]! * x[i + lag]!;
      return s;
    };
    let best = 0,
      bv = -Infinity;
    for (let lag = Math.floor(guess * 0.9); lag <= Math.ceil(guess * 1.1); lag++) {
      const v = ac(lag);
      if (v > bv) [best, bv] = [lag, v];
    }
    const [a, b, c] = [ac(best - 1), bv, ac(best + 1)];
    return best + (0.5 * (a - c)) / (a - 2 * b + c);
  };

  it('is in tune (within a few cents) from the middle of the keyboard up, at either sample rate', async () => {
    const { karplus } = await import('../src/audio/music');
    for (const rate of [44100, 48000])
      for (const midi of [60, 67, 72, 79, 84]) {
        const f = 440 * 2 ** ((midi - 69) / 12);
        const data = new Float32Array(Math.floor(rate * 0.5));
        const ctx = { sampleRate: rate, createBuffer: () => ({ getChannelData: () => data }) as unknown as AudioBuffer };
        karplus(ctx, f, 0.5, 0.5);
        const heard = rate / period(data, rate / f);
        expect(Math.abs(1200 * Math.log2(heard / f))).toBeLessThan(4);
      }
  });
});

describe('the album (eleven pieces, each with a shape)', () => {
  const m = (hour: number, rain = 0, season: Mood['season'] = 'spring'): Mood => ({ hour, rain, season, activity: 0.5 });

  it('has at least ten pieces, every one reachable from some hour, weather or season', () => {
    expect(ids.length).toBeGreaterThanOrEqual(10);
    const heard = new Set<string>();
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const)
      for (let h = 0; h < 24; h += 0.5) for (const rain of [0, 0.4, 0.9]) for (const p of scenePool(m(h, rain, season))) heard.add(p);
    expect([...heard].sort()).toEqual([...ids].sort());
  });

  it('keeps the Rhodes on some pieces, and gives the others a felt piano or a guitar', () => {
    const using = (i: string) => ids.filter((id) => PIECES[id].comp === i || PIECES[id].lead === i).length;
    expect(using('rhodes')).toBeGreaterThanOrEqual(4);
    expect(using('piano')).toBeGreaterThanOrEqual(4);
    expect(using('guitar')).toBeGreaterThanOrEqual(4);
    expect(ids.filter((id) => PIECES[id].comp !== 'rhodes' && PIECES[id].lead !== 'rhodes').length).toBeGreaterThanOrEqual(3);
  });

  it('never plays the same piece twice running where the hour offers another', () => {
    const d = new Director(new Rng(11));
    const played: string[] = [];
    let last: string | null = null;
    for (let i = 0, t = 0; i < 1200; i++, t += 3.2) {
      const b = d.nextBar(t, m(14));
      if (b.piece && b.bar === 0) played.push(b.piece);
      last = b.piece;
    }
    expect(last).not.toBeUndefined();
    expect(played.length).toBeGreaterThan(4);
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
    expect(new Set(played).size).toBe(3); // the whole afternoon pool, in time
  });

  it('shapes a piece like a record: keys alone to open, a fill into each pass, a bare breakdown, keys alone to close', () => {
    for (const id of ids) {
      const total = PIECES[id].passes * 8;
      expect(formFor(id, 0)).toMatchObject({ drums: 0, bass: 0, section: 'intro' });
      expect(formFor(id, 2).drums).toBeGreaterThan(0);
      expect(formFor(id, 2).drums).toBeLessThan(1);
      expect(formFor(id, total - 1)).toMatchObject({ drums: 0, section: 'outro' });
      expect(formFor(id, 5)).toMatchObject({ drums: 1, bass: 1, section: 'body' });
      if (PIECES[id].passes >= 3) {
        const lp = (PIECES[id].passes - 1) * 8;
        expect(formFor(id, 7).fill).toBe(true);
        expect(formFor(id, lp)).toMatchObject({ drums: 0, section: 'breakdown' });
        expect(formFor(id, lp + 3).fill).toBe(true); // the fill that brings the band back
        expect(formFor(id, lp + 4).drums).toBe(1);
      }
      // the same bar always plays the same way
      expect(formFor(id, 9)).toEqual(formFor(id, 9));
    }
  });
});
