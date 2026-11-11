import { AudioEngine } from './engine';
import { Music } from './music';
import { Ambience } from './ambience';
import type { Season } from '../core/clock';

export type SfxName = 'place' | 'remove' | 'flap' | 'meow' | 'click' | 'shutter';

/**
 * Facade over the audio graph. Browsers only allow audio after a user gesture,
 * so nothing is created until `enable()` is called from a click.
 */
export class Sound {
  private engine: AudioEngine | null = null;
  private music: Music | null = null;
  private ambience: Ambience | null = null;
  enabled = false;
  musicVolume = 0.55;
  ambienceVolume = 0.6;

  async enable(): Promise<void> {
    if (!this.engine) {
      this.engine = new AudioEngine();
      this.music = new Music(this.engine);
      this.ambience = new Ambience(this.engine);
    }
    await this.engine.resume();
    this.music!.start();
    this.enabled = true;
    this.applyVolumes();
  }

  disable(): void {
    this.enabled = false;
    this.engine?.suspend();
    this.music?.stop();
  }

  async toggle(): Promise<boolean> {
    if (this.enabled) this.disable();
    else await this.enable();
    return this.enabled;
  }

  applyVolumes(): void {
    if (!this.engine) return;
    const t = this.engine.now;
    this.engine.music.gain.setTargetAtTime(this.musicVolume, t, 0.2);
    this.engine.ambience.gain.setTargetAtTime(this.ambienceVolume, t, 0.2);
  }

  update(hour: number, rain: number, season: Season): void {
    if (!this.enabled) return;
    this.music?.setState({ hour, rain, season });
    this.ambience?.setState({ hour, rain, season });
  }

  bell(): void {
    if (this.enabled) this.ambience?.bell();
  }

  sfx(name: SfxName, pan = 0): void {
    const e = this.engine;
    if (!e || !this.enabled) return;
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
          n.start(s, Math.random() * 3, 0.08);
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
