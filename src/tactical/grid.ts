export type Tile = 'floor' | 'grass' | 'road' | 'wall' | 'car' | 'fence' | 'crate';

export interface Pt {
  x: number;
  y: number;
}

/** Blocks movement. */
export function isSolid(t: Tile): boolean {
  return t === 'wall' || t === 'car' || t === 'fence' || t === 'crate';
}

/** Blocks line of sight. */
export function blocksSight(t: Tile): boolean {
  return t === 'wall';
}

/** Low cover: blocks movement, not sight; gives a defensive bonus to whoever hides behind it. */
export function isLowCover(t: Tile): boolean {
  return t === 'car' || t === 'fence' || t === 'crate';
}

export const DIRS8: Pt[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

export function chebyshev(a: Pt, b: Pt): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function key(x: number, y: number): number {
  return y * 1000 + x;
}

export class Grid {
  tiles: Tile[];
  constructor(public w: number, public h: number, fill: Tile = 'grass') {
    this.tiles = new Array(w * h).fill(fill);
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): Tile {
    return this.inBounds(x, y) ? this.tiles[y * this.w + x] : 'wall';
  }
  set(x: number, y: number, t: Tile): void {
    if (this.inBounds(x, y)) this.tiles[y * this.w + x] = t;
  }

  /** Bresenham line of sight between tile centres; endpoints don't block. */
  los(a: Pt, b: Pt): boolean {
    let x0 = a.x, y0 = a.y;
    const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (!(x0 === x1 && y0 === y1)) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      if (x0 === x1 && y0 === y1) break;
      if (blocksSight(this.get(x0, y0))) return false;
    }
    return true;
  }

  /** Diagonal steps may not squeeze between two solid tiles. */
  canStep(from: Pt, dx: number, dy: number): boolean {
    const nx = from.x + dx, ny = from.y + dy;
    if (!this.inBounds(nx, ny) || isSolid(this.get(nx, ny))) return false;
    if (dx !== 0 && dy !== 0) {
      if (isSolid(this.get(from.x + dx, from.y)) || isSolid(this.get(from.x, from.y + dy))) return false;
    }
    return true;
  }

  /**
   * BFS distances from `start` (8-way, each step costs 1), up to maxDist.
   * `blocked(x,y)` marks extra blockers (other creatures).
   */
  distances(start: Pt, maxDist: number, blocked: (x: number, y: number) => boolean): Map<number, { d: number; prev: number }> {
    const out = new Map<number, { d: number; prev: number }>();
    out.set(key(start.x, start.y), { d: 0, prev: -1 });
    let frontier: Pt[] = [start];
    for (let d = 1; d <= maxDist && frontier.length; d++) {
      const next: Pt[] = [];
      for (const p of frontier) {
        for (const dir of DIRS8) {
          if (!this.canStep(p, dir.x, dir.y)) continue;
          const nx = p.x + dir.x, ny = p.y + dir.y;
          const k = key(nx, ny);
          if (out.has(k) || blocked(nx, ny)) continue;
          out.set(k, { d, prev: key(p.x, p.y) });
          next.push({ x: nx, y: ny });
        }
      }
      frontier = next;
    }
    return out;
  }
}

export function unkey(k: number): Pt {
  return { x: k % 1000, y: Math.floor(k / 1000) };
}

export function pathTo(dist: Map<number, { d: number; prev: number }>, target: Pt): Pt[] {
  const path: Pt[] = [];
  let k = key(target.x, target.y);
  let node = dist.get(k);
  if (!node) return path;
  while (node && node.prev !== -1) {
    path.unshift(unkey(k));
    k = node.prev;
    node = dist.get(k);
  }
  return path;
}
