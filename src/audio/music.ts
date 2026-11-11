import type { AudioEngine } from './engine';
import { mtof } from './engine';
import { PROGRESSIONS, keyForHour, snapToScale, voiceChord, type ChordStep } from './theory';
import { Rng, stream } from '../core/rng';
import type { Season } from '../core/clock';

export interface MusicState {
  hour: number;
  rain: number;
  season: Season;
}

/**
 * Endless generative lo-fi piano. A tiny "composer":
 *  - picks a progression per 8-bar phrase, drifting key with the time of day
 *  - left hand: rootless jazz voicings, voice-led, rolled like a real hand
 *  - right hand: a 2-bar motif, repeated with variation, snapped to the scale
 *  - soft sine bass, very quiet brushed drums by day, none at night
 *  - tape wow on every oscillator, vinyl crackle underneath
 * Scheduling uses the classic look-ahead pattern ("A Tale of Two Clocks").
 */
export class Music {
  private readonly rng = new Rng(2024);
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0; // 8th notes
  private bar = 0;
  private key = 65;
  private prog: ChordStep[] = PROGRESSIONS.A!;
  private progName = 'A';
  private lh = [57, 60, 64, 67];
  private motif: { at: number; deg: number; len: number }[] = [];
  private lastMel = 72;
  private state: MusicState = { hour: 9, rain: 0, season: 'spring' };
  private readonly wow: OscillatorNode;
  private readonly wowGain: GainNode;
  private readonly crackle: GainNode;
  private readonly drums: GainNode;
  private bpm = 72;

  constructor(private readonly a: AudioEngine) {
    const c = a.ctx;
    this.wow = c.createOscillator();
    this.wow.frequency.value = 0.45;
    this.wowGain = c.createGain();
    this.wowGain.gain.value = 7; // cents
    this.wow.connect(this.wowGain);
    this.wow.start();
    this.crackle = c.createGain();
    this.crackle.gain.value = 0.05;
    const cr = c.createBufferSource();
    cr.buffer = this.crackleBuffer();
    cr.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    cr.connect(hp).connect(this.crackle).connect(a.music);
    cr.start();
    this.drums = c.createGain();
    this.drums.gain.value = 0;
    this.drums.connect(a.music);
  }

  setState(s: MusicState): void {
    this.state = s;
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextTime = this.a.now + 0.2;
    this.newPhrase();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }
  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private get night(): boolean {
    return this.state.hour >= 20 || this.state.hour < 5;
  }

