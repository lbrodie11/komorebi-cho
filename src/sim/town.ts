import { NavGrid } from './grid';
import { DOORS, EXITS, GROUND, OBSTACLES } from '../world/layout';
import { groundHeight, isWalkableSurface } from '../world/terrain';

/**
 * The town's nav grid: the plinth at 0.5 m cells, the static obstacles, and the doors and exits
 * that define its main region (doors are read live, so a shop that moves takes its anchor along).
 */
export function townGrid(): NavGrid {
  const grid = new NavGrid(
    { x0: GROUND.x0, z0: GROUND.z0, w: GROUND.x1 - GROUND.x0, d: GROUND.z1 - GROUND.z0, cell: 0.5 },
    { walkable: isWalkableSurface, height: groundHeight },
    OBSTACLES,
  );
  grid.setAnchors(() => [...Object.values(DOORS).map((d) => [d.x, d.z] as const), ...EXITS]);
  return grid;
}
