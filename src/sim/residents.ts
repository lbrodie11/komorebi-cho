import * as THREE from 'three';
import { Rng, stream } from '../core/rng';
import { hourInRange, type Season } from '../core/clock';
import { clamp } from '../core/math';
import { Passage } from './passage';
import { PlaceMemory, type PlaceMemoryData } from './places';
import { curve, rank, score } from './utility';
import { Diary, type DiaryEntry } from './diary';
import { Bonds, type Promotion, type Rung } from './bonds';
import { butFor, placeScore, type FieldEnv } from './field';
import type { EventBus, GameEvents, WorldEditEvent } from '../core/events';
import type { Materials } from '../render/materials';
import { DOORS, EXITS, G, PASSAGES, ROOF_TERRACE, SHELTERS, TREES } from '../world/layout';
import { groundHeight } from '../world/terrain';
import type { NavGrid } from './grid';
import { PERSONAS, type Persona } from './personas';
import type { Pose, Slot, SmartKind, SmartObject, SmartRegistry } from './smart';
import { bubbleMaterial, type BubbleIcon } from './bubbles';
import { msg, type Msg, type MsgKey } from '../i18n';

type TaskKind =
  'home' | 'commute' | 'work' | 'inside' | 'use' | 'wander' | 'inspect' | 'jog' | 'deliver' | 'linger' | 'queue' | 'search' | 'shelter' | 'roof' | 'ride';

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
  /** Queueing: what they'll do at the counter. */
  next?: { label: Msg; dwell: number; bubble?: BubbleIcon };
}

const PERSONA_SEED = 77;

/** One neighbour: a little rig of boxes plus a brain made of a schedule, three needs and a utility picker. */
/** How close (m) another resident must be before a walker sidesteps (two walkers close at ~2.4 m/s). */
const AVOID_RADIUS = 1.2;
/**
 * Extra pull of a favourite (enough to keep a habit, not to shut out something better), and of
 * something new to the curious (it fades with familiarity's half-life, slower once they've tried it).
 */
const FAVOURITE_BONUS = 0.3;
const NOVELTY_PULL = 1.4;
/** A day in game minutes. */
const DAY = 1440;
/** After dark, a place this close (m) to a placed lantern counts as lit. */
const LIT_RADIUS = 3;
/** Rain heavier than this is a shower; snow slows walking to this share of pace. */
const SHOWER = 0.35;
const SNOW_PACE = 0.75;
/** Shops with an awning to shelter under (their door, which moves with them). */
const AWNING_SHOPS = ['bakery', 'florist'] as const;
/** Footprints in the snow: how many at once, and how long each lasts (real seconds). */
const FOOTPRINTS = 240;
const PRINT_LIFE = 90;
/** Game minutes until doing the same kind of thing again appeals as much as before. */
const SATED_MINUTES = 60;
/** A bow's length (s), how often a pair greets at most (game minutes), and a chat turn (s). */
const BOW_SECONDS = 0.8;
const GREET_EVERY = 60;
const CHAT_TURN = 2.4;

/** How readily two neighbours take to each other (0..1, authored; either side's word counts): a prior, not a fact. */
export function friendship(a: { p: Persona }, b: { p: Persona }): number {
  return Math.max(a.p.friends?.[b.p.id] ?? 0, b.p.friends?.[a.p.id] ?? 0);
}
/** How close a pair on each rung of the bond ladder is, 0..1 (what choices and crowding read). */
export const CLOSENESS: Record<Rung, number> = { unseen: 0, familiar: 0.1, nod: 0.25, greeting: 0.5, chat: 0.75, friends: 1 };
/** Riding is this many times walking pace. */
const RIDE_PACE = 2.2;
/** People within this distance (m) are in the same place; a game minute of it in a day is a day together. */
const TOGETHER_RADIUS = 4;
const TOGETHER_MINUTES = 1;

/** People within this distance (m) of something make it feel crowded. */
const CROWD_RADIUS = 2;
/** Game minutes someone waits in a shop's line before giving up. */
const QUEUE_PATIENCE = 12;
/** Path searches per tick, at most (20 Hz sim: 120 a second, far more than residents ever need). */
export const PATHS_PER_TICK = 6;

/** How fast anyone turns (rad/s): no snapping round to a new heading. */
const TURN_RATE = 9;
/** A gesture: a glance (the head turns toward something), a nod, a wave. */
export type Gesture = 'glance' | 'nod' | 'wave';
const GESTURE_SECONDS: Record<Gesture, number> = { glance: 1.4, nod: 0.5, wave: 1.3 };

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A gait: how fast the legs cycle (per m/s of walking pace scaled to the stride), how far they swing,
 * how much the body bobs, and how far the arms counter-swing. Kids bounce, the jogger runs with bent
 * arms, someone with a cane takes shorter, slower steps.
 */
export function gaitFor(p: Pick<Persona, 'kid' | 'accessory'>, run: boolean): { rate: number; swing: number; bob: number; arm: number } {
  if (run) return { rate: 14, swing: 0.9, bob: 0.07, arm: 1.1 };
  if (p.kid) return { rate: 11, swing: 0.6, bob: 0.09, arm: 0.6 };
  if (p.accessory === 'cane') return { rate: 7, swing: 0.32, bob: 0.025, arm: 0.2 };
  return { rate: 9, swing: 0.55, bob: 0.05, arm: 0.45 };
}

