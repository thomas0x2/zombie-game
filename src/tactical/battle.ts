import { Rng } from '../game/rng';
import type { Resources, ResourceKey, Survivor } from '../game/types';
import { carryCapacity } from '../game/crew';
import { Grid, chebyshev, isLowCover, key, pathTo, type Pt, DIRS8 } from './grid';

export type ZombieKind = 'walker' | 'runner' | 'brute';

export const ZOMBIE_STATS: Record<ZombieKind, { hp: number; move: number; dmg: [number, number]; hit: number; name: string }> = {
  walker: { hp: 5, move: 3, dmg: [2, 3], hit: 60, name: 'Shambler' },
  runner: { hp: 3, move: 6, dmg: [1, 3], hit: 65, name: 'Sprinter' },
  brute: { hp: 12, move: 2, dmg: [4, 6], hit: 75, name: 'Bloater' },
};

export interface Unit {
  id: number;
  survivor: Survivor;
  x: number;
  y: number;
  ap: number;
  ammo: number;
  carry: Partial<Resources>;
  overwatch: boolean;
  alive: boolean;
  extracted: boolean;
  recruit: boolean;
  kills: number;
  heals: number;
}

export interface Zombie {
  id: number;
  kind: ZombieKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alerted: boolean;
  goal: Pt | null;
}

export interface LootCache {
  x: number;
  y: number;
  contents: Partial<Resources>;
  label: string;
}

export interface Stranger {
  x: number;
  y: number;
  survivor: Survivor;
}

export type Objective = { type: 'extract' } | { type: 'survive'; turns: number };

export interface BattleEvent {
  kind: 'shot' | 'melee' | 'zbite' | 'spawn' | 'move' | 'death' | 'info' | 'loot' | 'overwatch';
  from?: Pt;
  to?: Pt;
  hit?: boolean;
  dmg?: number;
  text: string;
}

export interface BattleConfig {
  grid: Grid;
  evac: Pt[];
  deploy: Pt[];
  spawns: Pt[];
  loot: LootCache[];
  strangers: Stranger[];
  zombies: { kind: ZombieKind; x: number; y: number }[];
  objective: Objective;
  danger: number;
  seed: number;
  /** Tiles that hurt the base if a zombie ends its turn on them (defense only). */
  core?: Pt[];
  aimBonus?: number;
  dmgBonus?: number;
}

export const SIGHT = 9;
export const SHOOT_RANGE = 12;
export const AP_PER_TURN = 2;

export class Battle {
  grid: Grid;
  rng: Rng;
  units: Unit[] = [];
  zombies: Zombie[] = [];
  loot: LootCache[];
  strangers: Stranger[];
  evac: Pt[];
  spawns: Pt[];
  core: Pt[];
  objective: Objective;
  danger: number;
  turn = 1;
  /** Noise made this player turn; drives zombie attraction and spawns. */
  noise: { x: number; y: number; amount: number }[] = [];
  /** Accumulated noise across the mission; reported back as base heat. */
  totalNoise = 0;
  spawnPressure = 0;
  coreDamage = 0;
  events: BattleEvent[] = [];
  outcome: 'ongoing' | 'success' | 'failed' = 'ongoing';
  aimBonus: number;
  dmgBonus: number;
  private nextZid = 1;
  private visCache: Set<number> | null = null;

  constructor(cfg: BattleConfig, squad: { survivor: Survivor; ammo: number }[]) {
    this.grid = cfg.grid;
    this.rng = new Rng(cfg.seed ^ 0x9e3779b9);
    this.loot = cfg.loot;
    this.strangers = cfg.strangers;
    this.evac = cfg.evac;
    this.spawns = cfg.spawns;
    this.core = cfg.core ?? [];
    this.objective = cfg.objective;
    this.danger = cfg.danger;
    this.aimBonus = cfg.aimBonus ?? 0;
    this.dmgBonus = cfg.dmgBonus ?? 0;
    squad.forEach((m, i) => {
      const p = cfg.deploy[i % cfg.deploy.length];
      this.units.push(this.makeUnit(m.survivor, p, m.ammo, false));
    });
    for (const z of cfg.zombies) this.addZombie(z.kind, z.x, z.y, false);
  }

