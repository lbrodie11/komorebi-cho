import type { AudioEngine } from './engine';
import { stream } from '../core/rng';
import type { Season } from '../core/clock';
import { place, type Listener } from './spatial';
import { EventBudget, scapeLevels, type Density, type ScapeLevels } from './soundscape';
import { DOORS, SENTO, STREAM, TREES, VENDING } from '../world/layout';

/** What a caption names (shown in caption mode; the HUD words it as `caption.<kind>`). */
export type CaptionKind =
  | 'bell'
  | 'rain'
  | 'rainStops'
  | 'snowWind'
  | 'cicadas'
  | 'uguisu'
  | 'sparrows'
  | 'higurashi'
  | 'crickets'
  | 'crow'
  | 'bikeBell'
  | 'chime'
  | 'train'
  | 'waterfall'
  | 'bath'
  | 'radio'
  | 'kitchen'
  | 'vending'
  | 'shutter'
  | 'cup'
  | 'creak'
  | 'footsteps'
  | 'drips'
  | 'suzu';

export interface AmbienceState {
  hour: number;
  rain: number;
  /** How wet the street is (drips go on after the rain). */
  wet?: number;
  season: Season;
}

/** Neighbourhood sounds the simulation causes. */
export type LifeEvent = 'shutter' | 'cup' | 'creak' | 'footstep' | 'suzu';

/** The same kind of sound is captioned at most once in this many seconds. */
const CAPTION_GAP = 30;

/** Where the town's own sources are (world x, z). */
const WATERFALL = { x: STREAM.x, z: STREAM.z0 + 0.4 };
const BATH = { x: SENTO.x, z: SENTO.z };
const CHIMNEY = { x: SENTO.chimney.x, z: SENTO.chimney.z };

/** What each emitter is called in captions. */
const EMITTER_CAPTION = {
  waterfall: 'waterfall',
  pond: 'waterfall',
  bath: 'bath',
  radio: 'radio',
  kitchen: 'kitchen',
  vending: 'vending',
} as const satisfies Record<string, CaptionKind>;

interface Emitter {
  x: number;
  z: number;
  /** Its level before distance (0..1, set by the moment). */
  level: number;
  gain: GainNode;
  lp: BiquadFilterNode;
  pan: StereoPannerNode;
}

/**
 * The soundscape (prompt 11): sound as part of the place, positioned. A listener sits at the camera's
 * focus; every source pans and fades from where it really is (spatial.ts). Fixed emitters (the
 * waterfall and pond, the bathhouse's water, the kissaten's radio, the ramen kitchen, a vending
 * machine's hum) are always there, louder the closer you look. Rain comes in layers (scapeLevels).
 * Creatures and the neighbourhood's own sounds are one-shots from where they happen, through a
 * density budget. A distant commuter train passes, rarely, behind the buildings. Japan's
 * "100 Soundscapes" list is the reference for treating everyday sound as part of a place; the
 * clichés (constant shamisen, frequent temple bells, market chatter) stay out.
 */
export class Ambience {
  private readonly rng = stream('audio/ambience');
  private state: AmbienceState = { hour: 9, rain: 0, season: 'spring' };
  private levels: ScapeLevels = scapeLevels({ hour: 9, rain: 0, wet: 0, season: 'spring' });
  private listener: Listener = { x: 0, z: 0, yaw: Math.PI / 4, zoom: 1 };
  private timer: number | null = null;
  /** Called with each sound worth captioning, at most once per CAPTION_GAP seconds per kind. */
  onCaption: ((kind: CaptionKind) => void) | null = null;
  private readonly lastCaption = new Map<CaptionKind, number>();
  private readonly budget = new EventBudget();
  private readonly beds: Record<'rainfall' | 'roofs' | 'leaves' | 'wetGround' | 'wind' | 'cicadas', GainNode>;
  private readonly emitters: Record<'waterfall' | 'pond' | 'bath' | 'radio' | 'kitchen' | 'vending', Emitter>;
  private wasRaining = false;
  /** Which emitters were loud enough to name last time (a caption when one comes within earshot). */
  private readonly heard = new Set<string>();
  private wasCicadas = false;
  /** Where the birds you can see are (world x, z): their calls come from them. Null: not told yet. */
  private birds: { sparrows: readonly (readonly [number, number])[]; crows: readonly (readonly [number, number])[] } | null = null;
  /** The wind's gust, 0..1, easing toward a new strength every few seconds (never a steady hiss). */
  private gust = 0.3;
  private gustGoal = 0.3;
  private next = { bird: 0, insect: 0, crow: 0, bike: 0, drip: 0, train: 0, closeDrop: 0, gust: 0 };

