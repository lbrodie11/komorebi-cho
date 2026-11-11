import { mixHex, clamp, lerp, smoothstep } from '../core/math';
import type { Season } from '../core/clock';

/** Everything the lighting rig and post pass need for one moment of the day. */
export interface SkyState {
  top: string;
  bottom: string;
  sun: string;
  sunI: number; // 0..1, scaled by the renderer's physical constant
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  lamp: number; // 0..1 how "on" street lamps / lanterns are
  stars: number;
  exposure: number;
  clouds: number; // background cloud band opacity
  sunDir: [number, number, number];
  isNight: boolean;
}

interface Key {
  h: number;
  top: string;
  bottom: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  lamp: number;
  stars: number;
  exposure: number;
  clouds: number;
}

/**
 * Hand-authored keyframes. These are art direction: tune them by eye against
 * the seeded screenshots (`?seed=1&hour=H&freeze=1`). Each key says what mood it is for.
 *
 * Value structure first: at every key the buildings must separate from both the
 * ground and the sky when the frame is squinted at. Night skies stop at #16141f,
 * so the void never reads as pure black and the darkest roofs still hold an edge against it.
 */
const KEYS: Key[] = [
  // deep night: cool moonlight from behind the terrace, every lamp on
  {
    // colour script: stillness; the town asleep, a few windows keeping watch
    h: 0,
    top: '#16141f',
    bottom: '#211e30',
    sun: '#86aed4',
    sunI: 0.16,
    hemiSky: '#4f73a3',
    hemiGround: '#16141f',
    hemiI: 0.42,
    lamp: 1,
    stars: 1,
    exposure: 1.25,
    clouds: 0.1,
  },
  // before dawn: the horizon starts to lift
  {
    // colour script: anticipation; the night thinning
    h: 4.6,
    top: '#16141f',
    bottom: '#2e2a42',
    sun: '#86aed4',
    sunI: 0.14,
    hemiSky: '#4f73a3',
    hemiGround: '#16141f',
    hemiI: 0.42,
    lamp: 1,
    stars: 0.9,
    exposure: 1.25,
    clouds: 0.1,
  },
  // sunrise: a pink horizon and the first long orange shadows; lamps fading
  {
    // colour script: gentle optimism; the town is waking up
    h: 5.6,
    top: '#2f4a72',
    bottom: '#e59b9b',
    sun: '#ff6b3d',
    sunI: 0.35,
    hemiSky: '#8e86c0',
    hemiGround: '#45291b',
    hemiI: 0.5,
    lamp: 0.55,
    stars: 0.2,
    exposure: 1.12,
    clouds: 0.6,
  },
  // early morning: soft gold sun, pale pink sky
  {
    // colour script: freshness; peach light on cream walls, vegetation still muted
    h: 6.6,
    top: '#4f73a3',
    bottom: '#f4c7cf',
    sun: '#ffd37a',
    sunI: 0.8,
    hemiSky: '#c4dcee',
    hemiGround: '#653d27',
    hemiI: 0.62,
    lamp: 0.1,
    stars: 0,
    exposure: 1.04,
    clouds: 0.8,
  },
  // day: neutral, warm-white sun, cool sky fill, warm ground bounce
  {
    // colour script: everyday warmth; readable architecture, modest shadow contrast, comfortably alive
    h: 8.5,
    top: '#4f73a3',
    bottom: '#c4dcee',
    sun: '#fff1c4',
    sunI: 1.0,
    hemiSky: '#c4dcee',
    hemiGround: '#8a5634',
    hemiI: 0.75,
    lamp: 0,
    stars: 0,
    exposure: 1.0,
    clouds: 0.9,
  },
  {
    // colour script: the long afternoon; warmth gathering, nothing hurried
    h: 15.5,
    top: '#4f73a3',
    bottom: '#c4dcee',
    sun: '#fff1c4',
    sunI: 1.0,
    hemiSky: '#c4dcee',
    hemiGround: '#8a5634',
    hemiI: 0.72,
    lamp: 0,
    stars: 0,
    exposure: 1.0,
    clouds: 0.9,
  },
  // golden hour (17:30): low amber sun raking across the lane, long violet shadows,
  // a gold horizon under a still-blue sky. Lamps not yet needed.
  {
    // colour script: nostalgia; you wish this moment would last
    h: 17.5,
    top: '#4f73a3',
    bottom: '#ffd37a',
    sun: '#ffa94d',
    sunI: 0.95,
    hemiSky: '#e59b9b',
    hemiGround: '#8a5634',
    hemiI: 0.58,
    lamp: 0.15,
    stars: 0,
    exposure: 1.02,
    clouds: 0.9,
  },
  // sunset: the sun goes red, the sky pink to violet, lamps come on
  {
    // colour script: the turn; lamps waking one by one, the day letting go
    h: 18.4,
    top: '#2e2a42',
    bottom: '#e59b9b',
    sun: '#ff6b3d',
    sunI: 0.55,
    hemiSky: '#8e86c0',
    hemiGround: '#45291b',
    hemiI: 0.52,
    lamp: 0.65,
    stars: 0.25,
    exposure: 1.08,
    clouds: 0.7,
  },
  // blue hour (19:15): the whole street goes cool blue so warm windows carry the frame.
  // The kissaten's window (materials.windowMat('cafe'), lighting.ts EMISSIVE) must be the warmest thing in view:
  // fill and sky stay strictly blue, so nothing else competes for amber.
  {
    // colour script: quiet wonder; cool indigo, local amber, saturated accents held back (the benchmark scene)
    h: 19.25,
    top: '#1f2c45',
    bottom: '#4f73a3',
    sun: '#86aed4',
    sunI: 0.18,
    hemiSky: '#4f73a3',
    hemiGround: '#211e30',
    hemiI: 0.5,
    lamp: 1,
    stars: 0.45,
    exposure: 1.16,
    clouds: 0.35,
  },
  // evening into night
  {
    // colour script: intimacy; the street belongs to the few still out
    h: 21,
    top: '#16141f',
    bottom: '#211e30',
    sun: '#86aed4',
    sunI: 0.16,
    hemiSky: '#4f73a3',
    hemiGround: '#16141f',
    hemiI: 0.42,
    lamp: 1,
    stars: 1,
    exposure: 1.25,
    clouds: 0.1,
  },
  {
    // colour script: stillness again (wraps to 0)
    h: 24,
    top: '#16141f',
    bottom: '#211e30',
    sun: '#86aed4',
    sunI: 0.16,
    hemiSky: '#4f73a3',
    hemiGround: '#16141f',
    hemiI: 0.42,
    lamp: 1,
    stars: 1,
    exposure: 1.25,
    clouds: 0.1,
  },
];

