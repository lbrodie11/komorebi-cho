import type { AudioEngine } from './engine';
import { mtof } from './engine';
import { bassNote, humanise, voiceLead, type Voice } from './theory';
import { PIECES, variation, type PieceId, type ThemeNote, type VariationId } from './themes';
import { BarClock, Director, type Layers, type Mood } from './director';
import { stream } from '../core/rng';
import type { Season } from '../core/clock';

export interface MusicState {
  hour: number;
  rain: number;
  season: Season;
  /** How busy the street is, 0..1 (more people out: a little more drum). */
  activity?: number;
}

/** Seconds of music scheduled ahead of the audio clock ("A Tale of Two Clocks"). */
const LOOKAHEAD = 0.3;
/** A bar of silence while resting (only the soundscape). */
const REST_BAR = 4;

/**
 * The score (prompt 11): authored pieces (themes.ts) played by five instruments, arranged by the
 * Music Director (director.ts) on the music's own clock. The simulation only tells it the mood:
 * fast-forward and time jumps never change its tempo or cut a phrase. Each bar is scheduled whole,
 * at a computed time (no drift): chords voice-led from the last, the melody from the theme or one
 * of its variations, the bass from the root, drums with per-instrument grooves, all humanised from
 * a named stream. Layers (drums, rain pad, bass, keys, lead) follow the director, on 4-bar lines.
 */
export class Music {
  private timer: number | null = null;
  private state: MusicState = { hour: 9, rain: 0, season: 'spring' };
  private readonly director = new Director(stream('audio/director'));
  private readonly rng = stream('audio/music');
  private readonly clock = new BarClock();
  private playing: PieceId | null = null;
  private nextBar = 0;
  private voicing: number[] | null = null;
  private line: { variation: VariationId; notes: ThemeNote[] } | null = null;
  /** Layer buses: what the director turns up and down. */
  private readonly bus: Record<keyof Layers, GainNode>;
  private readonly tremolo: GainNode;
  private readonly crackle: GainNode;
  private readonly plucks = new Map<string, AudioBuffer>();
  private readonly drive: WaveShaperNode;

  constructor(private readonly a: AudioEngine) {
    const c = a.ctx;
    const mk = (g: number) => {
      const n = c.createGain();
      n.gain.value = g;
      n.connect(a.music);
      return n;
    };
    this.bus = { drums: mk(0), pad: mk(0), bass: mk(0), keys: mk(0), lead: mk(0) };
    // the electric piano's soft tremolo: one LFO shared by every EP voice
    const lfo = c.createOscillator();
    lfo.frequency.value = 4.6;
    this.tremolo = c.createGain();
    this.tremolo.gain.value = 0.1;
    lfo.connect(this.tremolo);
    lfo.start();
    // the bass's gentle saturation
    this.drive = c.createWaveShaper();
    this.drive.curve = saturate(1.6);
    this.drive.connect(this.bus.bass);
    // vinyl crackle: sparse and quiet (it tires the ear)
    this.crackle = c.createGain();
    this.crackle.gain.value = 0.018;
    const cr = c.createBufferSource();
    cr.buffer = this.crackleBuffer();
    cr.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    cr.connect(hp).connect(this.crackle).connect(a.music);
    cr.start();
  }

