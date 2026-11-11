/**
 * Loudness and true peak (prompt 11's mix targets), pure and tested: integrated loudness per
 * ITU-R BS.1770-4 (K-weighting, 400 ms blocks with 75% overlap, an absolute gate at −70 LUFS and a
 * relative gate 10 LU below), and an approximate true peak (4× oversampled by interpolation).
 * Also a 16-bit WAV encoder for the soundtrack export.
 */

/** A biquad, direct form I, over a whole channel. */
function biquad(x: Float32Array, b: readonly number[], a: readonly number[]): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const o = b[0]! * v + b[1]! * x1 + b[2]! * x2 - a[1]! * y1 - a[2]! * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = o;
    y[i] = o;
  }
  return y;
}

/** The K-weighting filter's two stages (a high shelf, then a high-pass), for any sample rate (BS.1770 coefficients, re-derived). */
function kWeight(x: Float32Array, rate: number): Float32Array {
  // stage 1: high shelf, +4 dB above ~1.5 kHz
  const G = 3.999843853973347;
  let f0 = 1681.974450955533,
    Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = Math.pow(10, G / 20),
    Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1b = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0];
  const s1a = [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  // stage 2: high-pass at ~38 Hz
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const s2b = [1, -2, 1];
  const s2a = [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return biquad(biquad(x, s1b, s1a), s2b, s2a);
}

/** Integrated loudness (LUFS) of the channels (each weighted 1.0: left, right). −Infinity for silence. */
export function integratedLoudness(channels: readonly Float32Array[], rate: number): number {
  const weighted = channels.map((c) => kWeight(c, rate));
  const block = Math.round(rate * 0.4),
    hop = Math.round(rate * 0.1);
  const n = weighted[0]!.length;
  const z: number[] = [];
  for (let start = 0; start + block <= n; start += hop) {
    let sum = 0;
    for (const w of weighted) {
      let ms = 0;
      for (let i = start; i < start + block; i++) ms += w[i]! * w[i]!;
      sum += ms / block;
    }
    z.push(sum);
  }
  const lufs = (ms: number) => -0.691 + 10 * Math.log10(ms);
  const abs = z.filter((ms) => lufs(ms) > -70);
  if (!abs.length) return -Infinity;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((ms) => lufs(ms) > rel);
  return lufs(mean(gated.length ? gated : abs));
}

/** Approximate true peak (dBTP): the highest sample, 4× oversampled by cubic interpolation. */
export function truePeak(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const c of channels)
    for (let i = 1; i + 2 < c.length; i++) {
      const p0 = c[i - 1]!,
        p1 = c[i]!,
        p2 = c[i + 1]!,
        p3 = c[i + 2]!;
      for (let k = 0; k < 4; k++) {
        const t = k / 4;
        // Catmull-Rom
        const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
    }
  return 20 * Math.log10(Math.max(peak, 1e-9));
}

/** A 16-bit PCM WAV file of the channels. */
export function encodeWav(channels: readonly Float32Array[], rate: number): ArrayBuffer {
  const n = channels[0]!.length,
    ch = channels.length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return buf;
}
