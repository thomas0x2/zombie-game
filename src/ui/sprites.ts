/**
 * Procedurally drawn, top-down "colony sim" style art: flat colours, chunky outlines,
 * textured ground and simple round-headed characters. All original, drawn with Canvas 2D.
 */
import type { Grid, Pt, Tile } from '../tactical/grid';
import { isSolid } from '../tactical/grid';
import type { ResourceKey } from '../game/types';

export const TS = 40;

/** Deterministic per-tile noise in [0,1). */
export function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

const OUTLINE = '#1d1a16';

// ---------------------------------------------------------------- terrain

function drawGrass(c: CanvasRenderingContext2D, x: number, y: number) {
  const px = x * TS, py = y * TS;
  const soil = hash(x >> 1, y >> 1, 7) < 0.18;
  c.fillStyle = soil ? '#6e5a3e' : hash(x, y, 1) < 0.5 ? '#56653a' : '#5a6a3c';
  c.fillRect(px, py, TS, TS);
  // Speckles and tufts.
  for (let i = 0; i < 9; i++) {
    const sx = px + hash(x, y, 10 + i) * TS, sy = py + hash(x, y, 30 + i) * TS;
    c.fillStyle = soil ? (i % 2 ? '#5e4c33' : '#7c6747') : (i % 3 === 0 ? '#6f8048' : i % 3 === 1 ? '#4a5832' : '#7a8a4c');
    c.fillRect(sx, sy, 2, 2);
  }
  if (!soil && hash(x, y, 50) < 0.35) {
    const tx = px + 6 + hash(x, y, 51) * (TS - 12), ty = py + 8 + hash(x, y, 52) * (TS - 14);
    c.strokeStyle = '#3f4c2b';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(tx, ty + 5); c.lineTo(tx - 3, ty);
    c.moveTo(tx, ty + 5); c.lineTo(tx, ty - 1);
    c.moveTo(tx, ty + 5); c.lineTo(tx + 3, ty);
    c.stroke();
  }
  if (!soil && hash(x, y, 60) < 0.06) {
    // A few wildflowers.
    c.fillStyle = hash(x, y, 61) < 0.5 ? '#d9c15a' : '#c98a9a';
    c.beginPath(); c.arc(px + 10 + hash(x, y, 62) * 20, py + 10 + hash(x, y, 63) * 20, 2, 0, Math.PI * 2); c.fill();
  }
}

function drawRoad(c: CanvasRenderingContext2D, g: Grid, x: number, y: number) {
  const px = x * TS, py = y * TS;
  c.fillStyle = hash(x, y, 2) < 0.5 ? '#45443f' : '#4a4943';
  c.fillRect(px, py, TS, TS);
  for (let i = 0; i < 7; i++) {
    c.fillStyle = i % 2 ? '#3a3935' : '#55534c';
    c.fillRect(px + hash(x, y, 70 + i) * TS, py + hash(x, y, 80 + i) * TS, 2, 2);
  }
  if (hash(x, y, 90) < 0.25) {
    c.strokeStyle = '#2f2e2a';
    c.lineWidth = 1;
    c.beginPath();
    let cx = px + hash(x, y, 91) * TS, cy = py + hash(x, y, 92) * TS;
    c.moveTo(cx, cy);
    for (let i = 0; i < 3; i++) { cx += (hash(x, y, 93 + i) - 0.5) * 16; cy += (hash(x, y, 96 + i) - 0.5) * 16; c.lineTo(cx, cy); }
    c.stroke();
  }
  // Faded centre line between the two road lanes.
  if (g.get(x, y + 1) === 'road' && g.get(x, y - 1) !== 'road' && x % 2 === 0) {
    c.fillStyle = 'rgba(214, 182, 92, 0.75)';
    c.fillRect(px + 6, py + TS - 2, TS - 12, 4);
  }
}

