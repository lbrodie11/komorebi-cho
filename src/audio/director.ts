/**
 * The Music Director (prompt 11): chooses what the score plays from the time of day, the weather,
 * the season and how busy the street is, and keeps it continuous. Pure (no Web Audio), so its rules
 * are tested:
 *  - The music has its own clock: it is asked once per bar, by the music scheduler, never by the
 *    simulation. Fast-forward and time jumps only change what it would *like* to play.
 *  - A different piece starts only on a 4-, 8- or 16-bar boundary (by urgency), after a minimum
 *    dwell, and never more than once per boundary however often the mood flips.
 *  - Small changes are vertical (layers: rain thins the drums and brings in a pad; the melody stays),
 *    applied on 4-bar boundaries. Big ones are horizontal (another piece, at a phrase end).
 *  - Silence is part of the score: after a piece ends, a minute or two of only the soundscape,
 *    then a piece returns with its theme.
 */
import type { Season } from '../core/clock';
import type { Rng } from '../core/rng';
import { PASS_ORDER, PIECES, type PieceId, type VariationId } from './themes';

export interface Mood {
  hour: number;
  rain: number;
  season: Season;
  /** How busy the street is, 0..1 (residents out and about). */
  activity: number;
}

/** Layer levels, 0..1: what's playing of the arrangement. */
export interface Layers {
  drums: number;
  pad: number;
  bass: number;
  keys: number;
  lead: number;
}

/** Bars a piece plays at least before another may replace it. */
export const MIN_DWELL = 16;
/** Seconds of only the soundscape after a piece ends. */
export const REST: readonly [number, number] = [60, 120];

/**
 * The pieces a moment calls for, the most fitting first. The director plays one, and after its rest
 * another from the same pool (never the same twice running where there's a choice), so an afternoon
 * has several tunes, not one on repeat. Pools for different parts of the day share nothing with
 * their neighbours where a switch should be heard (morning against afternoon).
 */
export function scenePool(m: Mood): readonly PieceId[] {
  const night = m.hour >= 22 || m.hour < 5;
  const winter = m.season === 'winter';
  if (m.rain > 0.5 && (night || m.hour >= 19)) return ['rainMidnight', 'puddles'];
  if (night) return m.rain > 0.2 ? ['rainMidnight', 'lanterns'] : winter ? ['lastTrain', 'lanterns', 'firstLight'] : ['lastTrain', 'lanterns'];
  if (m.rain > 0.6) return ['puddles', 'lastTrain', 'kissaten'];
  if (m.hour < 7) return ['firstLight', 'morning'];
  if (m.hour < 10.5) return winter ? ['morning', 'firstLight', 'laundry'] : ['morning', 'laundry'];
  if (m.hour < 17) return ['afternoon', 'kissaten', 'shortcut'];
  return ['lastTrain', 'bathhouse', 'kissaten'];
}

/** The piece a moment calls for first (its pool's lead). */
export function sceneFor(m: Mood): PieceId {
  return scenePool(m)[0]!;
}

/** Vertical layering: the same piece, thinner or fuller with the weather, the season and the street. */
export function layersFor(m: Mood, piece: PieceId): Layers {
  const p = PIECES[piece];
  const night = m.hour >= 21 || m.hour < 5;
  let drums = p.drums ? 1 - Math.min(1, m.rain * 1.4) : 0;
  if (night || m.season === 'winter') drums *= 0.35;
  drums *= 0.75 + 0.25 * m.activity;
  const pad = Math.min(1, m.rain * 1.2) + (m.season === 'winter' ? 0.3 : 0);
  const bass = m.season === 'summer' ? 1 : m.season === 'winter' ? 0.6 : 0.85;
  const lead = m.season === 'autumn' ? 0.8 : 1;
  return { drums, pad: Math.min(1, pad), bass, keys: 1, lead };
}

/** How soon a change of piece may come (bars): rain coming on is urgent, a season change isn't. */
export function boundaryFor(from: PieceId, to: PieceId, m: Mood): 4 | 8 | 16 {
  if (to === 'rainMidnight' && m.rain > 0.6) return 4;
  if (from === to) return 16;
  return 8;
}

/** How a bar is played within its piece's shape. */
export interface Form {
  /** Drums and bass, 0..1 (0: they sit out). */
  drums: number;
  bass: number;
  /** The last bar before the drums return or a new pass starts: a small fill. */
  fill: boolean;
  /** Where in the shape this bar is, for tests and the debug overlay. */
  section: 'intro' | 'body' | 'breakdown' | 'outro';
}

/**
 * A piece has a shape, like a record, not a loop (bars count from 0 across all its passes):
 *  - intro: two bars of keys and the motif alone, then two with the drums coming in softly;
 *  - body: the full band, with a small fill at the end of each 8-bar pass;
 *  - breakdown: in pieces of three passes or more, the first four bars of the last pass drop the
 *    drums and thin the bass, so the theme comes back bare before the band returns;
 *  - outro: the last two bars are keys and melody alone, into the silence that follows.
 * Pure: the same bar always plays the same way.
 */
