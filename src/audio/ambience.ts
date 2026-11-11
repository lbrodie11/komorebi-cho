import type { AudioEngine } from './engine';
import { Rng } from '../core/rng';
import type { Season } from '../core/clock';

/** What a caption names (shown in caption mode; the HUD words it). */
export type CaptionKind = 'bell' | 'rain' | 'rainStops' | 'snowWind' | 'cicadas' | 'uguisu' | 'sparrows' | 'higurashi' | 'crickets' | 'crow' | 'bikeBell';

export interface AmbienceState {
  hour: number;
  rain: number;
  season: Season;
}

/**
 * Soundscape as weather: six layers that come and go, never all at once.
 * Japan's "100 Soundscapes" list (Environment Agency, 1996) is the reference
 * for treating everyday sound as part of a place: temple bells, cicadas,
 * insects, water. All synthesised here.
 */
/** The same kind of sound is captioned at most once in this many seconds. */
const CAPTION_GAP = 30;

export class Ambience {
  private readonly rng = new Rng(808);
  private readonly rainGain: GainNode;
  private readonly hissGain: GainNode;
  private readonly windGain: GainNode;
  private readonly waterGain: GainNode;
  private readonly cicadaGain: GainNode;
  private state: AmbienceState = { hour: 9, rain: 0, season: 'spring' };
  private timer: number | null = null;
  /** Called with each sound worth captioning, at most once per CAPTION_GAP seconds per kind. */
  onCaption: ((kind: CaptionKind) => void) | null = null;
  private lastCaption = new Map<CaptionKind, number>();
  private wasRaining = false;
  private wasCicadas = false;
  private nextBird = 0;
  private nextInsect = 0;
  private nextCrow = 0;
  private nextBike = 0;
  private nextDrip = 0;

  constructor(private readonly a: AudioEngine) {
    const c = a.ctx;
    const mk = (pink: boolean, setup: (src: AudioBufferSourceNode) => AudioNode, level = 0) => {
      const src = a.noise(pink);
      const g = c.createGain();
      g.gain.value = level;
      setup(src).connect(g).connect(a.ambience);
      src.start();
      return g;
    };
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    this.rainGain = mk(true, (s) => s.connect(filt('highpass', 280)).connect(filt('lowpass', 1400)));
    this.hissGain = mk(false, (s) => s.connect(filt('bandpass', 3800, 0.6)));
    this.windGain = mk(true, (s) => s.connect(filt('lowpass', 420)));
    this.waterGain = mk(false, (s) => s.connect(filt('bandpass', 950, 0.5)), 0.035);
    // cicadas: band-limited noise amplitude-modulated at ~38 Hz
    const cic = a.noise(false);
    const bp = filt('bandpass', 5600, 5);
    const am = c.createGain();
    am.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 38;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(am.gain);
    lfo.start();
    this.cicadaGain = c.createGain();
    this.cicadaGain.gain.value = 0;
    cic.connect(bp).connect(am).connect(this.cicadaGain).connect(a.ambience);
    cic.start();
  }