  setState(s: MusicState): void {
    this.state = s;
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextBar = this.a.now + 0.2;
    this.playing = null;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private get mood(): Mood {
    return { hour: this.state.hour, rain: this.state.rain, season: this.state.season, activity: this.state.activity ?? 0.5 };
  }

  /**
   * Render the score offline (the soundtrack export): every bar up to `seconds`, scheduled at once on
   * an OfflineAudioContext. The same bars, the same instruments, the same named streams.
   */
  renderAhead(seconds: number): void {
    if (this.nextBar === 0) this.nextBar = 0.1;
    this.schedule(seconds);
  }

  /** Schedule whole bars ahead of the audio clock. */
  private schedule(until = this.a.now + LOOKAHEAD): void {
    while (this.nextBar < until) {
      const at = this.nextBar;
      const bar = this.director.nextBar(at, this.mood);
      this.setLayers(bar.layers, at);
      if (!bar.piece) {
        // resting: only the soundscape (the next bar is asked for after a beat of silence)
        this.playing = null;
        this.nextBar = at + REST_BAR;
        continue;
      }
      if (bar.piece !== this.playing || bar.bar === 0) {
        // a new piece (or a fresh start of one) begins a new tempo epoch, on this bar line
        this.playing = bar.piece;
        this.clock.start(at, PIECES[bar.piece].bpm);
        this.clock.next();
        this.shade(bar.piece, at);
      } else this.clock.next();
      this.playBar(bar.piece, bar.bar, bar.variation, at);
      this.nextBar = this.clock.following;
    }
  }

  /** Lofi filter and reverb, by season and hour (the score's colour). */
  private shade(piece: PieceId, t: number): void {
    const s = this.state;
    const night = s.hour >= 20 || s.hour < 5;
    this.a.lofi.frequency.setTargetAtTime(s.rain > 0.5 ? 2400 : night ? 3000 : s.season === 'summer' ? 5200 : s.season === 'autumn' ? 3300 : 4200, t, 3);
    this.a.musicVerb.gain.setTargetAtTime(s.season === 'winter' ? 1.25 : piece === 'rainMidnight' ? 1.1 : night ? 0.85 : 0.55, t, 3);
  }

  private setLayers(l: Layers, t: number): void {
    for (const k of Object.keys(this.bus) as (keyof Layers)[]) this.bus[k].gain.setTargetAtTime(l[k] * LAYER_GAIN[k], t, 1.2);
  }

  /** One bar: chord, bass, melody, drums, pad. */
  private playBar(id: PieceId, bar: number, v: VariationId, t: number): void {
    const p = PIECES[id];
    const eighth = 60 / p.bpm / 2;
    const swing = id === 'afternoon' ? 0.16 : 0.12;
    const at = (e: number) => t + e * eighth + (e % 2 ? eighth * swing : 0);
    const step = p.chords[bar % 8]!;
    const pos = (bar % 8) / 8;
    // the chord, voice-led from the last
    this.voicing = voiceLead(this.voicing, p.key, step);
    const comp = (n: number, at0: number, v0: number, d: number, out: AudioNode) =>
      p.comp === 'ep' ? this.epiano(n, at0, v0, d, out) : this.piano(n, at0, v0, d, out);
    for (const [i, n] of this.voicing.entries()) {
      const h = humanise(this.rng, 'keys', pos);
      comp(n, at(0) + h.offset + (p.comp === 'piano' ? i * 0.022 : 0), h.vel * 0.8, eighth * 7, this.bus.keys);
    }
    if (this.rng.chance(0.35)) {
      const h = humanise(this.rng, 'keys', pos);
      const top = this.voicing[this.voicing.length - 1]!;
      comp(top, at(3) + h.offset, h.vel * 0.5, eighth * 2, this.bus.keys);
    }
    // bass: the root on one, the root an octave up or a fifth later in the bar
    const b = bassNote(p.key, step);
    const hb = humanise(this.rng, 'bass', pos);
    this.bass(b, at(0) + hb.offset, hb.vel, eighth * (p.drums === 'boom' ? 3 : 6));
    if (p.drums === 'boom' || this.rng.chance(0.4)) {
      const h2 = humanise(this.rng, 'bass', pos);
      this.bass(b + (this.rng.chance(0.5) ? 7 : 12), at(p.drums === 'boom' ? 5 : 6) + h2.offset, h2.vel * 0.8, eighth * 2);
    }
    // the melody: the theme or one of its variations (new each pass)
    if (!this.line || this.line.variation !== v || bar % 8 === 0) this.line = { variation: v, notes: variation(p, v) };
    const lead = (n: number, at0: number, v0: number, d: number, out: AudioNode) =>
      p.lead === 'ep' ? this.epiano(n, at0, v0, d, out) : p.lead === 'pluck' ? this.pluck(n, at0, v0, d, out) : this.piano(n, at0, v0, d, out);
    for (const x of this.line.notes) {
      if (x.bar !== bar % 8) continue;
      // later passes breathe: a note left out now and then (never the motif in bar 0)
      if (bar >= 8 && x.bar !== 0 && this.rng.chance(id === 'rainMidnight' ? 0.3 : 0.12)) continue;
      const h = humanise(this.rng, p.lead === 'pluck' ? 'pluck' : 'melody', pos);
      lead(p.key + x.n, at(x.at) + h.offset, h.vel, eighth * x.len * 1.3, this.bus.lead);
    }
    // the rain pad: the chord, sustained, soft (its layer is silent unless it rains or it's winter)
    this.pad(this.voicing, t, eighth * 8);
    // drums, each with its own groove
    if (p.drums) this.drumBar(p.drums, at, pos);
  }

  private drumBar(kind: 'brush' | 'boom', at: (e: number) => number, pos: number): void {
    const play: Record<Voice, ((t: number, v: number) => void) | null> = {
      kick: (t, v) => this.kick(t, v),
      snare: (t, v) => this.snare(t, v),
      rim: (t, v) => this.rim(t, v),
      hat: (t, v) => this.hat(t, v),
      brush: (t, v) => this.brush(t, v),
      keys: null,
      melody: null,
      bass: null,
      pluck: null,
    };
    const hit = (voice: Voice, e: number) => {
      const h = humanise(this.rng, voice, pos);
      play[voice]?.(at(e) + h.offset, h.vel);
    };
    if (kind === 'boom') {
      hit('kick', 0);
      if (this.rng.chance(0.5)) hit('kick', 3);
      hit('kick', 5);
      hit('snare', 2);
      hit('snare', 6);
      for (let e = 0; e < 8; e++) hit('hat', e);
    } else {
      hit('kick', 0);
      hit('brush', 2);
      hit('brush', 6);
      if (this.rng.chance(0.4)) hit('rim', 7);
      for (let e = 0; e < 8; e += 2) hit('hat', e);
    }
  }

  // ── Instruments ──────────────────────────────────────────────────────────

  /** Electric piano: 2-operator FM, the index shaped by an envelope and by velocity (harder = brighter). */
  private epiano(midi: number, t: number, vel: number, dur: number, out: AudioNode): void {
    const c = this.a.ctx;
    const f = mtof(midi);
    const car = c.createOscillator();
    car.frequency.value = f;
    const mod = c.createOscillator();
    mod.frequency.value = f;
    const index = c.createGain();
    const peak = f * (0.8 + vel * 2.2);
    index.gain.setValueAtTime(peak, t);
    index.gain.setTargetAtTime(f * 0.25, t + 0.005, 0.25);
    mod.connect(index).connect(car.frequency);
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.16, t + 0.006);
    amp.gain.setTargetAtTime(vel * 0.07, t + 0.01, 0.4);
    amp.gain.setTargetAtTime(0, t + Math.max(dur, 0.15), 0.25);
    const trem = c.createGain();
    trem.gain.value = 1;
    this.tremolo.connect(trem.gain);
    car.connect(amp).connect(trem).connect(out);
    const end = t + Math.max(dur, 0.15) + 1.5;
    for (const o of [car, mod]) {
      o.start(t);
      o.stop(end);
    }
    car.onended = () => {
      try {
        this.tremolo.disconnect(trem.gain);
      } catch {
        /* already gone */
      }
      trem.disconnect();
    };
  }