function drawFloor(c: CanvasRenderingContext2D, x: number, y: number) {
  const px = x * TS, py = y * TS;
  const plank = TS / 4;
  for (let i = 0; i < 4; i++) {
    const v = hash(x, y * 4 + i, 3);
    c.fillStyle = v < 0.33 ? '#8a6a47' : v < 0.66 ? '#93714c' : '#83643f';
    c.fillRect(px, py + i * plank, TS, plank);
    c.fillStyle = '#5f4630';
    c.fillRect(px, py + i * plank + plank - 1, TS, 1);
    const seam = px + ((hash(x, y * 4 + i, 4) * TS) | 0);
    c.fillRect(seam, py + i * plank, 1, plank);
  }
  if (hash(x, y, 5) < 0.12) {
    c.fillStyle = 'rgba(60, 35, 20, 0.35)';
    c.beginPath(); c.ellipse(px + TS / 2, py + TS / 2, 9, 6, hash(x, y, 6) * 3, 0, Math.PI * 2); c.fill();
  }
}

function drawWall(c: CanvasRenderingContext2D, g: Grid, x: number, y: number) {
  const px = x * TS, py = y * TS;
  const wall = (dx: number, dy: number) => g.get(x + dx, y + dy) === 'wall' && g.inBounds(x + dx, y + dy);
  c.fillStyle = '#8d8478';
  c.fillRect(px, py, TS, TS);
  // Brick courses.
  c.strokeStyle = '#776e63';
  c.lineWidth = 1;
  for (let r = 0; r < 4; r++) {
    const yy = py + r * (TS / 4);
    c.beginPath(); c.moveTo(px, yy); c.lineTo(px + TS, yy); c.stroke();
    const off = r % 2 ? TS / 4 : 0;
    for (let k = off; k < TS; k += TS / 2) { c.beginPath(); c.moveTo(px + k, yy); c.lineTo(px + k, yy + TS / 4); c.stroke(); }
  }
  // Lit top face and chunky outline only where the wall meets open ground.
  c.fillStyle = '#a69c8e';
  if (!wall(0, -1)) c.fillRect(px, py, TS, 5);
  c.fillStyle = OUTLINE;
  if (!wall(0, -1)) c.fillRect(px, py, TS, 2);
  if (!wall(0, 1)) c.fillRect(px, py + TS - 3, TS, 3);
  if (!wall(-1, 0)) c.fillRect(px, py, 2, TS);
  if (!wall(1, 0)) c.fillRect(px + TS - 2, py, 2, TS);
}

function drawFence(c: CanvasRenderingContext2D, g: Grid, x: number, y: number) {
  const px = x * TS, py = y * TS, m = TS / 2;
  const f = (dx: number, dy: number) => g.get(x + dx, y + dy) === 'fence';
  c.lineCap = 'round';
  const rail = (x1: number, y1: number, x2: number, y2: number) => {
    c.strokeStyle = OUTLINE; c.lineWidth = 6; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.strokeStyle = '#8b6a3e'; c.lineWidth = 3.5; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  };
  const horiz = f(-1, 0) || f(1, 0) || !(f(0, -1) || f(0, 1));
  if (horiz) rail(f(-1, 0) ? px : px + 6, py + m, f(1, 0) ? px + TS : px + TS - 6, py + m);
  if (f(0, -1) || f(0, 1)) rail(px + m, f(0, -1) ? py : py + 6, px + m, f(0, 1) ? py + TS : py + TS - 6);
  c.lineCap = 'butt';
  c.fillStyle = OUTLINE; c.fillRect(px + m - 5, py + m - 5, 10, 10);
  c.fillStyle = '#a07b48'; c.fillRect(px + m - 3.5, py + m - 3.5, 7, 7);
}

function drawCrate(c: CanvasRenderingContext2D, x: number, y: number) {
  const px = x * TS + 6, py = y * TS + 6, s = TS - 12;
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(px + 3, py + 4, s, s);
  c.fillStyle = OUTLINE; c.fillRect(px - 1.5, py - 1.5, s + 3, s + 3);
  c.fillStyle = '#a3824f'; c.fillRect(px, py, s, s);
  c.strokeStyle = '#6f5432'; c.lineWidth = 2;
  c.strokeRect(px + 2, py + 2, s - 4, s - 4);
  c.beginPath(); c.moveTo(px + 3, py + 3); c.lineTo(px + s - 3, py + s - 3); c.stroke();
}

