import type { EventBus, GameEvents } from '../core/events';
import type { World } from '../world/world';
import type { NavGrid } from '../sim/grid';
import type { SmartRegistry } from '../sim/smart';
import type { Residents } from '../sim/residents';
import { DOORS } from '../world/layout';

/** What a shop edit reaches beyond the world itself. */
export interface ShopEditContext {
  world: World;
  grid: NavGrid;
  smart: SmartRegistry;
  residents: Residents;
  bus: EventBus<GameEvents>;
  hour: () => number;
}

/**
 * Move or resize a shop-house (prompt 06 phase C): the grammar rebuilds it and whatever its change
 * touches, its fixtures and their nav footprints come along (anyone standing where a pot lands
 * steps aside), and its door and shop counter move to its new middle. Anyone queuing at the counter
 * stands up and re-plans, people heading for the door follow it, and when the edit is fresh
 * (`announce`; undo and redo are quiet) the neighbours notice the shop in its new spot.
 */
export function applyShopEdit(c: ShopEditContext, id: string, z0: number, z1: number, announce: boolean): void {
  for (const n of c.world.setShopExtent(id, z0, z1)) {
    c.grid.stamp({ x: n.x, z: n.from, r: n.r }, -1);
    c.grid.stamp({ x: n.x, z: n.to, r: n.r }, 1);
    c.residents.shuffleAside(n.x, n.to, n.r);
  }
  const mid = (z0 + z1) / 2;
  const door = DOORS[id];
  if (door && door.z !== mid) {
    const was: [number, number] = [door.x, door.z];
    door.z = mid;
    c.residents.onDoorMoved(was, [door.x, mid]);
  }
  const o = c.smart.objects.get(`shop-${id}`);
  if (!o) return;
  c.residents.onRemoved(o.id);
  const dz = mid - o.z;
  o.z = mid;
  for (const s of [...o.slots, ...(o.queue ?? [])]) s.z += dz;
  if (!announce) return;
  o.inspectors = 0;
  c.bus.emit('sfx', { name: 'place', x: o.x, z: mid });
  const ev = { id: o.id, kind: 'shop', x: o.x, z: mid, novelty: 0.8 };
  c.bus.emit('objectPlaced', ev);
  c.residents.onPlaced(ev, o, c.hour());
}
