import { Rng } from '../game/rng';
import { makeSurvivor } from '../game/crew';
import type { MissionSite, Resources, ResourceKey } from '../game/types';
import { buildBaseGrid, coreTiles, initialStructures, interior, type Structure } from '../game/layout';
import { RESOURCE_KEYS } from '../game/types';
import type { BattleConfig, LootCache, ZombieKind } from './battle';
import { Grid, isSolid, key, type Pt } from './grid';

export const MAP_W = 26;
export const MAP_H = 18;

interface Rect { x: number; y: number; w: number; h: number }

function overlaps(a: Rect, b: Rect, pad: number) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

const CACHE_LABELS: Record<ResourceKey, string[]> = {
  food: ['Pantry shelf', 'Vending machine', 'Cooler box'],
  scrap: ['Toolbox', 'Parts bin', 'Workbench'],
  meds: ['First-aid kit', 'Medicine cabinet', 'Pharmacy drawer'],
  ammo: ['Locker', 'Gun safe', 'Duffel bag'],
};

function rollLoot(rng: Rng, bias: ResourceKey, danger: number): Partial<Resources> {
  const c: Partial<Resources> = {};
  c[bias] = rng.int(2, 3 + Math.floor(danger / 2));
  if (rng.chance(0.6)) {
    const other = rng.pick(RESOURCE_KEYS.filter((k) => k !== bias));
    c[other] = (c[other] ?? 0) + rng.int(1, 2);
  }
  return c;
}

function pickKind(rng: Rng, danger: number): ZombieKind {
  const r = rng.next();
  if (r < 0.03 + danger * 0.03) return 'brute';
  if (r < 0.15 + danger * 0.06) return 'runner';
  return 'walker';
}

/** Reachable tiles from a point, ignoring creatures. */
function flood(grid: Grid, from: Pt): Set<number> {
  return new Set(grid.distances(from, 999, () => false).keys());
}

export function generateScavengeMap(site: MissionSite, day: number): BattleConfig {
  for (let attempt = 0; attempt < 40; attempt++) {
    const cfg = tryScavenge(site, day, site.seed + attempt * 7919);
    if (cfg) return cfg;
  }
  throw new Error('map generation failed');
}

