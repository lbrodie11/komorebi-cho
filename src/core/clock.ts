export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/**
 * World time. One real second = `minutesPerSecond` in-world minutes at speed 1.
 * Default pacing gives a ~24 real-minute day: slow enough to feel calm, fast
 * enough that a lunch-break session sees dusk.
 */
export class WorldClock {
  /** Minutes since day 0, 00:00. */
  minutes: number;
  speed = 1;
  paused = false;
  season: Season = 'spring';
  readonly minutesPerSecond = 1;

  constructor(startHour = 8.5) {
    this.minutes = startHour * 60;
  }

  tick(realDt: number): number {
    if (this.paused) return 0;
    const dm = realDt * this.minutesPerSecond * this.speed;
    this.minutes += dm;
    return dm;
  }

  get hour(): number {
    return (this.minutes / 60) % 24;
  }
  get day(): number {
    return Math.floor(this.minutes / 1440);
  }
  /** Jump forward to the next occurrence of `hour` (never backwards in time). */
  jumpTo(hour: number): void {
    const cur = this.hour;
    let delta = hour - cur;
    if (delta < 0) delta += 24;
    this.minutes += delta * 60;
  }
  setHour(hour: number): void {
    this.minutes = this.day * 1440 + hour * 60;
  }
  /** "06:42" */
  label(): string {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  isBetween(a: number, b: number): boolean {
    return hourInRange(this.hour, a, b);
  }
}

/** True if `h` is in [a, b), wrapping around midnight when a > b. */
export function hourInRange(h: number, a: number, b: number): boolean {
  return a <= b ? h >= a && h < b : h >= a || h < b;
}
