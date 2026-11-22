import { Battle, SHOOT_RANGE, ZOMBIE_STATS, type Unit, type Zombie, type BattleEvent } from '../tactical/battle';
import { chebyshev, key, pathTo, type Pt } from '../tactical/grid';
import {
  TS, drawBrackets, drawHpBar, drawLoot, drawPawn, label, lookFor, renderTerrain, roundRect, zombieLook, type PawnLook,
} from './sprites';

function facingOf(dx: number, dy: number): number {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 3;
  return dy < 0 ? 2 : 0;
}

function walkBob(d: { moving: number }, now: number): number {
  const t = now - d.moving;
  return t < 350 ? -Math.abs(Math.sin(t / 45)) * 2 : 0;
}
import { carryCapacity, TRAITS } from '../game/crew';
import { RESOURCE_KEYS } from '../game/types';
import { h, clear } from './dom';




interface Fx { kind: 'line' | 'text'; from?: Pt; to: Pt; text?: string; color: string; t0: number; dur: number }

export interface TacticalOptions {
  title: string;
  /** Extra ground dressing (e.g. the base's furniture on horde nights). */
  decor?: (c: CanvasRenderingContext2D) => void;
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


  let selected: Unit | null = battle.activeUnits[0] ?? null;
  let hover: Pt | null = null;
  let forceFire = false;
  let busy = false;
  let disposed = false;
  let eventIdx = 0;
  const seen = new Set<number>();
  // Your own base is already mapped out; only the dead are hidden by line of sight.
  if (battle.objective.type === 'survive') {
    for (let y = 0; y < battle.grid.h; y++) for (let x = 0; x < battle.grid.w; x++) seen.add(key(x, y));
  }
  const fx: Fx[] = [];
  const disp = new Map<string, { x: number; y: number; f: number; moving: number }>();
  const logLines: { text: string; cls: string }[] = [];