  /** Felt piano: soft hammer, warm partials, decay that shortens up the keyboard. */
  private piano(midi: number, t: number, vel: number, dur: number, out: AudioNode): void {
    const c = this.a.ctx;
    const f = mtof(midi);
    const decay = 1.2 + (Math.max(0, 84 - midi) / 24) * 2.2;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.2, t + 0.012); // felt: a slower attack than a bare hammer
    env.gain.setTargetAtTime(0.0001, t + 0.012, decay / 4);
    env.gain.setTargetAtTime(0, t + Math.max(dur, 0.15), 0.2);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700 + vel * 2600, t);
    lp.frequency.setTargetAtTime(500 + vel * 600, t + 0.02, 0.6);
    lp.connect(env).connect(out);
    const end = t + Math.max(dur, 0.15) + 1.2;
    for (const [mul, g] of [
      [1, 1],
      [1.0018, 0.45],
      [2, 0.3],
      [3.004, 0.1],
    ] as const) {
      const o = c.createOscillator();
      o.frequency.value = f * mul;
      const og = c.createGain();
      og.gain.value = g;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(end);
    }
    // the felt: a very soft, low thump rather than a click
    const h = this.a.noise(true, false);
    const hb = c.createBiquadFilter();
    hb.type = 'lowpass';
    hb.frequency.value = 900;
    const hg = c.createGain();
    hg.gain.setValueAtTime(vel * 0.03, t);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    h.connect(hb).connect(hg).connect(env);
    h.start(t, this.a.noiseOffset(), 0.05);
  }

  /** Bass: rounded (sine and a little triangle), a soft attack, gently saturated, steady low end. */
  private bass(midi: number, t: number, vel: number, dur: number): void {
    const c = this.a.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.22, t + 0.025);
    g.gain.setTargetAtTime(vel * 0.15, t + 0.05, 0.3);
    g.gain.setTargetAtTime(0, t + dur, 0.12);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.connect(g).connect(this.drive);
    for (const [type, mix] of [
      ['sine', 1],
      ['triangle', 0.25],
    ] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = mtof(midi);
      const m = c.createGain();
      m.gain.value = mix;
      o.connect(m).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.8);
    }
  }

  /** A warm, short pluck (Karplus–Strong, rendered once per pitch: no feedback loop is short enough in Web Audio). */
  private pluck(midi: number, t: number, vel: number, _dur: number, out: AudioNode): void {
    const c = this.a.ctx;
    const muted = this.playing === 'afternoon';
    const key = `${midi}|${muted}`;
    let buf = this.plucks.get(key);
    if (!buf) this.plucks.set(key, (buf = karplus(c, mtof(midi), muted ? 0.45 : 1.4, muted ? 0.45 : 0.5)));
    const s = c.createBufferSource();
    s.buffer = buf;
    const g = c.createGain();
    g.gain.value = vel * 0.5;
    s.connect(g).connect(out);
    s.start(t);
  }

  /** The rain/winter pad: the chord, slow attack and release, through a dark filter. */
  private pad(voicing: readonly number[], t: number, dur: number): void {
    if (this.bus.pad.gain.value < 0.01 && this.state.rain < 0.2 && this.state.season !== 'winter') return;
    const c = this.a.ctx;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur * 1.1);
    lp.connect(g).connect(this.bus.pad);
    for (const n of voicing)
      for (const d of [-6, 6]) {
        const o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(n);
        o.detune.value = d;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur * 1.2);
      }
  }

  private kick(t: number, v: number): void {
    const c = this.a.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(v * 0.42, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); // dry: short
    o.connect(g).connect(this.bus.drums);
    o.start(t);
    o.stop(t + 0.25);
  }

  private snare(t: number, v: number): void {
    const c = this.a.ctx;
    const n = this.a.noise(false, false);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(v * 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(bp).connect(g).connect(this.bus.drums);
    n.start(t, this.a.noiseOffset(), 0.2);
    const o = c.createOscillator();
    o.frequency.value = 185;
    const og = c.createGain();
    og.gain.setValueAtTime(v * 0.12, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og).connect(this.bus.drums);
    o.start(t);
    o.stop(t + 0.1);
  }

  private rim(t: number, v: number): void {
    const c = this.a.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 420;
    const g = c.createGain();
    g.gain.setValueAtTime(v * 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(this.bus.drums);
    o.start(t);
    o.stop(t + 0.05);
  }

  private hat(t: number, v: number): void {
    const c = this.a.ctx;
    const n = this.a.noise(false, false);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000 + v * 2000; // a little texture: harder hits are brighter
    const g = c.createGain();
    g.gain.setValueAtTime(v * 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + v * 0.03);
    n.connect(hp).connect(g).connect(this.bus.drums);
    n.start(t, this.a.noiseOffset(), 0.08);
  }

  private brush(t: number, v: number): void {
    const c = this.a.ctx;
    const n = this.a.noise(true, false);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * 0.2, t + 0.03); // a swish, not a hit
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    n.connect(bp).connect(g).connect(this.bus.drums);
    n.start(t, this.a.noiseOffset(), 0.3);
  }

  private crackleBuffer(): AudioBuffer {
    const c = this.a.ctx;
    const len = c.sampleRate * 4;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    const r = stream('audio/crackle');
    for (let i = 0; i < len; i++) {
      d[i] = (r.next() * 2 - 1) * 0.01;
      if (r.next() < 0.00018) {
        const amp = r.next() * 0.6;
        for (let k = 0; k < 24 && i + k < len; k++) d[i + k] = (d[i + k] ?? 0) + amp * Math.exp(-k / 4) * (k % 2 ? -1 : 1);
      }
    }
    return b;
  }
}

