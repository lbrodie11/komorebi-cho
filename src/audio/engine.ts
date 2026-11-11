import { Rng, stream } from '../core/rng';

/**
 * Audio graph. Everything you hear is synthesised at runtime: no audio files.
 *
 *   music -> duck -> lofi (lowpass + gentle saturation) -> musicVerb -> hall --+
 *   sfx --------------------------------------------------------> fxVerb -> hall -+-> compressor -> master -> out
 *   ambience -> highpass (no rumble pile-up) -----------------------------------+
 *   room (the kissaten's own small reverb) -> ambience, and its wet tail -------+
 *
 * The ambience beds stay dry (they are the open air); its one-shots that should ring (the temple
 * bell) send to fxVerb themselves.
 *
 * Music and effects have separate reverb sends, so the music's seasonal reverb never changes how a
 * placed bench or the temple bell sounds; the kissaten's sounds go through a small room instead of
 * the open-air hall (reverb by place, no global wash). One-shots duck the music 2–3 dB.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly music: GainNode;
  readonly ambience: GainNode;
  readonly sfx: GainNode;
  /** Reverb send for the music only (the composer moves it with season and hour). */
  readonly musicVerb: GainNode;
  /** Reverb send for effects and ambience one-shots (fixed). */
  readonly fxVerb: GainNode;
  readonly lofi: BiquadFilterNode;
  /** The music ducks under one-shots (see `duck`). */
  private readonly ducker: GainNode;
  /** A small, enclosed room (the kissaten): send sounds that happen indoors here. */
  readonly room: GainNode;
  private readonly noiseBuf: AudioBuffer;
  private readonly pinkBuf: AudioBuffer;
  /** End times of the one-shot voices still sounding (see claim()). */
  private voices: number[] = [];
  /** Noise and impulse buffers come from a named stream, so the audio is reproducible. */
  private readonly rng: Rng = stream('audio/engine');

  /** A live context by default; an OfflineAudioContext renders the soundtrack export. */
  constructor(ctx?: BaseAudioContext) {
    const AC =
      typeof window === 'undefined' ? null : (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    this.ctx = (ctx ?? new AC!({ latencyHint: 'playback' })) as AudioContext;
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    comp.connect(this.master);
    this.master.connect(c.destination);

    const reverb = c.createConvolver();
    reverb.buffer = this.impulse(3.2, 2.6);
    const wet = c.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet).connect(comp);
    this.musicVerb = c.createGain();
    this.musicVerb.connect(reverb);
    this.fxVerb = c.createGain();
    this.fxVerb.gain.value = 0.6;
    this.fxVerb.connect(reverb);

    this.lofi = c.createBiquadFilter();
    this.lofi.type = 'lowpass';
    this.lofi.frequency.value = 3800;
    this.lofi.Q.value = 0.4;
    const sat = c.createWaveShaper();
    sat.curve = softClip(0.9);
    this.lofi.connect(sat);
    this.music = c.createGain();
    this.music.gain.value = 0.55;
    this.ducker = c.createGain();
    this.music.connect(this.ducker).connect(this.lofi);
    sat.connect(comp);
    sat.connect(this.musicVerb);

    this.ambience = c.createGain();
    this.ambience.gain.value = 0.6;
    // the waterfall, the wind and the bass pile up low: the soundscape keeps out of the bass's way
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 70;
    this.ambience.connect(hp).connect(comp);
    // the kissaten: a short, close room
    this.room = c.createGain();
    const room = c.createConvolver();
    room.buffer = this.impulse(0.6, 4);
    const roomWet = c.createGain();
    roomWet.gain.value = 0.5;
    this.room.connect(room).connect(roomWet).connect(comp);
    this.room.connect(this.ambience);
    this.sfx = c.createGain();
    this.sfx.gain.value = 0.6;
    this.sfx.connect(comp);
    this.sfx.connect(this.fxVerb);

    this.noiseBuf = this.makeNoise(false);
    this.pinkBuf = this.makeNoise(true);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Is the context actually producing sound? (Mobile browsers can leave it "interrupted".) */
  get running(): boolean {
    return this.ctx.state === 'running';
  }

  /** Start the context. Rejects, or resolves with running false, when the browser won't (no gesture, a phone call). */
  async resume(): Promise<boolean> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.running;
  }

  /** Stop the context's processing entirely: no CPU while sound is off or the tab is hidden. */
  async suspend(): Promise<void> {
    if (this.ctx.state === 'running') await this.ctx.suspend();
  }

  /** Fade the master in from wherever it is: no loud first transient. */
  fadeIn(): void {
    const g = this.master.gain;
    g.cancelScheduledValues(this.now);
    g.setValueAtTime(g.value, this.now);
    g.setTargetAtTime(MASTER, this.now, 0.8);
  }

  /** Fade the master out; resolves once it is effectively silent, so a suspend after it never clicks. */
  fadeOut(): Promise<void> {
    const g = this.master.gain;
    g.cancelScheduledValues(this.now);
    g.setValueAtTime(g.value, this.now);
    g.setTargetAtTime(0, this.now, FADE_OUT / 4);
    return new Promise((res) => setTimeout(res, FADE_OUT * 1000));
  }

  /**
   * Ask for a one-shot voice lasting `seconds`. False when the budget is full: the caller
   * skips the sound (a busy moment thins out rather than piling up).
   */
  claim(seconds: number): boolean {
    const now = this.now;
    this.voices = this.voices.filter((t) => t > now);
    if (this.voices.length >= VOICE_BUDGET) return false;
    this.voices.push(now + seconds);
    return true;
  }

  /** Duck the music under a one-shot: down 2.5 dB at once, back over half a second. */
  duck(at = this.now): void {
    const g = this.ducker.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(DUCK, at, 0.02);
    g.setTargetAtTime(1, at + 0.25, 0.25);
  }

  /** A random start offset into the 4-second noise buffers. */
  noiseOffset(): number {
    return this.rng.range(0, 3);
  }

  noise(pink = false, loop = true): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = pink ? this.pinkBuf : this.noiseBuf;
    s.loop = loop;
    return s;
  }

  /** Stereo exponential-decay noise impulse: a soft, roomy hall. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (this.rng.next() * 2 - 1) * Math.pow(1 - t, decay) * (i < rate * 0.01 ? i / (rate * 0.01) : 1);
      }
    }
    return buf;
  }

  private makeNoise(pink: boolean): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = rate * 4;
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = this.rng.next() * 2 - 1;
      if (!pink) {
        d[i] = w * 0.5;
        continue;
      }
      // Paul Kellet's refined pink noise filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }
}

/** The master level: set so the full mix measures about −23 LUFS integrated (src/dev/soundtrack.ts measures it). */
export const MASTER = 0.4;
/** The music's level under a one-shot (−2.5 dB). */
export const DUCK = Math.pow(10, -2.5 / 20);
/** Seconds the master takes to fade to silence before the context is suspended. */
export const FADE_OUT = 0.6;
/** Most one-shot voices (sfx and ambient creatures) sounding at once. Music voices are not counted. */
export const VOICE_BUDGET = 24;

function softClip(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * (1 + amount)) / Math.tanh(1 + amount);
  }
  return curve;
}

/** MIDI note -> Hz */
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
