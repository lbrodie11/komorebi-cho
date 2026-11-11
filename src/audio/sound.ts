import { AudioEngine } from './engine';
import { Music } from './music';
import { Ambience, type CaptionKind } from './ambience';
import { AudioLifecycle } from './lifecycle';
import type { Season } from '../core/clock';

export type SfxName = 'place' | 'remove' | 'flap' | 'meow' | 'click' | 'shutter' | 'chime';
export type { CaptionKind };

/**
 * Facade over the audio graph. Browsers only allow audio after a user gesture,
 * so nothing is created until sound is first turned on from a click or key.
 *
 * Off really is off: turning sound off (or hiding the tab) fades out, stops every
 * scheduler and suspends the AudioContext, so a silent game costs no audio CPU.
 */
export class Sound {
  private engine: AudioEngine | null = null;
  private music: Music | null = null;
  private ambience: Ambience | null = null;
  private readonly life: AudioLifecycle;
  musicVolume = 0.55;
  ambienceVolume = 0.6;
  effectsVolume = 0.6;
  /** Shown in caption mode: each sound worth naming, as it plays. */
  onCaption: ((kind: CaptionKind) => void) | null = null;
  private state: { hour: number; rain: number; season: Season } = { hour: 16.6, rain: 0, season: 'spring' };

  constructor() {
    this.life = new AudioLifecycle({
      start: async () => {
        if (!this.engine) this.build();
        const e = this.engine!;
        if (!(await e.resume())) return false;
        this.applyVolumes();
        this.music!.setState(this.state);
        this.ambience!.setState(this.state);
        e.fadeIn();
        this.music!.start();
        this.ambience!.start();
        return true;
      },
      stop: async () => {
        this.music?.stop();
        this.ambience?.stop();
        if (!this.engine) return;
        await this.engine.fadeOut();
        await this.engine.suspend();
      },
    });
  }

  private build(): void {
    const e = new AudioEngine();
    this.engine = e;
    this.music = new Music(e);
    this.ambience = new Ambience(e);
    this.ambience.onCaption = (k) => this.onCaption?.(k);
    // a phone call or the OS taking the device suspends ("interrupted" on iOS) the context behind our back
    e.ctx.addEventListener('statechange', () => {
      if (this.life.active && !e.running) void this.life.interrupted();
    });
  }

  /** The player wants sound (it may still be paused while the tab is hidden). */
  get enabled(): boolean {
    return this.life.want;
  }

  /** Sound is actually playing now. */
  get playing(): boolean {
    return this.life.active;
  }

  /** Turn sound on or off; resolves with the resulting choice (false if the browser refused). */
  setEnabled(on: boolean): Promise<boolean> {
    return this.life.setWant(on);
  }

  toggle(): Promise<boolean> {
    return this.setEnabled(!this.life.want);
  }

  /** Hidden tabs go quiet and stop all audio work; visible again, they come back where they would be. */
  setHidden(hidden: boolean): Promise<void> {
    return this.life.setHidden(hidden);
  }

  /** After any user gesture: restart audio the browser interrupted, if the player still wants it. */
  retry(): void {
    if (this.life.want && !this.life.active && !this.life.hidden) void this.life.retry();
  }

  /** The audio context, for tests and the debug overlay. */
  get context(): AudioContext | null {
    return this.engine?.ctx ?? null;
  }

  applyVolumes(): void {
    if (!this.engine) return;
    const t = this.engine.now;
    this.engine.music.gain.setTargetAtTime(this.musicVolume, t, 0.2);
    this.engine.ambience.gain.setTargetAtTime(this.ambienceVolume, t, 0.2);
    this.engine.sfx.gain.setTargetAtTime(this.effectsVolume, t, 0.2);
  }

  update(hour: number, rain: number, season: Season): void {
    this.state = { hour, rain, season };
    if (!this.playing) return;
    this.music?.setState(this.state);
    this.ambience?.setState(this.state);
  }

  bell(): void {
    if (this.playing) this.ambience?.bell();
  }

  sfx(name: SfxName, pan = 0): void {
    const e = this.engine;
    if (!e || !this.playing || !e.claim(0.7)) return; // off, or the one-shot budget is full
    const c = e.ctx;
    const t = e.now + 0.01;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
    p.connect(e.sfx);
    const tone = (f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine', at = t) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(p);
      o.start(at);
      o.stop(at + dur + 0.02);
    };
    switch (name) {
      case 'place': // wooden block "tok", then a tiny two-note chime
        tone(900, 520, 0.09, 0.4);
        tone(1568, 1560, 0.5, 0.06, 'sine', t + 0.08);
        tone(2093, 2090, 0.6, 0.05, 'sine', t + 0.16);
        break;
      case 'remove':
        tone(600, 300, 0.18, 0.25, 'triangle');
        break;
      case 'click':
        tone(1400, 1100, 0.03, 0.15);
        break;
      case 'chime': // a glass wind chime (furin): a bright strike and a long, slightly beating ring
        tone(2637, 2635, 1.8, 0.05);
        tone(2650, 2648, 1.6, 0.03);
        tone(5274, 5270, 0.9, 0.015);
        break;
      case 'shutter': {
        const n = e.noise(false, false);
        const g = c.createGain();
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        n.connect(g).connect(p);
        n.start(t, 0, 0.1);
        tone(2400, 1800, 0.04, 0.15, 'square', t + 0.06);
        break;
      }
      case 'flap':
        for (let i = 0; i < 6; i++) {
          const n = e.noise(true, false);
          const g = c.createGain();
          const s = t + i * 0.07;
          g.gain.setValueAtTime(0.0001, s);
          g.gain.linearRampToValueAtTime(0.12, s + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, s + 0.06);
          n.connect(g).connect(p);
          n.start(s, e.noiseOffset(), 0.08);
        }
        break;
      case 'meow': {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(520, t);
        o.frequency.linearRampToValueAtTime(820, t + 0.15);
        o.frequency.linearRampToValueAtTime(480, t + 0.5);
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value = 3;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.08, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        o.connect(bp).connect(g).connect(p);
        o.start(t);
        o.stop(t + 0.6);
        break;
      }
    }
  }
}