  constructor(private readonly a: AudioEngine) {
    const c = a.ctx;
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const bed = (pink: boolean, ...chain: AudioNode[]) => {
      const src = a.noise(pink);
      const g = c.createGain();
      g.gain.value = 0;
      let n: AudioNode = src;
      for (const x of chain) n = n.connect(x);
      n.connect(g).connect(a.ambience);
      src.start(0, a.noiseOffset());
      return g;
    };
    // rain as layers: broad rainfall, a brighter patter on the roofs, the leaves, wet ground
    this.beds = {
      rainfall: bed(true, filt('highpass', 280), filt('lowpass', 1400)),
      roofs: bed(false, filt('bandpass', 4200, 0.8)),
      leaves: bed(true, filt('bandpass', 2200, 0.9)),
      wetGround: bed(true, filt('bandpass', 600, 0.6)),
      wind: bed(true, filt('lowpass', 420)),
      cicadas: this.cicadaBed(),
    };
    // the fixed emitters, each a loop with its own filter, gain and pan
    const emitter = (x: number, z: number, src: AudioNode, out: AudioNode = a.ambience): Emitter => {
      const lp = filt('lowpass', 8000);
      const gain = c.createGain();
      gain.gain.value = 0;
      const pan = c.createStereoPanner();
      src.connect(lp).connect(gain).connect(pan).connect(out);
      return { x, z, level: 0, gain, lp, pan };
    };
    const loop = (pink: boolean, ...chain: AudioNode[]) => {
      const s = a.noise(pink);
      let n: AudioNode = s;
      for (const x of chain) n = n.connect(x);
      s.start(0, a.noiseOffset());
      return n;
    };
    // the radio in the kissaten: the score itself, small and boxy, bleeding from the door
    const radio = c.createGain();
    radio.gain.value = 0.5;
    a.lofi.connect(radio);
    const radioBox = filt('bandpass', 1300, 1.1);
    radio.connect(radioBox);
    // a vending machine's hum: a low tone and a faint whine
    const hum = c.createGain();
    for (const [f, g] of [
      [100, 0.6],
      [6200, 0.05],
    ] as const) {
      const o = c.createOscillator();
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = g;
      o.connect(og).connect(hum);
      o.start();
    }
    this.emitters = {
      waterfall: emitter(WATERFALL.x, WATERFALL.z, loop(false, filt('bandpass', 1100, 0.5))),
      pond: emitter(3, 2, loop(true, filt('bandpass', 700, 1.4))),
      bath: emitter(BATH.x, BATH.z, loop(false, filt('bandpass', 1800, 0.9))),
      radio: emitter(DOORS.kissaten!.x, DOORS.kissaten!.z, radioBox, a.room),
      kitchen: emitter(DOORS.ramen!.x, DOORS.ramen!.z, loop(false, filt('bandpass', 5200, 2))), // the hiss of the stock pot
      vending: emitter(VENDING[0]!.x, VENDING[0]!.z, hum),
    };
  }

  private cicadaBed(): GainNode {
    const c = this.a.ctx;
    // band-limited noise amplitude-modulated at ~38 Hz
    const src = this.a.noise(false);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5600;
    bp.Q.value = 5;
    const am = c.createGain();
    am.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 38;
    const depth = c.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(am.gain);
    lfo.start();
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(am).connect(g).connect(this.a.ambience);
    src.start();
    return g;
  }