  private makeUnit(s: Survivor, p: Pt, ammo: number, recruit: boolean): Unit {
    return {
      id: s.id, survivor: s, x: p.x, y: p.y, ap: recruit ? 0 : AP_PER_TURN, ammo, carry: {},
      overwatch: false, alive: true, extracted: false, recruit, kills: 0, heals: 0,
    };
  }

  addZombie(kind: ZombieKind, x: number, y: number, alerted: boolean): Zombie {
    const st = ZOMBIE_STATS[kind];
    const z: Zombie = { id: this.nextZid++, kind, x, y, hp: st.hp, maxHp: st.hp, alerted, goal: null };
    this.zombies.push(z);
    return z;
  }

  // ---------- queries ----------

  get activeUnits(): Unit[] {
    return this.units.filter((u) => u.alive && !u.extracted);
  }

  unitAt(x: number, y: number): Unit | undefined {
    return this.units.find((u) => u.alive && !u.extracted && u.x === x && u.y === y);
  }
  zombieAt(x: number, y: number): Zombie | undefined {
    return this.zombies.find((z) => z.hp > 0 && z.x === x && z.y === y);
  }
  strangerAt(x: number, y: number): Stranger | undefined {
    return this.strangers.find((s) => s.x === x && s.y === y);
  }
  lootAt(x: number, y: number): LootCache | undefined {
    return this.loot.find((l) => l.x === x && l.y === y);
  }
  occupied(x: number, y: number): boolean {
    return !!(this.unitAt(x, y) || this.zombieAt(x, y) || this.strangerAt(x, y));
  }
  isEvac(x: number, y: number): boolean {
    return this.evac.some((p) => p.x === x && p.y === y);
  }
  isCore(x: number, y: number): boolean {
    return this.core.some((p) => p.x === x && p.y === y);
  }

  /** Tiles currently seen by the squad. */
  visible(): Set<number> {
    if (this.visCache) return this.visCache;
    const vis = new Set<number>();
    for (const u of this.activeUnits) {
      for (let y = u.y - SIGHT; y <= u.y + SIGHT; y++) {
        for (let x = u.x - SIGHT; x <= u.x + SIGHT; x++) {
          if (!this.grid.inBounds(x, y)) continue;
          const dx = x - u.x, dy = y - u.y;
          if (dx * dx + dy * dy > SIGHT * SIGHT) continue;
          if (this.grid.los(u, { x, y })) vis.add(key(x, y));
        }
      }
    }
    this.visCache = vis;
    return vis;
  }
  isVisible(x: number, y: number): boolean {
    return this.visible().has(key(x, y));
  }
  private invalidate(): void {
    this.visCache = null;
  }

  moveRange(u: Unit) {
    return this.grid.distances(u, u.survivor.mobility * Math.min(u.ap, 2), (x, y) => this.occupied(x, y));
  }

  /** AP cost to move to (x,y), or null if unreachable. */
  moveCost(u: Unit, x: number, y: number): number | null {
    if (u.ap <= 0) return null;
    const node = this.moveRange(u).get(key(x, y));
    if (!node || node.d === 0) return null;
    const cost = node.d <= u.survivor.mobility ? 1 : 2;
    return cost <= u.ap ? cost : null;
  }

  coverBetween(shooter: Pt, target: Pt): boolean {
    // Low cover adjacent to the target, on the side facing the shooter.
    const dx = Math.sign(shooter.x - target.x), dy = Math.sign(shooter.y - target.y);
    const cands: Pt[] = [{ x: target.x + dx, y: target.y + dy }];
    if (dx !== 0) cands.push({ x: target.x + dx, y: target.y });
    if (dy !== 0) cands.push({ x: target.x, y: target.y + dy });
    if (chebyshev(shooter, target) <= 1) return false;
    return cands.some((c) => isLowCover(this.grid.get(c.x, c.y)));
  }

  hitChance(u: Unit, target: Pt, aimMod = 0): number {
    const d = chebyshev(u, target);
    let c = u.survivor.aim + this.aimBonus + aimMod;
    if (d <= 2) c += 10;
    if (d > 6) c -= (d - 6) * 4;
    if (this.coverBetween(u, target)) c -= 20;
    return Math.max(5, Math.min(95, Math.round(c)));
  }

