import type { WorldClock } from '../core/clock';
import { skyAt } from '../render/sky';
import type { World } from '../world/world';
import type { Animals } from './animals';
import type { Residents } from './residents';
import type { SmartObject } from './smart';

export interface SimParts {
  clock: WorldClock;
  world: World;
  residents: Residents;
  animals: Animals;
  placed: () => SmartObject[];
}

/**
 * Run the simulation with a fixed timestep from `fromHour` up to `toHour`
 * (forward, wrapping midnight), mirroring the order of the main loop. Same
 * inputs, same seed → same resident and animal state, independent of frame rate.
 * Returns the accumulated animation time so the caller can continue from it.
 */
export function warmUp(p: SimParts, fromHour: number, toHour: number, dt = 1 / 20, time = 0): number {
  const { clock, world, residents, animals } = p;
  clock.setHour(fromHour);
  const span = (((toHour - fromHour) % 24) + 24) % 24;
  const steps = Math.round((span * 60) / (dt * clock.minutesPerSecond * clock.speed));
  let t = time;
  let slow = 0;
  for (let s = 0; s < steps; s++) {
    t += dt;
    const gm = clock.tick(dt);
    const hour = clock.hour;
    const rain = world.weather.rain;
    world.update(dt, t, clock, skyAt(hour, rain, clock.season), gm);
    residents.update(dt, gm, hour, rain, t);
    animals.update(dt, t, hour, rain, clock.season, residents.agents);
    slow += dt;
    if (slow > 1) {
      slow = 0;
      residents.noticePass(p.placed(), hour);
    }
  }
  // land exactly on the requested hour (float accumulation drifts by microseconds)
  clock.setHour(toHour);
  return t;
}