export function skyAt(hour: number, rain: number, season: Season): SkyState {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.h <= h) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = smoothstep(0, 1, (h - a.h) / (b.h - a.h));
  const s: SkyState = {
    top: mixHex(a.top, b.top, t),
    bottom: mixHex(a.bottom, b.bottom, t),
    sun: mixHex(a.sun, b.sun, t),
    sunI: lerp(a.sunI, b.sunI, t),
    hemiSky: mixHex(a.hemiSky, b.hemiSky, t),
    hemiGround: mixHex(a.hemiGround, b.hemiGround, t),
    hemiI: lerp(a.hemiI, b.hemiI, t),
    lamp: lerp(a.lamp, b.lamp, t),
    stars: lerp(a.stars, b.stars, t),
    exposure: lerp(a.exposure, b.exposure, t),
    clouds: lerp(a.clouds, b.clouds, t),
    sunDir: sunDirection(h),
    isNight: h < 5.4 || h > 19.6,
  };
  if (season === 'winter') {
    s.hemiSky = mixHex(s.hemiSky, '#cfd2d4', 0.25);
    s.sun = mixHex(s.sun, '#eef2f5', 0.2);
  }
  if (rain > 0) {
    const r = clamp(rain, 0, 1);
    s.top = mixHex(s.top, s.isNight ? '#16141f' : '#3f3a58', r * 0.85);
    s.bottom = mixHex(s.bottom, s.isNight ? '#2e2a42' : '#686d78', r * 0.85);
    s.sunI *= 1 - 0.75 * r;
    s.hemiSky = mixHex(s.hemiSky, '#686d78', r * 0.6);
    s.hemiI *= 1 - 0.15 * r;
    s.lamp = Math.max(s.lamp, 0.55 * r);
    s.stars *= 1 - r;
    s.exposure += 0.1 * r;
    s.clouds = Math.max(s.clouds, r);
    const eve = smoothstep(16, 17.5, h) * (1 - smoothstep(20, 21, h));
    if (season === 'winter') {
      // snowy morning: overcast but luminous. Snow on the ground bounces light back up,
      // so the fill brightens and goes pale grey; contrast stays low and cool.
      const morn = smoothstep(5.2, 6.5, h) * (1 - smoothstep(9.5, 11, h)) * r;
      s.hemiGround = mixHex(s.hemiGround, '#cfd2d4', morn * 0.8);
      s.hemiI *= 1 + 0.3 * morn;
      s.top = mixHex(s.top, '#8a8f99', morn * 0.7);
      s.bottom = mixHex(s.bottom, '#cfd2d4', morn * 0.8);
      s.exposure += 0.06 * morn;
    } else if (eve > 0) {
      // rainy evening: the street lamps come on early, the sky closes to violet-grey, and the
      // wet lane picks up every warm window (the reflections live in post.ts and materials.ts)
      s.lamp = Math.max(s.lamp, 0.85 * r * eve);
      s.hemiSky = mixHex(s.hemiSky, '#5a5378', r * eve * 0.5);
      s.top = mixHex(s.top, '#2e2a42', r * eve * 0.5);
    }
  }
  return s;
}

/**
 * Sun travels east to west across the camera's default view, low and long at
 * the ends of the day so dawn and dusk throw dramatic pixel shadows. At night
 * the "sun" is the moon: high, cool, from behind the terrace.
 */
export function sunDirection(h: number): [number, number, number] {
  if (h < 5.4 || h > 19.6) return [18, 40, -14];
  const t = clamp((h - 5.6) / (19.2 - 5.6), 0, 1); // 0 sunrise -> 1 sunset
  const az = lerp(-0.25 * Math.PI, 1.05 * Math.PI, t);
  const elev = Math.sin(t * Math.PI);
  return [-Math.cos(az) * 36, 6 + elev * 34, 14 + Math.sin(az) * 10];
}