export class Agent {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  /** Everything above the hips (body, arms, head): it bows, prays and leans as one. */
  private readonly torso = new THREE.Group();
  /** The head (with its hair and hat), pivoting at the neck: nods and glances. */
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Object3D[] = [];
  private readonly legs: THREE.Mesh[] = [];
  /** Where they mean to face (rad): the body turns toward it at TURN_RATE. */
  heading = 0;
  /** A gesture playing: which, how far in (s), and for a glance the world yaw to look toward. */
  gesture: { kind: Gesture; t: number; yaw: number } | null = null;
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
  /** Needs, 0..1: tiredness, thirst, and wanting company (prompt 08). */
  readonly needs = { fatigue: 0.2, thirst: 0.2, social: 0.3 };
  /**
   * Up on the café's roof terrace: out of the stair-head door, across to the deck chair, and back.
   * They count as indoors for the street (nobody down there meets them), but you can see them.
   */
  roof: { phase: 'out' | 'sit' | 'back'; t: number } | null = null;
  /** The height they stand at when it isn't the ground (the roof terrace). */
  perch: number | null = null;
  /** On the bicycle: how many more stretches before taking it back to the rack. */
  riding: number | null = null;
  /** Why they chose the seat they're at or heading for: the placed things without which they'd have gone elsewhere. */
  cause: { obj: string; ids: string[] } | null = null;
  /** Seconds left of a bow (to a neighbour passing by). */
  bowT = 0;
  /** A reaction playing (a hop, a puzzled lean) and how far into it (s). */
  react: { kind: 'hop' | 'lean'; t: number } | null = null;
  /** Reduced motion: no hops or leans. */
  still = false;
  /** When they last changed their day for something the player placed (game minutes), and what. */
  changedAt = -Infinity;
  changedThing: Msg | null = null;
  /** The soft ring at their feet while that's recent (the routine-change highlight). */
  readonly ring: THREE.Mesh;
  /** How far the umbrella is open (0..1, animated). */
  umbrellaOpen = 0;
  /** Distance walked since the last footprint in the snow (m). */
  stride = 0;
  readonly known = new Set<string>();
  lastInspect = -999;
  /** How well they know each place, and which they like best (prompt 08). */
  places = new PlaceMemory();
  /** Their favourite of each kind as last told (so a new favourite is told once). */
  readonly favs = new Map<string, string>();
  /** Favourites the player removed, to go and look for once (id → the place's noun label). */
  readonly missing = new Map<string, string>();
  /** A line a day, from what really happened (prompt 08). */
  readonly diary = new Diary();
  /** When they last did each kind of thing (game minutes): just had a drink, they don't want another. */
  readonly lastDid = new Map<string, number>();
  /** What they chose last of each kind of activity (the hysteresis margin keeps it unless clearly beaten). */
  readonly lastPick = new Map<string, string>();
  /** Simulation seconds until they decide what's next (decisions are staggered, 0.5–2 s apart). */
  thinkUntil = 0;
  /** The narrow passage they are waiting to enter (it is the other way's turn), if any. */
  waitingFor: string | null = null;
  /** Waiting for a path search (searches are rationed per tick, so many re-plans never land in one frame). */
  needsPath = false;
  /** The nav version their region was last checked at (recovery from islands). */
  regionChecked = -1;
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
    // the upper body pivots at the hips (0.42 m): a bow tips body, arms and head together
    const HIP = 0.42;
    this.torso.position.y = HIP;
    this.root.add(this.torso);
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.34), mat(p.colors.top));
    this.body.position.y = 0.73 - HIP;
    this.body.userData.agent = this;
    // arms hang from the shoulders, sleeves in the top's colour, a hand at the end
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.4, 0.13), mat(p.colors.top));
      sleeve.position.y = -0.2;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.11), mat(p.colors.skin));
      hand.position.y = -0.45;
      arm.add(sleeve, hand);
      arm.position.set(side * 0.29, 1.0 - HIP, 0);
      this.arms.push(arm);
      this.torso.add(arm);
    }
    // the head pivots at the neck (1.06 m): nods and glances turn hair and hat with it
    const NECK = 1.06;
    this.head.position.y = NECK - HIP;
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), mat(p.colors.skin));
    face.position.y = 1.22 - NECK;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.13, 0.35), mat(p.colors.hair));
    hair.position.set(0, 1.42 - NECK, -0.01);
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.08), mat(p.colors.hair));
    hairBack.position.set(0, 1.3 - NECK, -0.15);
    this.head.add(face, hair, hairBack);
    this.torso.add(this.body, this.head);
    if (p.accessory === 'apron') {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.04), mat(p.colors.accent ?? '#f6efe0'));
      a.position.set(0, 0.66 - HIP, 0.18);
      this.torso.add(a);
    } else if (p.accessory === 'bag') {
      // over the shoulder, worn outside the arm
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.3), mat(p.colors.accent ?? '#45291b'));
      b.position.set(0.39, 0.62 - HIP, 0);
      this.torso.add(b);
    } else if (p.accessory === 'hat') {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), mat(p.colors.accent ?? '#f6efe0'));
      h.position.y = 1.5 - NECK;
      this.head.add(h);
    } else if (p.accessory === 'box') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.3), mat(p.colors.accent ?? '#d4a774'));
      b.position.set(0, 0.85 - HIP, 0.3);
      this.torso.add(b);
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
    // the routine-change highlight: a soft ring at their feet (Residents shows it while it's recent)
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd37a', transparent: true, opacity: 0.55, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 16).rotateX(-Math.PI / 2), ringMat);
    this.ring.position.y = 0.03;
    this.ring.visible = false;
    this.root.add(this.ring);
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
    // and say it with the body: a little hop for something new, a puzzled lean for a `?`
    if (icon === 'notice' || icon === 'sparkle' || icon === 'heart') this.react = { kind: 'hop', t: 0 };
    else if (icon === 'question') this.react = { kind: 'lean', t: 0 };
  }

  placeAt(x: number, z: number): void {
    this.root.position.set(x, groundHeight(x, z), z);
  }

  /** Turn to face `yaw` at once (placing someone, a memory's pose): no turning animation. */
  faceNow(yaw: number): void {
    this.heading = yaw;
    this.root.rotation.y = yaw;
  }

  /** Play a gesture (a glance toward world yaw `yaw`, a nod, a wave). A new one replaces the last. */
  gestureTo(kind: Gesture, yaw = this.root.rotation.y): void {
    this.gesture = { kind, t: 0, yaw };
  }

  /** Visual pose + walk cycle + arms, head and gestures + umbrella; called every frame. */
  animate(dt: number, moving: boolean, rain: number, time: number): void {
    const run = this.task?.kind === 'jog';
    // on the bicycle they sit, whatever the task's pose says
    const riding = this.riding !== null;
    const pose: Pose = riding ? 'sit' : this.pose;
    const g = gaitFor(this.p, run);
    if (moving) this.walkPhase += dt * g.rate;
    const swing = moving ? Math.sin(this.walkPhase) * g.swing : 0;
    // turning: toward the heading at a capped rate, leaning a little into the turn while walking
    const turn = wrapAngle(this.heading - this.root.rotation.y);
    const step = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, turn));
    this.root.rotation.y = wrapAngle(this.root.rotation.y + step);
    const lean = moving && !this.still ? Math.max(-0.12, Math.min(0.12, turn * 0.25)) : 0;
    const ground = this.perch ?? groundHeight(this.x, this.z);
    let y = ground + (moving && !this.still ? Math.abs(Math.sin(this.walkPhase)) * g.bob : 0);
    let legX = 0;
    let tilt = run ? 0.16 : 0; // runners lean forward
    // arms: counter-swing to the legs when walking; each pose has its own
    let armL = -swing * (g.arm / Math.max(0.01, g.swing)) * 0.8,
      armR = -armL,
      armZ = 0;
    if (run) {
      armL -= 0.5;
      armR -= 0.5; // bent at the elbow, near enough
    }
    this.root.scale.y = this.scale;
    switch (pose) {
      case 'sit':
        legX = riding ? -0.9 : -1.45;
        y = ground + (riding ? 0.42 : 0.12) * this.scale;
        armL = armR = riding ? -1.1 : -0.55; // hands on the bars, or in the lap
        break;
      case 'pray':
        tilt = 0.28;
        armL = armR = -1.25;
        armZ = 0.38; // palms together in front
        break;
      case 'crouch':
        this.root.scale.y = this.scale * 0.72;
        tilt = 0.35;
        armL = armR = -0.9;
        break;
      case 'sweep':
        tilt = 0.15;
        if (this.tool) this.tool.rotation.z = Math.sin(time * 4) * 0.5;
        armL = -0.7 + Math.sin(time * 4) * 0.15;
        armR = -0.6 - Math.sin(time * 4) * 0.15;
        break;
      default:
        break;
    }
    // a small bow to a neighbour passing by
    if (this.bowT > 0) {
      this.bowT = Math.max(0, this.bowT - dt);
      tilt = Math.max(tilt, 0.45 * Math.sin((Math.PI * this.bowT) / BOW_SECONDS));
    }
    this.torso.rotation.set(tilt, 0, -lean);
    if (pose === 'sit') {
      this.legs[0]!.rotation.x = legX;
      this.legs[1]!.rotation.x = legX;
    } else {
      this.legs[0]!.rotation.x = swing;
      this.legs[1]!.rotation.x = -swing;
    }
    // gestures (they carry meaning, so reduced motion keeps them)
    let headX = 0,
      headY = 0,
      waveZ = 0;
    const ge = this.gesture;
    if (ge) {
      ge.t += dt;
      const len = GESTURE_SECONDS[ge.kind];
      const k = Math.sin((Math.PI * Math.min(ge.t, len)) / len);
      if (ge.kind === 'nod') headX = 0.38 * k;
      else if (ge.kind === 'glance') headY = Math.max(-1, Math.min(1, wrapAngle(ge.yaw - this.root.rotation.y))) * Math.min(1, k * 1.6);
      else waveZ = k;
      if (ge.t >= len) this.gesture = null;
    }
    this.head.rotation.set(headX, headY, 0);
    const [l, r] = this.arms as [THREE.Object3D, THREE.Object3D];
    l.rotation.set(armL, 0, -armZ);
    if (waveZ > 0) r.rotation.set(0, 0, waveZ * (2.75 + 0.35 * Math.sin(time * 13)));
    else r.rotation.set(armR, 0, armZ);
    // reactions: a hop (0.5 s), a puzzled lean (1.2 s)
    this.root.rotation.z = 0;
    if (this.react && !this.still) {
      this.react.t += dt;
      const len = this.react.kind === 'hop' ? 0.5 : 1.2;
      const k = Math.sin((Math.PI * Math.min(this.react.t, len)) / len);
      if (this.react.kind === 'hop') y += k * 0.16 * this.scale;
      else this.root.rotation.z = k * 0.2;
      if (this.react.t >= len) this.react = null;
    } else this.react = null;
    this.root.position.y = y;
    // the umbrella opens and closes (it isn't just there): up in the rain, down under an awning
    const want = rain > 0.25 && !this.hidden && this.task?.kind !== 'jog' && this.task?.kind !== 'shelter' ? 1 : 0;
    this.umbrellaOpen = clamp(this.umbrellaOpen + Math.sign(want - this.umbrellaOpen) * dt * 2.5, 0, 1);
    const u = this.umbrellaOpen;
    this.umbrella.visible = u > 0.02;
    this.umbrella.scale.set(0.25 + 0.75 * u, 0.6 + 0.4 * u, 0.25 + 0.75 * u);
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
  /** Their favourite place, if they have one (its noun). */
  favorite: Msg | null;
  /** Their diary, newest first (the last two days). */
  diary: Msg[];
  /** Something the player placed that changed their day, in the last in-game day. */
  changed: Msg | null;
  /** Who they know best (at least to nod to), closest first: persona id and rung. */
  neighbors: { id: string; rung: Rung }[];
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
  private readonly toldUse = new Set<string>();
  /** Path searches left this tick (PATHS_PER_TICK). */
  private pathBudget = 0;
  /** Game minutes, kept in step with the world clock by main (place memory fades on it). */
  minutes = 0;
  /** Show the routine-change rings (Settings), and reduced motion (no hops or leans). */
  highlights = true;
  reducedMotion = false;
  /** The season, kept in step by main (winter precipitation is snow). */
  season: Season = 'spring';
  /** When the current shower started (game minutes), for "sudden rain"; -Infinity while dry. */
  private showerFrom = -Infinity;
  /** Has the weather been looked at yet? Rain already falling when the town loads isn't a sudden shower. */
  private rainSeen = false;
  /** Footprints in the snow: a ring of small marks that shrink away. */
  private readonly prints: THREE.InstancedMesh;
  private readonly printAge: Float32Array;
  private printNext = 0;
  /** Narrow passages where walkers take turns (the bridge). */
  private readonly passages = PASSAGES.map((s) => new Passage(s));
  /** Seconds of simulation, for passage waits. */
  private clockS = 0;
  /** The hour and rain of the current tick. */
  private hourNow = 0;
  private rainNow = 0;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly grid: NavGrid,
    private readonly smart: SmartRegistry,
    private readonly bus: EventBus<GameEvents>,
    m: Materials,
    seed = 0,
  ) {
    this.agents = PERSONAS.map((p, i) => new Agent(p, m, i, seed));
    const mark = new THREE.PlaneGeometry(0.11, 0.2).rotateX(-Math.PI / 2);
    this.prints = new THREE.InstancedMesh(mark, m.solid('#8a8f99', 1), FOOTPRINTS);
    this.prints.count = FOOTPRINTS;
    this.printAge = new Float32Array(FOOTPRINTS).fill(PRINT_LIFE);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < FOOTPRINTS; i++) this.prints.setMatrixAt(i, hidden);
    this.prints.frustumCulled = false;
    scene.add(this.prints);
    // haunts: the places they already call theirs (Mitsuko's pond bench)
    for (const a of this.agents)
      for (const id of a.p.haunts ?? []) {
        const o = smart.objects.get(id);
        if (!o) continue;
        a.places.haunt(id, o.x, o.z, 0);
        a.favs.set(o.kind, id); // already theirs: a change from it is news
      }
    for (const a of this.agents) {
      scene.add(a.root);
      this.pickables.push(a.body);
    }
    this.seedBonds();
  }

  get bodies(): THREE.Object3D[] {
    return this.pickables;
  }

  info(a: Agent): ResidentInfo {
    return {
      id: a.p.id,
      doing: a.hidden ? this.hiddenLabel(a) : (a.task?.label ?? msg('task.thinking')),
      knows: a.known.size,
      favorite: this.topFavourite(a),
      changed: this.minutes - a.changedAt < DAY ? a.changedThing : null,
      neighbors: this.bonds
        .known(a.p.id, 'nod')
        .slice(0, 4)
        .map((k) => ({ id: k.other, rung: k.rung })),
      diary: a.diary.entries
        .slice(-2)
        .reverse()
        .map((e) => e.msg),
    };
  }

  /** The place they know best of all, if it's familiar enough to be a favourite. */
  private topFavourite(a: Agent): Msg | null {
    const id = a.places.favourite(
      [...this.smart.objects.values()].filter((o) => o.kind !== 'shop').map((o) => o.id),
      this.minutes,
    );
    const o = id ? this.smart.objects.get(id) : undefined;
    return o ? thing(o.label) : null;
  }

  private hiddenLabel(a: Agent): Msg {
    if (a.task?.kind === 'commute') return msg(a.p.kid ? 'task.atSchool' : 'task.atWork');
    if (a.task?.kind === 'roof') return msg('task.onRoof');
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
    this.pathBudget = PATHS_PER_TICK;
    this.clockS += dt;
    this.hourNow = hour;
    this.rainNow = rain;
    this.weatherPass(rain);
    this.agePrints(dt);
    this.syncPassages();
    this.diaryDay(rain);
    this.socialPass(gm);
    for (const a of this.agents) {
      a.ring.visible = this.highlights && !a.hidden && this.minutes - a.changedAt < DAY;
      a.still = this.reducedMotion;
      if (!a.hidden && !a.shuffle && a.regionChecked !== this.grid.version) this.recover(a);
      a.needs.thirst = clamp(a.needs.thirst + gm * 0.004, 0, 1);
      a.needs.social = clamp(a.needs.social + gm * 0.003, 0, 1);
      if (a.shuffle) {
        this.shuffleStep(a, dt);
        a.animate(dt, true, rain, time);
        continue;
      }
      // decisions are staggered: a beat between one thing and the next, never all at once
      if (!a.task && this.clockS >= a.thinkUntil) this.plan(a, hour, rain);
      if (a.task) this.step(a, dt, gm, hour, rain);
      const roofWalk = !!a.roof && a.roof.phase !== 'sit';
      a.animate(dt, roofWalk || (!a.hidden && !a.arrived && a.standUp <= 0 && a.path.length > 0 && !a.waitingFor), rain, time);
    }
    this.bikeFollow();
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

    // a break on the roof terrace (the café's own), on dry afternoons and evenings. Decided before
    // anyone steps outside: from inside the café it is straight up the stairs, never out of the door and back in
    const roofDoor = p.roofBreak ? DOORS[p.roofBreak] : undefined;
    if (
      roofDoor &&
      !asleep &&
      !commuting &&
      hour > 14.5 &&
      hour < 21.5 &&
      rain < 0.15 &&
      this.minutes - (a.lastDid.get('roof') ?? -Infinity) > 180 &&
      a.rng.chance(0.3)
    ) {
      a.lastDid.set('roof', this.minutes);
      const inside = a.hidden && !!a.hiddenAt && Math.hypot(a.hiddenAt[0] - roofDoor.x, a.hiddenAt[1] - roofDoor.z) < 0.5;
      if (a.hidden && !inside) this.emerge(a); // at home: out of that door first, and walk over
      return this.assign(a, {
        kind: 'roof',
        label: msg('task.toRoof'),
        goal: [roofDoor.x, roofDoor.z],
        dwell: a.rng.range(12, 28),
        pose: 'stand',
        hide: true,
        interruptible: false,
      });
    }

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
    a.regionChecked = -1; // out of a door the player may have sealed in meanwhile: check where they are
  }

  /**
   * Utility AI (prompt 08): score every reachable option as weight × considerations (response curves
   * for the needs, distance and crowding as considerations, with compensation), then pick with a
   * mood drawn per kind of activity and a hysteresis margin for what they chose last of each kind.
   */
  private freeTime(a: Agent, hour: number, rain: number): void {
    const p = a.p;
    const like = (k: SmartKind | 'wander' | 'jog' | 'deliver') => p.likes[k] ?? 0;
    const night = hour > 20.5 || hour < 5.5;
    type Option = { score: number; key: string; kind: string; make: () => Task | null; seat?: SmartObject };
    const opts: Option[] = [];
    const dist = (o: { x: number; z: number }) => Math.hypot(o.x - a.x, o.z - a.z);
    const dPen = (o: { x: number; z: number }) => 1 / (1 + dist(o) / 22);
    const rainPen = 1 - rain * 0.7;
    let env: FieldEnv | null = null;

    const useOpt = (kind: SmartKind, base: number, label: (o: SmartObject) => Msg, dwell: [number, number], bubble?: BubbleIcon) => {
      for (const o of this.smart.available(kind, hour)) {
        if (o.placed && !a.known.has(o.id)) continue;
        if ((a.avoid.get(o.id) ?? -1) > this.minutes) continue;
        // somewhere to sit is judged as a place (shade, shelter, light, what's nearby: field.ts);
        // everything else just by whether it's lit after dark
        const where =
          kind === 'bench'
            ? placeScore({ x: o.x, z: o.z, face: o.slots[0]?.face }, (env ??= this.fieldEnv(hour, rain)), !!p.catFriend).score
            : this.lightFactor(o, hour);
        const s = score(base, [dPen(o), this.crowdFactor(a, o), this.satiation(a, kind)]) * this.placeFactor(a, o) * this.socialFactor(a, o) * where;
        opts.push({
          score: s,
          key: o.id,
          kind,
          make: () => this.useTask(a, o, label(o), a.rng.range(dwell[0], dwell[1]), bubble),
          ...(kind === 'bench' ? { seat: o } : {}),
        });
      }
      // every counter busy: queueing is an option, a less attractive one
      for (const o of this.smart.queueable(kind, hour)) {
        if ((a.avoid.get(o.id) ?? -1) > this.minutes) continue;
        const s = score(base, [dPen(o), this.crowdFactor(a, o)]) * 0.55;
        opts.push({ score: s, key: `queue:${o.id}`, kind, make: () => this.queueTask(a, o, label(o), a.rng.range(dwell[0], dwell[1]), bubble) });
      }
    };
    const isKid = !!p.kid;
    // needs through response curves: tiredness matters little until it suddenly does; thirst builds
    useOpt('bench', (0.25 + curve.logistic(a.needs.fatigue, 8, 0.5) * 0.8 + like('bench')) * rainPen, () => msg('task.sitting'), [8, 20], 'note');
    useOpt('vending', curve.quadratic(a.needs.thirst) * 1.4 + like('vending') * 0.5, () => msg('task.drink'), [1.2, 2], 'cup');
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
    // caught by a sudden shower: shelter under an awning, the arch or the café's terrace
    if (rain > SHOWER && this.suddenShower) opts.push({ score: 1.8, key: 'shelter', kind: 'shelter', make: () => this.shelterTask(a) });
    // a favourite the player removed: go and look for it, once
    for (const [id, label] of a.missing) {
      const at = a.places.where(id);
      opts.push({
        score: 2,
        key: `search:${id}`,
        kind: 'search',
        make: () => {
          a.missing.delete(id);
          const spot = at && this.grid.nearestOpen(at.x, at.z, 4);
          if (!spot) return (a.places.forget(id), null);
          return {
            kind: 'search',
            label: msg('task.lookingFor', { thing: thing(label) }),
            goal: spot,
            dwell: a.rng.range(1.5, 3),
            pose: 'stand',
            interruptible: true,
            onArrive: () => {
              a.say('question', 2.2);
              a.places.forget(id);
              a.diary.note(Math.floor(this.minutes / 1440), 'lookedFor', thing(label));
              this.story(msg('story.looksFor', { who: who(a.p.id), thing: thing(label) }), a.p.id);
            },
          };
        },
      });
      break;
    }
    // wandering the park
    opts.push({
      score: (0.3 + like('wander')) * rainPen,
      key: 'wander',
      kind: 'wander',
      make: () => {
        const pt = this.grid.randomOpenIn(() => a.rng.next(), -7.5, 7.8, -3.5, 8.2);
        return pt ? { kind: 'wander', label: msg('task.stroll'), goal: pt, dwell: a.rng.range(0.5, 2), pose: 'stand', interruptible: true } : null;
      },
    });
    if (like('jog') > 0 && !night && rain < 0.4) opts.push({ score: like('jog'), key: 'jog', kind: 'jog', make: () => this.jogTask(a) });
    // the bicycle by the hedge: whoever rides takes it for a turn round the block, if it's on its rack
    if (p.rides && this.bike && !this.bikeOut && !night && rain < 0.3 && this.satiation(a, 'ride') > 0.5)
      opts.push({ score: 0.9, key: 'ride', kind: 'ride', make: () => this.rideTask(a) });
    if (like('deliver') > 0 && hourInRange(hour, 9, 18))
      opts.push({
        score: like('deliver'),
        key: 'deliver',
        kind: 'deliver',
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
    // go home early when it pours or gets late (the kids, at once, when it rains hard)
    opts.push({
      score: 0.08 + rain * 0.5 + (night ? 0.8 : 0) + (isKid && rain > 0.7 ? 3 : 0),
      key: 'home',
      kind: 'home',
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

    const { best, scores } = rank(opts, () => a.rng.range(0.75, 1.25), a.lastPick);
    const t = best?.make();
    if (!best || !t) return;
    // why here? Of the placed things that made this seat inviting, the ones without which they'd have
    // gone elsewhere (the same moods, the same rivals): kept with the choice, for crediting what follows
    a.cause = null;
    if (best.seat && env) {
      const i = opts.indexOf(best);
      const rival = Math.max(...scores.filter((_, k) => k !== i));
      const ids = butFor({ x: best.seat.x, z: best.seat.z, face: best.seat.slots[0]?.face }, env, !!p.catFriend, scores[i]!, rival);
      if (ids.length) a.cause = { obj: best.seat.id, ids };
    }
    a.lastPick.set(best.kind, best.key);
    this.assign(a, t);
  }

  /** The bicycle (set by main from the world), where it is kept, and whether someone has it out. */
  bike: THREE.Object3D | null = null;
  private bikeHome: { x: number; z: number; ry: number } | null = null;
  private bikeOut = false;

  /** Walk to the bicycle; arriving, get on and ride a few stretches of the block's loop, then bring it back. */
  private rideTask(a: Agent): Task | null {
    const b = this.bike;
    if (!b) return null;
    this.bikeHome ??= { x: b.position.x, z: b.position.z, ry: b.rotation.y };
    const spot = this.grid.nearestOpen(this.bikeHome.x, this.bikeHome.z - 0.7, 3);
    if (!spot) return null;
    this.bikeOut = true; // spoken for
    return {
      kind: 'ride',
      label: msg('task.toBike'),
      goal: spot,
      dwell: 0.3,
      pose: 'stand',
      interruptible: false,
      onArrive: () => {
        a.riding = a.rng.int(3, 6);
        a.lastDid.set('ride', this.minutes);
      },
    };
  }

  /** The next stretch of the ride, or the way back to the rack. */
  private rideOn(a: Agent): void {
    const home = this.bikeHome!;
    const back = a.riding! <= 0;
    const loop: [number, number][] = [
      [-9.2, 9.5],
      [-9.2, -4.9],
      [9.2, -4.9],
      [9.2, 9.5],
    ];
    const goal = back ? (this.grid.nearestOpen(home.x, home.z - 0.7, 3) ?? [a.x, a.z]) : loop[a.rng.int(0, 3)]!;
    a.riding = back ? -1 : a.riding! - 1;
    this.assign(a, { kind: 'ride', label: msg('task.riding'), goal, dwell: 0.1, pose: 'stand', interruptible: false });
  }

  /** Off the bicycle, and the bicycle back on its rack exactly where it was. */
  private dismount(a: Agent): void {
    a.riding = null;
    this.bikeOut = false;
    if (this.bike && this.bikeHome) {
      this.bike.position.set(this.bikeHome.x, G, this.bikeHome.z);
      this.bike.rotation.y = this.bikeHome.ry;
    }
  }

  /** Keep the bicycle under its rider. */
  private bikeFollow(): void {
    const r = this.bike && this.agents.find((a) => a.riding !== null);
    if (!r || !this.bike) return;
    this.bike.position.set(r.x, groundHeight(r.x, r.z), r.z);
    this.bike.rotation.y = r.root.rotation.y - Math.PI / 2; // its front (local +x) the way the rider faces
  }

  /**
   * The roof terrace, for whoever is up there: out of the stair-head door, across to the deck chair
   * at walking pace, sit for the task's dwell, walk back to the door, and gone (down the stairs).
   */
  private roofStep(a: Agent, dt: number, gm: number, rain: number): void {
    const r = a.roof!;
    const [dx, dz] = ROOF_TERRACE.door,
      [cx, cz] = ROOF_TERRACE.chair;
    const walk = Math.hypot(cx - dx, cz - dz) / (a.p.speed * 0.8);
    if (r.phase === 'sit') {
      a.dwellLeft -= gm;
      a.heading = ROOF_TERRACE.chairFace;
      // rain, or time's up: back inside
      if (a.dwellLeft <= 0 || rain > 0.25) {
        r.phase = 'back';
        r.t = 0;
        a.pose = 'stand';
        a.standUp = 0;
      }
      return;
    }
    r.t = Math.min(1, r.t + dt / walk);
    const k = r.phase === 'out' ? r.t : 1 - r.t;
    a.root.position.x = dx + (cx - dx) * k;
    a.root.position.z = dz + (cz - dz) * k;
    a.heading = Math.atan2((cx - dx) * (r.phase === 'out' ? 1 : -1), (cz - dz) * (r.phase === 'out' ? 1 : -1));
    if (r.t < 1) return;
    if (r.phase === 'out') {
      r.phase = 'sit';
      a.pose = 'sit';
    } else {
      // down the stairs: out of sight again, to come out of the café's door when they next do something
      a.roof = null;
      a.perch = null;
      a.root.visible = false;
      if (a.hiddenAt) a.placeAt(a.hiddenAt[0], a.hiddenAt[1]);
      a.task = null;
    }
  }

  /** In at the café's door, up the stairs, and out of the stair head onto the roof. */
  private toRoof(a: Agent): void {
    const [dx, dz] = ROOF_TERRACE.door;
    a.roof = { phase: 'out', t: 0 };
    a.perch = ROOF_TERRACE.y;
    a.root.position.set(dx, ROOF_TERRACE.y, dz);
    a.pose = 'stand';
    a.root.visible = true;
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

  /**
   * Place memory in a choice (prompt 08): familiar places pull a little, a favourite pulls more,
   * and something new pulls the curious until it's familiar (novelty fades with the same half-life).
   */
  private placeFactor(a: Agent, o: SmartObject): number {
    const now = this.minutes;
    const fam = a.places.familiarity(o.id, now);
    const fav = this.favouriteOf(a, o.kind) === o.id ? FAVOURITE_BONUS : 0;
    const nov = o.placed && a.known.has(o.id) ? a.p.curiosity * NOVELTY_PULL * a.places.novelty(o.id, now) * (fam < 1 ? 1 : 0.8) : 0;
    return 1 + fav + 0.1 * fam + nov;
  }

  /** Their favourite of a kind among what's there now (null if none is familiar enough). */
  favouriteOf(a: Agent, kind: SmartKind): string | null {
    const ids: string[] = [];
    for (const o of this.smart.objects.values()) if (o.kind === kind) ids.push(o.id);
    return a.places.favourite(ids, this.minutes, a.favs.get(kind) ?? null);
  }

  /**
   * They used a place: it grows familiar. Coming back on a later day is worth a line ("tries the
   * new bench again"), and so is a new favourite. Told once each, and never two at once.
   */
  private remember(a: Agent, o: SmartObject): void {
    a.lastDid.set(o.kind, this.minutes);
    // using something the player placed changes their day: the highlight (and the card) say so
    if (o.placed) {
      a.changedAt = this.minutes;
      a.changedThing = thing(o.label);
    }
    const r = a.places.used(o.id, o.x, o.z, this.minutes);
    const fav = this.favouriteOf(a, o.kind);
    const was = a.favs.get(o.kind);
    const day = Math.floor(this.minutes / 1440);
    if (fav === o.id) a.diary.note(day, 'favorite', thing(o.label));
    if (r === 'first' && o.placed) a.diary.note(day, 'tried', thing(o.label));
    // a new favourite is taken (and told) when they're there, not while they sit somewhere else, and
    // not while they still mean to go and look for the one that went (first the `?`, then settling)
    if (fav && fav !== was && fav === o.id && a.missing.size === 0) {
      a.favs.set(o.kind, fav);
      // the first favourite they ever had of a kind is who they are, not news
      if (was !== undefined) {
        a.diary.note(day, 'newFavorite', thing(o.label));
        if (o.placed) this.bus.emit('routine', { who: a.p.id, id: o.id });
        return this.story(msg('story.newFavorite', { who: who(a.p.id), thing: thing(o.label) }), a.p.id);
      }
    }
    if (r === 'again' && o.placed) {
      a.diary.note(day, 'again', thing(o.label));
      this.story(msg('story.triesAgain', { who: who(a.p.id), thing: thing(o.label) }), a.p.id);
    }
  }

  /**
   * Weather (prompt 08): a shower that starts catches people out. In its first half hour, those
   * sitting about outdoors get up and head for shelter (an awning, the arch, the café's terrace).
   * Snow (winter's rain) slows everyone a little and leaves footprints that fade.
   */
  private weatherPass(rain: number): void {
    if (!this.rainSeen) {
      this.rainSeen = true;
      // it was raining before we looked (a load, a seeded rainy run): nobody is caught out by it
      if (rain > SHOWER) this.showerFrom = this.minutes - 30;
    }
    if (rain > SHOWER && this.showerFrom === -Infinity) {
      this.showerFrom = this.minutes;
      for (const a of this.agents) {
        if (a.hidden || !a.task || !a.task.interruptible) continue;
        const outdoors =
          a.task.kind === 'wander' || a.task.kind === 'jog' || (a.task.kind === 'use' && a.task.obj?.kind !== 'cafe' && a.task.obj?.kind !== 'shop');
        if (outdoors) this.endTask(a);
      }
    } else if (rain < SHOWER * 0.6) this.showerFrom = -Infinity;
  }

  /** Is it a sudden shower (it started less than half an hour ago)? */
  private get suddenShower(): boolean {
    return this.minutes - this.showerFrom < 30;
  }

  /** Is what's falling snow? */
  snowing(rain: number): boolean {
    return this.season === 'winter' && rain > 0.1;
  }

  /** Where people shelter from a sudden shower: under the awnings (they move with their shops), the arch, the café's terrace. */
  private shelters(): { x: number; z: number; face: number }[] {
    const out: { x: number; z: number; face: number }[] = [];
    for (const id of AWNING_SHOPS) {
      const d = DOORS[id];
      if (d) out.push({ x: d.x + 0.35, z: d.z, face: Math.PI / 2 });
    }
    return [...out, ...SHELTERS];
  }

  private shelterTask(a: Agent): Task | null {
    let best: { x: number; z: number; face: number } | null = null,
      bd = Infinity;
    for (const s of this.shelters()) {
      const d = Math.hypot(s.x - a.x, s.z - a.z);
      if (d < bd) [best, bd] = [s, d];
    }
    if (!best) return null;
    // a few can share one: stand a little apart
    const ang = a.rng.range(0, Math.PI * 2),
      r = a.rng.range(0, 0.6);
    const spot = this.grid.nearestOpen(best.x + Math.cos(ang) * r, best.z + Math.sin(ang) * r, 3);
    if (!spot) return null;
    return { kind: 'shelter', label: msg('task.sheltering'), goal: spot, dwell: a.rng.range(15, 35), pose: 'stand', face: best.face, interruptible: true };
  }

  /** Footprints: drop one every stride while walking in snow; all of them shrink away over PRINT_LIFE seconds. */
  private footprints(a: Agent, moved: number, rain: number): void {
    if (!this.snowing(rain) || a.hidden) return;
    a.stride += moved;
    if (a.stride < 0.45) return;
    a.stride = 0;
    const side = this.printNext % 2 ? 0.08 : -0.08;
    const ry = a.root.rotation.y;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(a.x + Math.cos(ry) * side, groundHeight(a.x, a.z) + 0.02, a.z - Math.sin(ry) * side),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
      new THREE.Vector3(1, 1, 1),
    );
    this.prints.setMatrixAt(this.printNext, m);
    this.printAge[this.printNext] = 0;
    this.printNext = (this.printNext + 1) % FOOTPRINTS;
    this.prints.instanceMatrix.needsUpdate = true;
  }

  /** Age the footprints: they shrink away (fading would need a material each). */
  private agePrints(dt: number): void {
    let changed = false;
    const m = new THREE.Matrix4(),
      p = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3();
    for (let i = 0; i < FOOTPRINTS; i++) {
      if (this.printAge[i]! >= PRINT_LIFE) continue;
      this.printAge[i]! += dt;
      this.prints.getMatrixAt(i, m);
      m.decompose(p, q, s);
      const k = Math.max(0, 1 - this.printAge[i]! / PRINT_LIFE);
      m.compose(p, q, s.set(k, 1, k));
      this.prints.setMatrixAt(i, m);
      changed = true;
    }
    if (changed) this.prints.instanceMatrix.needsUpdate = true;
  }

  /** The day the diaries are on; each resident's own named stream picks their details. */
  private diaryOn = -1;
  private readonly diaryRng = new Map<string, Rng>();
  /** Midnight: everyone who was out writes yesterday's line. Otherwise note the weather they're out in. */
  private diaryDay(rain: number): void {
    const day = Math.floor(this.minutes / 1440);
    if (this.diaryOn !== -1 && day !== this.diaryOn) {
      // a new day: bonds nobody renewed slip a little; yesterday's moments can happen again
      this.bonds.newDay(day);
      this.momentsToday.clear();
    }
    if (this.diaryOn !== -1 && day !== this.diaryOn)
      for (const a of this.agents) {
        let r = this.diaryRng.get(a.p.id);
        if (!r) this.diaryRng.set(a.p.id, (r = stream(`diary/${a.p.id}`)));
        a.diary.close(this.diaryOn, r);
      }
    this.diaryOn = day;
    for (const a of this.agents) a.diary.weather(day, rain, !a.hidden, this.snowing(rain));
  }

  /** Having just done something, wanting it again recovers over an hour (no drink after drink after drink). */
  private satiation(a: Agent, kind: string): number {
    const since = this.minutes - (a.lastDid.get(kind) ?? -Infinity);
    return curve.logistic(since / SATED_MINUTES, 8, 0.6);
  }

  /**
   * After dark, people drift toward light: the café, and anything within a few meters of a lantern
   * someone placed. (By day, light is everywhere and this is 1.)
   */
  private lightFactor(o: SmartObject, hour: number): number {
    if (hour > 5.5 && hour < 18) return 1;
    if (o.kind === 'cafe') return 1.6;
    for (const p of this.smart.objects.values()) if (p.glow && Math.hypot(p.x - o.x, p.z - o.z) < LIT_RADIUS) return 1.5;
    return 1;
  }

  /** What the place field reads, as the town is now (trees and lights the player placed included, with their ids). */
  fieldEnv(hour: number, rain: number): FieldEnv {
    const trees: FieldEnv['trees'][number][] = TREES.map((t) => ({ x: t.x, z: t.z, r: t.r }));
    const lights: FieldEnv['lights'][number][] = [],
      food: FieldEnv['food'][number][] = [],
      bowls: FieldEnv['bowls'][number][] = [];
    for (const o of this.smart.objects.values()) {
      const f = { x: o.x, z: o.z, ...(o.placed ? { id: o.id } : {}) };
      if (o.placed && o.label === 'sakura') trees.push({ ...f, r: 1.6 });
      if (o.glow) lights.push(f);
      if (o.kind === 'vending' || o.kind === 'cafe') food.push(f);
      if (o.kind === 'catbowl') bowls.push(f);
    }
    return {
      hour,
      season: this.season,
      rain,
      trees,
      shelters: this.shelters(),
      lights,
      water: [{ x: 2.4, z: 2.1, r: 3 }], // the pond
      food,
      bowls,
      isOpen: (x, z) => this.grid.isOpenAt(x, z),
    };
  }

  /** Friends at a place make it more inviting, more so the more they want company (kids play together). */
  private socialFactor(a: Agent, o: SmartObject): number {
    let pull = 0;
    for (const b of this.agents) if (b !== a && !b.hidden && Math.hypot(b.x - o.x, b.z - o.z) < CROWD_RADIUS) pull += this.closeness(a, b);
    return 1 + pull * (0.4 + a.needs.social);
  }

  /**
   * The bond ladder (prompt 09b): who knows whom, and how well. It starts from the authored
   * affinities (a few pairs part-way up, so day one isn't cold) and grows from days in the same
   * place and from shared moments.
   */
  bonds = new Bonds();
  /** Minutes each pair has spent near each other today (`${pair}` → [day, minutes]). */
  private readonly near = new Map<string, [number, number]>();
  /** Shared moments already counted today, by pair and what it was. */
  private readonly momentsToday = new Set<string>();

  /** The authored starting point: affinities for everyone, and a rung for those who already knew each other. */
  private seedBonds(): void {
    for (let i = 0; i < this.agents.length; i++)
      for (let j = i + 1; j < this.agents.length; j++) {
        const a = this.agents[i]!,
          b = this.agents[j]!;
        const f = friendship(a, b);
        if (f <= 0) continue;
        this.bonds.setAffinity(a.p.id, b.p.id, f);
        const rung: Rung | null = f >= 0.9 ? 'friends' : f >= 0.5 ? 'greeting' : f >= 0.3 ? 'nod' : null;
        if (rung && this.bonds.rung(a.p.id, b.p.id) === 'unseen') this.bonds.seed(a.p.id, b.p.id, rung, Math.floor(this.minutes / DAY));
      }
  }

  /** How close two neighbours are now, 0..1, from the rung they stand on. */
  closeness(a: Agent, b: Agent): number {
    return CLOSENESS[this.bonds.rung(a.p.id, b.p.id)];
  }

  /**
   * Two people shared a moment (looked at the same new thing, sat on the same bench, waited out the
   * rain under one awning): once a day per pair per kind. `madeBy` is the placed thing behind it, if any.
   */
  private sharedMoment(a: Agent, b: Agent, what: string, madeBy?: SmartObject): void {
    const dayF = this.minutes / DAY;
    const key = `${a.p.id < b.p.id ? `${a.p.id}|${b.p.id}` : `${b.p.id}|${a.p.id}`}|${what}|${Math.floor(dayF)}`;
    if (this.momentsToday.has(key)) return;
    this.momentsToday.add(key);
    // who made it possible: the placed thing it happened at, and whatever placed things brought
    // either of them to this very seat (the but-for causes of their choice), in equal shares
    const ids = new Set<string>();
    if (madeBy?.placed) ids.add(madeBy.id);
    for (const x of [a, b]) if (x.cause && x.task?.obj?.id === x.cause.obj) for (const id of x.cause.ids) if (this.smart.objects.has(id)) ids.add(id);
    const credit: Record<string, number> = {};
    for (const id of ids) credit[id] = 1 / ids.size;
    this.promoted(this.bonds.moment(a.p.id, b.p.id, dayF, credit));
  }

  /**
   * Something drew attention at (x, z): a wind chime rang, a cat settled, the evening bell. Everyone
   * out and free within `r` glances that way, and each pair of them standing near each other has
   * shared a moment (Whyte's triangulation: a third thing that gives two strangers something in
   * common). `madeBy` is the placed thing behind it, if any. Returns how many looked up.
   */
  attention(x: number, z: number, r: number, what: string, madeBy?: SmartObject): number {
    const looking = this.agents.filter(
      (a) => !a.hidden && !a.shuffle && a.riding === null && a.task?.kind !== 'work' && a.task?.kind !== 'jog' && Math.hypot(a.x - x, a.z - z) < r,
    );
    for (const a of looking) if (Math.hypot(a.x - x, a.z - z) > 0.5) a.gestureTo('glance', Math.atan2(x - a.x, z - a.z));
    for (let i = 0; i < looking.length; i++)
      for (let j = i + 1; j < looking.length; j++) {
        const a = looking[i]!,
          b = looking[j]!;
        if (Math.hypot(a.x - b.x, a.z - b.z) < TOGETHER_RADIUS) this.sharedMoment(a, b, what, madeBy);
      }
    return looking.length;
  }

  /** A pair climbed a rung: a line in the feed (naming the thing the player placed, if it was behind it), and an event. */
  private promoted(p: Promotion | null): void {
    if (!p) return;
    const made = p.credited.map((id) => this.smart.objects.get(id)).find((o) => o);
    const key = `story.bond.${p.to}${made ? '.because' : ''}` as MsgKey;
    // told from greeting terms up, and a first nod only when something the player placed was behind
    // it: fourteen neighbours becoming nodding acquaintances would otherwise fill the feed
    if (p.to !== 'familiar' && (p.to !== 'nod' || made)) this.story(msg(key, { a: who(p.a), b: who(p.b), ...(made ? { thing: thing(made.label) } : {}) }), p.a);
    this.bus.emit('bond', { a: p.a, b: p.b, to: p.to, credited: p.credited });
  }

  /** When each pair last greeted (game minutes), and the chats already told today. */
  private readonly greeted = new Map<string, number>();
  private readonly toldChats = new Set<string>();

  /**
   * The social layer (prompt 08), once a tick over every pair in view: neighbours passing close bow;
   * friends across the lane wave; friends sitting together chat, in turns (alternating bubbles), which
   * is what company is for. Each pair greets at most once an hour.
   */
  private socialPass(gm: number): void {
    const out = this.agents.filter((a) => !a.hidden);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!,
          b = out[j]!;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > 7) continue;
        const key = a.p.id < b.p.id ? `${a.p.id}|${b.p.id}` : `${b.p.id}|${a.p.id}`;
        // in the same place: a minute of it in a day is a day together (the ladder's first requirement)
        if (d < TOGETHER_RADIUS) {
          const day = Math.floor(this.minutes / DAY);
          const n = this.near.get(key);
          if (!n || n[0] !== day) this.near.set(key, [day, gm]);
          else if (n[1] < TOGETHER_MINUTES && (n[1] += gm) >= TOGETHER_MINUTES) this.promoted(this.bonds.together(a.p.id, b.p.id, this.minutes / DAY));
          // shared moments: looking over the same new thing; waiting out the rain together
          const ta = a.task,
            tb = b.task;
          if (ta?.kind === 'inspect' && tb?.kind === 'inspect' && ta.obj && ta.obj === tb.obj && a.arrived && b.arrived)
            this.sharedMoment(a, b, 'look', ta.obj);
          if (ta?.kind === 'shelter' && tb?.kind === 'shelter' && a.arrived && b.arrived && d < 2.5) this.sharedMoment(a, b, 'shelter');
        }
        const rung = this.bonds.rung(a.p.id, b.p.id);
        const seated = (x: Agent) => x.arrived && x.pose === 'sit';
        if (seated(a) && seated(b) && a.task?.obj && a.task.obj === b.task?.obj) {
          // side by side on one bench is a moment whoever they are; they talk once they're on greeting terms
          // (side by side: at the café, people at different tables aren't sharing one)
          if (d < 1.6) this.sharedMoment(a, b, 'seat', a.task.obj);
          if (CLOSENESS[rung] >= CLOSENESS.greeting) this.chat(a, b, gm);
          continue;
        }
        const walking = (x: Agent) => !x.arrived && x.path.length > 0 && !x.shuffle;
        if (!walking(a) && !walking(b)) continue;
        if ((this.greeted.get(key) ?? -Infinity) + GREET_EVERY > this.minutes) continue;
        if (d < 1.6 && !seated(a) && !seated(b)) {
          // passing on the lane, each according to how well they know each other: strangers walk on,
          // a familiar face gets a glance, then a nod, and from greeting terms a small bow
          if (rung === 'unseen') continue;
          this.greeted.set(key, this.minutes);
          if (rung === 'familiar') {
            a.gestureTo('glance', Math.atan2(b.x - a.x, b.z - a.z));
            b.gestureTo('glance', Math.atan2(a.x - b.x, a.z - b.z));
          } else if (rung === 'nod') {
            a.gestureTo('nod');
            b.gestureTo('nod');
          } else a.bowT = b.bowT = BOW_SECONDS;
        } else if (d > 3 && CLOSENESS[rung] >= CLOSENESS.greeting && !seated(a) && !seated(b) && this.closestApproach(a, b) > 2) {
          // friends across the lane, not about to pass each other (then they'll bow): a wave
          this.greeted.set(key, this.minutes);
          a.say('wave', 1.4);
          b.say('wave', 1.4);
          // and with the hand, after a glance across
          a.gestureTo('wave');
          b.gestureTo('wave');
        }
      }
  }

  /** How close two people will come in the next few seconds, walking as they are (m). */
  private closestApproach(a: Agent, b: Agent): number {
    const vel = (x: Agent): [number, number] => {
      if (x.arrived || x.pathIdx >= x.path.length) return [0, 0];
      const [tx, tz] = x.path[x.pathIdx]!;
      const d = Math.hypot(tx - x.x, tz - x.z) || 1;
      return [((tx - x.x) / d) * x.p.speed, ((tz - x.z) / d) * x.p.speed];
    };
    const [ax, az] = vel(a),
      [bx, bz] = vel(b);
    let best = Infinity;
    for (let t = 0; t <= 5; t += 0.25) best = Math.min(best, Math.hypot(a.x + ax * t - b.x - bx * t, a.z + az * t - b.z - bz * t));
    return best;
  }

  /** Two friends on one bench: they talk in turns; company is what they wanted. Told once a day per pair. */
  private chat(a: Agent, b: Agent, gm: number): void {
    const [p, q] = a.p.id < b.p.id ? [a, b] : [b, a];
    const speaker = Math.floor(this.clockS / CHAT_TURN) % 2 === 0 ? p : q;
    if (speaker.bubbleT <= 0) speaker.say('chat', CHAT_TURN * 0.7);
    for (const x of [a, b]) x.needs.social = Math.max(0, x.needs.social - gm * 0.05);
    const key = `${p.p.id}|${q.p.id}|${Math.floor(this.minutes / 1440)}`;
    if (this.toldChats.has(key) || this.storyCooldown > 0) return;
    this.toldChats.add(key);
    this.story(msg('story.chat', { a: who(p.p.id), b: who(q.p.id), thing: thing(a.task!.obj!.label) }), p.p.id);
  }

  /**
   * Crowding (prompt 07): desirability × 1 / (1 + density × crowdAversion), where density is the
   * people within 2 m of it (using it or just standing about) over how many it suits in comfort.
   */
  private crowdFactor(a: Agent, o: SmartObject): number {
    let n = 0;
    // friends there aren't a crowd: they're a reason to go (socialFactor)
    for (const b of this.agents) if (b !== a && !b.hidden && this.closeness(a, b) < 0.3 && Math.hypot(b.x - o.x, b.z - o.z) < CROWD_RADIUS) n++;
    const density = n / Math.max(1, o.soft ?? o.slots.length);
    return 1 / (1 + density * (a.p.crowdAversion ?? 1));
  }

  /** Wait in line at a shop: when a counter frees up they step up to it; if it takes too long, they give up. */
  private queueTask(a: Agent, o: SmartObject, label: Msg, useDwell: number, bubble?: BubbleIcon): Task | null {
    const spot = this.smart.reserveQueue(o, a.p.id);
    if (!spot) return null;
    return {
      kind: 'queue',
      label: msg('task.queueing', { thing: thing(o.label) }),
      goal: [spot.x, spot.z],
      exact: [spot.x, spot.z],
      dwell: QUEUE_PATIENCE,
      pose: 'stand',
      face: spot.face,
      obj: o,
      slot: spot,
      interruptible: true,
      next: { label, dwell: useDwell, bubble },
    };
  }

  /** In line: step up to a free counter, or move up a place. */
  private queueStep(a: Agent, t: Task): void {
    const o = t.obj!;
    // a counter they can actually stand at (not one something placed has covered): only then give up their place in line
    if (o.slots.some((s) => !s.takenBy && this.smart.usable(o, s)) && this.smart.isOpen(o, this.hourNow)) {
      t.slot!.takenBy = null;
      const use = this.useTask(a, o, t.next!.label, t.next!.dwell, t.next!.bubble);
      if (use) return this.assign(a, use);
      t.slot!.takenBy = a.p.id;
    }
    const q = o.queue ?? [];
    const mine = q.indexOf(t.slot!);
    const ahead = q.findIndex((s) => !s.takenBy);
    if (ahead !== -1 && ahead < mine) {
      t.slot!.takenBy = null;
      const s = q[ahead]!;
      s.takenBy = a.p.id;
      t.slot = s;
      t.goal = [s.x, s.z];
      t.exact = [s.x, s.z];
      a.arrived = false;
      a.path = [
        [a.x, a.z],
        [s.x, s.z],
      ];
      a.pathIdx = 1;
      a.pathVersion = this.grid.version;
    }
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
        if (o.kind === 'shrine') this.bus.emit('prayed', { x: o.x, z: o.z });
        this.remember(a, o);
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
    a.waitingFor = null;
    a.arrived = false;
    a.path = [];
    a.pathIdx = 0;
    a.pathVersion = -1;
    a.dwellLeft = t.dwell;
    if (a.hidden) {
      // already out of sight: they are simply "there" now (at work, at the station...)
      if (t.hide) a.hiddenAt = [t.goal[0], t.goal[1]];
      if (t.kind === 'roof') this.toRoof(a); // already inside the café: straight up the stairs
      return;
    }
    this.repath(a);
  }

  private repath(a: Agent): void {
    if (!a.task) return;
    if (this.pathBudget <= 0) {
      // the rest wait a tick (50 ms): a crowd re-planning at once never costs one frame
      a.needsPath = true;
      a.path = [];
      a.pathIdx = 0;
      return;
    }
    this.pathBudget--;
    a.needsPath = false;
    const path = this.grid.findPath(a.x, a.z, a.task.goal[0], a.task.goal[1]);
    a.pathVersion = this.grid.version;
    if (!path) {
      // Unreachable (e.g. the player boxed the goal in): give up gracefully, remember it for a while,
      // and stand and think for a moment instead of re-planning every frame. Never teleport while visible.
      const t = a.task;
      if (t.obj) a.avoid.set(t.obj.id, this.minutes + 90);
      this.endTask(a, 'question');
      // getting up from a seat (inside its footprint): step off onto open ground before standing to think
      if (!this.grid.isOpenAt(a.x, a.z)) {
        const off = this.grid.nearestOpenLevel(a.x, a.z, 3);
        if (off) a.shuffle = { fx: a.x, fz: a.z, tx: off[0], tz: off[1], t: 0, dur: 0.45 };
      }
      a.task = { kind: 'linger', label: msg('task.anotherWay'), goal: [a.x, a.z], dwell: a.rng.range(1, 2.5), pose: 'stand', interruptible: true };
      a.arrived = true;
      a.dwellLeft = a.task.dwell;
      return;
    }
    a.path = path;
    // from a seat (a closed cell inside a bench's footprint) step off to the path's first open cell
    // first, rather than cutting straight across the bench to the second
    a.pathIdx = this.grid.isOpenAt(a.x, a.z) ? 1 : 0;
  }

  private endTask(a: Agent, icon?: BubbleIcon): void {
    const t = a.task;
    if (t?.kind === 'ride') this.dismount(a); // however the ride ends, the bicycle goes back on its rack
    if (t?.obj && t.kind === 'inspect') t.obj.inspectors = Math.max(0, t.obj.inspectors - 1);
    this.smart.release(a.p.id);
    if (a.pose === 'sit' || a.pose === 'crouch') a.standUp = 0.6;
    a.pose = 'stand';
    a.task = null;
    a.waitingFor = null;
    // a beat before the next thing, unless they're on a seat (inside its footprint): step off first
    a.thinkUntil = this.grid.isOpenAt(a.x, a.z) ? this.clockS + a.rng.range(0.5, 2) : this.clockS;
    a.path = [];
    a.arrived = false;
    if (icon) a.say(icon, 1.6);
  }

  // ── Execution ───────────────────────────────────────────────────────────
  private step(a: Agent, dt: number, gm: number, _hour: number, _rain: number): void {
    const t = a.task!;
    if (a.hidden) {
      if (a.roof) return this.roofStep(a, dt, gm, this.rainNow);
      a.dwellLeft -= gm;
      if (a.dwellLeft <= 0) a.task = null; // re-plan; may emerge
      return;
    }
    if (a.standUp > 0) {
      a.standUp -= dt;
      return;
    }
    if (!a.arrived) {
      if (a.needsPath) {
        this.repath(a);
        if (a.needsPath || !a.task) return;
      }
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
    if (t.face !== undefined) a.heading = t.face;
    if (t.kind === 'queue') {
      this.queueStep(a, t);
      if (a.task !== t || !a.arrived) return;
    }
    if (t.kind === 'inspect' && a.bubbleT < 0.3 && a.dwellLeft < t.dwell * 0.6 && t.bubble) {
      a.say(t.bubble, 2);
      t.bubble = undefined;
    }
    if (a.dwellLeft <= 0) {
      this.endTask(a);
    }
  }

  /** Tell each passage who is walking inside it now, and who is still waiting at its ends. */
  private syncPassages(): void {
    for (const p of this.passages) {
      const walkers = new Map<string, -1 | 1>();
      const waiters = new Set<string>();
      for (const a of this.agents) {
        if (a.hidden || !a.task) continue;
        if (a.waitingFor === p.spec.id) waiters.add(a.p.id);
        if (a.arrived || a.pathIdx >= a.path.length || !p.contains(a.x, a.z)) continue;
        const [tx, tz] = a.path[a.pathIdx]!;
        walkers.set(a.p.id, p.heading(tx - a.x, tz - a.z));
      }
      p.sync(walkers, waiters);
    }
  }

  /**
   * Local avoidance (prompt 07): a sidestep away from anyone within reach ahead (walking, sitting
   * or standing), as a sideways speed along the walker's left (+) or right (-). Head-on, both step
   * to their own left, so they pass (people in Tokyo keep left). Deterministic: agent order only.
   */
  private sidestep(a: Agent, ux: number, uz: number): { lat: number; slow: number } {
    let lat = 0,
      slow = 1;
    for (const b of this.agents) {
      if (b === a || b.hidden) continue;
      const rx = b.x - a.x,
        rz = b.z - a.z;
      const d = Math.hypot(rx, rz);
      if (d > AVOID_RADIUS || d < 1e-4) continue;
      const ahead = (rx * ux + rz * uz) / d;
      if (ahead < -0.2 && d > 0.35) continue; // behind them: theirs to avoid
      // which side of my heading they're on: + means on my left (left of (ux, uz) is (uz, -ux))
      const side = (rx * uz - rz * ux) / d;
      const w = Math.min(1, (1.6 * (AVOID_RADIUS - d)) / AVOID_RADIUS);
      // nearly head-on: keep left; otherwise step away from their side
      lat += w * (Math.abs(side) < 0.25 ? 1 : -Math.sign(side));
      // right in front: ease off while stepping aside
      if (ahead > 0.6 && d < 0.6) slow = Math.min(slow, 0.35 + d);
    }
    return { lat: clamp(lat, -1, 1), slow };
  }

  private walk(a: Agent, dt: number): void {
    const t = a.task!;
    let move = a.p.speed * dt * (this.snowing(this.rainNow) ? SNOW_PACE : 1) * (a.riding !== null ? RIDE_PACE : 1);
    const x0 = a.x,
      z0 = a.z;
    // a sidestep first (only onto open ground), then on along the path, which re-aims from wherever they are
    if (a.pathIdx < a.path.length) {
      const [tx, tz] = a.path[a.pathIdx]!;
      const d = Math.hypot(tx - a.x, tz - a.z);
      if (d > 0.05) {
        const ux = (tx - a.x) / d,
          uz = (tz - a.z) / d;
        // about to step onto the bridge while it's the other way's turn: wait at the end, facing it
        const ahead = Math.min(d, move) + 0.05;
        for (const p of this.passages) {
          if (p.contains(a.x, a.z) || !p.contains(a.x + ux * ahead, a.z + uz * ahead)) continue;
          if (p.request(a.p.id, p.heading(ux, uz), this.clockS)) continue;
          a.waitingFor = p.spec.id;
          a.heading = Math.atan2(ux, uz);
          return;
        }
        a.waitingFor = null;
        const av = this.sidestep(a, ux, uz);
        move *= av.slow;
        const lat = av.lat * a.p.speed * 0.9 * dt;
        const nx = a.x + uz * lat,
          nz = a.z - ux * lat;
        if (lat !== 0 && this.grid.isOpenAt(nx, nz)) {
          a.root.position.x = nx;
          a.root.position.z = nz;
        }
      }
    }
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
      a.heading = Math.atan2(dx, dz);
      move -= s;
      if (s >= d) a.pathIdx++;
    }
    this.footprints(a, Math.hypot(a.x - x0, a.z - z0), this.rainNow);
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
      if (t.kind === 'roof') this.toRoof(a);
      return;
    }
    if (t.kind === 'ride') {
      t.onArrive?.();
      if (a.riding === -1) return this.endTask(a); // back at the rack: off, and the bicycle parked
      return this.rideOn(a);
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
    this.bonds.restored(o.id); // back again (an undo, a move): its credit is no longer "since removed"
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
    a.places.noticed(o.id, o.x, o.z, this.minutes);
    if (o.placed) a.diary.note(Math.floor(this.minutes / 1440), 'noticed', thing(o.label));
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
        if (Math.hypot(a.x - o.x, a.z - o.z) < 3.2 && !a.known.has(o.id)) {
          // seen in passing: a glance as they go by; they know it's there now, it's new to them, and it goes in the diary
          a.gestureTo('glance', Math.atan2(o.x - a.x, o.z - a.z));
          a.known.add(o.id);
          a.places.noticed(o.id, o.x, o.z, this.minutes);
          a.diary.note(Math.floor(this.minutes / 1440), 'noticed', thing(o.label));
        }
      }
    }
  }

  /**
   * Recovery (prompt 07): someone visible on an island, a pocket the player's edits sealed off from
   * every door and exit, steps over the nearest obstruction back into the town at walking pace
   * (never a jump), after a puzzled moment; whatever they were doing there is over.
   */
  private recover(a: Agent): void {
    a.regionChecked = this.grid.version;
    if (!this.grid.trapped(a.x, a.z)) return;
    const out = this.grid.nearestMain(a.x, a.z, 10);
    if (!out) return;
    if (a.task) this.endTask(a, 'question');
    a.standUp = 0;
    a.pose = 'stand';
    const len = Math.hypot(out[0] - a.x, out[1] - a.z);
    a.shuffle = { fx: a.x, fz: a.z, tx: out[0], tz: out[1], t: 0, dur: Math.max(0.4, len / (a.p.speed * 0.8)) };
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
      // at their own level: a step aside never goes over the terrace wall
      const spot = this.grid.nearestOpenLevel(x + Math.sin(ang) * want, z + Math.cos(ang) * want, 3, [a.x, a.z]) ?? this.grid.nearestOpenLevel(a.x, a.z, 4);
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
    if (Math.hypot(s.tx - s.fx, s.tz - s.fz) > 1e-3) a.heading = Math.atan2(s.tx - s.fx, s.tz - s.fz);
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

  /**
   * The player removed something for good (not a move). Anyone whose favourite it was will go and
   * look for it, once: a `?` where it stood, a line, then they settle on another.
   */
  onGone(id: string): void {
    const o = this.smart.objects.get(id);
    if (!o) return;
    for (const a of this.agents) if (this.favouriteOf(a, o.kind) === id) a.missing.set(id, o.label);
  }

  /** Forget places that no longer exist, without looking for them (a reset of the town). */
  forgetGone(): void {
    for (const a of this.agents) {
      a.missing.clear();
      for (const id of a.places.ids) if (!this.smart.objects.has(id)) a.places.forget(id);
      for (const [kind, id] of a.favs) if (!this.smart.objects.has(id)) a.favs.delete(kind);
    }
  }

  onRemoved(id: string): void {
    this.bonds.removed(id); // any bond it helped stays; its credit reads "since removed"
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

  /** Each resident's diary, for the save. */
  diariesData(): Record<string, DiaryEntry[]> {
    const out: Record<string, DiaryEntry[]> = {};
    for (const a of this.agents) if (a.diary.entries.length) out[a.p.id] = [...a.diary.entries];
    return out;
  }
  restoreDiaries(d: Record<string, DiaryEntry[]>): void {
    for (const a of this.agents) if (d[a.p.id]) a.diary.entries = d[a.p.id]!.slice(-7);
  }

  /** What each resident knows of places (familiarity, favourites), for the save. */
  placesData(): Record<string, PlaceMemoryData> {
    const out: Record<string, PlaceMemoryData> = {};
    for (const a of this.agents) out[a.p.id] = a.places.toJSON();
    return out;
  }
  restorePlaces(d: Record<string, unknown>): void {
    for (const a of this.agents) {
      if (!(a.p.id in d)) {
        // a save from before place memory: their haunts are theirs as of now, not faded since day one
        for (const id of a.p.haunts ?? []) {
          const o = this.smart.objects.get(id);
          if (o) a.places.haunt(id, o.x, o.z, this.minutes);
        }
        continue;
      }
      a.places = PlaceMemory.from(d[a.p.id]);
      for (const kind of ['bench', 'cafe', 'view', 'catbowl', 'admire', 'vending'] as const) {
        const f = this.favouriteOf(a, kind);
        if (f) a.favs.set(kind, f);
      }
    }
  }

  /** The bond ladder, for the save. */
  bondsData(): Record<string, unknown> {
    return this.bonds.toJSON();
  }
  /** Restore the ladder (anything malformed is dropped), then lay the authored priors over it. */
  restoreBonds(d: unknown): void {
    this.bonds = Bonds.from(
      d,
      this.agents.map((a) => a.p.id),
    );
    this.seedBonds();
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