/** Layer bus levels at full (the mix of the arrangement). */
const LAYER_GAIN: Record<keyof Layers, number> = { drums: 0.75, pad: 1, bass: 0.9, keys: 0.8, lead: 1 };

/** Gentle saturation for the bass. */
function saturate(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

/**
 * Karplus–Strong, rendered to a buffer: a burst of noise round a delay line the length of one
 * period, averaged each pass (the string losing its brightness). `damp` < 0.5 is a palm-muted string.
 */
export function karplus(c: BaseAudioContext, f: number, seconds: number, damp: number): AudioBuffer {
  const rate = c.sampleRate;
  const len = Math.floor(rate * seconds);
  const period = Math.max(2, Math.round(rate / f));
  const buf = c.createBuffer(1, len, rate);
  const out = buf.getChannelData(0);
  const ring = new Float32Array(period);
  const r = stream(`audio/pluck/${Math.round(f)}`);
  for (let i = 0; i < period; i++) ring[i] = r.next() * 2 - 1;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const k = i % period;
    const y = ring[k]!;
    // average with the previous sample: a lowpass each round trip; `damp` sets how fast it fades
    const next = (y + prev) * damp * 0.996;
    prev = y;
    ring[k] = next;
    out[i] = y * 0.6 * Math.min(1, i / 40);
  }
  return buf;
}