  canShoot(u: Unit, z: Zombie): boolean {
    return u.ap > 0 && u.ammo > 0 && z.hp > 0 && chebyshev(u, z) <= SHOOT_RANGE && this.grid.los(u, z);
  }
  canMelee(u: Unit, z: Zombie): boolean {
    return u.ap > 0 && z.hp > 0 && chebyshev(u, z) === 1 && this.grid.canStep(u, z.x - u.x, z.y - u.y) !== false;
  }
  meleeChance(u: Unit): number {
    return Math.min(95, 80 + (u.survivor.traits.includes('brawler') ? 10 : 0));
  }

  /** Things the unit can interact with from where it stands. */
  interactables(u: Unit): { loot?: LootCache; stranger?: Stranger } {
    const near = (p: Pt) => chebyshev(u, p) <= 1;
    return { loot: this.loot.find(near), stranger: this.strangers.find(near) };
  }

  carried(u: Unit): number {
    return Object.values(u.carry).reduce((a, b) => a + (b ?? 0), 0);
  }

  // ---------- player actions ----------

  private log(e: BattleEvent) {
    this.events.push(e);
  }

  move(u: Unit, x: number, y: number): boolean {
    const cost = this.moveCost(u, x, y);
    if (cost === null) return false;
    const from = { x: u.x, y: u.y };
    u.x = x;
    u.y = y;
    u.ap -= cost;
    u.overwatch = false;
    this.invalidate();
    this.log({ kind: 'move', from, to: { x, y }, text: `${u.survivor.name} moves.` });
    return true;
  }

  private gunDamage(): number {
    return this.rng.int(3, 5) + this.dmgBonus;
  }

  private makeNoise(x: number, y: number, amount: number) {
    this.noise.push({ x, y, amount });
    this.totalNoise += amount;
  }

  private damageZombie(u: Unit | null, z: Zombie, dmg: number) {
    z.hp -= dmg;
    z.alerted = true;
    if (u) z.goal = { x: u.x, y: u.y };
    if (z.hp <= 0) {
      this.log({ kind: 'death', to: { x: z.x, y: z.y }, text: `${ZOMBIE_STATS[z.kind].name} goes down.` });
      if (u) u.kills++;
      this.zombies = this.zombies.filter((q) => q !== z);
    }
  }

  shoot(u: Unit, z: Zombie, aimMod = 0, reaction = false): boolean {
    if (!reaction && !this.canShoot(u, z)) return false;
    const chance = this.hitChance(u, z, aimMod);
    const hit = this.rng.int(1, 100) <= chance;
    u.ammo--;
    if (!reaction) u.ap = 0; // firing ends the unit's turn
    const dmg = hit ? this.gunDamage() : 0;
    this.log({
      kind: reaction ? 'overwatch' : 'shot', from: { x: u.x, y: u.y }, to: { x: z.x, y: z.y }, hit, dmg,
      text: `${u.survivor.name} ${reaction ? 'reacts and fires' : 'fires'} (${chance}%): ${hit ? `hit for ${dmg}` : 'miss'}.`,
    });
    this.makeNoise(u.x, u.y, u.survivor.traits.includes('quiet') ? 2 : 4);
    if (hit) this.damageZombie(u, z, dmg);
    return true;
  }

  melee(u: Unit, z: Zombie): boolean {
    if (!this.canMelee(u, z)) return false;
    const chance = this.meleeChance(u);
    const hit = this.rng.int(1, 100) <= chance;
    u.ap -= 1;
    u.overwatch = false;
    const dmg = hit ? this.rng.int(2, 3) + u.survivor.melee : 0;
    this.log({
      kind: 'melee', from: { x: u.x, y: u.y }, to: { x: z.x, y: z.y }, hit, dmg,
      text: `${u.survivor.name} swings (${chance}%): ${hit ? `hit for ${dmg}` : 'miss'}.`,
    });
    this.makeNoise(u.x, u.y, 0.5);
    if (hit) this.damageZombie(u, z, dmg);
    return true;
  }

