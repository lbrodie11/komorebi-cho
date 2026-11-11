import * as THREE from 'three';
import { Rng } from '../core/rng';
import { hourInRange } from '../core/clock';
import { clamp } from '../core/math';
import type { EventBus, GameEvents, WorldEditEvent } from '../core/events';
import type { Materials } from '../render/materials';
import { DOORS, EXITS } from '../world/layout';
import { groundHeight } from '../world/terrain';
import type { NavGrid } from './grid';
import { PERSONAS, type Persona } from './personas';
import type { Pose, Slot, SmartKind, SmartObject, SmartRegistry } from './smart';
import { bubbleMaterial, type BubbleIcon } from './bubbles';
import { msg, type Msg, type MsgKey } from '../i18n';

type TaskKind = 'home' | 'commute' | 'work' | 'inside' | 'use' | 'wander' | 'inspect' | 'jog' | 'deliver' | 'linger';

interface Task {
  kind: TaskKind;
  /** What the card says they are doing. */
  label: Msg;
  goal: [number, number];
  dwell: number; // game minutes once arrived
  pose: Pose;
  face?: number;
  obj?: SmartObject;
  slot?: Slot;
  hide?: boolean;
  bubble?: BubbleIcon;
  interruptible: boolean;
  /** Exact standing point (slot), reached by a short glide after the path ends. */
  exact?: [number, number];
  onArrive?: () => void;
}

const PERSONA_SEED = 77;

/** One neighbour: a little rig of boxes plus a brain made of a schedule, three needs and a utility picker. */
export class Agent {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  private readonly legs: THREE.Mesh[] = [];
  private readonly umbrella: THREE.Mesh;
  private readonly bubble: THREE.Sprite;
  private readonly tool?: THREE.Object3D;
  task: Task | null = null;
  hidden = true;
  path: [number, number][] = [];
  pathIdx = 0;
  pathVersion = -1;
  dwellLeft = 0;
  arrived = false;
  standUp = 0;
  bubbleT = 0;
  walkPhase = 0;
  pose: Pose = 'stand';
  readonly needs = { fatigue: 0.2, thirst: 0.2 };
  readonly known = new Set<string>();
  lastInspect = -999;
  /** Stepping aside from something that just landed where they stood (from, to, elapsed, duration). */
  shuffle: { fx: number; fz: number; tx: number; tz: number; t: number; dur: number } | null = null;
  /** Where they went out of sight (home door, shop door, the station exit). They reappear there. */
  hiddenAt: [number, number] | null = null;
  /** Places that turned out unreachable (boxed in by the player); skipped until the game-minute stamp. */
  readonly avoid = new Map<string, number>();
  readonly rng: Rng;
  readonly scale: number;

