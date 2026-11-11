/**
 * The soundtrack export (prompt 11, a dev page: `npm run dev`, then /soundtrack.html). Renders the
 * score offline for a mood and a length, measures it (integrated loudness, true peak) and offers it
 * as a WAV: for listening tests, the trailer, and an optional free soundtrack release. Nothing here
 * ships in the game build.
 */
import { AudioEngine, MASTER } from '../audio/engine';
import { Music } from '../audio/music';
import { Ambience } from '../audio/ambience';
import { encodeWav, integratedLoudness, truePeak } from '../audio/loudness';
import type { Season } from '../core/clock';

const RATE = 44100;

export async function render(
  minutes: number,
  hour: number,
  rain: number,
  season: Season,
  withSoundscape = false,
): Promise<{ lufs: number; peak: number; wav: ArrayBuffer }> {
  const seconds = minutes * 60;
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
  const e = new AudioEngine(ctx);
  e.master.gain.setValueAtTime(MASTER, 0);
  e.ambience.gain.value = 0.6;
  if (withSoundscape) {
    // the soundscape's beds and emitters (its one-shots run on timers and are sparse: not rendered here)
    const amb = new Ambience(e);
    amb.setState({ hour, rain, wet: rain, season });
    amb.setListener({ x: 0, z: 2, yaw: Math.PI / 4, zoom: 1 });
  }
  const m = new Music(e);
  m.setState({ hour, rain, season, activity: 0.5 });
  m.renderAhead(seconds);
  const out = await ctx.startRendering();
  const ch = [out.getChannelData(0), out.getChannelData(1)];
  return { lufs: integratedLoudness(ch, RATE), peak: truePeak(ch), wav: encodeWav(ch, RATE) };
}

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
document.getElementById('go')?.addEventListener('click', () => {
  const status = document.getElementById('status')!;
  status.textContent = 'Rendering…';
  void render(Number($('minutes').value), Number($('hour').value), Number($('rain').value), $('season').value as Season).then(({ lufs, peak, wav }) => {
    status.textContent = `Integrated ${lufs.toFixed(1)} LUFS, true peak ${peak.toFixed(1)} dBTP`;
    const a = document.getElementById('download') as HTMLAnchorElement;
    a.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    a.download = `komorebi-cho-${$('season').value}-${$('hour').value}h.wav`;
    a.hidden = false;
  });
});
Object.assign(window, { __soundtrack: { render } });