  setOverwatch(u: Unit): boolean {
    if (u.ap <= 0 || u.ammo <= 0) return false;
    u.ap = 0;
    u.overwatch = true;
    this.log({ kind: 'info', text: `${u.survivor.name} watches the approach.` });
    return true;
  }

  interact(u: Unit): boolean {
    if (u.ap <= 0) return false;
    const { loot, stranger } = this.interactables(u);
    if (stranger) {
      this.strangers = this.strangers.filter((s) => s !== stranger);
      const r = this.makeUnit(stranger.survivor, stranger, 2, true);
      this.units.push(r);
      u.ap -= 1;
      this.invalidate();
      this.log({ kind: 'info', text: `${stranger.survivor.name} joins you. Get them to the evac zone!` });
      return true;
    }
    if (loot) {
      const cap = carryCapacity(u.survivor);
      let room = cap - this.carried(u);
      if (room <= 0) {
        this.log({ kind: 'info', text: `${u.survivor.name}'s pack is full.` });
        return false;
      }
      const taken: string[] = [];
      for (const k of Object.keys(loot.contents) as ResourceKey[]) {
        const have = loot.contents[k] ?? 0;
        const take = Math.min(have, room);
        if (take <= 0) continue;
        if (k === 'ammo') {
          // Ammo goes straight into the magazine pouch, it doesn't use pack space.
          u.ammo += have;
          loot.contents[k] = 0;
          taken.push(`${have} ammo`);
          continue;
        }
        u.carry[k] = (u.carry[k] ?? 0) + take;
        loot.contents[k] = have - take;
        room -= take;
        taken.push(`${take} ${k}`);
      }
      if (Object.values(loot.contents).every((v) => !v)) this.loot = this.loot.filter((l) => l !== loot);
      u.ap -= 1;
      this.log({ kind: 'loot', to: { x: loot.x, y: loot.y }, text: taken.length ? `${u.survivor.name} grabs ${taken.join(', ')}.` : 'Nothing useful left.' });
      return true;
    }
    return false;
  }

  canHeal(u: Unit, ally: Unit): boolean {
    return u.ap > 0 && u.survivor.traits.includes('medic') && u.heals < 2 && ally.alive && !ally.extracted &&
      chebyshev(u, ally) <= 1 && ally.survivor.hp < ally.survivor.maxHp;
  }
  heal(u: Unit, ally: Unit): boolean {
    if (!this.canHeal(u, ally)) return false;
    u.ap -= 1;
    u.heals++;
    ally.survivor.hp = Math.min(ally.survivor.maxHp, ally.survivor.hp + 4);
    this.log({ kind: 'info', text: `${u.survivor.name} patches up ${ally.survivor.name}.` });
    return true;
  }

  canEvac(u: Unit): boolean {
    return this.objective.type === 'extract' && u.ap > 0 && this.isEvac(u.x, u.y);
  }
  evacuate(u: Unit): boolean {
    if (!this.canEvac(u)) return false;
    u.extracted = true;
    u.ap = 0;
    this.invalidate();
    this.log({ kind: 'info', text: `${u.survivor.name} is out.` });
    this.checkEnd();
    return true;
  }

  /** Abort: everyone standing in the evac zone leaves now. */
  evacAllInZone(): number {
    let n = 0;
    for (const u of this.activeUnits) {
      if (this.isEvac(u.x, u.y)) {
        u.extracted = true;
        u.ap = 0;
        n++;
      }
    }
    this.invalidate();
    this.checkEnd();
    return n;
  }

  private checkEnd() {
    if (this.outcome !== 'ongoing') return;
    if (this.activeUnits.length === 0) {
      const anyOut = this.units.some((u) => u.extracted && !u.recruit);
      this.outcome = anyOut ? 'success' : 'failed';
    }
    if (this.objective.type === 'survive' && this.turn > this.objective.turns && this.activeUnits.length) {
      this.outcome = 'success';
    }
  }

  // ---------- zombie phase ----------

