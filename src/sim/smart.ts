import { hourInRange } from '../core/clock';
import { BENCHES, BRIDGE, CAFE_TABLES, ISLET, PLAYGROUND, VENDING, ALLOTMENT_ROWS } from '../world/layout';

export type SmartKind = 'bench' | 'vending' | 'shop' | 'view' | 'shrine' | 'temple' | 'cafe' | 'swing' | 'sand' | 'garden' | 'admire' | 'catbowl' | 'warmth';

export type Pose = 'stand' | 'sit' | 'pray' | 'crouch' | 'sweep';

export interface Slot {
  x: number;
  z: number;
  /** rotation.y the occupant should face */
  face: number;
  pose: Pose;
  takenBy: string | null;
}

/**
 * Smart objects advertise what they offer; residents decide whether they want it.
 * (The Sims' architecture in miniature: the bench knows it is for sitting.)
 */
export interface SmartObject {
  id: string;
  kind: SmartKind;
  label: string;
  x: number;
  z: number;
  slots: Slot[];
  /** Player-placed objects are novel for a while and can be removed. */
  placed: boolean;
  createdAt: number;
  /** Concurrent "come look at this" visitors, capped to avoid swarms. */
  inspectors: number;
  openHours?: [number, number];
}

export class SmartRegistry {
  readonly objects = new Map<string, SmartObject>();

  add(o: Omit<SmartObject, 'inspectors' | 'createdAt' | 'placed'> & Partial<Pick<SmartObject, 'placed' | 'createdAt'>>): SmartObject {
    const full: SmartObject = { inspectors: 0, placed: false, createdAt: 0, ...o };
    this.objects.set(full.id, full);
    return full;
  }
  remove(id: string): SmartObject | undefined {
    const o = this.objects.get(id);
    this.objects.delete(id);
    return o;
  }
  isOpen(o: SmartObject, hour: number): boolean {
    return !o.openHours || hourInRange(hour, o.openHours[0], o.openHours[1]);
  }
  /** All objects of a kind with at least one free slot. */
  available(kind: SmartKind, hour: number): SmartObject[] {
    const out: SmartObject[] = [];
    for (const o of this.objects.values()) if (o.kind === kind && this.isOpen(o, hour) && o.slots.some((s) => !s.takenBy)) out.push(o);
    return out;
  }
  reserve(o: SmartObject, who: string): Slot | null {
    const s = o.slots.find((sl) => !sl.takenBy);
    if (!s) return null;
    s.takenBy = who;
    return s;
  }
  release(who: string): void {
    for (const o of this.objects.values()) for (const s of o.slots) if (s.takenBy === who) s.takenBy = null;
  }
  /** Who is using an object (for edge cases like removing an occupied bench). */
  occupants(o: SmartObject): string[] {
    return o.slots.map((s) => s.takenBy).filter((v): v is string => !!v);
  }
}

/** Seat slots for a bench at (x,z) rotated ry (seat faces local +z). */
export function benchSlots(x: number, z: number, ry: number): Slot[] {
  const c = Math.cos(ry),
    s = Math.sin(ry);
  return [-0.38, 0.38].map((o) => ({ x: x + o * c + 0.05 * s, z: z - o * s + 0.05 * c, face: ry, pose: 'sit' as const, takenBy: null }));
}

/** Slot standing in front of something at distance d, facing it. */
export function frontSlot(x: number, z: number, ry: number, d: number, pose: Pose = 'stand'): Slot {
  return { x: x + Math.sin(ry) * d, z: z + Math.cos(ry) * d, face: ry + Math.PI, pose, takenBy: null };
}

export function registerStaticObjects(r: SmartRegistry): void {
  for (const b of BENCHES) r.add({ id: b.id, kind: 'bench', label: 'bench', x: b.x, z: b.z, slots: benchSlots(b.x, b.z, b.ry) });
  VENDING.forEach((v, i) => r.add({ id: `vending-${i}`, kind: 'vending', label: 'vending machine', x: v.x, z: v.z, slots: [frontSlot(v.x, v.z, 0, 0.85)] }));
  const shops: [string, string, number, [number, number]][] = [
    ['ramen', 'ramen shop', -2, [11, 23]],
    ['bakery', 'bakery', 1.5, [7, 19]],
    ['florist', 'flower shop', 4.7, [9, 18]],
    ['books', 'bookshop', 7.6, [10, 20]],
  ];
  for (const [id, label, z, hours] of shops)
    r.add({
      id: `shop-${id}`,
      kind: 'shop',
      label,
      x: -10.5,
      z,
      openHours: hours,
      slots: [-0.7, 0.7].map((o) => ({ x: -9.55, z: z + o, face: -Math.PI / 2, pose: 'stand' as const, takenBy: null })),
    });
  const mid = (BRIDGE.x0 + BRIDGE.x1) / 2;
  r.add({
    id: 'bridge',
    kind: 'view',
    label: 'bridge',
    x: mid,
    z: BRIDGE.z,
    slots: [
      { x: mid - 0.4, z: BRIDGE.z - 0.25, face: Math.PI, pose: 'stand', takenBy: null },
      { x: mid + 0.4, z: BRIDGE.z + 0.25, face: 0, pose: 'stand', takenBy: null },
    ],
  });
  r.add({
    id: 'islet-shrine',
    kind: 'shrine',
    label: 'Benzaiten shrine',
    x: ISLET.x,
    z: ISLET.z,
    slots: [{ x: ISLET.x - 0.3, z: ISLET.z, face: Math.PI / 2, pose: 'pray', takenBy: null }],
  });
  r.add({
    id: 'temple',
    kind: 'temple',
    label: 'temple',
    x: 9.5,
    z: -9.4,
    slots: [
      { x: 9.2, z: -8.65, face: Math.PI, pose: 'pray', takenBy: null },
      { x: 9.9, z: -8.65, face: Math.PI, pose: 'pray', takenBy: null },
    ],
  });
  r.add({
    id: 'kissaten',
    kind: 'cafe',
    label: 'kissaten',
    x: 13.9,
    z: 3,
    openHours: [7.5, 21],
    slots: CAFE_TABLES.flatMap(([x, z]) => [
      { x: x - 0.6, z, face: Math.PI / 2, pose: 'sit' as const, takenBy: null },
      { x: x + 0.6, z, face: -Math.PI / 2, pose: 'sit' as const, takenBy: null },
    ]),
  });
  r.add({
    id: 'swings',
    kind: 'swing',
    label: 'swings',
    x: -6.3,
    z: 5.4,
    slots: PLAYGROUND.swingX.map((x) => ({ x, z: PLAYGROUND.swingZ, face: 0, pose: 'sit' as const, takenBy: null })),
  });
  r.add({
    id: 'sandpit',
    kind: 'sand',
    label: 'sandpit',
    x: -5.5,
    z: 6.6,
    slots: [
      [-6.6, 6.8],
      [-5.2, 7.3],
      [-6, 7.5],
    ].map(([x, z]) => ({ x: x!, z: z!, face: Math.PI, pose: 'crouch' as const, takenBy: null })),
  });
  r.add({
    id: 'allotment',
    kind: 'garden',
    label: 'allotment',
    x: 13.3,
    z: 8,
    slots: ALLOTMENT_ROWS.map((z, i) => ({ x: 11.4 + (i % 2) * 3, z: z + 0.7, face: Math.PI, pose: 'crouch' as const, takenBy: null })),
  });
}
