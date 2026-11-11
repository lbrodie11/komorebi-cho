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
  /** Noun id: the words are `noun.<label>` in the language tables. */
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
  /** It gives light (a placed lantern, a vending machine): after dark, people drift toward it. */
  glow?: boolean;
  /** A placed object's footprint radius: a slot of anything else that falls under it can't be used. */
  radius?: number;
  /** How far it draws the eye when something happens at it (m): bigger things from further off. */
  draw?: number;
  /** How many can use it in comfort (its slots are the hard limit); by default, all of them. */
  soft?: number;
  /** Standing spots where people wait their turn when every slot is taken (shops), nearest first. */
  queue?: Slot[];
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
  /**
   * Can someone stand in this slot of `o`? Not if something else was placed over it (the fox statues
   * set down right where you'd stand to admire the planter).
   */
  usable(o: SmartObject, s: Slot): boolean {
    for (const p of this.objects.values()) if (p !== o && p.radius && Math.hypot(p.x - s.x, p.z - s.z) < p.radius * 0.7) return false;
    return true;
  }
  /** All objects of a kind with at least one free, usable slot. */
  available(kind: SmartKind, hour: number): SmartObject[] {
    const out: SmartObject[] = [];
    for (const o of this.objects.values()) if (o.kind === kind && this.isOpen(o, hour) && o.slots.some((s) => !s.takenBy && this.usable(o, s))) out.push(o);
    return out;
  }
  reserve(o: SmartObject, who: string): Slot | null {
    const s = o.slots.find((sl) => !sl.takenBy && this.usable(o, sl));
    if (!s) return null;
    s.takenBy = who;
    return s;
  }
  release(who: string): void {
    for (const o of this.objects.values()) {
      for (const s of o.slots) if (s.takenBy === who) s.takenBy = null;
      for (const s of o.queue ?? []) if (s.takenBy === who) s.takenBy = null;
    }
  }
  /** A free place in the queue, nearest the counter first. */
  reserveQueue(o: SmartObject, who: string): Slot | null {
    const s = o.queue?.find((q) => !q.takenBy);
    if (!s) return null;
    s.takenBy = who;
    return s;
  }
  /** Shops with every slot taken but room in the queue (open now). */
  queueable(kind: SmartKind, hour: number): SmartObject[] {
    const out: SmartObject[] = [];
    for (const o of this.objects.values())
      if (o.kind === kind && o.queue && this.isOpen(o, hour) && o.slots.every((s) => s.takenBy) && o.queue.some((q) => !q.takenBy)) out.push(o);
    return out;
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

/** Where people wait outside a shop, from its counter (x, z offsets; nearest first). */
const SHOP_QUEUE: readonly (readonly [number, number])[] = [
  [0.75, 0.15],
  [1.35, 0.3],
  [1.95, 0.45],
];

export function registerStaticObjects(r: SmartRegistry): void {
  // each of the town's benches has a name of its own ("the pond bench"): people have favourites
  for (const b of BENCHES) r.add({ id: b.id, kind: 'bench', label: b.id, x: b.x, z: b.z, slots: benchSlots(b.x, b.z, b.ry) });
  VENDING.forEach((v, i) => r.add({ id: `vending-${i}`, kind: 'vending', label: 'vending', x: v.x, z: v.z, slots: [frontSlot(v.x, v.z, 0, 0.85)] }));
  const shops: [string, string, number, [number, number]][] = [
    ['ramen', 'ramen', -2, [11, 23]],
    ['bakery', 'bakery', 1.5, [7, 19]],
    ['florist', 'florist', 4.7, [9, 18]],
    ['books', 'books', 7.6, [10, 20]],
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
      soft: 1,
      // a short line out into the lane, angled a little up the street
      queue: SHOP_QUEUE.map(([dx, dz]) => ({ x: -9.55 + dx, z: z + dz, face: -Math.PI / 2, pose: 'stand' as const, takenBy: null })),
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
    label: 'shrine',
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