const CAR_COLORS = ['#7d3a32', '#3f5f7a', '#6d6a5c', '#8a7444', '#4d6a4a', '#9a9a92'];

function drawCar(c: CanvasRenderingContext2D, x: number, y: number, wide: boolean) {
  const w = wide ? TS * 2 - 6 : TS - 6, h = TS - 10;
  const px = x * TS + 3, py = y * TS + 5;
  const col = CAR_COLORS[Math.floor(hash(x, y, 11) * CAR_COLORS.length)];
  c.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(c, px + 3, py + 4, w, h, 8); c.fill();
  c.fillStyle = OUTLINE; roundRect(c, px - 1.5, py - 1.5, w + 3, h + 3, 9); c.fill();
  c.fillStyle = col; roundRect(c, px, py, w, h, 8); c.fill();
  c.fillStyle = shade(col, 0.08); roundRect(c, px + 3, py + 3, w - 6, h / 2 - 3, 5); c.fill();
  if (wide) {
    // Cabin, windshields.
    c.fillStyle = '#2b3640';
    roundRect(c, px + w * 0.28, py + 4, w * 0.12, h - 8, 3); c.fill();
    roundRect(c, px + w * 0.68, py + 4, w * 0.08, h - 8, 3); c.fill();
    c.fillStyle = shade(col, -0.08);
    c.fillRect(px + w * 0.41, py + 5, w * 0.26, h - 10);
    // Headlights.
    c.fillStyle = '#e8e0b8'; c.fillRect(px + 2, py + 3, 3, 4); c.fillRect(px + 2, py + h - 7, 3, 4);
  } else {
    c.fillStyle = '#2b2622'; c.fillRect(px + w * 0.3, py + 4, w * 0.4, h - 8);
  }
  // Rust and soot.
  for (let i = 0; i < 4; i++) {
    c.fillStyle = i % 2 ? 'rgba(120,60,20,0.55)' : 'rgba(20,15,10,0.35)';
    c.beginPath(); c.arc(px + hash(x, y, 20 + i) * w, py + hash(x, y, 30 + i) * h, 2 + hash(x, y, 40 + i) * 3, 0, Math.PI * 2); c.fill();
  }
}

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Renders the static ground layer once. */
export function renderTerrain(g: Grid, evac: Pt[], core: Pt[]): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = g.w * TS;
  cv.height = g.h * TS;
  const c = cv.getContext('2d')!;
  const groundOf = (t: Tile, x: number, y: number): Tile => {
    if (t !== 'car' && t !== 'fence' && t !== 'crate') return t;
    // Objects sit on whatever ground surrounds them.
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const n = g.get(x + dx, y + dy);
      if (n === 'road' || n === 'floor') return n;
    }
    return 'grass';
  };
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const ground = groundOf(g.get(x, y), x, y);
    if (ground === 'road') drawRoad(c, g, x, y);
    else if (ground === 'floor') drawFloor(c, x, y);
    else drawGrass(c, x, y);
  }
  // Wall shadows fall down-right onto the ground.
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.get(x, y) !== 'wall') continue;
    c.fillStyle = 'rgba(0,0,0,0.28)';
    if (g.get(x, y + 1) !== 'wall') c.fillRect(x * TS + 5, (y + 1) * TS, TS, 7);
    if (g.get(x + 1, y) !== 'wall') c.fillRect((x + 1) * TS, y * TS + 5, 6, TS);
  }
  const usedCar = new Set<number>();
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const t = g.get(x, y);
    if (t === 'wall') drawWall(c, g, x, y);
    else if (t === 'fence') drawFence(c, g, x, y);
    else if (t === 'crate') drawCrate(c, x, y);
    else if (t === 'car' && !usedCar.has(y * 1000 + x)) {
      const wide = g.get(x + 1, y) === 'car' && !usedCar.has(y * 1000 + x + 1);
      if (wide) usedCar.add(y * 1000 + x + 1);
      usedCar.add(y * 1000 + x);
      drawCar(c, x, y, wide);
    }
  }
  // Evac zone: painted landing marks.
  if (evac.length) {
    for (const p of evac) {
      c.fillStyle = 'rgba(120, 200, 110, 0.22)';
      c.fillRect(p.x * TS, p.y * TS, TS, TS);
    }
    const minX = Math.min(...evac.map((p) => p.x)), maxX = Math.max(...evac.map((p) => p.x));
    const minY = Math.min(...evac.map((p) => p.y)), maxY = Math.max(...evac.map((p) => p.y));
    c.setLineDash([6, 4]);
    c.strokeStyle = 'rgba(170, 230, 140, 0.9)';
    c.lineWidth = 2;
    c.strokeRect(minX * TS + 2, minY * TS + 2, (maxX - minX + 1) * TS - 4, (maxY - minY + 1) * TS - 4);
    c.setLineDash([]);
    label(c, 'EVAC', ((minX + maxX + 1) / 2) * TS, minY * TS + 14, '#d8f5c8');
  }
  if (core.length) {
    const minX = Math.min(...core.map((p) => p.x)), maxX = Math.max(...core.map((p) => p.x));
    const minY = Math.min(...core.map((p) => p.y)), maxY = Math.max(...core.map((p) => p.y));
    // Supply stockpile: sacks and barrels.
    for (const p of core) drawStockpile(c, p.x, p.y);
    c.setLineDash([6, 4]);
    c.strokeStyle = 'rgba(230, 110, 80, 0.9)';
    c.lineWidth = 2;
    c.strokeRect(minX * TS + 2, minY * TS + 2, (maxX - minX + 1) * TS - 4, (maxY - minY + 1) * TS - 4);
    c.setLineDash([]);
    label(c, 'STORES', ((minX + maxX + 1) / 2) * TS, minY * TS - 4, '#f6c7b8');
  }
  return cv;
}