  function consumeEvents() {
    const now = performance.now();
    for (; eventIdx < battle.events.length; eventIdx++) {
      const e: BattleEvent = battle.events[eventIdx];
      if (e.kind !== 'move') logLines.unshift({ text: e.text, cls: e.kind });
      if (e.from && e.to && e.kind !== 'move') {
        const u = battle.unitAt(e.from.x, e.from.y);
        const z = battle.zombieAt(e.from.x, e.from.y);
        if (u) faceToward(`u${u.id}`, e.to);
        else if (z) faceToward(`z${z.id}`, e.to);
      }
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
      h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: lookFor(u.survivor.name).body } }), h('b', {}, s.name), h('span', { class: 'pill' }, status)),
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

  const terrain = renderTerrain(battle.grid, battle.evac, battle.core, opts.decor);
  const looks = new Map<string, PawnLook>();
  function lookOf(id: string, make: () => PawnLook) {
    let l = looks.get(id);
    if (!l) { l = make(); looks.set(id, l); }
    return l;
  }

  function dpos(id: string, x: number, y: number) {
    let d = disp.get(id);
    if (!d) { d = { x, y, f: 0, moving: 0 }; disp.set(id, d); }
    const dx = x - d.x, dy = y - d.y;
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
      d.f = facingOf(dx, dy);
      d.moving = performance.now();
    }
    d.x += dx * 0.22;
    d.y += dy * 0.22;
    if (Math.abs(d.x - x) < 0.01) d.x = x;
    if (Math.abs(d.y - y) < 0.01) d.y = y;
    return d;
  }

  function faceToward(id: string, to: Pt) {
    const d = disp.get(id);
    if (d) d.f = facingOf(to.x - d.x, to.y - d.y);
  }

  function draw() {
    if (disposed) return;
    const now = performance.now();
    const vis = battle.visible();
    for (const k of vis) seen.add(k);
    const g = battle.grid;
    ctx.fillStyle = '#0d0c0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain, 0, 0);

    // Movement range.
    if (selected && !busy && selected.ap > 0 && battle.outcome === 'ongoing') {
      const range = battle.moveRange(selected);
      for (const [k, n] of range) {
        if (n.d === 0) continue;
        const x = k % 1000, y = Math.floor(k / 1000);
        ctx.fillStyle = n.d <= selected.survivor.mobility ? 'rgba(120,190,250,0.13)' : 'rgba(240,180,70,0.1)';
        ctx.fillRect(x * TS + 1, y * TS + 1, TS - 2, TS - 2);
      }
      if (hover && battle.moveCost(selected, hover.x, hover.y) !== null) {
        const path = pathTo(range, hover);
        ctx.strokeStyle = 'rgba(235, 245, 255, 0.85)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(selected.x * TS + TS / 2, selected.y * TS + TS / 2);
        for (const p of path) ctx.lineTo(p.x * TS + TS / 2, p.y * TS + TS / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        drawBrackets(ctx, hover.x * TS + 3, hover.y * TS + 3, TS - 6, 'rgba(235,245,255,0.9)');
      }
    }

    // Loot.
    for (const l of battle.loot) {
      if (!seen.has(key(l.x, l.y))) continue;
      const kinds = RESOURCE_KEYS.filter((k) => l.contents[k]);
      const main = kinds.sort((a, b) => (l.contents[b] ?? 0) - (l.contents[a] ?? 0))[0] ?? 'scrap';
      drawLoot(ctx, l.x, l.y, main);
    }

    // Characters, drawn top to bottom so lower ones overlap upper ones.
    type Drawable = { y: number; fn: () => void };
    const list: Drawable[] = [];
    const labels: (() => void)[] = [];
    for (const s of battle.strangers) {
      if (!vis.has(key(s.x, s.y))) continue;
      list.push({ y: s.y, fn: () => {
        const cx = s.x * TS + TS / 2, cy = s.y * TS + TS / 2;
        drawPawn(ctx, cx, cy, lookOf(`s${s.survivor.name}`, () => lookFor(s.survivor.name)), 0);
        labels.push(() => label(ctx, 'Survivor', cx, cy + TS / 2 + 4, '#a9d6f5'));
      } });
    }
    for (const z of battle.zombies) {
      if (!vis.has(key(z.x, z.y))) continue;
      const d = dpos(`z${z.id}`, z.x, z.y);
      list.push({ y: d.y, fn: () => {
        const cx = d.x * TS + TS / 2, cy = d.y * TS + TS / 2;
        const sway = Math.sin(now / 300 + z.id) * 1.2;
        drawPawn(ctx, cx + sway, cy, lookOf(`z${z.id}`, () => zombieLook(z.kind, z.id)), d.f, { bob: walkBob(d, now) });
        if (z.hp < z.maxHp) drawHpBar(ctx, cx, cy - (z.kind === 'brute' ? 30 : 25), z.hp / z.maxHp, '#c0392b');
        if (z.alerted) { ctx.fillStyle = '#e0533a'; ctx.font = 'bold 12px system-ui'; ctx.fillText('!', cx + 9, cy - 16); }
      } });
    }
    for (const u of battle.units) {
      if (!u.alive || u.extracted) continue;
      const d = dpos(`u${u.id}`, u.x, u.y);
      list.push({ y: d.y, fn: () => {
        const cx = d.x * TS + TS / 2, cy = d.y * TS + TS / 2;
        if (u.overwatch) {
          const ang = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][d.f];
          ctx.fillStyle = 'rgba(245, 176, 65, 0.18)';
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, TS * 2.2, ang - 0.6, ang + 0.6); ctx.closePath(); ctx.fill();
        }
        if (u === selected) drawBrackets(ctx, d.x * TS + 1, d.y * TS - 6, TS - 2, '#f6f1e4');
        drawPawn(ctx, cx, cy, lookOf(`u${u.id}`, () => lookFor(u.survivor.name)), d.f, { armed: true, bob: walkBob(d, now) });
        drawHpBar(ctx, cx, cy - 25, u.survivor.hp / u.survivor.maxHp, u.survivor.hp / u.survivor.maxHp > 0.4 ? '#6fcf6a' : '#e0a33a');
        labels.push(() => label(ctx, u.survivor.name.split(' ')[0], cx, cy + TS / 2 + 4, u === selected ? '#ffe7a8' : '#f2efe6'));
      } });
    }
    list.sort((a, b) => a.y - b.y).forEach((d) => d.fn());
    labels.forEach((fn) => fn());

    // Fog: unexplored is dark; explored but out of sight is dimmed.
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const k = key(x, y);
      if (!seen.has(k)) { ctx.fillStyle = '#0d0c0a'; ctx.fillRect(x * TS, y * TS, TS, TS); }
      else if (!vis.has(k)) { ctx.fillStyle = 'rgba(14, 16, 22, 0.55)'; ctx.fillRect(x * TS, y * TS, TS, TS); }
    }

    // Hover info on a zombie.
    if (hover && selected && !busy) {
      const z = battle.zombieAt(hover.x, hover.y);
      if (z && vis.has(key(z.x, z.y))) drawTargetInfo(selected, z);
    }

    // Effects.
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      const t = (now - f.t0) / f.dur;
      if (t >= 1) { fx.splice(i, 1); continue; }
      if (f.kind === 'line' && f.from) {
        const x1 = f.from.x * TS + TS / 2, y1 = f.from.y * TS + TS / 2;
        const x2 = f.to.x * TS + TS / 2, y2 = f.to.y * TS + TS / 2;
        // A short bright tracer travelling along the line.
        const p = Math.min(1, t * 2.5);
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x1 + (x2 - x1) * Math.max(0, p - 0.35), y1 + (y2 - y1) * Math.max(0, p - 0.35));
        ctx.lineTo(x1 + (x2 - x1) * p, y1 + (y2 - y1) * p);
        ctx.stroke();
        if (t < 0.15) { ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(x1, y1, 5, 0, Math.PI * 2); ctx.fill(); }
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
      } else if (f.kind === 'text') {
        ctx.globalAlpha = 1 - t;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 3;
        const tx = f.to.x * TS + TS / 2, ty = f.to.y * TS - t * 18 + 2;
        ctx.strokeText(f.text ?? '', tx, ty);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text ?? '', tx, ty);
        ctx.textAlign = 'left';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
      }
    }

    // Soft vignette.
    ctx.drawImage(vignette, 0, 0);
    requestAnimationFrame(draw);
  }

  const vignette = document.createElement('canvas');
  vignette.width = canvas.width;
  vignette.height = canvas.height;
  {
    const vc = vignette.getContext('2d')!;
    const gr = vc.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.45, canvas.width / 2, canvas.height / 2, canvas.width * 0.7);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.35)');
    vc.fillStyle = gr;
    vc.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawTargetInfo(u: Unit, z: Zombie) {
    const st = ZOMBIE_STATS[z.kind];
    const adj = chebyshev(u, z) === 1;
    let what: string;
    if (adj && !forceFire && battle.canMelee(u, z)) what = `Melee ${battle.meleeChance(u)}%`;
    else if (battle.canShoot(u, z)) what = `Shoot ${battle.hitChance(u, z)}%${battle.coverBetween(u, z) ? ' (cover)' : ''}`;
    else if (u.ammo <= 0) what = 'No ammo';
    else if (chebyshev(u, z) > SHOOT_RANGE) what = 'Out of range';
    else if (u.ap <= 0) what = 'No AP';
    else what = 'No line of sight';
    const text = `${st.name} ${z.hp}/${z.maxHp} · ${what}`;
    ctx.font = '600 12px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 14;
    let x = z.x * TS + TS / 2 - w / 2;
    x = Math.max(2, Math.min(canvas.width - w - 2, x));
    const y = Math.max(2, z.y * TS - 34);
    ctx.fillStyle = 'rgba(24, 22, 18, 0.92)';
    roundRect(ctx, x, y, w, 20, 4);
    ctx.fill();
    ctx.strokeStyle = '#6b5f4a';
    ctx.stroke();
    ctx.fillStyle = '#f2efe6';
    ctx.fillText(text, x + 7, y + 14);
    drawBrackets(ctx, z.x * TS + 1, z.y * TS - 4, TS - 2, '#e0533a');
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