function tryScavenge(site: MissionSite, day: number, seed: number): BattleConfig | null {
  const rng = new Rng(seed);
  const grid = new Grid(MAP_W, MAP_H, 'grass');
  const danger = site.danger;

  // A road through the block.
  const roadY = rng.int(5, MAP_H - 6);
  for (let x = 0; x < MAP_W; x++) { grid.set(x, roadY, 'road'); grid.set(x, roadY + 1, 'road'); }

  // Buildings away from the deploy edge.
  const rooms: Rect[] = [];
  const target = rng.int(3, 5);
  for (let tries = 0; tries < 200 && rooms.length < target; tries++) {
    const r: Rect = { x: rng.int(6, MAP_W - 8), y: rng.int(1, MAP_H - 7), w: rng.int(5, 8), h: rng.int(4, 6) };
    if (r.x + r.w >= MAP_W - 1 || r.y + r.h >= MAP_H - 1) continue;
    if (r.y <= roadY + 2 && r.y + r.h >= roadY) continue;
    if (rooms.some((o) => overlaps(o, r, 2))) continue;
    rooms.push(r);
  }
  if (rooms.length < 3) return null;

  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
        grid.set(x, y, edge ? 'wall' : 'floor');
      }
    }
    // Doors: one facing the road, plus a back door sometimes.
    const doorSide = r.y > roadY ? 'top' : 'bottom';
    const dx = rng.int(r.x + 1, r.x + r.w - 2);
    grid.set(dx, doorSide === 'top' ? r.y : r.y + r.h - 1, 'floor');
    if (rng.chance(0.6)) {
      const side = rng.pick(['left', 'right'] as const);
      const dy = rng.int(r.y + 1, r.y + r.h - 2);
      grid.set(side === 'left' ? r.x : r.x + r.w - 1, dy, 'floor');
    }
    // Some furniture inside.
    if (rng.chance(0.5)) {
      const fx = rng.int(r.x + 2, r.x + r.w - 3), fy = rng.int(r.y + 1, r.y + r.h - 2);
      grid.set(fx, fy, 'crate');
    }
  }

  // Wrecked cars on and near the road, fences in yards.
  const cars = rng.int(3, 5);
  for (let i = 0; i < cars; i++) {
    const x = rng.int(5, MAP_W - 3), y = roadY + rng.int(0, 1);
    if (grid.get(x, y) === 'road' && grid.get(x + 1, y) === 'road') { grid.set(x, y, 'car'); grid.set(x + 1, y, 'car'); }
  }
  const fences = rng.int(2, 4);
  for (let i = 0; i < fences; i++) {
    const horiz = rng.chance(0.5);
    const len = rng.int(2, 4);
    const x0 = rng.int(4, MAP_W - 5), y0 = rng.int(1, MAP_H - 2);
    for (let j = 0; j < len; j++) {
      const x = horiz ? x0 + j : x0, y = horiz ? y0 : y0 + j;
      if (grid.get(x, y) === 'grass') grid.set(x, y, 'fence');
    }
  }

  // Deploy & evac on the west edge, around the road.
  const evac: Pt[] = [];
  for (let y = roadY - 1; y <= roadY + 2; y++) for (let x = 0; x <= 1; x++) evac.push({ x, y });
  for (const p of evac) if (isSolid(grid.get(p.x, p.y))) grid.set(p.x, p.y, 'road');
  const deploy: Pt[] = [
    { x: 2, y: roadY }, { x: 2, y: roadY + 1 }, { x: 3, y: roadY }, { x: 3, y: roadY + 1 },
    { x: 2, y: roadY - 1 }, { x: 2, y: roadY + 2 },
  ];
  for (const p of deploy) if (isSolid(grid.get(p.x, p.y))) grid.set(p.x, p.y, 'grass');

  const reach = flood(grid, deploy[0]);
  const floorTiles = (pred: (p: Pt) => boolean) => {
    const out: Pt[] = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (!isSolid(grid.get(x, y)) && reach.has(key(x, y)) && pred({ x, y })) out.push({ x, y });
    }
    return out;
  };
  const inRoom = (p: Pt) => rooms.some((r) => p.x > r.x && p.x < r.x + r.w - 1 && p.y > r.y && p.y < r.y + r.h - 1);
  const taken = new Set<number>(deploy.map((p) => key(p.x, p.y)));
  const take = (cands: Pt[]): Pt | null => {
    const free = cands.filter((p) => !taken.has(key(p.x, p.y)));
    if (!free.length) return null;
    const p = rng.pick(free);
    taken.add(key(p.x, p.y));
    return p;
  };

  // Loot: mostly indoors.
  const loot: LootCache[] = [];
  const lootCount = 4 + Math.ceil(danger * 0.8);
  const indoor = floorTiles(inRoom);
  const outdoor = floorTiles((p) => !inRoom(p) && p.x > 6);
  if (indoor.length < lootCount) return null;
  for (let i = 0; i < lootCount; i++) {
    const p = take(i < lootCount - 1 ? indoor : outdoor);
    if (!p) return null;
    const bias = rng.chance(0.7) ? site.lootBias : rng.pick(RESOURCE_KEYS);
    loot.push({ x: p.x, y: p.y, contents: rollLoot(rng, bias, danger), label: rng.pick(CACHE_LABELS[bias]) });
  }

  // A survivor holed up deep inside.
  const strangers = [];
  if (site.hasSurvivor) {
    const p = take(indoor.filter((q) => q.x > MAP_W / 2));
    if (p) strangers.push({ x: p.x, y: p.y, survivor: makeSurvivor(rng, -1) });
  }

  // Zombies, dormant, away from the drop-off.
  const zombies: BattleConfig['zombies'] = [];
  const zc = 3 + Math.round(danger * 1.5) + Math.floor(day / 4);
  const zTiles = floorTiles((p) => p.x >= 9);
  for (let i = 0; i < zc; i++) {
    const p = take(zTiles);
    if (!p) break;
    zombies.push({ kind: pickKind(rng, danger), x: p.x, y: p.y });
  }

  // Spawn points: east, north and south edges.
  const spawns = floorTiles((p) => (p.x >= MAP_W - 2 || ((p.y === 0 || p.y === MAP_H - 1) && p.x > 10)));
  if (spawns.length < 4) return null;

  return { grid, evac, deploy, spawns, loot, strangers, zombies, objective: { type: 'extract' }, danger, seed };
}

/** Night-horde defense of the home base, fought on the base's own layout. */
export function generateDefenseMap(seed: number, day: number, wallsLevel: number, structures: Structure[] = initialStructures()): BattleConfig {
  const rng = new Rng(seed);
  const grid = buildBaseGrid(structures, wallsLevel);
  const core = coreTiles();
  const hall = structures.find((st) => st.id === 'hall')!;
  const deploy = interior(hall).filter((p) => !core.some((c) => c.x === p.x && c.y === p.y));
  rng.shuffle(deploy);

  const spawns: Pt[] = [];
  for (let x = 0; x < MAP_W; x++) { spawns.push({ x, y: 0 }, { x, y: MAP_H - 1 }); }
  for (let y = 1; y < MAP_H - 1; y++) { spawns.push({ x: 0, y }, { x: MAP_W - 1, y }); }
  const open = spawns.filter((p) => !isSolid(grid.get(p.x, p.y)));

  const zombies: BattleConfig['zombies'] = [];
  const n = 5 + day;
  const danger = Math.min(5, 1 + Math.floor(day / 4));
  rng.shuffle(open);
  for (let i = 0; i < Math.min(n, open.length); i++) {
    zombies.push({ kind: pickKind(rng, danger), x: open[i].x, y: open[i].y });
  }
  return {
    grid, evac: [], deploy, spawns: open, loot: [], strangers: [],
    zombies, objective: { type: 'survive', turns: 8 }, danger, seed, core,
  };
}
