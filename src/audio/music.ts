import type { AudioEngine } from './engine';
import { mtof } from './engine';
import { bassNote, humanise, voiceLead, type Voice } from './theory';
import { PIECES, variation, type Instrument, type PieceId, type ThemeNote, type VariationId } from './themes';
import { BarClock, Director, type Form, type Layers, type Mood } from './director';
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
 * Each piece has a shape (intro, body, breakdown, outro: director.formFor), chords that sometimes
 * arrive an eighth early, a bass that slides and walks up, ghost notes and fills, and the keys
 * pumping gently under the kick. The whole score runs through tape wow and flutter (engine.ts).
 */
export class Music {
  private timer: number | null = null;
  /** A piece begins (which, and when on the audio clock): the HUD names it, like a record sleeve. */
  onPiece: ((id: PieceId, at: number) => void) | null = null;
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
  private readonly side: GainNode;
  /** The chord for this bar was already played, pushed an eighth early, at the end of the last. */
  private pushed = false;
  private readonly tremolo: GainNode;
  /** The suitcase auto-panners, one per bus the Rhodes plays into. */
  private readonly autopan = new Map<AudioNode, StereoPannerNode>();
  private readonly crackle: GainNode;
  private readonly plucks = new Map<string, AudioBuffer>();
  private readonly drive: WaveShaperNode;

