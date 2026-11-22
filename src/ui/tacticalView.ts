import { Battle, SHOOT_RANGE, ZOMBIE_STATS, type Unit, type Zombie, type BattleEvent } from '../tactical/battle';
import { chebyshev, key, pathTo, type Pt, type Tile } from '../tactical/grid';
import { carryCapacity, TRAITS } from '../game/crew';
import { RESOURCE_KEYS } from '../game/types';
import { h, clear } from './dom';

const TS = 34;

const TILE_COLOR: Record<Tile, string> = {
  grass: '#2c3526',
  road: '#2b2b2e',
  floor: '#3a3430',
  wall: '#6b625a',
  car: '#5a3b33',
  fence: '#5c5340',
  crate: '#6a5536',
};

const UNIT_COLORS = ['#e0a458', '#7fb3d5', '#c39bd3', '#82c99a', '#e59866', '#f7dc6f', '#aab7b8'];

interface Fx { kind: 'line' | 'text'; from?: Pt; to: Pt; text?: string; color: string; t0: number; dur: number }

export interface TacticalOptions {
  title: string;
  onDone: (b: Battle) => void;
}

export function mountTactical(root: HTMLElement, battle: Battle, opts: TacticalOptions): () => void {
  clear(root);
  const canvas = h('canvas', { width: battle.grid.w * TS, height: battle.grid.h * TS, class: 'tac-canvas' });
  const side = h('div', { class: 'tac-side' });
  const header = h('div', { class: 'tac-header' });
  const wrap = h('div', { class: 'tac-wrap' }, h('div', { class: 'tac-board' }, header, canvas), side);
  root.append(wrap);
  const ctx = canvas.getContext('2d')!;

  const colorOf = new Map<number, string>();
  battle.units.forEach((u, i) => colorOf.set(u.id, UNIT_COLORS[i % UNIT_COLORS.length]));

  let selected: Unit | null = battle.activeUnits[0] ?? null;
  let hover: Pt | null = null;
  let forceFire = false;
  let busy = false;
  let disposed = false;
  let eventIdx = 0;
  const seen = new Set<number>();
  const fx: Fx[] = [];
  const disp = new Map<string, { x: number; y: number }>();
  const logLines: { text: string; cls: string }[] = [];

  function consumeEvents() {
    const now = performance.now();
    for (; eventIdx < battle.events.length; eventIdx++) {
      const e: BattleEvent = battle.events[eventIdx];
      if (e.kind !== 'move') logLines.unshift({ text: e.text, cls: e.kind });
      if ((e.kind === 'shot' || e.kind === 'overwatch') && e.from && e.to) {
        fx.push({ kind: 'line', from: e.from, to: e.to, color: e.hit ? '#ffd27f' : '#888', t0: now, dur: 260 });
        fx.push({ kind: 'text', to: e.to, text: e.hit ? `-${e.dmg}` : 'miss', color: e.hit ? '#ff8a65' : '#bbb', t0: now, dur: 900 });
      }
      if ((e.kind === 'melee' || e.kind === 'zbite') && e.to) {
        fx.push({ kind: 'text', to: e.to, text: e.hit ? `-${e.dmg}` : 'miss', color: e.kind === 'zbite' ? '#ff5252' : '#ffcc80', t0: now, dur: 900 });
      }
      if (e.kind === 'loot' && e.to) fx.push({ kind: 'text', to: e.to, text: '+loot', color: '#f4d03f', t0: now, dur: 900 });
    }
    if (logLines.length > 60) logLines.length = 60;
  }

  function ensureSelection() {
    if (selected && (!selected.alive || selected.extracted)) selected = null;
    if (!selected || selected.ap === 0) {
      const next = battle.activeUnits.find((u) => u.ap > 0);
      if (next) selected = next;
      else if (!selected) selected = battle.activeUnits[0] ?? null;
    }
  }

  function cycleUnit() {
    const list = battle.activeUnits.filter((u) => u.ap > 0);
    if (!list.length) return;
    const i = selected ? list.indexOf(selected) : -1;
    selected = list[(i + 1) % list.length];
    refresh();
  }

  // ---------- input ----------

  function tileFromEvent(ev: MouseEvent): Pt {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    return { x: Math.floor(((ev.clientX - r.left) * sx) / TS), y: Math.floor(((ev.clientY - r.top) * sy) / TS) };
  }

  canvas.addEventListener('mousemove', (ev) => { hover = tileFromEvent(ev); });
  canvas.addEventListener('mouseleave', () => { hover = null; });
  canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); forceFire = false; refresh(); });
  canvas.addEventListener('click', (ev) => {
    if (busy || battle.outcome !== 'ongoing') return;
    const p = tileFromEvent(ev);
    const u = battle.unitAt(p.x, p.y);
    if (u) {
      if (selected && u !== selected && battle.canHeal(selected, u) && ev.shiftKey) battle.heal(selected, u);
      else selected = u;
      refresh();
      return;
    }
    if (!selected) return;
    const z = battle.zombieAt(p.x, p.y);
    if (z && battle.isVisible(z.x, z.y)) {
      const adj = chebyshev(selected, z) === 1;
      if (adj && !forceFire && battle.canMelee(selected, z)) battle.melee(selected, z);
      else if (battle.canShoot(selected, z)) battle.shoot(selected, z);
      else if (battle.canMelee(selected, z)) battle.melee(selected, z);
      forceFire = false;
      afterAction();
      return;
    }
    if (battle.moveCost(selected, p.x, p.y) !== null) {
      battle.move(selected, p.x, p.y);
      afterAction();
    }
  });

  function onKey(ev: KeyboardEvent) {
    if (busy || battle.outcome !== 'ongoing') return;
    if (ev.target instanceof HTMLInputElement) return;
    const k = ev.key.toLowerCase();
    if (k === 'tab') { ev.preventDefault(); cycleUnit(); }
    else if (k === ' ' || k === 'enter') { ev.preventDefault(); endTurn(); }
    else if (k === 'o' && selected) { battle.setOverwatch(selected); afterAction(); }
    else if (k === 'e' && selected) { battle.interact(selected); afterAction(); }
    else if (k === 'x' && selected) { battle.evacuate(selected); afterAction(); }
    else if (k === 'f') { forceFire = !forceFire; refresh(); }
    else if (k === 'h' && selected) { healNearest(); }
  }
  window.addEventListener('keydown', onKey);

  function healNearest() {
    if (!selected) return;
    const ally = battle.activeUnits.find((a) => a !== selected && battle.canHeal(selected!, a));
    if (ally) { battle.heal(selected, ally); afterAction(); }
  }

  function afterAction() {
    consumeEvents();
    if (selected && selected.ap === 0) ensureSelection();
    refresh();
    if (battle.outcome !== 'ongoing') { finish(); return; }
    if (battle.activeUnits.length && battle.activeUnits.every((u) => u.ap === 0)) endTurn();
  }

  function endTurn() {
    if (busy || battle.outcome !== 'ongoing') return;
    busy = true;
    refresh();
    const gen = battle.zombieTurn();
    const step = () => {
      if (disposed) return;
      const r = gen.next();
      consumeEvents();
      if (r.done || battle.outcome !== 'ongoing') {
        if (!r.done) while (!gen.next().done) { /* drain */ }
        consumeEvents();
        busy = false;
        selected = null;
        ensureSelection();
        refresh();
        if (battle.outcome !== 'ongoing') finish();
        return;
      }
      refresh();
      setTimeout(step, 160);
    };
    setTimeout(step, 120);
  }

  function finish() {
    const s = battle.summary();
    const ok = battle.outcome === 'success';
    const loot = RESOURCE_KEYS.filter((k) => s.loot[k]).map((k) => `${s.loot[k]} ${k}`).join(', ') || 'nothing';
    const overlay = h('div', { class: 'overlay' },
      h('div', { class: 'modal' },
        h('h2', {}, ok ? (battle.objective.type === 'survive' ? 'The line held' : 'Extraction complete') : 'Squad lost'),
        h('p', {}, battle.objective.type === 'extract' ? `Recovered: ${loot}.` : `Base damage taken: ${s.coreDamage}.`),
        s.dead.length ? h('p', { class: 'bad' }, `Lost: ${s.dead.map((d) => d.name).join(', ')}`) : null,
        s.survivors.some((x) => x.recruit) ? h('p', { class: 'good' }, `Rescued: ${s.survivors.filter((x) => x.recruit).map((x) => x.survivor.name).join(', ')}`) : null,
        h('button', { class: 'btn primary', onclick: () => opts.onDone(battle) }, 'Return to base'),
      ),
    );
    root.append(overlay);
  }

  // ---------- side panel ----------

  function btn(label: string, enabled: boolean, onclick: () => void, hint = '') {
    return h('button', { class: 'btn', disabled: !enabled || busy, title: hint, onclick: () => { onclick(); } }, label);
  }

  function refresh() {
    ensureSelection();
    consumeEvents();
    const obj = battle.objective;
    clear(header);
    header.append(
      h('span', { class: 'tac-title' }, opts.title),
      h('span', {}, obj.type === 'survive' ? `Turn ${Math.min(battle.turn, obj.turns)} / ${obj.turns} — hold until dawn` : `Turn ${battle.turn} — loot, then get everyone to the green zone`),
      h('span', { class: 'muted' }, busy ? 'The dead are moving…' : 'Your move'),
    );

    clear(side);
    const roster = h('div', { class: 'roster' });
    for (const u of battle.units) {
      if (!u.alive && u.recruit) continue;
      const s = u.survivor;
      const status = !u.alive ? 'DOWN' : u.extracted ? 'OUT' : u.overwatch ? 'WATCH' : `${u.ap} AP`;
      roster.append(h('div', {
        class: `card ${u === selected ? 'sel' : ''} ${!u.alive ? 'dead' : ''}`,
        onclick: () => { if (u.alive && !u.extracted) { selected = u; refresh(); } },
      },
      h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: colorOf.get(u.id) ?? '#5dade2' } }), h('b', {}, s.name), h('span', { class: 'pill' }, status)),
      h('div', { class: 'bar' }, h('div', { class: 'fill', style: { width: `${(100 * s.hp) / s.maxHp}%` } })),
      h('div', { class: 'small muted' }, `HP ${s.hp}/${s.maxHp} · Aim ${s.aim} · Ammo ${u.ammo} · Pack ${battle.carried(u)}/${carryCapacity(s)}${u.recruit ? ' · rescued' : ''}`),
      ));
    }
    side.append(h('h3', {}, 'Squad'), roster);

    if (selected && selected.alive && !selected.extracted) {
      const u = selected;
      const { loot, stranger } = battle.interactables(u);
      const canHealSomeone = battle.activeUnits.some((a) => a !== u && battle.canHeal(u, a));
      side.append(
        h('h3', {}, `${u.survivor.name}`),
        h('div', { class: 'small muted' }, u.survivor.traits.map((t) => `${TRAITS[t].name}: ${TRAITS[t].desc}`).join(' · ')),
        h('div', { class: 'actions' },
          btn(stranger ? 'Talk (E)' : loot ? `Search ${loot.label} (E)` : 'Search (E)', u.ap > 0 && !!(loot || stranger), () => { battle.interact(u); afterAction(); }, 'Interact with an adjacent cache or survivor'),
          btn('Overwatch (O)', u.ap > 0 && u.ammo > 0, () => { battle.setOverwatch(u); afterAction(); }, 'Fire at the first zombie that moves in sight'),
          btn(forceFire ? 'Fire mode: ON (F)' : 'Fire mode (F)', u.ammo > 0, () => { forceFire = !forceFire; refresh(); }, 'Shoot adjacent zombies instead of melee'),
          u.survivor.traits.includes('medic') ? btn('Patch ally (H)', canHealSomeone, healNearest, 'Heal an adjacent ally') : null,
          battle.objective.type === 'extract' ? btn('Evacuate (X)', battle.canEvac(u), () => { battle.evacuate(u); afterAction(); }, 'Leave from the green zone') : null,
        ),
      );
    }
    side.append(
      h('div', { class: 'actions' },
        btn('Next unit (Tab)', true, cycleUnit),
        h('button', { class: 'btn primary', disabled: busy, onclick: endTurn }, 'End turn (Space)'),
      ),
      h('div', { class: 'small muted help' },
        'Click a survivor to select. Click a tile to move (blue: 1 AP, amber: 2 AP). Click a zombie to attack: melee if adjacent (quiet), otherwise shoot (loud, ends turn). Gunfire draws more of them.'),
      h('h3', {}, 'Log'),
      h('div', { class: 'log' }, logLines.slice(0, 14).map((l) => h('div', { class: `log-${l.cls}` }, l.text))),
    );
  }

  // ---------- rendering ----------

  function dpos(id: string, x: number, y: number) {
    let d = disp.get(id);
    if (!d) { d = { x, y }; disp.set(id, d); }
    d.x += (x - d.x) * 0.25;
    d.y += (y - d.y) * 0.25;
    if (Math.abs(d.x - x) < 0.01) d.x = x;
    if (Math.abs(d.y - y) < 0.01) d.y = y;
    return d;
  }

  function draw() {
    if (disposed) return;
    const now = performance.now();
    const vis = battle.visible();
    for (const k of vis) seen.add(k);
    const g = battle.grid;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const k = key(x, y);
        const t = g.get(x, y);
        if (!seen.has(k)) { ctx.fillStyle = '#0b0c0e'; ctx.fillRect(x * TS, y * TS, TS, TS); continue; }
        ctx.fillStyle = TILE_COLOR[t];
        ctx.fillRect(x * TS, y * TS, TS, TS);
        if (t === 'road' && y % 2 === 0 && x % 3 === 0) { ctx.fillStyle = '#4a4a3a'; ctx.fillRect(x * TS + 6, y * TS + TS - 2, TS - 12, 3); }
        if (t === 'wall') { ctx.fillStyle = '#7d736a'; ctx.fillRect(x * TS, y * TS, TS, 5); }
        if (t === 'car') { ctx.fillStyle = '#3d2722'; ctx.fillRect(x * TS + 3, y * TS + 6, TS - 6, TS - 12); }
        if (t === 'crate') { ctx.strokeStyle = '#3e3020'; ctx.strokeRect(x * TS + 5, y * TS + 5, TS - 10, TS - 10); }
        if (t === 'fence') { ctx.fillStyle = '#3c3626'; for (let i = 4; i < TS; i += 8) ctx.fillRect(x * TS + i, y * TS + 4, 3, TS - 8); }
        if (battle.isEvac(x, y)) { ctx.fillStyle = 'rgba(80, 200, 120, 0.25)'; ctx.fillRect(x * TS, y * TS, TS, TS); }
        if (battle.isCore(x, y)) { ctx.strokeStyle = 'rgba(230, 80, 60, 0.7)'; ctx.strokeRect(x * TS + 2, y * TS + 2, TS - 4, TS - 4); }
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.strokeRect(x * TS + 0.5, y * TS + 0.5, TS - 1, TS - 1);
      }
    }

    // Movement range.
    if (selected && !busy && selected.ap > 0 && battle.outcome === 'ongoing') {
      const range = battle.moveRange(selected);
      for (const [k, n] of range) {
        if (n.d === 0) continue;
        const x = k % 1000, y = Math.floor(k / 1000);
        ctx.fillStyle = n.d <= selected.survivor.mobility ? 'rgba(90,160,230,0.18)' : 'rgba(230,170,60,0.14)';
        ctx.fillRect(x * TS, y * TS, TS, TS);
      }
      if (hover && battle.moveCost(selected, hover.x, hover.y) !== null) {
        const path = pathTo(range, hover);
        ctx.strokeStyle = '#9fd3ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(selected.x * TS + TS / 2, selected.y * TS + TS / 2);
        for (const p of path) ctx.lineTo(p.x * TS + TS / 2, p.y * TS + TS / 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    // Loot & strangers.
    for (const l of battle.loot) {
      if (!seen.has(key(l.x, l.y))) continue;
      ctx.fillStyle = '#d4ac0d';
      ctx.fillRect(l.x * TS + 10, l.y * TS + 11, TS - 20, TS - 20);
      ctx.strokeStyle = '#7d6608';
      ctx.strokeRect(l.x * TS + 10, l.y * TS + 11, TS - 20, TS - 20);
    }
    for (const s of battle.strangers) {
      if (!vis.has(key(s.x, s.y))) continue;
      circle(s.x, s.y, '#5dade2', '?');
    }

    // Zombies.
    for (const z of battle.zombies) {
      if (!vis.has(key(z.x, z.y))) continue;
      const d = dpos(`z${z.id}`, z.x, z.y);
      const col = z.kind === 'brute' ? '#7d8a3a' : z.kind === 'runner' ? '#a3b85a' : '#6e8b4e';
      circle(d.x, d.y, col, z.kind === 'brute' ? 'B' : z.kind === 'runner' ? 'S' : 'Z', z.kind === 'brute' ? 0.44 : 0.36, z.alerted ? '#c0392b' : '#1c2414');
      hpBar(d.x, d.y, z.hp / z.maxHp, '#c0392b');
    }

    // Units.
    for (const u of battle.units) {
      if (!u.alive || u.extracted) continue;
      const d = dpos(`u${u.id}`, u.x, u.y);
      if (u === selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(d.x * TS + TS / 2, d.y * TS + TS / 2, TS * 0.46, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      circle(d.x, d.y, colorOf.get(u.id) ?? '#5dade2', u.survivor.name[0], 0.36, '#111');
      hpBar(d.x, d.y, u.survivor.hp / u.survivor.maxHp, '#2ecc71');
      if (u.overwatch) { ctx.fillStyle = '#f5b041'; ctx.font = 'bold 10px sans-serif'; ctx.fillText('👁', d.x * TS + TS - 12, d.y * TS + 11); }
    }

    // Hover info on a zombie.
    if (hover && selected && !busy) {
      const z = battle.zombieAt(hover.x, hover.y);
      if (z && vis.has(key(z.x, z.y))) drawTargetInfo(selected, z);
    }

    // Fog over seen-but-not-visible tiles.
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const k = key(x, y);
      if (seen.has(k) && !vis.has(k)) { ctx.fillStyle = 'rgba(8,10,14,0.55)'; ctx.fillRect(x * TS, y * TS, TS, TS); }
    }

    // Effects.
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      const t = (now - f.t0) / f.dur;
      if (t >= 1) { fx.splice(i, 1); continue; }
      if (f.kind === 'line' && f.from) {
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(f.from.x * TS + TS / 2, f.from.y * TS + TS / 2);
        ctx.lineTo(f.to.x * TS + TS / 2, f.to.y * TS + TS / 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
      } else if (f.kind === 'text') {
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = f.color;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(f.text ?? '', f.to.x * TS + TS / 2, f.to.y * TS - t * 18 + 4);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
    }
    requestAnimationFrame(draw);
  }

  function drawTargetInfo(u: Unit, z: Zombie) {
    const st = ZOMBIE_STATS[z.kind];
    const adj = chebyshev(u, z) === 1;
    let label: string;
    if (adj && !forceFire && battle.canMelee(u, z)) label = `Melee ${battle.meleeChance(u)}%`;
    else if (battle.canShoot(u, z)) label = `Shoot ${battle.hitChance(u, z)}%${battle.coverBetween(u, z) ? ' (cover)' : ''}`;
    else if (u.ammo <= 0) label = 'No ammo';
    else if (chebyshev(u, z) > SHOOT_RANGE) label = 'Out of range';
    else if (u.ap <= 0) label = 'No AP';
    else label = 'No line of sight';
    const text = `${st.name} ${z.hp}/${z.maxHp} · ${label}`;
    ctx.font = '12px sans-serif';
    const w = ctx.measureText(text).width + 12;
    let x = z.x * TS + TS / 2 - w / 2;
    x = Math.max(2, Math.min(canvas.width - w - 2, x));
    const y = Math.max(2, z.y * TS - 22);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(x, y, w, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x + 6, y + 13);
  }

  function circle(x: number, y: number, color: string, letter: string, r = 0.36, ring = '#111') {
    const cx = x * TS + TS / 2, cy = y * TS + TS / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, TS * r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#111';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(letter, cx, cy + 5);
    ctx.textAlign = 'left';
  }

  function hpBar(x: number, y: number, frac: number, color: string) {
    const bx = x * TS + 5, by = y * TS + TS - 5;
    ctx.fillStyle = '#000';
    ctx.fillRect(bx, by, TS - 10, 3);
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, (TS - 10) * Math.max(0, frac), 3);
  }

  refresh();
  requestAnimationFrame(draw);
  // Debug/test hook in dev builds only.
  if (import.meta.env.DEV) (window as unknown as { __battle: Battle }).__battle = battle;

  return () => {
    disposed = true;
    window.removeEventListener('keydown', onKey);
  };
}