  /** Begin the creatures and the town's comings and goings. Idempotent. */
  start(): void {
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 120);
  }

  /** Stop scheduling: nothing runs while sound is off or the tab is hidden. */
  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** How busy the neighbourhood's sounds may get (Quiet / Balanced / Lively). */
  setDensity(d: Density): void {
    this.budget.density = d;
  }

  private caption(kind: CaptionKind): void {
    const now = this.a.now;
    if (now - (this.lastCaption.get(kind) ?? -Infinity) < CAPTION_GAP) return;
    this.lastCaption.set(kind, now);
    this.onCaption?.(kind);
  }

  /** Where the sparrows and crows in sight are: they are what you hear, from where they are. */
  setBirds(b: NonNullable<Ambience['birds']>): void {
    this.birds = b;
  }

  /** Where the camera is looking: every positioned source follows. */
  setListener(l: Listener): void {
    this.listener = l;
    this.placeEmitters();
  }

  setState(s: AmbienceState): void {
    this.state = s;
    const t = this.a.now;
    const L = (this.levels = scapeLevels({ hour: s.hour, rain: s.rain, wet: s.wet ?? s.rain, season: s.season }));
    // (the wind and the leaves ride the gusts: tick() sets them)
    for (const k of Object.keys(this.beds) as (keyof typeof this.beds)[])
      if (k !== 'wind' && k !== 'leaves') this.beds[k].gain.setTargetAtTime(L[k], t, k === 'rainfall' ? 1.2 : 2.5);
    const night = s.hour >= 21 || s.hour < 6;
    const em = this.emitters;
    em.waterfall.level = 0.09;
    em.pond.level = 0.03;
    em.bath.level = s.hour > 14 && s.hour < 23 ? 0.05 : 0.015; // the sento opens in the afternoon
    em.radio.level = s.hour > 7 && s.hour < 21 ? 0.35 : 0;
    em.kitchen.level = s.hour > 11 && s.hour < 23 ? 0.03 : 0;
    em.vending.level = night ? 0.03 : 0.012; // you hear it at night
    this.placeEmitters();
    const cicadas = L.cicadas > 0;
    if (cicadas && !this.wasCicadas) this.caption('cicadas');
    this.wasCicadas = cicadas;
    const raining = s.rain > 0.3;
    if (raining !== this.wasRaining) this.caption(raining ? (s.season === 'winter' ? 'snowWind' : 'rain') : 'rainStops');
    this.wasRaining = raining;
  }

  private placeEmitters(): void {
    const t = this.a.now;
    for (const [name, e] of Object.entries(this.emitters)) {
      const p = place(this.listener, e.x, e.z);
      e.gain.gain.setTargetAtTime(e.level * p.gain, t, 0.4);
      e.pan.pan.setTargetAtTime(p.pan, t, 0.4);
      e.lp.frequency.setTargetAtTime(p.cutoff, t, 0.4);
      // within earshot now: name it (once in a while)
      const loud = e.level > 0 && p.gain > 0.45;
      if (loud && !this.heard.has(name)) this.caption(EMITTER_CAPTION[name as keyof typeof EMITTER_CAPTION]);
      if (loud) this.heard.add(name);
      else this.heard.delete(name);
    }
  }

  /** Something in the neighbourhood made a sound, at (x, z): through the density budget, from where it happened. */
  event(kind: LifeEvent, x: number, z: number): void {
    const importance = kind === 'shutter' || kind === 'suzu' ? 0.8 : kind === 'footstep' ? 0.2 : 0.5;
    const t = this.a.now + 0.02;
    // too far to hear: it costs nothing (the budget is for what you'd actually hear)
    const at = place(this.listener, x, z);
    if (at.gain < 0.05 || !this.budget.allow(t, importance)) return;
    switch (kind) {
      case 'shutter':
        this.noiseHit(t, 2600, 0.6, 0.9, 0.08 * at.gain, at.pan, true);
        this.caption('shutter');
        break;
      case 'cup':
        this.ping(t, 3100, 0.18, 0.05 * at.gain, at.pan, this.a.room);
        this.ping(t + 0.07, 3900, 0.12, 0.03 * at.gain, at.pan, this.a.room);
        this.caption('cup');
        break;
      case 'creak':
        this.creak(t, 0.05 * at.gain, at.pan);
        this.caption('creak');
        break;
      case 'suzu':
        // the shrine's bell rope: a cluster of small bells, shaken twice
        for (const k of [0, 0.32])
          for (let i = 0; i < 5; i++) this.ping(t + k + this.rng.range(0, 0.06), this.rng.range(3300, 4300), 0.35, 0.02 * at.gain, at.pan, this.a.ambience);
        this.caption('suzu');
        break;
      case 'footstep':
        this.noiseHit(t, (this.state.wet ?? 0) > 0.3 ? 900 : 1600, 1.2, 0.08, 0.05 * at.gain, at.pan, false);
        if ((this.state.wet ?? 0) > 0.3) this.caption('footsteps');
        break;
    }
  }

  private tick(): void {
    const now = this.a.now;
    const { hour, rain, season } = this.state;
    const day = hour > 5.6 && hour < 18;
    const n = this.next;
    // the wind comes in gusts: a new strength every few seconds, eased to, and the leaves answer it
    if (now > n.gust) {
      n.gust = now + this.rng.range(4, 9);
      this.gustGoal = this.rng.chance(0.25) ? this.rng.range(0.7, 1) : this.rng.range(0.05, 0.5);
    }
    this.gust += (this.gustGoal - this.gust) * 0.04;
    this.beds.wind.gain.setTargetAtTime(this.levels.wind * (0.35 + 1.3 * this.gust), now, 0.6);
    this.beds.leaves.gain.setTargetAtTime(this.levels.leaves + (season === 'winter' ? 0 : 0.035 * this.gust * this.gust), now, 0.6);
    // birds: the sparrows you can see chirp from where they are (from a tree if nobody has said
    // where they are); the bush warbler sings unseen from a tree on spring mornings
    if (now > n.bird) {
      n.bird = now + this.rng.range(1.6, 6);
      if (day && rain < 0.3) {
        if (season === 'spring' && hour < 10.5 && this.rng.chance(0.25)) {
          const tree = this.rng.pick(TREES);
          const at = place(this.listener, tree.x, tree.z);
          this.uguisu(now, at.pan, at.gain);
          this.caption('uguisu');
        } else {
          const seen = this.birds?.sparrows;
          const from = seen ? (seen.length ? this.rng.pick(seen) : null) : season !== 'winter' ? [this.rng.pick(TREES).x, this.rng.pick(TREES).z] : null;
          if (from) {
            const at = place(this.listener, from[0], from[1]);
            this.sparrows(now, at.pan, at.gain);
            if (at.gain > 0.3 && this.rng.chance(0.2)) this.caption('sparrows');
          }
        }
      }
    }
    if (now > n.insect) {
      n.insect = now + this.rng.range(2.5, 7);
      const at = place(this.listener, this.rng.range(-7, 7), this.rng.range(-3, 8));
      if (season === 'summer' && hour > 17.4 && hour < 19.6) {
        this.higurashi(now, at.pan, at.gain);
        this.caption('higurashi');
      }
      if ((season === 'autumn' || season === 'summer') && (hour > 19.5 || hour < 4) && rain < 0.3) {
        this.suzumushi(now, at.pan, at.gain);
        this.caption('crickets');
      }
    }
    // crows over the bathhouse chimney at dusk
    if (now > n.crow) {
      n.crow = now + this.rng.range(14, 40);
      if (hour > 16.5 && hour < 18.8 && rain < 0.4) {
        // from a crow in the air, if any are up; else from over the chimney where they gather
        const up = this.birds?.crows.length ? this.rng.pick(this.birds.crows) : [CHIMNEY.x, CHIMNEY.z];
        const at = place(this.listener, up[0], up[1]);
        this.crow(now, at.pan, Math.max(0.35, at.gain));
        this.caption('crow');
      }
    }
    // a bicycle bell somewhere along the lane
    if (now > n.bike) {
      n.bike = now + this.rng.range(20, 60);
      if (hour > 7 && hour < 20 && rain < 0.3) {
        const at = place(this.listener, -9.25, this.rng.range(-4, 11));
        this.bikeBell(now, at.pan, at.gain);
        this.caption('bikeBell');
      }
    }
    // drips from the eaves and gutters: while it's wet, after the rain too
    if (this.levels.drips > 0.05 && now > n.drip) {
      n.drip = now + this.rng.range(0.4, 1.6) / this.levels.drips;
      const at = place(this.listener, this.rng.pick([-10.2, -9, 11, 2]), this.rng.range(-8, 9));
      this.drip(now + this.rng.range(0, 0.1), at.pan, at.gain);
      if (this.state.rain < 0.2) this.caption('drips');
    }
    // the odd close drop: on the camera's own patch of street
    if (this.state.rain > 0.4 && season !== 'winter' && now > n.closeDrop) {
      n.closeDrop = now + this.rng.range(3, 9);
      this.drip(now, this.rng.range(-0.4, 0.4), 1.6);
    }
    // a commuter train, rare, low and far, passing behind the buildings
    if (n.train === 0) n.train = now + this.rng.range(240, 600);
    if (now > n.train) {
      n.train = now + this.rng.range(420, 900);
      if (hour > 5.5 && hour < 24) {
        this.train(now);
        this.caption('train');
      }
    }
  }

  // ── Synthesised sources ─────────────────────────────────────────────────
  private out(pan: number, to: AudioNode = this.a.ambience): StereoPannerNode {
    const p = this.a.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(to);
    return p;
  }

  private chirp(t: number, f0: number, f1: number, dur: number, vol: number, pan: number): void {
    if (vol < 0.0008 || !this.a.claim(t - this.a.now + dur)) return; // inaudible, or over the voice budget
    const c = this.a.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private ping(t: number, f: number, dur: number, vol: number, pan: number, to: AudioNode): void {
    if (!this.a.claim(dur)) return;
    const c = this.a.ctx;
    const o = c.createOscillator();
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(pan, to));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseHit(t: number, f: number, q: number, dur: number, vol: number, pan: number, rolling: boolean): void {
    if (!this.a.claim(dur)) return;
    const c = this.a.ctx;
    const n = this.a.noise(false, false);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (rolling ? 0.15 : 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g).connect(this.out(pan));
    n.start(t, this.a.noiseOffset(), dur + 0.05);
    // only the shutter's roll ducks the music: a footstep a second would make it pump
    if (rolling) {
      this.a.duck(t);
      // a shutter's slats: a rattle riding the roll
      const lfo = c.createOscillator();
      lfo.frequency.value = 22;
      const d = c.createGain();
      d.gain.value = vol * 0.6;
      lfo.connect(d).connect(g.gain);
      lfo.start(t);
      lfo.stop(t + dur);
    }
  }

  private creak(t: number, vol: number, pan: number): void {
    if (!this.a.claim(0.4)) return;
    const c = this.a.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(190, t + 0.3);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(bp).connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + 0.4);
  }

  private sparrows(t: number, pan: number, gain: number): void {
    const n = this.rng.int(2, 5);
    for (let i = 0; i < n; i++) this.chirp(t + i * this.rng.range(0.09, 0.16), this.rng.range(3900, 4600), this.rng.range(2900, 3400), 0.06, 0.035 * gain, pan);
  }

  /** "Hoo... hokekyo": a long rising whistle then a quick falling flourish. */
  private uguisu(t: number, pan: number, gain: number): void {
    const c = this.a.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(1250, t);
    o.frequency.linearRampToValueAtTime(1500, t + 0.9);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03 * gain, t + 0.25);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + 1.05);
    const s = t + 1.15;
    this.chirp(s, 2300, 2000, 0.12, 0.03 * gain, pan);
    this.chirp(s + 0.16, 2600, 2100, 0.1, 0.03 * gain, pan);
    this.chirp(s + 0.3, 2200, 1700, 0.35, 0.03 * gain, pan);
  }

  /** Evening cicada "kana-kana-kana": fast pulses, falling in pitch. */
  private higurashi(t: number, pan: number, gain: number): void {
    for (let i = 0; i < 14; i++) this.chirp(t + i * 0.085, 4700 - i * 40, 4400 - i * 40, 0.06, 0.014 * (1 - i / 18) * gain, pan);
  }

  /** Bell cricket "riiin". */
  private suzumushi(t: number, pan: number, gain: number): void {
    for (let i = 0; i < 18; i++) this.chirp(t + i * 0.028, 4200, 4150, 0.022, 0.012 * gain, pan);
  }

  private crow(t: number, pan: number, gain: number): void {
    const c = this.a.ctx;
    const calls = this.rng.int(2, 3);
    for (let i = 0; i < calls; i++) {
      const s = t + i * 0.55;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(620, s);
      o.frequency.exponentialRampToValueAtTime(440, s + 0.32);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1300;
      bp.Q.value = 2.5;
      const g = c.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.03 * gain, s + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.38);
      o.connect(bp).connect(g).connect(this.out(pan));
      o.start(s);
      o.stop(s + 0.4);
    }
  }

  private bikeBell(t: number, pan: number, gain: number): void {
    for (const k of [0, 0.11]) {
      this.chirp(t + k, 2650, 2640, 0.5, 0.012 * gain, pan);
      this.chirp(t + k, 3950, 3940, 0.35, 0.006 * gain, pan);
    }
  }

  private drip(t: number, pan: number, gain: number): void {
    this.chirp(t, this.rng.range(1400, 2600), this.rng.range(700, 1200), 0.05, 0.015 * gain, pan);
  }

  /**
   * A commuter train far off behind the buildings: a low, muffled rumble with the wheels' rhythm,
   * moving across from one side to the other over half a minute. No horn, no announcement.
   */
  private train(t: number): void {
    const c = this.a.ctx;
    const dur = 28;
    const n = this.a.noise(true, true);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const clack = c.createGain();
    clack.gain.value = 0.6;
    const lfo = c.createOscillator();
    lfo.frequency.value = 2.3; // the joints in the rails
    const depth = c.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(clack.gain);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = c.createStereoPanner();
    const dir = this.rng.chance(0.5) ? 1 : -1;
    p.pan.setValueAtTime(-0.7 * dir, t);
    p.pan.linearRampToValueAtTime(0.7 * dir, t + dur);
    n.connect(lp).connect(clack).connect(g).connect(p).connect(this.a.ambience);
    n.start(t, this.a.noiseOffset());
    n.stop(t + dur);
    lfo.start(t);
    lfo.stop(t + dur);
  }

  /** Temple bell (bonshō): inharmonic partials, beating, very long decay. */
  bell(): void {
    this.caption('bell');
    const c = this.a.ctx;
    const t = this.a.now + 0.05;
    const f0 = 98;
    for (const [mul, g, dec] of [
      [1, 1, 9],
      [1.005, 0.6, 9],
      [2.0, 0.5, 6],
      [2.76, 0.35, 5],
      [5.4, 0.18, 3],
      [8.93, 0.08, 2],
    ] as const) {
      const o = c.createOscillator();
      o.frequency.value = f0 * mul;
      const gg = c.createGain();
      gg.gain.setValueAtTime(0, t);
      gg.gain.linearRampToValueAtTime(0.09 * g, t + 0.01);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(gg);
      gg.connect(this.a.ambience);
      gg.connect(this.a.fxVerb);
      o.start(t);
      o.stop(t + dec + 0.1);
    }
  }

  dispose(): void {
    this.stop();
  }
}
