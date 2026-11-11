/**
 * The soundscape's rules (prompt 11), pure and unit-tested: which layers sound how loud for a moment,
 * and the density budget that keeps a busy minute from piling up.
 *
 * Rain is several layers: broad rainfall, rain on roofs, rain in the leaves, eave and gutter drips,
 * wet ground, the odd close drop. The rainfall stops first; drips and trickles carry on while the
 * street is wet (they follow the same wetness the picture shows).
 */
import type { Season } from '../core/clock';

export interface ScapeState {
  hour: number;
  rain: number;
  /** How wet the street still is (lags the rain). */
  wet: number;
  season: Season;
}

export interface ScapeLevels {
  rainfall: number;
  roofs: number;
  leaves: number;
  /** Drips per second (eaves, gutters). */
  drips: number;
  wetGround: number;
  wind: number;
  cicadas: number;
  water: number;
}

/** Layer levels for a moment (0..1 each, drips in drops per second). Snow is quiet: no roofs, no drips. */
export function scapeLevels(s: ScapeState): ScapeLevels {
  const winter = s.season === 'winter';
  const r = s.rain;
  const day = s.hour > 8 && s.hour < 17.5;
  return {
    rainfall: winter ? r * 0.08 : r * 0.5,
    roofs: winter ? 0 : r * 0.22,
    // leaves rustle with rain except in winter (bare trees, snow)
    leaves: winter ? 0 : r * 0.14,
    // drips go on while it's wet, after the rain has stopped
    drips: winter ? 0 : Math.min(6, s.wet * 4 + r * 2),
    wetGround: winter ? 0 : Math.max(0, s.wet - r * 0.5) * 0.12,
    wind: 0.05 + (winter ? 0.16 : 0) + r * 0.1,
    cicadas: s.season === 'summer' && day && r < 0.3 ? 0.07 : 0,
    water: 0.035,
  };
}

/** How busy the neighbourhood's own sounds may get (Settings). */
export type Density = 'quiet' | 'balanced' | 'lively';
/** Neighbourhood events per minute, at most, by density (important ones can borrow ahead). */
export const EVENTS_PER_MINUTE: Record<Density, number> = { quiet: 4, balanced: 9, lively: 16 };

/**
 * The density budget: a token bucket. Each event asks with its importance (0..1); ordinary events
 * need a whole token, important ones (≥ 0.8: the bell, a shutter at opening time) may go a little
 * into debt, so they're rarely the ones dropped, and the least important (< 0.3: footsteps) never
 * take the last token, so a street of walkers can't starve the cups and creaks. A busy minute thins
 * out instead of piling up.
 */
export class EventBudget {
  private tokens: number;
  private last = 0;
  constructor(public density: Density = 'balanced') {
    this.tokens = this.cap;
  }
  private get cap(): number {
    return Math.max(2, EVENTS_PER_MINUTE[this.density] / 3);
  }
  /** May an event of this importance sound at time `t` (seconds)? */
  allow(t: number, importance: number): boolean {
    this.tokens = Math.min(this.cap, this.tokens + ((t - this.last) * EVENTS_PER_MINUTE[this.density]) / 60);
    this.last = t;
    const floor = importance >= 0.8 ? -1 : importance < 0.3 ? 1 : 0;
    if (this.tokens - 1 < floor) return false;
    this.tokens -= 1;
    return true;
  }
}