function drawStockpile(c: CanvasRenderingContext2D, x: number, y: number) {
  const px = x * TS, py = y * TS;
  const barrel = (bx: number, by: number) => {
    c.fillStyle = OUTLINE; c.beginPath(); c.arc(bx, by, 7.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#5c6e7a'; c.beginPath(); c.arc(bx, by, 6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#3e4c55'; c.lineWidth = 1; c.beginPath(); c.arc(bx, by, 3, 0, Math.PI * 2); c.stroke();
  };
  const sack = (bx: number, by: number) => {
    c.fillStyle = OUTLINE; roundRect(c, bx - 8, by - 6, 16, 12, 5); c.fill();
    c.fillStyle = '#c2a874'; roundRect(c, bx - 6.5, by - 4.5, 13, 9, 4); c.fill();
  };
  if (hash(x, y, 77) < 0.5) { barrel(px + 13, py + 13); sack(px + 26, py + 27); }
  else { sack(px + 14, py + 14); barrel(px + 27, py + 26); }
}

export function label(c: CanvasRenderingContext2D, text: string, cx: number, cy: number, color = '#f2efe6') {
  c.font = '600 11px system-ui, sans-serif';
  const w = c.measureText(text).width + 8;
  c.fillStyle = 'rgba(15, 14, 12, 0.62)';
  roundRect(c, cx - w / 2, cy - 8, w, 14, 3);
  c.fill();
  c.fillStyle = color;
  c.textAlign = 'center';
  c.fillText(text, cx, cy + 3);
  c.textAlign = 'left';
}

// ---------------------------------------------------------------- characters

export interface PawnLook {
  body: string;
  skin: string;
  hair: string;
  hairStyle: number;
  zombie?: 'walker' | 'runner' | 'brute';
}

const CLOTHES = ['#7a5b3a', '#4f6d7a', '#8b3f3a', '#5e6b45', '#7b6a8c', '#9a7b4f', '#3f5068', '#a0643c'];
const SKINS = ['#f1d3b6', '#e0b48e', '#c48a5f', '#93603c', '#6b4329'];
const HAIRS = ['#2a1d15', '#5a3a1f', '#a8743a', '#d8c27a', '#7a2f1c', '#3a3a3a', '#bdbdb5'];

export function lookFor(seed: string): PawnLook {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const r = (k: number) => hash(h, k, 99);
  return {
    body: CLOTHES[Math.floor(r(1) * CLOTHES.length)],
    skin: SKINS[Math.floor(r(2) * SKINS.length)],
    hair: HAIRS[Math.floor(r(3) * HAIRS.length)],
    hairStyle: Math.floor(r(4) * 3),
  };
}

export function zombieLook(kind: 'walker' | 'runner' | 'brute', id: number): PawnLook {
  const rags = ['#4d4a3f', '#5a4b45', '#3f4a4f', '#5b5a48', '#4a3f3a'];
  return {
    body: rags[id % rags.length],
    skin: kind === 'brute' ? '#8f9a6a' : kind === 'runner' ? '#a3a58a' : '#8c9878',
    hair: '#2d2a22',
    hairStyle: id % 3,
    zombie: kind,
  };
}

/** facing: 0 down, 1 left, 2 up, 3 right. */
export function drawPawn(c: CanvasRenderingContext2D, cx: number, cy: number, look: PawnLook, facing: number, opts: { armed?: boolean; bob?: number } = {}) {
  const z = look.zombie;
  const s = z === 'brute' ? 1.3 : 1;
  const bob = opts.bob ?? 0;
  // Ground shadow.
  c.fillStyle = 'rgba(0,0,0,0.32)';
  c.beginPath(); c.ellipse(cx + 2, cy + 13 * s, 11 * s, 4.5 * s, 0, 0, Math.PI * 2); c.fill();

  const bodyW = (z === 'brute' ? 15 : z === 'runner' ? 10 : 11.5) * s;
  const bodyH = 11 * s;
  const by = cy + 4 * s + bob;
  // Weapon held to the side it faces.
  if (opts.armed && facing !== 2) {
    const dir = facing === 1 ? -1 : 1;
    c.strokeStyle = OUTLINE; c.lineWidth = 4;
    c.beginPath();
    if (facing === 0) { c.moveTo(cx + 7, by - 2); c.lineTo(cx + 9, by + 12); }
    else { c.moveTo(cx + dir * 2, by + 1); c.lineTo(cx + dir * 17, by + 1); }
    c.stroke();
    c.strokeStyle = '#4b4b4b'; c.lineWidth = 2; c.stroke();
  }
  // Body (rounded, outlined).
  c.fillStyle = OUTLINE;
  c.beginPath(); c.ellipse(cx, by, bodyW + 1.5, bodyH + 1.5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = look.body;
  c.beginPath(); c.ellipse(cx, by, bodyW, bodyH, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = shade(look.body, 0.07);
  c.beginPath(); c.ellipse(cx - bodyW * 0.25, by - bodyH * 0.35, bodyW * 0.5, bodyH * 0.35, 0, 0, Math.PI * 2); c.fill();
  if (z) {
    // Torn clothes and stains.
    c.fillStyle = '#6b2a22';
    c.beginPath(); c.arc(cx + bodyW * 0.3, by + 2, 2.5 * s, 0, Math.PI * 2); c.fill();
    c.fillStyle = look.skin;
    c.beginPath(); c.arc(cx - bodyW * 0.4, by + bodyH * 0.4, 2.2 * s, 0, Math.PI * 2); c.fill();
  }
  // Head.
  const hr = (z === 'brute' ? 8 : 8.5) * (z === 'brute' ? 1.05 : 1);
  const hx = cx + (facing === 1 ? -2 : facing === 3 ? 2 : 0);
  const hy = cy - 9 * s + bob;
  c.fillStyle = OUTLINE;
  c.beginPath(); c.arc(hx, hy, hr + 1.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = look.skin;
  c.beginPath(); c.arc(hx, hy, hr, 0, Math.PI * 2); c.fill();
  // Hair.
  c.fillStyle = look.hair;
  if (facing === 2) {
    c.beginPath(); c.arc(hx, hy, hr, 0, Math.PI * 2); c.fill();
  } else if (!z || look.hairStyle !== 2) {
    c.beginPath();
    if (look.hairStyle === 0) c.arc(hx, hy, hr, Math.PI * 1.05, Math.PI * 1.95);
    else c.arc(hx, hy - 1, hr, Math.PI * 0.9, Math.PI * 2.1);
    c.closePath(); c.fill();
  }
  // Eyes.
  if (facing !== 2) {
    c.fillStyle = z ? '#c23b22' : '#1d1a16';
    const ey = hy + 1.5;
    if (facing === 0) { c.fillRect(hx - 4, ey, 2, 2.5); c.fillRect(hx + 2, ey, 2, 2.5); }
    else { const ex = facing === 1 ? hx - 5 : hx + 3; c.fillRect(ex, ey, 2, 2.5); }
  }
}

export function drawHpBar(c: CanvasRenderingContext2D, cx: number, top: number, frac: number, color: string) {
  const w = 24;
  c.fillStyle = 'rgba(10,10,10,0.75)';
  c.fillRect(cx - w / 2 - 1, top - 1, w + 2, 5);
  c.fillStyle = color;
  c.fillRect(cx - w / 2, top, w * Math.max(0, Math.min(1, frac)), 3);
}

/** Corner brackets around a selected thing. */
export function drawBrackets(c: CanvasRenderingContext2D, x: number, y: number, size: number, color = '#f2efe6') {
  const l = 7;
  c.strokeStyle = color;
  c.lineWidth = 2;
  c.beginPath();
  for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const px = x + sx * size, py = y + sy * size;
    const dx = sx ? -l : l, dy = sy ? -l : l;
    c.moveTo(px + dx, py); c.lineTo(px, py); c.lineTo(px, py + dy);
  }
  c.stroke();
}

// ---------------------------------------------------------------- items

export function drawLoot(c: CanvasRenderingContext2D, x: number, y: number, kind: ResourceKey) {
  const px = x * TS + TS / 2, py = y * TS + TS / 2;
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.beginPath(); c.ellipse(px + 2, py + 9, 11, 4, 0, 0, Math.PI * 2); c.fill();
  if (kind === 'food') {
    for (const [ox, oy] of [[-6, 2], [5, 3], [0, -5]]) {
      c.fillStyle = OUTLINE; c.beginPath(); c.arc(px + ox, py + oy, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#b8b2a5'; c.beginPath(); c.arc(px + ox, py + oy, 4.8, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#b5453a'; c.beginPath(); c.arc(px + ox, py + oy, 3, 0, Math.PI * 2); c.fill();
    }
  } else if (kind === 'meds') {
    c.fillStyle = OUTLINE; c.fillRect(px - 10, py - 8, 20, 16);
    c.fillStyle = '#ece7dc'; c.fillRect(px - 8.5, py - 6.5, 17, 13);
    c.fillStyle = '#c0392b'; c.fillRect(px - 1.5, py - 5, 3, 10); c.fillRect(px - 5, py - 1.5, 10, 3);
  } else if (kind === 'ammo') {
    c.fillStyle = OUTLINE; c.fillRect(px - 11, py - 7, 22, 14);
    c.fillStyle = '#5d6b3c'; c.fillRect(px - 9.5, py - 5.5, 19, 11);
    c.fillStyle = '#d9b44a';
    for (let i = 0; i < 4; i++) c.fillRect(px - 7 + i * 4, py - 3, 2, 6);
  } else {
    // Scrap: a tangle of metal and a gear.
    c.strokeStyle = OUTLINE; c.lineWidth = 4;
    c.beginPath(); c.moveTo(px - 10, py + 5); c.lineTo(px + 8, py - 6); c.stroke();
    c.strokeStyle = '#9aa1a6'; c.lineWidth = 2.5; c.stroke();
    c.fillStyle = OUTLINE; c.beginPath(); c.arc(px + 3, py + 3, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#8b8f8f'; c.beginPath(); c.arc(px + 3, py + 3, 5.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#5a5e60'; c.beginPath(); c.arc(px + 3, py + 3, 2, 0, Math.PI * 2); c.fill();
  }
}

export function solidAt(g: Grid, x: number, y: number) {
  return isSolid(g.get(x, y));
}