  /** Begin the little creatures (birds, insects, bells). Idempotent. */
  start(): void {
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 120);
  }

  /** Stop scheduling creatures: nothing runs while sound is off or the tab is hidden. */
  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private caption(kind: CaptionKind): void {
    const now = this.a.now;
    if (now - (this.lastCaption.get(kind) ?? -Infinity) < CAPTION_GAP) return;
    this.lastCaption.set(kind, now);
    this.onCaption?.(kind);
  }

  setState(s: AmbienceState): void {
    this.state = s;
    const t = this.a.now;
    const r = s.rain;
    const winter = s.season === 'winter';
    this.rainGain.gain.setTargetAtTime(winter ? r * 0.05 : r * 0.55, t, 1.5);
    this.hissGain.gain.setTargetAtTime(winter ? 0 : r * 0.1, t, 1.5);
    this.windGain.gain.setTargetAtTime(0.05 + (winter ? 0.18 : 0) + r * 0.12, t, 2);
    const day = s.hour > 8 && s.hour < 17.5;
    const cicadas = s.season === 'summer' && day && r < 0.3;
    this.cicadaGain.gain.setTargetAtTime(cicadas ? 0.06 + Math.sin(t * 0.05) * 0.03 : 0, t, 3);
    if (cicadas && !this.wasCicadas) this.caption('cicadas');
    this.wasCicadas = cicadas;
    const raining = r > 0.3;
    if (raining !== this.wasRaining) this.caption(raining ? (winter ? 'snowWind' : 'rain') : 'rainStops');
    this.wasRaining = raining;
  }

  private tick(): void {
    const now = this.a.now;
    const { hour, rain, season } = this.state;
    const day = hour > 5.6 && hour < 18;
    // birds: sparrows most of the year; the bush warbler (uguisu) on spring mornings
    if (now > this.nextBird) {
      this.nextBird = now + this.rng.range(1.6, 6);
      if (day && rain < 0.3 && season !== 'winter') {
        if (season === 'spring' && hour < 10.5 && this.rng.chance(0.25)) {
          this.uguisu(now);
          this.caption('uguisu');
        } else this.sparrows(now);
      }
    }
    if (now > this.nextInsect) {
      this.nextInsect = now + this.rng.range(2.5, 7);
      if (season === 'summer' && hour > 17.4 && hour < 19.6) {
        this.higurashi(now);
        this.caption('higurashi');
      }
      if ((season === 'autumn' || season === 'summer') && (hour > 19.5 || hour < 4) && rain < 0.3) {
        this.suzumushi(now);
        this.caption('crickets');
      }
    }
    if (now > this.nextCrow) {
      this.nextCrow = now + this.rng.range(14, 40);
      if (hour > 16.5 && hour < 18.8 && rain < 0.4) {
        this.crow(now);
        this.caption('crow');
      }
    }
    if (now > this.nextBike) {
      this.nextBike = now + this.rng.range(20, 60);
      if (hour > 7 && hour < 20 && rain < 0.3) {
        this.bikeBell(now);
        this.caption('bikeBell');
      }
    }
    if (rain > 0.2 && season !== 'winter' && now > this.nextDrip) {
      this.nextDrip = now + this.rng.range(0.08, 0.5) / rain;
      this.drip(now + this.rng.range(0, 0.1));
    }
  }

  // ── Little synthesised creatures ─────────────────────────────────────────
  private chirp(t: number, f0: number, f1: number, dur: number, vol: number, pan: number): void {
    if (!this.a.claim(t - this.a.now + dur)) return; // over the voice budget: this chirp is skipped
    const c = this.a.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.a.ambience);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private sparrows(t: number): void {
    const pan = this.rng.range(-0.8, 0.8);
    const n = this.rng.int(2, 5);
    for (let i = 0; i < n; i++) this.chirp(t + i * this.rng.range(0.09, 0.16), this.rng.range(3900, 4600), this.rng.range(2900, 3400), 0.06, 0.035, pan);
  }

  /** "Hoo... hokekyo": a long rising whistle then a quick falling flourish. */
  private uguisu(t: number): void {
    const c = this.a.ctx;
    const pan = this.rng.range(-0.6, 0.6);
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(1250, t);
    o.frequency.linearRampToValueAtTime(1500, t + 0.9);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.25);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.a.ambience);
    o.start(t);
    o.stop(t + 1.05);
    const s = t + 1.15;
    this.chirp(s, 2300, 2000, 0.12, 0.03, pan);
    this.chirp(s + 0.16, 2600, 2100, 0.1, 0.03, pan);
    this.chirp(s + 0.3, 2200, 1700, 0.35, 0.03, pan);
  }

  /** Evening cicada "kana-kana-kana": fast pulses, falling in pitch. */
  private higurashi(t: number): void {
    const pan = this.rng.range(-0.7, 0.7);
    for (let i = 0; i < 14; i++) this.chirp(t + i * 0.085, 4700 - i * 40, 4400 - i * 40, 0.06, 0.014 * (1 - i / 18), pan);
  }

  /** Bell cricket "riiin". */
  private suzumushi(t: number): void {
    const pan = this.rng.range(-0.8, 0.8);
    for (let i = 0; i < 18; i++) this.chirp(t + i * 0.028, 4200, 4150, 0.022, 0.012, pan);
  }

  private crow(t: number): void {
    const c = this.a.ctx;
    const pan = this.rng.range(-0.5, 0.5);
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
      g.gain.linearRampToValueAtTime(0.03, s + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.38);
      const p = c.createStereoPanner();
      p.pan.value = pan;
      o.connect(bp).connect(g).connect(p).connect(this.a.ambience);
      o.start(s);
      o.stop(s + 0.4);
    }
  }

  private bikeBell(t: number): void {
    const pan = this.rng.range(-0.9, 0.9);
    for (const k of [0, 0.11]) {
      this.chirp(t + k, 2650, 2640, 0.5, 0.012, pan);
      this.chirp(t + k, 3950, 3940, 0.35, 0.006, pan);
    }
  }

  private drip(t: number): void {
    this.chirp(t, this.rng.range(1400, 2600), this.rng.range(700, 1200), 0.05, 0.015 * this.state.rain, this.rng.range(-0.9, 0.9));
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
