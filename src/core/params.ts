import { SEASONS, type Season } from './clock';

/**
 * Launch flags read from the URL query. Kept DOM-free (only `URLSearchParams`)
 * so tests and a future Worker can parse them too.
 *
 *   ?seed=N&hour=H&season=S&weather=clear|rain&freeze=1   deterministic screenshot state
 *   ?debug                                                 stats overlay
 *   ?lutOff                                                palette snap via the reference loop instead of the LUT
 */
export interface LaunchParams {
  /** Mixed into the simulation's RNG streams (residents, animals, weather). 0 = the authored default. */
  seed: number;
  hour: number | null;
  season: Season | null;
  weather: 'clear' | 'rain' | null;
  /** Stop time, residents and animals after warm-up so every frame is identical. */
  freeze: boolean;
  debug: boolean;
  lutOff: boolean;
  /**
   * True when any seeded-state flag is present. Scripted runs never read or
   * write the player's save: a screenshot run must not clobber a real garden.
   */
  scripted: boolean;
}

const truthy = (v: string | null): boolean => v !== null && v !== '0' && v !== 'false';

export function parseLaunchParams(search: string): LaunchParams {
  const q = new URLSearchParams(search);
  const seedRaw = q.get('seed');
  const seedNum = seedRaw === null ? NaN : Number(seedRaw);
  const seed = Number.isFinite(seedNum) ? Math.trunc(seedNum) >>> 0 : 0;

  const hourRaw = q.get('hour');
  const hourNum = hourRaw === null || hourRaw === '' ? NaN : Number(hourRaw);
  const hour = Number.isFinite(hourNum) ? ((hourNum % 24) + 24) % 24 : null;

  const s = q.get('season');
  const season = s !== null && (SEASONS as readonly string[]).includes(s) ? (s as Season) : null;

  const w = q.get('weather');
  const weather = w === 'clear' || w === 'rain' ? w : null;

  const freeze = truthy(q.get('freeze'));
  return {
    seed,
    hour,
    season,
    weather,
    freeze,
    debug: q.has('debug'),
    lutOff: q.has('lutOff'),
    scripted: seedRaw !== null || hour !== null || season !== null || weather !== null || freeze,
  };
}

/**
 * Hour to start the warm-up from so the sim has run `warmupHours` of
 * fixed-step time before reaching `hour`. Residents start from their initial
 * plan, so a few in-world hours lets routines settle into a natural state.
 */
export function warmupStart(hour: number, warmupHours: number): number {
  return (((hour - warmupHours) % 24) + 24) % 24;
}
