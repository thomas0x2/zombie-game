/**
 * The home base: an old fire station compound with existing buildings that can be
 * repaired, remodeled for a purpose and upgraded.
 */
import { Grid, type Pt } from '../tactical/grid';

export type StructureSize = 'small' | 'medium' | 'large';
export type Purpose = 'bunks' | 'garden' | 'workshop' | 'infirmary' | 'radio' | 'tower';

export interface Structure {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: StructureSize;
  doors: Pt[];
  /** The hall is the station's heart (stores, beds) and can't be remodeled. */
  fixed?: boolean;
  ruined: boolean;
  purpose: Purpose | null;
  level: number;
}

export const SIZE_CAP: Record<StructureSize, number> = { small: 1, medium: 2, large: 3 };

export const ALLOWED: Record<StructureSize, Purpose[]> = {
  small: ['tower', 'radio', 'infirmary', 'workshop'],
  medium: ['bunks', 'garden', 'workshop', 'infirmary', 'radio'],
  large: ['bunks', 'garden', 'workshop', 'infirmary'],
};

export const BASE_W = 26;
export const BASE_H = 18;
/** Compound perimeter (inclusive). */
export const RING = { x0: 1, y0: 1, x1: 24, y1: 16 };

/** Gate openings in the perimeter, most to least important. */
const GATES: Pt[][] = [
  [{ x: 1, y: 13 }, { x: 1, y: 14 }],
  [{ x: 24, y: 9 }, { x: 24, y: 10 }],
  [{ x: 7, y: 1 }, { x: 8, y: 1 }],
  [{ x: 17, y: 16 }, { x: 16, y: 16 }],
];

export function initialStructures(): Structure[] {
  const s = (o: Omit<Structure, 'ruined' | 'purpose' | 'level'> & Partial<Structure>): Structure =>
    ({ ruined: false, purpose: null, level: 0, ...o });
  return [
    s({ id: 'hall', name: 'Station Hall', x: 9, y: 6, w: 8, h: 5, size: 'large', fixed: true,
      doors: [{ x: 12, y: 10 }, { x: 13, y: 10 }, { x: 12, y: 6 }, { x: 16, y: 8 }] }),
    s({ id: 'tower', name: 'Hose Tower', x: 3, y: 3, w: 3, h: 3, size: 'small', doors: [{ x: 4, y: 5 }] }),
    s({ id: 'garage', name: 'Engine Garage', x: 17, y: 3, w: 7, h: 5, size: 'large', doors: [{ x: 17, y: 5 }, { x: 20, y: 7 }, { x: 21, y: 7 }] }),
    s({ id: 'office', name: 'Dispatch Office', x: 3, y: 8, w: 5, h: 4, size: 'medium', doors: [{ x: 7, y: 9 }], ruined: true }),
    s({ id: 'house', name: "Chief's House", x: 9, y: 12, w: 6, h: 4, size: 'medium', doors: [{ x: 11, y: 12 }], ruined: true }),
    s({ id: 'shed', name: 'Tool Shed', x: 18, y: 11, w: 3, h: 3, size: 'small', doors: [{ x: 18, y: 12 }] }),
    s({ id: 'container', name: 'Shipping Container', x: 10, y: 2, w: 5, h: 3, size: 'small', doors: [{ x: 12, y: 4 }], ruined: true }),
  ];
}

export function interior(st: Structure): Pt[] {
  const out: Pt[] = [];
  for (let y = st.y + 1; y < st.y + st.h - 1; y++) for (let x = st.x + 1; x < st.x + st.w - 1; x++) out.push({ x, y });
  return out;
}

export function structureAt(list: Structure[], x: number, y: number): Structure | undefined {
  return list.find((st) => x >= st.x && x < st.x + st.w && y >= st.y && y < st.y + st.h);
}

/** Tiles in the hall where supplies are kept; zombies standing here damage the base. */
export function coreTiles(): Pt[] {
  return [{ x: 12, y: 7 }, { x: 13, y: 7 }, { x: 12, y: 8 }, { x: 13, y: 8 }];
}

export function buildBaseGrid(structures: Structure[], wallsLevel: number): Grid {
  const g = new Grid(BASE_W, BASE_H, 'grass');
  // Yard: a cracked concrete apron in front of the hall and garage.
  for (let y = RING.y0 + 1; y < RING.y1; y++) for (let x = RING.x0 + 1; x < RING.x1; x++) {
    if ((x >= 15 && y >= 8 && y <= 10) || (x >= 17 && x <= 23 && y === 8)) g.set(x, y, 'road');
  }
  for (let y = 9; y <= 10; y++) for (let x = 17; x < BASE_W; x++) g.set(x, y, 'road');

  // Perimeter.
  const ringTile = wallsLevel >= 1 ? 'wall' : 'fence';
  for (let x = RING.x0; x <= RING.x1; x++) { g.set(x, RING.y0, ringTile); g.set(x, RING.y1, ringTile); }
  for (let y = RING.y0; y <= RING.y1; y++) { g.set(RING.x0, y, ringTile); g.set(RING.x1, y, ringTile); }
  const gates = wallsLevel >= 2 ? 2 : wallsLevel === 1 ? 3 : 4;
  const width = wallsLevel === 0 ? 2 : 1;
  for (let i = 0; i < gates; i++) {
    for (let j = 0; j < width; j++) {
      const p = GATES[i][j];
      g.set(p.x, p.y, i === 1 ? 'road' : 'grass');
    }
  }

  // Buildings.
  for (const st of structures) {
    for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) {
      const edge = x === st.x || y === st.y || x === st.x + st.w - 1 || y === st.y + st.h - 1;
      g.set(x, y, edge ? 'wall' : 'floor');
    }
    for (const d of st.doors) g.set(d.x, d.y, 'floor');
    if (st.ruined) {
      // Collapsed sections and rubble.
      const inside = interior(st);
      g.set(st.x + st.w - 1, st.y, 'grass');
      if (inside.length > 2) g.set(inside[inside.length - 1].x, inside[inside.length - 1].y, 'crate');
    }
  }
  return g;
}