  constructor(
    readonly p: Persona,
    m: Materials,
    index: number,
    seed = 0,
  ) {
    // `seed` (0 = authored default) varies routines for seeded screenshot runs without touching geometry.
    this.rng = new Rng(((PERSONA_SEED + index * 101) ^ seed) >>> 0);
    this.scale = p.kid ? 0.68 : 1;
    const mat = (c: string) => m.solid(c, 0.85);
    for (const o of [-0.11, 0.11]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.2), mat(p.colors.legs));
      leg.geometry.translate(0, -0.21, 0);
      leg.position.set(o, 0.42, 0);
      this.legs.push(leg);
      this.root.add(leg);
    }
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.34), mat(p.colors.top));
    this.body.position.y = 0.73;
    this.body.userData.agent = this;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), mat(p.colors.skin));
    head.position.y = 1.22;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.13, 0.35), mat(p.colors.hair));
    hair.position.set(0, 1.42, -0.01);
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.08), mat(p.colors.hair));
    hairBack.position.set(0, 1.3, -0.15);
    this.root.add(this.body, head, hair, hairBack);
    if (p.accessory === 'apron') {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.04), mat(p.colors.accent ?? '#f6efe0'));
      a.position.set(0, 0.66, 0.18);
      this.root.add(a);
    } else if (p.accessory === 'bag') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.3), mat(p.colors.accent ?? '#45291b'));
      b.position.set(0.28, 0.62, 0);
      this.root.add(b);
    } else if (p.accessory === 'hat') {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), mat(p.colors.accent ?? '#f6efe0'));
      h.position.y = 1.5;
      this.root.add(h);
    } else if (p.accessory === 'box') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.3), mat(p.colors.accent ?? '#d4a774'));
      b.position.set(0, 0.85, 0.3);
      this.root.add(b);
    } else if (p.accessory === 'cane') {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.05), mat('#45291b'));
      c.position.set(0.3, 0.38, 0.12);
      this.root.add(c);
    } else if (p.accessory === 'broom') {
      const g = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.05), mat('#b07a4c'));
      stick.position.y = 0.55;
      const brush = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.08), mat('#d4a774'));
      brush.position.y = 0.05;
      g.add(stick, brush);
      g.position.set(0.3, 0, 0.25);
      g.rotation.x = 0.4;
      this.tool = g;
      this.root.add(g);
    }
    this.umbrella = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.28, 8), mat(this.rng.pick(['#2f4a72', '#d0402a', '#f6efe0', '#3c6838', '#ffd37a'])));
    this.umbrella.position.y = 1.86;
    this.umbrella.visible = false;
    this.root.add(this.umbrella);
    this.bubble = new THREE.Sprite(bubbleMaterial('notice'));
    this.bubble.scale.set(0.9, 0.9, 1);
    this.bubble.position.y = 2.25;
    this.bubble.visible = false;
    this.root.add(this.bubble);
    this.root.scale.setScalar(this.scale);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.root.visible = false;
  }

  get x(): number {
    return this.root.position.x;
  }
  get z(): number {
    return this.root.position.z;
  }

  say(icon: BubbleIcon, seconds = 2.5): void {
    this.bubble.material = bubbleMaterial(icon);
    this.bubbleT = seconds;
  }

  placeAt(x: number, z: number): void {
    this.root.position.set(x, groundHeight(x, z), z);
  }

  /** Visual pose + walk cycle + umbrella; called every frame. */
  animate(dt: number, moving: boolean, rain: number, time: number): void {
    const run = this.task?.kind === 'jog';
    if (moving) this.walkPhase += dt * (run ? 14 : 9) * (this.p.kid ? 1.2 : 1);
    const swing = moving ? Math.sin(this.walkPhase) * (run ? 0.9 : 0.55) : 0;
    const ground = groundHeight(this.x, this.z);
    let y = ground + (moving ? Math.abs(Math.sin(this.walkPhase)) * 0.05 : 0);
    let legX = 0;
    this.body.rotation.x = 0;
    this.root.scale.y = this.scale;
    switch (this.pose) {
      case 'sit':
        legX = -1.45;
        y = ground + 0.12 * this.scale;
        break;
      case 'pray':
        this.body.rotation.x = 0.28;
        break;
      case 'crouch':
        this.root.scale.y = this.scale * 0.72;
        this.body.rotation.x = 0.35;
        break;
      case 'sweep':
        this.body.rotation.x = 0.15;
        if (this.tool) this.tool.rotation.z = Math.sin(time * 4) * 0.5;
        break;
      default:
        break;
    }
    if (this.pose === 'sit') {
      this.legs[0]!.rotation.x = legX;
      this.legs[1]!.rotation.x = legX;
    } else {
      this.legs[0]!.rotation.x = swing;
      this.legs[1]!.rotation.x = -swing;
    }
    this.root.position.y = y;
    this.umbrella.visible = rain > 0.25 && !this.hidden && this.task?.kind !== 'jog';
    if (this.bubbleT > 0) {
      this.bubbleT -= dt;
      this.bubble.visible = true;
      this.bubble.position.y = 2.25 + Math.sin(time * 3) * 0.04;
    } else this.bubble.visible = false;
  }
}

export interface ResidentInfo {
  /** Persona id: the HUD words name, role and blurb from `persona.<id>.*`. */
  id: string;
  doing: Msg;
  knows: number;
}

/** A neighbour as a message parameter: their short name, in the reader's language. */
export const who = (id: string): Msg => ({ key: `persona.${id}.short` as MsgKey });
/** A smart object's noun (`noun.<label>`) as a message parameter. */
export const thing = (label: string): Msg => ({ key: `noun.${label}` as MsgKey });