  /**
   * Run the zombie phase one step at a time so the UI can animate.
   * Each yield is one zombie acting (or a spawn wave).
   */
  *zombieTurn(): Generator<void, void, void> {
    for (const u of this.activeUnits) if (!u.overwatch) u.ap = 0;

    // Noise attracts zombies within earshot.
    for (const n of this.noise) {
      const radius = 3 + n.amount * 1.5;
      for (const z of this.zombies) {
        if (chebyshev(z, n) <= radius) {
          z.alerted = true;
          z.goal = { x: n.x, y: n.y };
        }
      }
    }

    const order = [...this.zombies];
    for (const z of order) {
      if (z.hp <= 0 || this.outcome !== 'ongoing') continue;
      this.actZombie(z);
      yield;
    }

    this.spawnWave();
    yield;

    // Zombies inside the compound chew on the base.
    if (this.core.length) {
      const inCore = this.zombies.filter((z) => this.isCore(z.x, z.y)).length;
      if (inCore) {
        this.coreDamage += inCore * 2;
        this.log({ kind: 'info', text: `${inCore} zombie${inCore > 1 ? 's are' : ' is'} tearing at the stores!` });
      }
    }

    this.noise = [];
    this.turn++;
    for (const u of this.activeUnits) {
      u.ap = AP_PER_TURN;
      u.overwatch = false;
    }
    this.invalidate();
    this.checkEnd();
  }