  private newPhrase(): void {
    const s = this.state;
    const key = keyForHour(s.hour, s.rain);
    if (key !== this.key) this.key = key;
    const pool = s.rain > 0.5 || this.night ? ['D', 'E', 'B'] : s.hour < 9 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'E'];
    this.progName = this.rng.pick(pool.filter((p) => p !== this.progName));
    this.prog = PROGRESSIONS[this.progName]!;
    this.bpm = s.season === 'winter' ? 62 : this.night ? 64 : s.rain > 0.5 ? 66 : 72;
    // density and drums follow the mood
    const drumLevel = this.night || s.rain > 0.6 || s.season === 'winter' ? 0 : 0.5;
    this.drums.gain.setTargetAtTime(drumLevel, this.a.now, 2);
    this.a.lofi.frequency.setTargetAtTime(s.rain > 0.5 ? 2200 : this.night ? 2800 : s.season === 'summer' ? 4600 : 3800, this.a.now, 3);
    this.a.musicVerb.gain.setTargetAtTime(s.season === 'winter' ? 1.2 : this.night ? 0.9 : 0.6, this.a.now, 3);
    this.makeMotif();
  }

  private makeMotif(): void {
    const density = this.night ? 0.32 : this.state.rain > 0.5 ? 0.38 : 0.5;
    this.motif = [];
    let deg = this.rng.int(-2, 3);
    for (let i = 0; i < 16; i++) {
      if (this.rng.next() > density) continue;
      deg += this.rng.pick([-2, -1, -1, 0, 1, 1, 2, 3, -3]);
      deg = Math.max(-4, Math.min(6, deg));
      this.motif.push({ at: i, deg, len: this.rng.pick([1, 1, 2, 2, 3, 4]) });
    }
    if (this.motif.length < 2) this.motif.push({ at: 0, deg: 0, len: 4 }, { at: 6, deg: 2, len: 2 });
  }

  private schedule(): void {
    const spb = 60 / this.bpm;
    const eighth = spb / 2;
    while (this.nextTime < this.a.now + 0.15) {
      const swing = this.step % 2 === 1 ? eighth * 0.16 : 0;
      this.playStep(this.nextTime + swing, eighth);
      this.nextTime += eighth;
      this.step++;
      if (this.step % 8 === 0) {
        this.bar++;
        if (this.bar % 8 === 0) this.newPhrase();
        else if (this.bar % 2 === 0 && this.rng.chance(0.35)) this.makeMotif();
      }
    }
  }

  private playStep(t: number, eighth: number): void {
    const inBar = this.step % 8;
    const chord = this.prog[this.bar % this.prog.length]!;
    const root = this.key + chord.degree;
    const winter = this.state.season === 'winter';
    // left hand on beat 1 (sometimes anticipated on the "and" of 4)
    if (inBar === 0 || (inBar === 7 && this.rng.chance(0.15))) {
      const target = inBar === 7 ? this.prog[(this.bar + 1) % this.prog.length]! : chord;
      const notes = voiceChord(this.key, target, 58);
      this.lh = notes;
      notes.forEach((n, i) => this.piano(n, t + i * this.rng.range(0.018, 0.04), 0.32 + this.rng.range(0, 0.08), eighth * 7));
      // bass
      let b = this.key + target.degree;
      while (b > 47) b -= 12;
      while (b < 36) b += 12;
      this.bass(b, t, eighth * 6);
    }
    if (inBar === 4 && this.rng.chance(0.35)) {
      const n = this.lh[this.rng.int(0, this.lh.length - 1)];
      if (n !== undefined) this.piano(n + 12, t, 0.2, eighth * 3);
    }
    // right hand motif (2 bars = 16 eighths), varied on the repeat
    const pos = (this.bar % 2) * 8 + inBar;
    for (const ev of this.motif) {
      if (ev.at !== pos) continue;
      if (this.bar % 4 >= 2 && this.rng.chance(0.25)) continue; // variation: drop notes
      const base = root + 7 + ev.deg * 2;
      let n = snapToScale(base, this.key, 66, 86);
      if (Math.abs(n - this.lastMel) > 9) n = snapToScale(this.lastMel + Math.sign(n - this.lastMel) * 4, this.key, 66, 86);
      this.lastMel = n;
      const vel = 0.42 + this.rng.range(-0.08, 0.1);
      if (this.rng.chance(0.08)) this.piano(n - 1, t - 0.05, vel * 0.5, 0.06); // grace note
      this.piano(n, t, vel, eighth * ev.len * 1.4);
      if (this.state.season === 'spring' && this.rng.chance(0.3)) this.bell(n + 12, t + 0.01, 0.12);
      if (winter && this.rng.chance(0.2)) this.bell(n + 24, t + 0.02, 0.07);
    }
    // drums (very quiet, swung, day only)
    if (inBar === 0 || inBar === 5) this.kick(t);
    if (inBar === 2 || inBar === 6) this.brush(t);
    this.hat(t, inBar % 2 ? 0.35 : 0.6);
  }

  // ── Instruments ──────────────────────────────────────────────────────────
  private piano(midi: number, t: number, vel: number, dur: number): void {
    const c = this.a.ctx;
    const f = mtof(midi);
    const decay = 1.4 + (Math.max(0, 84 - midi) / 24) * 2.4;
    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vel * 0.22, t + 0.006);
    out.gain.setTargetAtTime(0.0001, t + 0.006, decay / 4);
    out.gain.setTargetAtTime(0, t + Math.max(dur, 0.12), 0.18);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 + vel * 5200, t);
    lp.frequency.setTargetAtTime(600 + vel * 1000, t + 0.01, 0.5);
    const pan = c.createStereoPanner();
    pan.pan.value = Math.max(-0.6, Math.min(0.6, (midi - 62) / 30));
    lp.connect(out).connect(pan).connect(this.a.music);
    const partials: [number, number, OscillatorType][] = [
      [1, 1, 'sine'],
      [1.0016, 0.5, 'sine'],
      [2, 0.38, 'sine'],
      [3.003, 0.14, 'triangle'],
      [4.01, 0.06, 'sine'],
    ];
    const end = t + Math.max(dur, 0.12) + 1.2;
    for (const [mul, g, type] of partials) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      this.wowGain.connect(o.detune);
      const og = c.createGain();
      og.gain.value = g;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(end);
      o.onended = () => {
        try {
          this.wowGain.disconnect(o.detune);
        } catch {
          /* already gone */
        }
        og.disconnect();
      };
    }
    // hammer: a tiny filtered noise tick
    const h = this.a.noise(false, false);
    const hb = c.createBiquadFilter();
    hb.type = 'bandpass';
    hb.frequency.value = 2600;
    const hg = c.createGain();
    hg.gain.setValueAtTime(vel * 0.05, t);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    h.connect(hb).connect(hg).connect(out);
    h.start(t, this.a.noiseOffset(), 0.05);
  }

  private bass(midi: number, t: number, dur: number): void {
    const c = this.a.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.03);
    g.gain.setTargetAtTime(0, t + dur, 0.2);
    o.connect(g).connect(this.a.music);
    o.start(t);
    o.stop(t + dur + 1.2);
  }

  private bell(midi: number, t: number, vel: number): void {
    const c = this.a.ctx;
    for (const [mul, gg] of [
      [1, 1],
      [2.76, 0.4],
      [5.4, 0.15],
    ] as const) {
      const o = c.createOscillator();
      o.frequency.value = mtof(midi) * mul;
      const g = c.createGain();
      g.gain.setValueAtTime(vel * 0.12 * gg, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(this.a.music);
      o.start(t);
      o.stop(t + 1.7);
    }
  }

  private kick(t: number): void {
    const c = this.a.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.32);
  }
  private brush(t: number): void {
    const c = this.a.ctx;
    const n = this.a.noise(true, false);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(bp).connect(g).connect(this.drums);
    n.start(t, this.a.noiseOffset(), 0.25);
  }
  private hat(t: number, v: number): void {
    const c = this.a.ctx;
    const n = this.a.noise(false, false);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.05 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(hp).connect(g).connect(this.drums);
    n.start(t, this.a.noiseOffset(), 0.06);
  }

  private crackleBuffer(): AudioBuffer {
    const c = this.a.ctx;
    const len = c.sampleRate * 3;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    const r = stream('audio/crackle');
    for (let i = 0; i < len; i++) {
      d[i] = (r.next() * 2 - 1) * 0.015;
      if (r.next() < 0.0004) {
        const amp = r.next() * 0.8;
        for (let k = 0; k < 30 && i + k < len; k++) d[i + k] = (d[i + k] ?? 0) + amp * Math.exp(-k / 4) * (k % 2 ? -1 : 1);
      }
    }
    return b;
  }
}