/**
 * The resident simulation. Layers (cheap versions of the research plan):
 *   schedule (sleep / commute / work blocks) -> needs -> utility choice over
 *   smart objects -> reservation -> A* path -> action with dwell + pose.
 * Anti-oscillation: tasks are committed until their dwell ends, decisions are
 * only taken between tasks, and interruptions follow explicit contracts.
 */
export class Residents {
  readonly agents: Agent[];
  private readonly pickables: THREE.Object3D[] = [];
  private storyCooldown = 0;
  private minutes = 0;
  private readonly toldUse = new Set<string>();

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly grid: NavGrid,
    private readonly smart: SmartRegistry,
    private readonly bus: EventBus<GameEvents>,
    m: Materials,
    seed = 0,
  ) {
    this.agents = PERSONAS.map((p, i) => new Agent(p, m, i, seed));
    for (const a of this.agents) {
      scene.add(a.root);
      this.pickables.push(a.body);
    }
  }

  get bodies(): THREE.Object3D[] {
    return this.pickables;
  }

  info(a: Agent): ResidentInfo {
    return {
      id: a.p.id,
      doing: a.hidden ? this.hiddenLabel(a) : (a.task?.label ?? msg('task.thinking')),
      knows: a.known.size,
    };
  }

  private hiddenLabel(a: Agent): Msg {
    if (a.task?.kind === 'commute') return msg(a.p.kid ? 'task.atSchool' : 'task.atWork');
    if (a.task?.kind === 'inside') return msg('task.busyInside');
    if (a.task?.kind === 'home') return msg(a.task.dwell > 30 ? 'task.asleep' : 'task.atHome');
    return msg('task.elsewhere');
  }

  /** Is anyone standing within r of (x,z)? Used to refuse placing things on people. */
  anyoneNear(x: number, z: number, r: number): boolean {
    return this.agents.some((a) => !a.hidden && Math.hypot(a.x - x, a.z - z) < r);
  }

  update(dt: number, gm: number, hour: number, rain: number, time: number): void {
    this.storyCooldown -= dt;
    this.minutes += gm;
    for (const a of this.agents) {
      a.needs.thirst = clamp(a.needs.thirst + gm * 0.004, 0, 1);
      if (a.shuffle) {
        this.shuffleStep(a, dt);
        a.animate(dt, true, rain, time);
        continue;
      }
      if (!a.task) this.plan(a, hour, rain);
      if (a.task) this.step(a, dt, gm, hour, rain);
      a.animate(dt, !a.hidden && !a.arrived && a.standUp <= 0 && a.path.length > 0, rain, time);
    }
  }

  // ── Planning ────────────────────────────────────────────────────────────
  private homePoint(a: Agent): [number, number] {
    if (a.p.home === 'exit') return this.nearestExit(a);
    const d = DOORS[a.p.home];
    return d ? [d.x, d.z] : this.nearestExit(a);
  }
  private nearestExit(a: Agent): [number, number] {
    let best = EXITS[0]!;
    let bd = Infinity;
    for (const e of EXITS) {
      const d = Math.hypot(e[0] - a.x, e[1] - a.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return [best[0], best[1]];
  }

  private plan(a: Agent, hour: number, rain: number): void {
    const p = a.p;
    const asleep = hourInRange(hour, p.sleep[0], p.sleep[1]);
    const commuting = p.commute && hourInRange(hour, p.commute[0], p.commute[1]) && !(p.kid && rain > 0.9);
    const working = p.work && hourInRange(hour, p.work.hours[0], p.work.hours[1]);

    if (a.hidden && !asleep && !commuting) this.emerge(a);

    if (asleep)
      return this.assign(a, { kind: 'home', label: msg('task.goingHome'), goal: this.homePoint(a), dwell: 45, pose: 'stand', hide: true, interruptible: true });
    if (commuting) {
      const out: [number, number] = [...this.rng(a).pick(EXITS)] as [number, number];
      return this.assign(a, {
        kind: 'commute',
        label: msg(p.kid ? 'task.toSchool' : 'task.toStation'),
        goal: out,
        dwell: 30,
        pose: 'stand',
        hide: true,
        interruptible: true,
      });
    }
    if (working) {
      const w = p.work!;
      if (a.rng.chance(0.45) && DOORS[w.door]) {
        const d = DOORS[w.door]!;
        return this.assign(a, {
          kind: 'inside',
          label: msg('task.busyInside'),
          goal: [d.x, d.z],
          dwell: a.rng.range(8, 22),
          pose: 'stand',
          hide: true,
          interruptible: true,
        });
      }
      return this.assign(a, {
        kind: 'work',
        label: msg(`work.${p.id}` as MsgKey),
        goal: w.spot,
        dwell: a.rng.range(6, 14),
        pose: w.action === 'sweep' ? 'sweep' : w.action === 'crouch' ? 'crouch' : 'stand',
        face: w.face,
        interruptible: true,
      });
    }
    this.freeTime(a, hour, rain);
  }

  private rng(a: Agent): Rng {
    return a.rng;
  }

  private emerge(a: Agent): void {
    const [x, z] = a.hiddenAt ?? this.homePoint(a);
    a.placeAt(x, z);
    a.hidden = false;
    a.root.visible = true;
  }

  /** Utility AI: score every reachable option, pick the best (with a little personality noise). */
  private freeTime(a: Agent, hour: number, rain: number): void {
    const p = a.p;
    const like = (k: SmartKind | 'wander' | 'jog' | 'deliver') => p.likes[k] ?? 0;
    const night = hour > 20.5 || hour < 5.5;
    type Option = { score: number; make: () => Task | null };
    const opts: Option[] = [];
    const dist = (o: { x: number; z: number }) => Math.hypot(o.x - a.x, o.z - a.z);
    const dPen = (o: { x: number; z: number }) => 1 / (1 + dist(o) / 22);
    const rainPen = 1 - rain * 0.7;

    const useOpt = (kind: SmartKind, base: number, label: (o: SmartObject) => Msg, dwell: [number, number], bubble?: BubbleIcon) => {
      for (const o of this.smart.available(kind, hour)) {
        if (o.placed && !a.known.has(o.id)) continue;
        if ((a.avoid.get(o.id) ?? -1) > this.minutes) continue;
        const crowd = o.slots.filter((s) => s.takenBy).length / o.slots.length;
        const score = base * dPen(o) * (1 - crowd * 0.5);
        opts.push({ score, make: () => this.useTask(a, o, label(o), a.rng.range(dwell[0], dwell[1]), bubble) });
      }
    };
    const isKid = !!p.kid;
    useOpt('bench', (0.25 + a.needs.fatigue * 0.8 + like('bench')) * rainPen, () => msg('task.sitting'), [8, 20], 'note');
    useOpt('vending', a.needs.thirst * 1.1 + like('vending') * 0.5, () => msg('task.drink'), [1.2, 2], 'cup');
    if (!night) {
      useOpt('shop', 0.25 + like('shop'), (o) => msg('task.browsing', { thing: thing(o.label) }), [3, 7]);
      useOpt('view', (0.3 + like('view')) * rainPen, () => msg('task.koi'), [3, 8], 'sparkle');
      useOpt('shrine', 0.15 + like('shrine'), () => msg('task.shrine'), [1.5, 3]);
      useOpt('temple', 0.12 + like('temple'), () => msg('task.temple'), [2, 4]);
      useOpt('cafe', (0.25 + like('cafe') + rain * 0.2) * (isKid ? 0.1 : 1), () => msg('task.coffee'), [12, 30], 'cup');
      useOpt('garden', like('garden'), () => msg('task.allotment'), [8, 16]);
      useOpt('admire', (0.35 + like('admire')) * rainPen, (o) => msg('task.admiring', { thing: thing(o.label) }), [2, 5], 'heart');
      useOpt('catbowl', like('catbowl'), () => msg('task.cats'), [5, 10], 'heart');
      if (isKid) {
        useOpt('swing', 0.6 + like('swing'), () => msg('task.swings'), [6, 12], 'note');
        useOpt('sand', 0.5 + like('sand'), () => msg('task.sand'), [8, 15]);
      }
    }
    // wandering the park
    opts.push({
      score: (0.3 + like('wander')) * rainPen,
      make: () => {
        const pt = this.grid.randomOpenIn(() => a.rng.next(), -7.5, 7.8, -3.5, 8.2);
        return pt ? { kind: 'wander', label: msg('task.stroll'), goal: pt, dwell: a.rng.range(0.5, 2), pose: 'stand', interruptible: true } : null;
      },
    });
    if (like('jog') > 0 && !night && rain < 0.4) opts.push({ score: like('jog'), make: () => this.jogTask(a) });
    if (like('deliver') > 0 && hourInRange(hour, 9, 18))
      opts.push({
        score: like('deliver'),
        make: () => {
          const ids = ['ramen', 'bakery', 'florist', 'books', 'kissaten', 'aptA', 'aptB', 'aptC', 'sento'];
          const d = DOORS[a.rng.pick(ids)]!;
          return {
            kind: 'deliver',
            label: msg('task.delivery'),
            goal: [d.x, d.z],
            dwell: a.rng.range(0.6, 1.4),
            pose: 'stand',
            interruptible: true,
            bubble: 'notice',
          };
        },
      });
    // go home early when it pours or gets late
    opts.push({
      score: 0.08 + rain * 0.5 + (night ? 0.8 : 0),
      make: () => ({
        kind: 'home',
        label: msg('task.headingHome'),
        goal: this.homePoint(a),
        dwell: a.rng.range(10, 30),
        pose: 'stand',
        hide: true,
        interruptible: true,
      }),
    });

    let best: Option | null = null;
    let bestScore = -1;
    for (const o of opts) {
      const s = o.score * a.rng.range(0.75, 1.25);
      if (s > bestScore) {
        bestScore = s;
        best = o;
      }
    }
    const t = best?.make();
    if (t) this.assign(a, t);
  }

  private jogTask(a: Agent): Task {
    const loop: [number, number][] = [
      [-9.2, 9.5],
      [-9.2, -4.9],
      [9.2, -4.9],
      [9.2, 9.5],
    ];
    const i = a.rng.int(0, 3);
    return { kind: 'jog', label: msg('task.jogging'), goal: loop[i]!, dwell: 0.2, pose: 'stand', interruptible: true };
  }

  private useTask(a: Agent, o: SmartObject, label: Msg, dwell: number, bubble?: BubbleIcon): Task | null {
    const slot = this.smart.reserve(o, a.p.id);
    if (!slot) return null;
    return {
      kind: 'use',
      label,
      goal: [slot.x, slot.z],
      exact: [slot.x, slot.z],
      dwell,
      pose: slot.pose,
      face: slot.face,
      obj: o,
      slot,
      bubble,
      interruptible: true,
      onArrive: () => {
        if (o.kind === 'vending' || o.kind === 'cafe') a.needs.thirst = 0;
        if (o.kind === 'bench' || o.kind === 'cafe') a.needs.fatigue = 0;
        if (o.placed) {
          const others = this.agents.filter((b) => b !== a && !b.hidden && b.arrived && b.task?.obj?.id === o.id).map((b) => b.p.id);
          this.bus.emit('used', { who: a.p.id, id: o.id, with: others });
        }
        const key = `${a.p.id}|${o.id}`;
        if (o.placed && this.storyCooldown <= 0 && !this.toldUse.has(key)) {
          this.toldUse.add(key);
          const line: MsgKey =
            o.kind === 'bench' ? 'story.useBench' : o.kind === 'vending' ? 'story.useVending' : o.kind === 'catbowl' ? 'story.useCatbowl' : 'story.useOther';
          this.story(msg(line, { who: who(a.p.id), thing: thing(o.label) }), a.p.id);
        }
      },
    };
  }

  private assign(a: Agent, t: Task): void {
    a.task = t;
    a.arrived = false;
    a.path = [];
    a.pathIdx = 0;
    a.pathVersion = -1;
    a.dwellLeft = t.dwell;
    if (a.hidden) {
      // already out of sight: they are simply "there" now (at work, at the station...)
      if (t.hide) a.hiddenAt = [t.goal[0], t.goal[1]];
      return;
    }
    this.repath(a);
  }

  private repath(a: Agent): void {
    if (!a.task) return;
    const path = this.grid.findPath(a.x, a.z, a.task.goal[0], a.task.goal[1]);
    a.pathVersion = this.grid.version;
    if (!path) {
      // Unreachable (e.g. the player boxed the goal in): give up gracefully, remember it for a while,
      // and stand and think for a moment instead of re-planning every frame. Never teleport while visible.
      const t = a.task;
      if (t.obj) a.avoid.set(t.obj.id, this.minutes + 90);
      this.endTask(a, 'question');
      a.task = { kind: 'linger', label: msg('task.anotherWay'), goal: [a.x, a.z], dwell: a.rng.range(1, 2.5), pose: 'stand', interruptible: true };
      a.arrived = true;
      a.dwellLeft = a.task.dwell;
      return;
    }
    a.path = path;
    a.pathIdx = 1;
  }

  private endTask(a: Agent, icon?: BubbleIcon): void {
    const t = a.task;
    if (t?.obj && t.kind === 'inspect') t.obj.inspectors = Math.max(0, t.obj.inspectors - 1);
    this.smart.release(a.p.id);
    if (a.pose === 'sit' || a.pose === 'crouch') a.standUp = 0.6;
    a.pose = 'stand';
    a.task = null;
    a.path = [];
    a.arrived = false;
    if (icon) a.say(icon, 1.6);
  }

  // ── Execution ───────────────────────────────────────────────────────────
  private step(a: Agent, dt: number, gm: number, _hour: number, _rain: number): void {
    const t = a.task!;
    if (a.hidden) {
      a.dwellLeft -= gm;
      if (a.dwellLeft <= 0) a.task = null; // re-plan; may emerge
      return;
    }
    if (a.standUp > 0) {
      a.standUp -= dt;
      return;
    }
    if (!a.arrived) {
      if (a.pathVersion !== this.grid.version) {
        a.pathVersion = this.grid.version;
        if (this.grid.pathBlocked([[a.x, a.z], ...a.path.slice(a.pathIdx)], 1)) this.repath(a);
      }
      if (!a.task) return;
      this.walk(a, dt);
      return;
    }
    // acting
    a.dwellLeft -= gm;
    if (t.face !== undefined) a.root.rotation.y = t.face;
    if (t.kind === 'inspect' && a.bubbleT < 0.3 && a.dwellLeft < t.dwell * 0.6 && t.bubble) {
      a.say(t.bubble, 2);
      t.bubble = undefined;
    }
    if (a.dwellLeft <= 0) {
      this.endTask(a);
    }
  }

  private walk(a: Agent, dt: number): void {
    const t = a.task!;
    let move = a.p.speed * dt;
    while (move > 0 && a.pathIdx < a.path.length) {
      const [tx, tz] = a.path[a.pathIdx]!;
      const dx = tx - a.x,
        dz = tz - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        a.pathIdx++;
        continue;
      }
      const s = Math.min(d, move);
      a.root.position.x += (dx / d) * s;
      a.root.position.z += (dz / d) * s;
      a.root.rotation.y = Math.atan2(dx, dz);
      move -= s;
      if (s >= d) a.pathIdx++;
    }
    if (a.pathIdx >= a.path.length) {
      if (t.exact) {
        // short glide onto the slot (benches, chairs and swings sit inside obstacle footprints)
        const dx = t.exact[0] - a.x,
          dz = t.exact[1] - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.03) {
          const s = Math.min(d, dt * 1.2);
          a.root.position.x += (dx / d) * s;
          a.root.position.z += (dz / d) * s;
          return;
        }
      }
      this.arrive(a);
    }
  }

  private arrive(a: Agent): void {
    const t = a.task!;
    a.arrived = true;
    a.path = [];
    a.pose = t.pose;
    if (t.hide) {
      a.hiddenAt = [a.x, a.z];
      a.hidden = true;
      a.root.visible = false;
      return;
    }
    if (t.kind === 'jog') {
      a.task = null;
      if (a.rng.chance(0.82)) this.assign(a, this.jogTask(a));
      return;
    }
    if (t.bubble && t.kind !== 'inspect') a.say(t.bubble, 2.2);
    if (t.kind === 'inspect') a.say('notice', 1.4);
    t.onArrive?.();
  }

  // ── Reactions to the player's edits ────────────────────────────────────
  /**
   * The next placement is guaranteed a visible reaction (the first-minutes hint uses this, so a
   * new player's first bench never goes unnoticed). Cleared once someone reacts.
   */
  guaranteeNext = false;

  onPlaced(ev: WorldEditEvent, o: SmartObject, hour: number): void {
    const free = this.agents
      .filter((a) => !a.hidden && a.task?.interruptible !== false && a.task?.kind !== 'inspect' && a.task?.kind !== 'home' && a.task?.kind !== 'commute')
      .map((a) => ({ a, d: Math.hypot(a.x - ev.x, a.z - ev.z) }))
      .sort((x, y) => x.d - y.d);
    const candidates = free.filter((c) => c.d < 15);
    let reacted = 0;
    for (const { a, d } of candidates) {
      if (o.inspectors >= 2 || reacted >= 3) break;
      const slack = a.task?.kind === 'work' ? 0.4 : 1;
      const prob = a.p.curiosity * (1 - d / 15) * (0.4 + ev.novelty) * slack;
      if (a.rng.next() > prob) continue;
      reacted++;
      this.inspect(a, o, ev, hour);
    }
    if (reacted === 0 && this.guaranteeNext) {
      // the most curious of the three nearest people who are out and about (however far), so it lands every time
      const near = this.grid.nearestOpen(ev.x, ev.z, 4);
      const pick = free
        .filter((c) => near && this.grid.findPath(c.a.x, c.a.z, near[0], near[1]))
        .slice(0, 3)
        .sort((x, y) => y.a.p.curiosity - x.a.p.curiosity)[0];
      if (pick) {
        reacted++;
        this.inspect(pick.a, o, ev, hour);
      }
    }
    if (reacted > 0) this.guaranteeNext = false;
    if (reacted === 0) this.story(msg('story.unnoticed', { thing: thing(o.label) }));
  }

  private inspect(a: Agent, o: SmartObject, ev: WorldEditEvent, _hour: number): void {
    this.endTask(a);
    o.inspectors++;
    a.known.add(o.id);
    a.lastInspect = performance.now();
    const ang = Math.atan2(a.x - ev.x, a.z - ev.z);
    const r = 1.2;
    const spot = this.grid.nearestOpen(ev.x + Math.sin(ang) * r, ev.z + Math.cos(ang) * r, 4) ?? [a.x, a.z];
    const face = Math.atan2(ev.x - spot[0], ev.z - spot[1]);
    const reaction: BubbleIcon =
      o.kind === 'admire' ? 'heart' : o.kind === 'vending' ? 'cup' : o.kind === 'catbowl' ? 'heart' : a.rng.pick(['sparkle', 'note', 'heart'] as const);
    a.say('notice', 1.2);
    this.assign(a, {
      kind: 'inspect',
      label: msg('task.looking', { thing: thing(o.label) }),
      goal: spot,
      dwell: a.rng.range(2.5, 4.5),
      pose: 'stand',
      face,
      obj: o,
      bubble: reaction,
      interruptible: true,
    });
    const line = a.rng.pick(['story.notice1', 'story.notice2', 'story.notice3'] as const);
    this.story(msg(line, { who: who(a.p.id), thing: thing(o.label) }), a.p.id);
    this.bus.emit('noticed', { who: a.p.id, id: o.id });
  }

  /** Passing close to a placed object you haven't seen yet: chance to notice it. */
  noticePass(placed: SmartObject[], hour: number): void {
    for (const a of this.agents) {
      if (a.hidden || a.task?.kind === 'inspect' || a.task?.kind === 'home' || a.task?.kind === 'commute') continue;
      for (const o of placed) {
        if (a.known.has(o.id) || o.inspectors >= 2) continue;
        if (Math.hypot(a.x - o.x, a.z - o.z) < 3.2 && a.rng.chance(a.p.curiosity * 0.5)) {
          this.inspect(a, o, { id: o.id, kind: o.kind, x: o.x, z: o.z, novelty: 0.5 }, hour);
          break;
        }
        if (Math.hypot(a.x - o.x, a.z - o.z) < 3.2) a.known.add(o.id);
      }
    }
  }

  /**
   * Something just landed on (x, z) with radius r (a placement, a move, an undo putting something
   * back): anyone standing there shuffles aside over 0.3–0.6 s, to the nearest open spot beyond its
   * edge, then carries on (or, if they had arrived somewhere, stands a moment and re-plans). Call it
   * after the object is stamped on the nav grid. Nobody teleports and nobody ends up inside it.
   */
  shuffleAside(x: number, z: number, r: number): void {
    for (const a of this.agents) {
      if (a.hidden || a.shuffle) continue;
      const d = Math.hypot(a.x - x, a.z - z);
      if (d > r + 0.3) continue;
      const ang = d > 1e-3 ? Math.atan2(a.x - x, a.z - z) : a.rng.range(0, Math.PI * 2);
      const want = r + 0.4;
      const spot = this.grid.nearestOpen(x + Math.sin(ang) * want, z + Math.cos(ang) * want, 3) ?? this.grid.nearestOpen(a.x, a.z, 4);
      if (!spot) continue;
      const len = Math.hypot(spot[0] - a.x, spot[1] - a.z);
      if (a.arrived || a.pose !== 'stand') this.endTask(a, 'question');
      a.standUp = 0;
      a.pose = 'stand';
      a.shuffle = { fx: a.x, fz: a.z, tx: spot[0], tz: spot[1], t: 0, dur: clamp(len / 2.2, 0.3, 0.6) };
    }
  }

  private shuffleStep(a: Agent, dt: number): void {
    const s = a.shuffle!;
    s.t = Math.min(s.dur, s.t + dt);
    const k = s.t / s.dur;
    const e = k * k * (3 - 2 * k);
    a.root.position.x = s.fx + (s.tx - s.fx) * e;
    a.root.position.z = s.fz + (s.tz - s.fz) * e;
    if (Math.hypot(s.tx - s.fx, s.tz - s.fz) > 1e-3) a.root.rotation.y = Math.atan2(s.tx - s.fx, s.tz - s.fz);
    if (k < 1) return;
    a.shuffle = null;
    // still on the way somewhere: find the way again from here
    if (a.task && !a.arrived) {
      a.path = [];
      a.pathIdx = 0;
      this.repath(a);
    }
  }

  /**
   * A door moved with its building (a shop slid along the street): whoever is walking to it heads
   * for the new one, and whoever is inside will come out of the new one. Nobody visible is moved.
   */
  onDoorMoved(from: readonly [number, number], to: readonly [number, number]): void {
    const at = (p: readonly [number, number] | null | undefined) => !!p && Math.hypot(p[0] - from[0], p[1] - from[1]) < 0.05;
    for (const a of this.agents) {
      if (at(a.hiddenAt)) a.hiddenAt = [to[0], to[1]];
      const t = a.task;
      if (!t || !at(t.goal)) continue;
      t.goal = [to[0], to[1]];
      if (a.hidden) continue;
      a.arrived = false;
      a.path = [];
      a.pathIdx = 0;
      this.repath(a);
    }
  }

  onRemoved(id: string): void {
    for (const a of this.agents) {
      a.known.delete(id);
      if (a.task?.obj?.id === id) {
        // interruption contract: stand up, look puzzled, re-plan. Never pop.
        this.endTask(a, 'question');
      }
    }
  }

  private story(m: Msg, whoId?: string): void {
    this.storyCooldown = 2;
    this.bus.emit('story', { msg: m, who: whoId });
  }

  /** Persistable snapshot of what residents remember. */
  memory(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const a of this.agents) out[a.p.id] = [...a.known];
    return out;
  }
  restoreMemory(mem: Record<string, string[]>): void {
    for (const a of this.agents) for (const id of mem[a.p.id] ?? []) a.known.add(id);
  }
}
