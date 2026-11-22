import { purposeDef } from '../game/base';
import { isFit } from '../game/crew';
import { buildBaseGrid, coreTiles, interior, structureAt, type Structure } from '../game/layout';
import type { RunState } from '../game/types';
import { isSolid, type Pt } from '../tactical/grid';
import { TS, drawBrackets, drawPawn, drawRooms, hash, label, lookFor, renderTerrain } from './sprites';
import { h } from './dom';

function roomLabel(st: Structure): string {
  if (st.fixed) return st.name;
  if (st.ruined) return `${st.name} · ruined`;
  if (!st.purpose) return `${st.name} · empty`;
  return `${purposeDef(st.purpose).name} ${st.level}`;
}

/** Where each survivor is hanging out today. */
function crewSpots(s: RunState): { name: string; p: Pt; facing: number }[] {
  const grid = buildBaseGrid(s.structures, s.buildings.walls);
  const free = (p: Pt) => !isSolid(grid.get(p.x, p.y));
  const placeIn = (ids: (string | null)[], fallback: Pt[]) => {
    const tiles = s.structures
      .filter((st) => !st.ruined && (ids.includes(st.purpose) || (ids.includes('hall') && st.fixed)))
      .flatMap(interior)
      .filter(free);
    return tiles.length ? tiles : fallback;
  };
  const yard: Pt[] = [];
  for (let y = 11; y <= 14; y++) for (let x = 16; x <= 22; x++) if (free({ x, y }) && !structureAt(s.structures, x, y)) yard.push({ x, y });
  const used = new Set<string>();
  const core = coreTiles();
  return s.crew.map((c, i) => {
    let pool: Pt[];
    if (c.injuredDays > 0) pool = placeIn(['infirmary', 'hall'], yard);
    else if (c.tired) pool = placeIn(['bunks', 'hall'], yard);
    else pool = [...placeIn(['workshop', 'garden', 'tower', 'radio'], []), ...yard];
    pool = pool.filter((p) => !used.has(`${p.x},${p.y}`) && !core.some((q) => q.x === p.x && q.y === p.y));
    const p = pool[Math.floor(hash(c.id, s.day, 4) * pool.length)] ?? yard[i % yard.length];
    used.add(`${p.x},${p.y}`);
    return { name: c.name, p, facing: Math.floor(hash(c.id, s.day, 5) * 4) };
  });
}

export function mountBaseMap(host: HTMLElement, s: RunState, selectedId: string, onSelect: (id: string) => void): void {
  const grid = buildBaseGrid(s.structures, s.buildings.walls);
  const terrain = renderTerrain(grid, [], coreTiles(), (c) => drawRooms(c, s.structures));
  const canvas = h('canvas', { width: terrain.width, height: terrain.height, class: 'tac-canvas base-canvas' });
  host.append(canvas);
  const ctx = canvas.getContext('2d')!;
  const spots = crewSpots(s);
  let hover: Structure | undefined;

  function draw() {
    ctx.drawImage(terrain, 0, 0);
    for (const st of s.structures) {
      const sel = st.id === selectedId;
      if (sel || st === hover) {
        ctx.fillStyle = sel ? 'rgba(240, 200, 120, 0.12)' : 'rgba(255, 255, 255, 0.07)';
        ctx.fillRect(st.x * TS, st.y * TS, st.w * TS, st.h * TS);
        drawBrackets(ctx, st.x * TS + 2, st.y * TS + 2, st.w * TS - 4, sel ? '#ffd27f' : 'rgba(255,255,255,0.7)', st.h * TS - 4);
      }
    }
    for (const sp of [...spots].sort((a, b) => a.p.y - b.p.y)) {
      const fit = s.crew.find((c) => c.name === sp.name);
      drawPawn(ctx, sp.p.x * TS + TS / 2, sp.p.y * TS + TS / 2, lookFor(sp.name), sp.facing, { armed: !!fit && isFit(fit) });
    }
    for (const sp of spots) label(ctx, sp.name.split(' ')[0], sp.p.x * TS + TS / 2, sp.p.y * TS + TS + 4);
    for (const st of s.structures) {
      const color = st.ruined ? '#d7a08f' : st.fixed ? '#ffd27f' : st.purpose ? '#e8f2d8' : '#cfc8b8';
      label(ctx, roomLabel(st), (st.x + st.w / 2) * TS, st.y * TS + 10, color);
    }
  }

  const tileOf = (ev: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor(((ev.clientX - r.left) * (canvas.width / r.width)) / TS), y: Math.floor(((ev.clientY - r.top) * (canvas.height / r.height)) / TS) };
  };
  canvas.addEventListener('mousemove', (ev) => {
    const t = tileOf(ev);
    const st = structureAt(s.structures, t.x, t.y);
    if (st !== hover) { hover = st; canvas.style.cursor = st ? 'pointer' : 'default'; draw(); }
  });
  canvas.addEventListener('click', (ev) => {
    const t = tileOf(ev);
    const st = structureAt(s.structures, t.x, t.y);
    if (st) onSelect(st.id);
  });
  draw();
}