  private nearestTarget(z: Zombie): Unit | null {
    let best: Unit | null = null;
    let bestD = Infinity;
    const sense = z.alerted ? SIGHT + 2 : 6;
    for (const u of this.activeUnits) {
      const d = chebyshev(z, u);
      if (d < bestD && d <= sense && (d <= 1 || this.grid.los(z, u))) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  private adjacentUnit(z: Zombie): Unit | undefined {
    return this.activeUnits.find((u) => chebyshev(u, z) === 1 && this.grid.canStep(z, u.x - z.x, u.y - z.y));
  }

  private actZombie(z: Zombie) {
    const st = ZOMBIE_STATS[z.kind];
    const target = this.nearestTarget(z);
    if (target) {
      z.alerted = true;
      z.goal = { x: target.x, y: target.y };
    }
    let adj = this.adjacentUnit(z);
    if (!adj) {
      let goal = z.goal;
      if (!goal && this.core.length) goal = this.core[Math.floor(this.core.length / 2)];
      if (goal) {
        this.stepToward(z, goal, st.move);
        if (z.goal && chebyshev(z, z.goal) === 0) z.goal = null;
      } else if (this.rng.chance(0.4)) {
        this.wander(z);
      }
      adj = this.adjacentUnit(z);
    }
    if (adj && z.hp > 0) this.bite(z, adj);
  }

  private stepToward(z: Zombie, goal: Pt, move: number) {
    // Search a wider area so they can path around buildings, then walk `move` steps along it.
    const dist = this.grid.distances(z, 40, (x, y) => {
      if (x === goal.x && y === goal.y) return false;
      return !!(this.zombieAt(x, y) || this.strangerAt(x, y) || this.unitAt(x, y));
    });
    let dest: Pt = goal;
    if (!dist.has(key(goal.x, goal.y))) {
      // Goal blocked (e.g. a unit stands there): head for the closest reachable tile next to it.
      let best: Pt | null = null;
      let bd = Infinity;
      for (const d of DIRS8) {
        const p = { x: goal.x + d.x, y: goal.y + d.y };
        const n = dist.get(key(p.x, p.y));
        if (n && n.d < bd) { bd = n.d; best = p; }
      }
      if (!best) return;
      dest = best;
    }
    const path = pathTo(dist, dest);
    for (let i = 0; i < Math.min(move, path.length); i++) {
      const p = path[i];
      if (this.occupied(p.x, p.y)) break;
      z.x = p.x;
      z.y = p.y;
      if (this.triggerOverwatch(z)) return;
      if (this.adjacentUnit(z)) break;
    }
  }

  private wander(z: Zombie) {
    const d = this.rng.pick(DIRS8);
    if (this.grid.canStep(z, d.x, d.y) && !this.occupied(z.x + d.x, z.y + d.y)) {
      z.x += d.x;
      z.y += d.y;
      this.triggerOverwatch(z);
    }
  }

  /** Returns true if the zombie died to reaction fire. */
  private triggerOverwatch(z: Zombie): boolean {
    for (const u of this.activeUnits) {
      if (!u.overwatch || u.ammo <= 0) continue;
      if (chebyshev(u, z) > SHOOT_RANGE || !this.grid.los(u, z)) continue;
      u.overwatch = false;
      this.shoot(u, z, -10, true);
      if (z.hp <= 0) return true;
    }
    return false;
  }

  private bite(z: Zombie, u: Unit) {
    const st = ZOMBIE_STATS[z.kind];
    let chance = st.hit;
    if (u.survivor.traits.includes('quick')) chance -= 10;
    const hit = this.rng.int(1, 100) <= chance;
    const dmg = hit ? this.rng.int(st.dmg[0], st.dmg[1]) : 0;
    this.log({
      kind: 'zbite', from: { x: z.x, y: z.y }, to: { x: u.x, y: u.y }, hit, dmg,
      text: `${st.name} lunges at ${u.survivor.name}: ${hit ? `${dmg} damage` : 'misses'}.`,
    });
    if (!hit) return;
    u.survivor.hp -= dmg;
    if (u.survivor.hp <= 0) {
      u.survivor.hp = 0;
      u.alive = false;
      this.invalidate();
      this.log({ kind: 'death', to: { x: u.x, y: u.y }, text: `${u.survivor.name} is dragged down!` });
      const dropped = { ...u.carry };
      if (Object.values(dropped).some((v) => v)) {
        this.loot.push({ x: u.x, y: u.y, contents: dropped, label: `${u.survivor.name.split(' ')[0]}'s pack` });
      }
      u.carry = {};
      this.checkEnd();
    }
  }

  private spawnWave() {
    const loud = this.noise.reduce((a, n) => a + n.amount, 0);
    const timePressure = this.objective.type === 'extract' ? Math.max(0, this.turn - 10) * 0.3 : 1.0 + this.turn * 0.3;
    this.spawnPressure += 0.2 + this.danger * 0.15 + loud * 0.12 + timePressure;
    let spawned = 0;
    while (this.spawnPressure >= 3 && spawned < 5) {
      this.spawnPressure -= 3;
      const free = this.spawns.filter((p) => !this.occupied(p.x, p.y) && !this.isVisible(p.x, p.y));
      const pool = free.length ? free : this.spawns.filter((p) => !this.occupied(p.x, p.y));
      if (!pool.length) break;
      const p = this.rng.pick(pool);
      const roll = this.rng.next();
      const kind: ZombieKind = roll < 0.05 + this.danger * 0.04 ? 'brute' : roll < 0.2 + this.danger * 0.06 ? 'runner' : 'walker';
      const z = this.addZombie(kind, p.x, p.y, loud > 0 || this.objective.type === 'survive');
      const lastNoise = this.noise[this.noise.length - 1];
      if (lastNoise) z.goal = { x: lastNoise.x, y: lastNoise.y };
      spawned++;
    }
    if (spawned) {
      this.log({ kind: 'spawn', text: spawned > 1 ? `You hear ${spawned} more of them coming.` : 'Something stirs at the edge of the block.' });
    }
  }

  /** End the player's turn early for everyone. */
  endPlayerTurn(): Generator<void, void, void> {
    return this.zombieTurn();
  }

  /** Aggregate result for the base layer. */
  summary() {
    const loot: Resources = { food: 0, scrap: 0, meds: 0, ammo: 0 };
    const out: { survivor: Survivor; kills: number; recruit: boolean; ammoLeft: number }[] = [];
    const dead: Survivor[] = [];
    for (const u of this.units) {
      const safe = u.extracted || (this.objective.type === 'survive' && u.alive);
      if (safe) {
        for (const k of Object.keys(u.carry) as ResourceKey[]) loot[k] += u.carry[k] ?? 0;
        out.push({ survivor: u.survivor, kills: u.kills, recruit: u.recruit, ammoLeft: u.ammo });
      } else if (!u.recruit) {
        dead.push(u.survivor);
      }
    }
    return { loot, survivors: out, dead, noise: this.totalNoise, coreDamage: this.coreDamage, turns: this.turn };
  }
}