export function formFor(piece: PieceId, bar: number): Form {
  const passes = PIECES[piece].passes;
  const total = passes * 8;
  if (bar < 2) return { drums: 0, bass: 0, fill: false, section: 'intro' };
  if (bar < 4) return { drums: 0.55, bass: 0.8, fill: false, section: 'intro' };
  if (bar >= total - 2) return { drums: 0, bass: bar === total - 2 ? 0.7 : 0, fill: false, section: 'outro' };
  const lastPass = (passes - 1) * 8;
  if (passes >= 3 && bar >= lastPass && bar < lastPass + 4) {
    // its last bar brings the drums back in under a fill
    const back = bar === lastPass + 3;
    return { drums: back ? 0.4 : 0, bass: 0.5, fill: back, section: 'breakdown' };
  }
  return { drums: 1, bass: 1, fill: bar % 8 === 7 && bar < total - 8, section: 'body' };
}

const REST_FORM: Form = { drums: 0, bass: 0, fill: false, section: 'outro' };

export interface Bar {
  /** What to play this bar, or nothing (a rest: only the soundscape). */
  piece: PieceId | null;
  /** Bar within the piece (0..), the chord is `bar % 8`. */
  bar: number;
  variation: VariationId;
  layers: Layers;
  /** Where this bar sits in the piece's shape (intro, body, breakdown, outro). */
  form: Form;
}

export class Director {
  /** The piece playing (null while resting), its bar, and when the rest ends (music-clock seconds). */
  piece: PieceId | null = null;
  bar = 0;
  private restUntil = 0;
  private layers: Layers | null = null;
  /** Pieces started, for tests and the debug overlay. */
  transitions = 0;

  constructor(private readonly rng: Rng) {}

  /**
   * The music scheduler asks at the start of every bar (`time` on the music's own clock, seconds).
   * The mood is whatever the world is now; only bar boundaries ever act on it.
   */
  nextBar(time: number, mood: Mood): Bar {
    const pool = scenePool(mood);
    const want = pool[0]!;
    if (this.piece === null) {
      // resting: come back when the rest is over, with a theme people know
      if (time >= this.restUntil) this.start(this.choose(pool), mood);
    } else {
      const p = PIECES[this.piece];
      const length = p.passes * 8;
      if (this.bar >= length) {
        // the piece is over: silence for a while
        this.piece = null;
        this.restUntil = time + this.rng.range(REST[0], REST[1]);
      } else if (!pool.includes(this.piece) && this.bar >= MIN_DWELL && this.bar % boundaryFor(this.piece, want, mood) === 0) {
        this.start(this.choose(pool), mood);
      }
    }
    if (this.piece === null) return { piece: null, bar: 0, variation: 'theme', layers: this.layersNow(mood, null), form: REST_FORM };
    const out: Bar = {
      piece: this.piece,
      bar: this.bar,
      variation: PASS_ORDER[Math.floor(this.bar / 8) % PASS_ORDER.length]!,
      layers: this.layersNow(mood, this.piece),
      form: formFor(this.piece, this.bar),
    };
    this.bar++;
    return out;
  }

  /** One of the pool, not the piece played last where there's another (seeded). */
  private choose(pool: readonly PieceId[]): PieceId {
    const fresh = pool.filter((p) => p !== this.last);
    return this.rng.pick(fresh.length ? fresh : pool);
  }
  private last: PieceId | null = null;

  private start(piece: PieceId, mood: Mood): void {
    this.last = piece;
    this.piece = piece;
    this.bar = 0;
    this.transitions++;
    this.layers = layersFor(mood, piece);
  }

  /** Layers change on 4-bar boundaries only (no flicker as the rain comes and goes). */
  private layersNow(mood: Mood, piece: PieceId | null): Layers {
    if (!piece) return { drums: 0, pad: 0, bass: 0, keys: 0, lead: 0 };
    if (!this.layers || this.bar % 4 === 0) this.layers = layersFor(mood, piece);
    return this.layers;
  }
}

/**
 * A bar clock that never drifts: bar n starts at `epoch + n × barSeconds`, computed, not accumulated.
 * A new piece (a new tempo) starts a new epoch at its first bar.
 */
export class BarClock {
  private epoch = 0;
  private bars = 0;
  barSeconds = 0;

  start(at: number, bpm: number): void {
    this.epoch = at;
    this.bars = 0;
    this.barSeconds = (4 * 60) / bpm;
  }
  /** When the next bar starts (and count it). */
  next(): number {
    return this.epoch + this.bars++ * this.barSeconds;
  }
  /** When the bar after the one just handed out starts (for a tempo change at a boundary). */
  get following(): number {
    return this.epoch + this.bars * this.barSeconds;
  }
}
