/** Minimal DOM stand-ins so the world can be built in Node (real three.js scene graph, no WebGL). */
export function installHeadlessDom(): void {
  const ctx2d = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    fillRect() {},
    fillText() {},
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
  g.requestAnimationFrame ??= () => 0;
}

/** Build the full simulation the way main.ts does, with a given seed. */
export async function buildSim(seed: number) {
  const { EventBus } = await import('../../src/core/events');
  const { WorldClock } = await import('../../src/core/clock');
  const { World } = await import('../../src/world/world');
  const { GROUND, OBSTACLES } = await import('../../src/world/layout');
  const { groundHeight, isWalkableSurface } = await import('../../src/world/terrain');
  const { NavGrid } = await import('../../src/sim/grid');
  const { SmartRegistry, registerStaticObjects } = await import('../../src/sim/smart');
  const { Residents } = await import('../../src/sim/residents');
  const { Animals } = await import('../../src/sim/animals');
  type Events = import('../../src/core/events').GameEvents;

  const bus = new EventBus<Events>();
  const clock = new WorldClock(16.6);
  const world = new World(seed);
  const grid = new NavGrid(
    { x0: GROUND.x0, z0: GROUND.z0, w: GROUND.x1 - GROUND.x0, d: GROUND.z1 - GROUND.z0, cell: 0.5 },
    { walkable: isWalkableSurface, height: groundHeight },
    OBSTACLES,
  );
  const smart = new SmartRegistry();
  registerStaticObjects(smart);
  const residents = new Residents(world.scene, grid, smart, bus, world.mats, seed);
  const animals = new Animals(world.scene, world.mats, grid, smart, bus, world.chimneyTop, seed);
  return { clock, world, residents, animals, placed: () => [] };
}
