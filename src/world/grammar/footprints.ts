import { APATO, CAFE, MICRO_HOME, SENTO, SHOPS, TEMPLE, TOOL_SHED } from '../layout';
import { streetContext } from './street';
import type { ShopHouseSpec } from './types';

/** A building's plan box and the height of its highest roof point: what wires must clear. */
export interface RoofBox {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

const ROOF_RISE = { gable: 1.4, shed: 1, flat: 0.3 } as const;

/** Every building in the town as a roof box (from the same specs the grammar builds; `shops` as they stand now). */
export function townRoofs(shopSpecs: readonly ShopHouseSpec[] = SHOPS): RoofBox[] {
  const street = streetContext(shopSpecs);
  const shops = shopSpecs.map((s) => {
    const fx = street.get(s.id)!.frontX;
    return { id: s.id, x0: fx - s.depth, x1: fx, z0: s.z0, z1: s.z1, top: s.height + ROOF_RISE[s.roof] + 0.32 };
  });
  const bbox = (id: string, pts: readonly (readonly [number, number])[], top: number): RoofBox => ({
    id,
    x0: Math.min(...pts.map((p) => p[0])),
    x1: Math.max(...pts.map((p) => p[0])),
    z0: Math.min(...pts.map((p) => p[1])),
    z1: Math.max(...pts.map((p) => p[1])),
    top,
  });
  const box = (id: string, x: number, z: number, w: number, d: number, top: number): RoofBox => ({
    id,
    x0: x - w / 2,
    x1: x + w / 2,
    z0: z - d / 2,
    z1: z + d / 2,
    top,
  });
  return [
    ...shops,
    box('sento', SENTO.x, SENTO.z, SENTO.w, SENTO.d, SENTO.y + SENTO.h + 2.2),
    bbox('microhome', MICRO_HOME.pts, MICRO_HOME.y + MICRO_HOME.h + 1.4),
    box('apato', APATO.x, APATO.z, APATO.w, APATO.d, APATO.y + APATO.h + 1.1),
    box('temple', TEMPLE.x, TEMPLE.z, TEMPLE.w + 1.6, TEMPLE.d + 1.2, TEMPLE.y + 0.3 + TEMPLE.h + 2.1),
    bbox('cafe', CAFE.pts, CAFE.y + CAFE.h1 + CAFE.h2 + 0.34),
    box('shed', TOOL_SHED.x, TOOL_SHED.z, TOOL_SHED.w, TOOL_SHED.d, TOOL_SHED.y + TOOL_SHED.h + 0.3),
  ];
}