  constructor(private readonly a: AudioEngine) {
    const c = a.ctx;
    // the keys, the lead and the pad breathe with the kick (a gentle pump, the lo-fi sidechain);
    // the drums and the bass go straight through
    this.side = c.createGain();
    this.side.connect(a.music);
    const mk = (g: number, to: AudioNode) => {
      const n = c.createGain();
      n.gain.value = g;
      n.connect(to);
      return n;
    };
    this.bus = { drums: mk(0, a.music), pad: mk(0, this.side), bass: mk(0, a.music), keys: mk(0, this.side), lead: mk(0, this.side) };
    // the Rhodes suitcase's stereo tremolo: one slow LFO swinging the pan
    const lfo = c.createOscillator();
    lfo.frequency.value = 4.2;
    this.tremolo = c.createGain();
    this.tremolo.gain.value = 0.35;
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
        this.onPiece?.(bar.piece, at);
        this.pushed = false; // a new piece starts clean: nothing was leaned into
        this.clock.start(at, PIECES[bar.piece].bpm);
        this.clock.next();
        this.shade(bar.piece, at);
      } else this.clock.next();
      this.playBar(bar.piece, bar.bar, bar.variation, at, bar.form);
      this.nextBar = this.clock.following;
    }
  }

  /** Lofi filter and reverb, by season and hour (the score's colour). */
  private shade(piece: PieceId, t: number): void {
    const s = this.state;
    const night = s.hour >= 20 || s.hour < 5;
    this.a.lofi.frequency.setTargetAtTime(s.rain > 0.5 ? 2400 : night ? 3000 : s.season === 'summer' ? 5200 : s.season === 'autumn' ? 3300 : 4200, t, 3);
    this.a.musicVerb.gain.setTargetAtTime(s.season === 'winter' ? 1.25 : PIECES[piece].drums === null ? 1.1 : night ? 0.85 : 0.55, t, 3);
  }

  /** How far up the director has the drums (0..1). */
  private drumLevel = 0;

  private setLayers(l: Layers, t: number): void {
    this.drumLevel = l.drums;
    for (const k of Object.keys(this.bus) as (keyof Layers)[]) this.bus[k].gain.setTargetAtTime(l[k] * LAYER_GAIN[k], t, 1.2);
  }

  /** Play a note on one of the three keyed or stringed instruments. */
  private voice(kind: Instrument, midi: number, t: number, vel: number, dur: number, out: AudioNode, muted = false): void {
    if (kind === 'rhodes') this.rhodes(midi, t, vel, dur, out);
    else if (kind === 'guitar') this.guitar(midi, t, vel, out, muted);
    else this.piano(midi, t, vel, dur, out);
  }

  /** One bar: chord, bass, melody, drums, pad, as the piece's shape has it (intro, body, breakdown, outro). */
  private playBar(id: PieceId, bar: number, v: VariationId, t: number, form: Form): void {
    const p = PIECES[id];
    const eighth = 60 / p.bpm / 2;
    const swing = p.drums === 'boom' ? 0.16 : 0.12;
    const at = (e: number) => t + e * eighth + (e % 2 ? eighth * swing : 0);
    const step = p.chords[bar % 8]!;
    const next = p.chords[(bar + 1) % 8]!;
    const pos = (bar % 8) / 8;
    const last = bar >= p.passes * 8 - 1;
    // the chord, voice-led from the last. A guitar strums it (low string first), a piano rolls it a little.
    this.voicing = voiceLead(this.voicing, p.key, step);
    const roll = p.comp === 'guitar' ? 0.03 : p.comp === 'piano' ? 0.022 : 0;
    const chord = (notes: readonly number[], e: number, scale: number, len: number) => {
      for (const [i, n] of notes.entries()) {
        const h = humanise(this.rng, 'keys', pos);
        this.voice(p.comp, n, at(e) + h.offset + i * roll, h.vel * scale, eighth * len, this.bus.keys);
      }
    };
    // on the one (softer if it was already pushed in early), then now and then a second touch
    chord(this.voicing, 0, this.pushed ? 0.45 : 0.8, 7);
    this.pushed = false;
    if (this.rng.chance(0.35)) {
      const h = humanise(this.rng, 'keys', pos);
      this.voice(p.comp, this.voicing[this.voicing.length - 1]!, at(3) + h.offset, h.vel * 0.5, eighth * 2, this.bus.keys);
    }
    // the push: now and then the next bar's chord arrives an eighth early, the way a player leans in
    if (!last && form.section === 'body' && this.rng.chance(0.28)) {
      this.voicing = voiceLead(this.voicing, p.key, next);
      chord(this.voicing, 7, 0.6, 8);
      this.pushed = true;
    }
    // bass: the root on one (sometimes sliding up into it), the fifth or the octave later in the
    // bar, and now and then a step up into the next root
    if (form.bass > 0) {
      const b = bassNote(p.key, step);
      const hb = humanise(this.rng, 'bass', pos);
      this.bass(b, at(0) + hb.offset, hb.vel * form.bass, eighth * (p.drums === 'boom' ? 3 : 6), this.rng.chance(0.3));
      if (p.drums === 'boom' || this.rng.chance(0.4)) {
        const h2 = humanise(this.rng, 'bass', pos);
        this.bass(b + (this.rng.chance(0.5) ? 7 : 12), at(p.drums === 'boom' ? 5 : 6) + h2.offset, h2.vel * 0.8 * form.bass, eighth * 2, false);
      }
      if (!last && form.section === 'body' && this.rng.chance(0.3)) {
        const h3 = humanise(this.rng, 'bass', pos);
        this.bass(bassNote(p.key, next) - 1, at(7) + h3.offset, h3.vel * 0.55, eighth * 0.9, false);
      }
    }
    // the melody: the theme or one of its variations (new each pass)
    if (!this.line || this.line.variation !== v || bar % 8 === 0) this.line = { variation: v, notes: variation(p, v) };
    for (const x of this.line.notes) {
      if (x.bar !== bar % 8) continue;
      // later passes breathe: a note left out now and then (never the motif in bar 0)
      if (bar >= 8 && x.bar !== 0 && this.rng.chance(p.drums === null ? 0.3 : 0.12)) continue;
      const h = humanise(this.rng, p.lead === 'guitar' ? 'pluck' : 'melody', pos);
      this.voice(p.lead, p.key + x.n, at(x.at) + h.offset, h.vel, eighth * x.len * 1.3, this.bus.lead, p.drums === 'boom');
    }
    // the rain pad: the chord, sustained, soft (its layer is silent unless it rains or it's winter)
    this.pad(this.voicing, t, eighth * 8);
    // drums, each with its own groove
    if (p.drums && form.drums > 0) this.drumBar(p.drums, at, pos, form);
  }

  private drumBar(kind: 'brush' | 'boom', at: (e: number) => number, pos: number, form: Form): void {
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
    const hit = (voice: Voice, e: number, scale = 1) => {
      const h = humanise(this.rng, voice, pos);
      play[voice]?.(at(e) + h.offset, h.vel * scale * form.drums);
    };
    if (kind === 'boom') {
      hit('kick', 0);
      if (this.rng.chance(0.5)) hit('kick', 3);
      hit('kick', 5);
      hit('snare', 2);
      hit('snare', 6);
      // ghost notes: barely there, just before the backbeat
      if (this.rng.chance(0.4)) hit('snare', 1, 0.25);
      if (this.rng.chance(0.3)) hit('snare', 5, 0.22);
      // hats: the off-beats softer than the beats, so the eighths rock instead of ticking
      for (let e = 0; e < 8; e++) hit('hat', e, e % 2 ? 0.6 : 1);
      if (form.fill) {
        hit('snare', 7, 0.55);
        hit('kick', 7, 0.7);
      }
    } else {
      hit('kick', 0);
      hit('brush', 2);
      hit('brush', 6);
      if (this.rng.chance(0.4)) hit('rim', 7);
      if (this.rng.chance(0.25)) hit('kick', 5, 0.6);
      for (let e = 0; e < 8; e += 2) hit('hat', e);
      if (form.fill) {
        hit('rim', 5, 0.8);
        hit('brush', 7, 0.7);
      }
    }
  }

  // ── Instruments ──────────────────────────────────────────────────────────

  /**
   * Rhodes piano: a tine struck by a hammer, ringing over a tone bar.
   *  - the body: a warm 1:1 FM tone whose index decays, so it settles towards a sine (the tone bar);
   *  - the bark: struck harder, the index starts higher (more of the growl you hear in a Rhodes);
   *  - the tine: a short metallic "ding" on the attack (a high-ratio modulator, gone in ~50 ms);
   *  - two pickups: a second body a few cents sharp, so held notes shimmer slowly instead of sitting dead still;
   *  - the amp: a lowpass that opens with how hard the key is struck and closes as the note rings;
   *  - the suitcase: its stereo tremolo, the voice swinging gently between the speakers.
   * Low notes ring longer, as on the real instrument.
   */
  private rhodes(midi: number, t: number, vel: number, dur: number, out: AudioNode): void {
    const c = this.a.ctx;
    const f = mtof(midi);
    const ring = 1 + (Math.max(0, 76 - midi) / 24) * 1.6; // seconds-ish: lower rings longer
    const hold = Math.max(dur, 0.2);
    const end = t + hold + ring + 0.5;
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.17, t + 0.004);
    amp.gain.setTargetAtTime(vel * 0.05, t + 0.01, ring * 0.45);
    amp.gain.setTargetAtTime(0, t + hold, 0.22);
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    tone.frequency.setValueAtTime(1500 + vel * 4200, t);
    tone.frequency.setTargetAtTime(900 + vel * 900, t + 0.03, 0.5);
    tone.connect(amp).connect(this.suitcase(out));
    // the body (tone bar) twice, the second a few cents sharp and quieter, each with the bark in its index
    for (const [cents, level] of [
      [0, 1],
      [4, 0.45],
    ] as const) {
      const car = c.createOscillator();
      car.frequency.value = f;
      car.detune.value = cents;
      const mod = c.createOscillator();
      mod.frequency.value = f;
      mod.detune.value = cents;
      const index = c.createGain();
      index.gain.setValueAtTime(f * (0.25 + vel * vel * 1.9), t);
      index.gain.setTargetAtTime(f * 0.06, t + 0.004, 0.35);
      mod.connect(index).connect(car.frequency);
      const g = c.createGain();
      g.gain.value = level;
      car.connect(g).connect(tone);
      for (const o of [car, mod]) {
        o.start(t);
        o.stop(end);
      }
    }
    // the tine's ding
    const tine = c.createOscillator();
    tine.frequency.value = f;
    const tmod = c.createOscillator();
    tmod.frequency.value = f * 14;
    const tidx = c.createGain();
    tidx.gain.setValueAtTime(f * (0.6 + vel * 1.4), t);
    tidx.gain.setTargetAtTime(0, t + 0.002, 0.018);
    tmod.connect(tidx).connect(tine.frequency);
    const tamp = c.createGain();
    tamp.gain.setValueAtTime(vel * 0.06, t);
    tamp.gain.setTargetAtTime(0, t + 0.002, 0.045);
    tine.connect(tamp).connect(amp);
    for (const o of [tine, tmod]) {
      o.start(t);
      o.stop(t + 0.3);
    }
  }

  /** The suitcase's stereo tremolo for a bus: one auto-panner per destination, shared by every Rhodes voice. */
  private suitcase(out: AudioNode): AudioNode {
    let p = this.autopan.get(out);
    if (!p) {
      const pan = this.a.ctx.createStereoPanner();
      this.tremolo.connect(pan.pan);
      pan.connect(out);
      this.autopan.set(out, (p = pan));
    }
    return p;
  }

  /**
   * Felt piano: a soft hammer on real strings.
   *  - five partials, each a little sharp of a whole multiple (stiff strings), the higher ones
   *    quieter and dying sooner, so a note starts bright and settles to its fundamental;
   *  - two strings on the fundamental, a cent and a half apart: a slow, living beat;
   *  - struck harder, it is brighter (more of the upper partials, a wider filter);
   *  - the felt: a low thump instead of a click; low notes sit a little left, high ones right.
   */
  private piano(midi: number, t: number, vel: number, dur: number, out: AudioNode): void {
    const c = this.a.ctx;
    const f = mtof(midi);
    const decay = 1.2 + (Math.max(0, 84 - midi) / 24) * 2.2;
    const hold = Math.max(dur, 0.15);
    const end = t + hold + 1.2;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.17, t + 0.012); // felt: a slower attack than a bare hammer
    env.gain.setTargetAtTime(0.0001, t + 0.012, decay / 4);
    env.gain.setTargetAtTime(0, t + hold, 0.2);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700 + vel * 2600, t);
    lp.frequency.setTargetAtTime(500 + vel * 600, t + 0.02, 0.6);
    const pan = c.createStereoPanner();
    pan.pan.value = Math.max(-0.35, Math.min(0.35, (midi - 64) / 60));
    lp.connect(env).connect(pan).connect(out);
    const partial = (mul: number, level: number, tau: number, cents = 0) => {
      const o = c.createOscillator();
      o.frequency.value = f * mul;
      o.detune.value = cents;
      const g = c.createGain();
      g.gain.setValueAtTime(level, t);
      g.gain.setTargetAtTime(level * 0.12, t + 0.02, tau);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(end);
    };
    partial(1, 1, decay, 0);
    partial(1, 0.5, decay, 1.5); // the second string
    for (let k = 2; k <= PIANO_PARTIALS; k++) partial(k * Math.sqrt(1 + STIFFNESS * k * k), (0.42 * (0.5 + vel)) / k ** 1.5, decay / (k * 1.4));
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

  /**
   * Bass: rounded (sine and a little triangle), a soft attack, gently saturated, steady low end.
   * `slide`: it comes up into the note from a little under, as a finger does.
   */
  private bass(midi: number, t: number, vel: number, dur: number, slide: boolean): void {
    const c = this.a.ctx;
    const f = mtof(midi);
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
      if (slide) {
        o.frequency.setValueAtTime(f * 0.89, t); // two semitones under
        o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
      } else o.frequency.value = f;
      const m = c.createGain();
      m.gain.value = mix;
      o.connect(m).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.8);
    }
  }

  /**
   * Nylon-string guitar (Karplus–Strong, rendered once per pitch: no feedback loop is short enough
   * in Web Audio). Open, it rings for a couple of seconds; `muted`, it is the palm-muted chop of a
   * boom-bap loop. A lowpass that follows how hard it's plucked keeps soft notes round.
   */
  private guitar(midi: number, t: number, vel: number, out: AudioNode, muted: boolean): void {
    const c = this.a.ctx;
    const key = `${midi}|${muted}`;
    let buf = this.plucks.get(key);
    if (!buf) this.plucks.set(key, (buf = karplus(c, mtof(midi), muted ? 0.45 : 2.2, muted ? 0.45 : 0.5)));
    const s = c.createBufferSource();
    s.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400 + vel * 3800;
    const g = c.createGain();
    g.gain.value = vel * 0.5;
    s.connect(lp).connect(g).connect(out);
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
    // the beater: a tick of filtered noise, so the kick reads on small speakers too
    const n = this.a.noise(false, false);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(v * 0.05, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    n.connect(bp).connect(ng).connect(this.bus.drums);
    n.start(t, this.a.noiseOffset(), 0.03);
    // the keys duck under it and swell back: the pump
    const s = this.side.gain;
    // (only as far as the drums are actually up: in the rain they're faded out, and keys pumping
    // under a kick nobody hears would be a hiccup)
    s.setTargetAtTime(1 - PUMP * Math.min(1, v * 1.2) * this.drumLevel, t, 0.008);
    s.setTargetAtTime(1, t + 0.07, 0.11);
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

/** How far the keys dip under a full-strength kick (0.2: about −2 dB). */
export const PUMP = 0.2;
/** The felt piano: how many partials, and how stiff the strings are (each partial k is √(1 + B·k²) sharp). */
const PIANO_PARTIALS = 5;
const STIFFNESS = 0.0004;
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
 * Karplus–Strong, rendered to a buffer: a burst of noise round a delay line one period long,
 * averaged each pass (the string losing its brightness). `damp` < 0.5 is a palm-muted string.
 * The averaging adds half a sample to the loop and a whole-sample delay line can't hit most
 * pitches, so a first-order allpass makes up the fraction: the pluck is in tune with the Rhodes
 * (a plain rounded loop is up to ~20 cents flat this high up).
 */
export function karplus(c: Pick<BaseAudioContext, 'sampleRate' | 'createBuffer'>, f: number, seconds: number, damp: number): AudioBuffer {
  const rate = c.sampleRate;
  const len = Math.floor(rate * seconds);
  const P = rate / f; // the loop's whole length, in samples
  const N = Math.max(2, Math.floor(P - 0.6));
  const d = P - 0.5 - N; // what the allpass adds: 0.1..1.1 samples (stable, nearly flat)
  const C = (1 - d) / (1 + d);
  const buf = c.createBuffer(1, len, rate);
  const out = buf.getChannelData(0);
  const ring = new Float32Array(N);
  const r = stream(`audio/pluck/${Math.round(f)}`);
  for (let i = 0; i < N; i++) ring[i] = r.next() * 2 - 1;
  let prev = 0,
    apIn = 0,
    apOut = 0;
  for (let i = 0; i < len; i++) {
    const k = i % N;
    const y = ring[k]!;
    out[i] = y * 0.6 * Math.min(1, i / 40);
    // average with the previous sample: a lowpass each round trip; `damp` sets how fast it fades
    const lp = (y + prev) * damp * 0.996;
    prev = y;
    // the fractional part of the period
    const ap = C * lp + apIn - C * apOut;
    apIn = lp;
    apOut = ap;
    ring[k] = ap;
  }
  return buf;
}
