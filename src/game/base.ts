import { Rng } from './rng';
import { grantXp, isFit, makeSurvivor } from './crew';
import type { UnlockId } from './meta';
import type {
  BuildingDef, LocationKind, Resources, ResourceKey, RunState, Survivor, TraderOffer,
} from './types';
import { RESOURCE_KEYS } from './types';
import { ALLOWED, SIZE_CAP, initialStructures, type Purpose, type Structure } from './layout';

export const WIN_DAY = 15;
export const HORDE_EVERY = 5;
export const AMMO_PER_MEMBER = 6;

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'walls', name: 'Walls', maxLevel: 3,
    cost: (l) => ({ scrap: 6 + l * 6 }),
    describe: (l) => `+${l * 5} night defense, +${l * 10} max integrity. Fewer breaches during hordes.`,
  },
  {
    id: 'tower', name: 'Watchtower', maxLevel: 1,
    cost: () => ({ scrap: 8 }),
    describe: (l) => `+${l * 4} night defense, +${l * 8} aim when defending. Warns of attack size.`,
  },
  {
    id: 'garden', name: 'Garden', maxLevel: 6,
    cost: (l) => ({ scrap: 4 + l * 4, food: 2 }),
    describe: (l) => `Grows ${l * 2} food each day.`,
  },
  {
    id: 'workshop', name: 'Workshop', maxLevel: 3,
    cost: (l) => ({ scrap: 8 + l * 6 }),
    describe: (l) => `+${l} gun damage. Salvages ${l} scrap a day.`,
  },
  {
    id: 'infirmary', name: 'Infirmary', maxLevel: 3,
    cost: (l) => ({ scrap: 5 + l * 5, meds: 2 }),
    describe: (l) => `Injured heal ${l} extra day(s) per night. Restores ${l * 2} more HP.`,
  },
  {
    id: 'bunks', name: 'Bunkhouse', maxLevel: 6,
    cost: (l) => ({ scrap: 4 + l * 4 }),
    describe: (l) => `Beds for ${l * 2} more survivors.`,
  },
  {
    id: 'radio', name: 'Radio', maxLevel: 1,
    cost: () => ({ scrap: 10, meds: 1 }),
    describe: (l) => (l ? 'One extra mission lead per day; traders visit more often.' : 'Hear about more places and traders.'),
  },
];

export function crewCap(bunks: number): number {
  return 4 + bunks * 2;
}

const SITE_NAMES: Record<LocationKind, string[]> = {
  market: ['Corner Grocer', 'Fresh-Mart Plaza', 'Night Owl Deli', 'Farmers Co-op'],
  hardware: ['Bolt & Beam Hardware', 'Rail Yard Depot', 'Auto Wreckers', 'Builders Supply'],
  clinic: ['St. Ansel Clinic', 'Riverside Pharmacy', 'Dental Office', 'Vet Hospital'],
  precinct: ['Precinct 9', 'Sporting Goods', 'National Guard Checkpoint', 'Pawn Shop'],
  suburb: ['Maple Row Houses', 'Cul-de-sac', 'Trailer Park', 'Old Motel'],
};
const KIND_BIAS: Record<LocationKind, ResourceKey> = {
  market: 'food', hardware: 'scrap', clinic: 'meds', precinct: 'ammo', suburb: 'food',
};

export function newRun(seed: number, unlocks: UnlockId[] = []): RunState {
  const rng = new Rng(seed);
  const s: RunState = {
    seed, rngState: 0, day: 1, phase: 'base',
    resources: { food: 12, scrap: 10, meds: 3, ammo: 20 },
    buildings: { walls: 0, tower: 0, garden: 0, workshop: 0, infirmary: 0, bunks: 0, radio: 0 },
    structures: initialStructures(),
    integrity: 30, maxIntegrity: 30,
    crew: [], nextId: 1, sites: [], missionDoneToday: false, trader: null, heat: 0, log: [],
    stats: { kills: 0, rescued: 0, lost: 0, missions: 0 },
  };
  for (let i = 0; i < 3; i++) s.crew.push(makeSurvivor(rng, s.nextId++));
  if (unlocks.includes('veteran')) s.crew.push(makeSurvivor(rng, s.nextId++, { veteran: true }));
  if (unlocks.includes('stockpile')) { s.resources.food += 8; s.resources.ammo += 8; }
  if (unlocks.includes('medkits')) s.resources.meds += 4;
  if (unlocks.includes('palisade')) s.buildings.walls = 1;
  const set = (id: string, p: Purpose) => { const st = s.structures.find((x) => x.id === id)!; st.purpose = p; st.level = 1; st.ruined = false; };
  if (unlocks.includes('gunsmith')) set('garage', 'workshop');
  if (unlocks.includes('radio')) set('shed', 'radio');
  syncBuildings(s);
  recomputeIntegrity(s, true);
  s.rngState = rng.state;
  rollDay(s);
  log(s, 'This old fire station is your safe zone now. Scavenge by day, hold the walls by night.', 'info');
  log(s, `Survive ${WIN_DAY} nights and the relief convoy will find you. Hordes hit every ${HORDE_EVERY}th night.`, 'info');
  return s;
}

/** Run-scoped RNG that persists its position inside the save. */
export function runRng(s: RunState): Rng & { commit(): void } {
  const r = new Rng(s.rngState || s.seed) as Rng & { commit(): void };
  r.commit = () => { s.rngState = r.state; };
  return r;
}

export function log(s: RunState, text: string, tone?: 'good' | 'bad' | 'info') {
  s.log.unshift({ day: s.day, text, tone });
  if (s.log.length > 80) s.log.length = 80;
}

function recomputeIntegrity(s: RunState, fill = false) {
  const max = 30 + s.buildings.walls * 10;
  if (fill) s.integrity = max;
  else s.integrity += Math.max(0, max - s.maxIntegrity);
  s.maxIntegrity = max;
}

export function canAfford(s: RunState, cost: Partial<Resources>): boolean {
  return RESOURCE_KEYS.every((k) => (cost[k] ?? 0) <= s.resources[k]);
}
function pay(s: RunState, cost: Partial<Resources>) {
  for (const k of RESOURCE_KEYS) s.resources[k] -= cost[k] ?? 0;
}
function gain(s: RunState, g: Partial<Resources>) {
  for (const k of RESOURCE_KEYS) s.resources[k] += g[k] ?? 0;
}

export const WALLS_MAX = 3;
export function wallsCost(level: number): Partial<Resources> {
  return { scrap: 6 + level * 6 };
}

export function upgradeWalls(s: RunState): boolean {
  const lvl = s.buildings.walls;
  if (lvl >= WALLS_MAX) return false;
  const cost = wallsCost(lvl);
  if (!canAfford(s, cost)) return false;
  pay(s, cost);
  s.buildings.walls = lvl + 1;
  recomputeIntegrity(s);
  log(s, `Reinforced the perimeter to level ${lvl + 1}.`, 'good');
  return true;
}

export function purposeDef(p: Purpose): BuildingDef {
  return BUILDINGS.find((b) => b.id === p)!;
}

/** Recompute effective purpose levels from the structures. */
export function syncBuildings(s: RunState) {
  for (const p of ['tower', 'garden', 'workshop', 'infirmary', 'bunks', 'radio'] as Purpose[]) {
    const sum = s.structures.filter((st) => !st.ruined && st.purpose === p).reduce((a, st) => a + st.level, 0);
    s.buildings[p] = Math.min(purposeDef(p).maxLevel, sum);
  }
}

export function restoreCost(st: Structure): Partial<Resources> {
  return { scrap: { small: 4, medium: 6, large: 9 }[st.size] };
}

export function restoreStructure(s: RunState, id: string): boolean {
  const st = s.structures.find((x) => x.id === id);
  if (!st || !st.ruined) return false;
  const cost = restoreCost(st);
  if (!canAfford(s, cost)) return false;
  pay(s, cost);
  st.ruined = false;
  log(s, `Cleared the rubble and patched up the ${st.name}.`, 'good');
  return true;
}

export function remodelCost(st: Structure, p: Purpose): Partial<Resources> {
  const c = { ...purposeDef(p).cost(0) };
  if (st.purpose) c.scrap = (c.scrap ?? 0) + 2; // tearing out the old fittings
  return c;
}

export function canRemodel(st: Structure, p: Purpose): boolean {
  return !st.fixed && !st.ruined && st.purpose !== p && ALLOWED[st.size].includes(p);
}

/** Turn a building over to a new purpose at level 1. */
export function remodel(s: RunState, id: string, p: Purpose): boolean {
  const st = s.structures.find((x) => x.id === id);
  if (!st || !canRemodel(st, p)) return false;
  const cost = remodelCost(st, p);
  if (!canAfford(s, cost)) return false;
  pay(s, cost);
  st.purpose = p;
  st.level = 1;
  syncBuildings(s);
  log(s, `The ${st.name} is now a ${purposeDef(p).name}.`, 'good');
  return true;
}

export function upgradeCost(st: Structure): Partial<Resources> | null {
  if (!st.purpose || st.ruined || st.level >= SIZE_CAP[st.size]) return null;
  return purposeDef(st.purpose).cost(st.level);
}

export function upgradeStructure(s: RunState, id: string): boolean {
  const st = s.structures.find((x) => x.id === id);
  if (!st) return false;
  const cost = upgradeCost(st);
  if (!cost || !canAfford(s, cost)) return false;
  pay(s, cost);
  st.level++;
  syncBuildings(s);
  log(s, `Upgraded the ${st.name} (${purposeDef(st.purpose!).name}) to level ${st.level}.`, 'good');
  return true;
}

export const REPAIR_COST = 3;
export const REPAIR_AMOUNT = 8;
export function repair(s: RunState): boolean {
  if (s.integrity >= s.maxIntegrity || s.resources.scrap < REPAIR_COST) return false;
  s.resources.scrap -= REPAIR_COST;
  s.integrity = Math.min(s.maxIntegrity, s.integrity + REPAIR_AMOUNT);
  return true;
}

/** Spend a med to patch someone up right away. */
export function treat(s: RunState, id: number): boolean {
  const c = s.crew.find((m) => m.id === id);
  if (!c || s.resources.meds < 1 || (c.hp >= c.maxHp && c.injuredDays === 0)) return false;
  s.resources.meds--;
  c.hp = Math.min(c.maxHp, c.hp + 4);
  c.injuredDays = Math.max(0, c.injuredDays - 1);
  return true;
}

function rollDay(s: RunState) {
  const rng = runRng(s);
  const count = 3 + s.buildings.radio;
  const kinds: LocationKind[] = rng.shuffle(['market', 'hardware', 'clinic', 'precinct', 'suburb']);
  s.sites = [];
  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length];
    const danger = Math.max(1, Math.min(5, Math.round(1 + s.day / 4 + rng.int(-1, 1) + (kind === 'precinct' ? 1 : 0))));
    s.sites.push({
      id: i,
      kind,
      name: rng.pick(SITE_NAMES[kind]),
      danger,
      lootBias: KIND_BIAS[kind],
      hasSurvivor: rng.chance(kind === 'suburb' ? 0.8 : 0.3),
      seed: rng.int(1, 1e9),
    });
  }
  s.trader = rng.chance(s.buildings.radio ? 0.5 : 0.3) ? makeTrader(rng) : null;
  if (s.trader) log(s, 'A trader\'s truck is idling by the gate.', 'info');
  rng.commit();
}

function makeTrader(rng: Rng): TraderOffer[] {
  const offers: TraderOffer[] = [];
  const pairs = rng.shuffle(RESOURCE_KEYS.flatMap((a) => RESOURCE_KEYS.filter((b) => b !== a).map((b) => [a, b] as const)));
  for (const [give, get] of pairs.slice(0, 3)) {
    const g = rng.int(3, 6);
    const rate: Record<ResourceKey, number> = { food: 1, scrap: 1, ammo: 0.8, meds: 2.5 };
    const back = Math.max(1, Math.round((g * rate[give]) / rate[get] * rng.int(70, 100) / 100));
    offers.push({ give: { [give]: g }, get: { [get]: back }, taken: false });
  }
  return offers;
}

export function trade(s: RunState, idx: number): boolean {
  const o = s.trader?.[idx];
  if (!o || o.taken || !canAfford(s, o.give)) return false;
  pay(s, o.give);
  gain(s, o.get);
  o.taken = true;
  return true;
}

// ---------- missions ----------

export interface MissionReport {
  loot: Resources;
  survivors: { survivor: Survivor; kills: number; recruit: boolean; ammoLeft: number }[];
  dead: Survivor[];
  noise: number;
  coreDamage?: number;
}

/** Take ammo for the squad out of the stores. Returns ammo per member. */
export function issueAmmo(s: RunState, squadSize: number, perMember = AMMO_PER_MEMBER): number {
  const each = Math.min(perMember, Math.floor(s.resources.ammo / Math.max(1, squadSize)));
  s.resources.ammo -= each * squadSize;
  return each;
}

export function applyMission(s: RunState, r: MissionReport, siteName: string): string[] {
  const lines: string[] = [];
  s.missionDoneToday = true;
  s.stats.missions++;
  gain(s, r.loot);
  const lootStr = RESOURCE_KEYS.filter((k) => r.loot[k]).map((k) => `${r.loot[k]} ${k}`).join(', ');
  lines.push(lootStr ? `Brought home ${lootStr}.` : 'Came back empty-handed.');

  for (const d of r.dead) {
    s.crew = s.crew.filter((c) => c.id !== d.id);
    s.stats.lost++;
    lines.push(`${d.name} didn't make it back.`);
  }
  const cap = crewCap(s.buildings.bunks);
  for (const o of r.survivors) {
    s.resources.ammo += o.ammoLeft;
    s.stats.kills += o.kills;
    if (o.recruit) {
      if (s.crew.length >= cap) {
        lines.push(`${o.survivor.name} had to move on: the bunks are full.`);
        continue;
      }
      o.survivor.id = s.nextId++;
      o.survivor.tired = true;
      if (o.survivor.hp < o.survivor.maxHp / 2) o.survivor.injuredDays = 1;
      s.crew.push(o.survivor);
      s.stats.rescued++;
      lines.push(`${o.survivor.name} joins the crew.`);
      continue;
    }
    const c = s.crew.find((m) => m.id === o.survivor.id);
    if (!c) continue;
    c.tired = true;
    const ups = grantXp(c, 1 + o.kills);
    if (ups) lines.push(`${c.name} reached level ${c.level}.`);
    if (c.hp <= c.maxHp * 0.4) {
      c.injuredDays = Math.max(c.injuredDays, 2);
      lines.push(`${c.name} is badly hurt and needs rest.`);
    }
  }
  s.heat = Math.min(6, s.heat + Math.round(r.noise / 10));
  log(s, `${siteName}: ${lines.join(' ')}`, r.dead.length ? 'bad' : 'good');
  return lines;
}

// ---------- night ----------

export function isHordeNight(day: number): boolean {
  return day % HORDE_EVERY === 0;
}

export function defenseRating(s: RunState): number {
  let d = s.buildings.walls * 5 + s.buildings.tower * 4;
  for (const c of s.crew) {
    if (!isFit(c)) continue;
    let v = 4 + c.level;
    if (c.traits.includes('leader')) v += 2;
    if (c.tired) v *= 0.75;
    d += v;
  }
  const shooters = s.crew.filter(isFit).length;
  if (s.resources.ammo < shooters) d *= 0.75;
  return Math.round(d);
}

export function attackEstimate(s: RunState): [number, number] {
  const base = 2 + s.day * 1.2 + s.day * s.day * 0.06 + s.heat;
  return [Math.round(base), Math.round(base + 2 + s.day / 2)];
}

export interface NightReport {
  lines: string[];
  repelled: boolean;
}

/** Upkeep that happens every night regardless of how the attack goes. */
function upkeep(s: RunState, lines: string[]) {
  const produced = s.buildings.garden * 2;
  if (produced) { s.resources.food += produced; lines.push(`The garden gave ${produced} food.`); }
  if (s.buildings.workshop) s.resources.scrap += s.buildings.workshop;

  const eaters = s.crew.length;
  if (s.resources.food >= eaters) {
    s.resources.food -= eaters;
  } else {
    const hungry = eaters - s.resources.food;
    s.resources.food = 0;
    lines.push(`Not enough food: ${hungry} went hungry.`);
    const rng = runRng(s);
    for (const c of rng.shuffle([...s.crew]).slice(0, hungry)) {
      c.hp = Math.max(1, c.hp - 2);
    }
    rng.commit();
  }

  for (const c of s.crew) {
    const heal = 2 + s.buildings.infirmary * 2 + (s.crew.some((m) => m.traits.includes('medic') && m !== c) ? 1 : 0);
    c.hp = Math.min(c.maxHp, c.hp + heal);
    if (c.injuredDays > 0) c.injuredDays = Math.max(0, c.injuredDays - 1 - s.buildings.infirmary);
  }
}

export function resolveNightAuto(s: RunState): NightReport {
  const rng = runRng(s);
  const lines: string[] = [];
  const [lo, hi] = attackEstimate(s);
  const attack = rng.int(lo, hi);
  const defense = defenseRating(s);
  const fit = s.crew.filter(isFit);
  s.resources.ammo = Math.max(0, s.resources.ammo - Math.min(fit.length, s.resources.ammo));
  let repelled = true;
  if (attack <= defense) {
    lines.push(`Night ${s.day}: ${attack} strength of dead hit the walls. Your ${defense} defense held.`);
  } else {
    repelled = false;
    const margin = attack - defense;
    const dmg = Math.ceil(margin * 1.5);
    s.integrity -= dmg;
    lines.push(`Night ${s.day}: ${attack} strength against your ${defense}. They broke through: -${dmg} integrity.`);
    const stolen = Math.min(s.resources.food, Math.ceil(margin / 2));
    if (stolen) { s.resources.food -= stolen; lines.push(`${stolen} food was spoiled in the chaos.`); }
    if (fit.length && rng.chance(Math.min(0.9, margin / 8))) {
      const v = rng.pick(fit);
      v.hp = Math.max(1, v.hp - rng.int(3, 5));
      v.injuredDays = Math.max(v.injuredDays, 2);
      lines.push(`${v.name} was hurt holding the line.`);
    }
    if (margin >= 10 && fit.length && rng.chance(0.4)) {
      const v = rng.pick(fit);
      s.crew = s.crew.filter((c) => c !== v);
      s.stats.lost++;
      lines.push(`${v.name} was lost in the breach.`);
    }
  }
  rng.commit();
  return { lines, repelled };
}

export function applyDefenseBattle(s: RunState, r: MissionReport): NightReport {
  const lines: string[] = [];
  for (const d of r.dead) {
    s.crew = s.crew.filter((c) => c.id !== d.id);
    s.stats.lost++;
    lines.push(`${d.name} fell defending the safe zone.`);
  }
  for (const o of r.survivors) {
    s.resources.ammo += o.ammoLeft;
    s.stats.kills += o.kills;
    const c = s.crew.find((m) => m.id === o.survivor.id);
    if (c) {
      const ups = grantXp(c, 1 + o.kills);
      if (ups) lines.push(`${c.name} reached level ${c.level}.`);
      if (c.hp <= c.maxHp * 0.4) c.injuredDays = Math.max(c.injuredDays, 1);
    }
  }
  const dmg = r.coreDamage ?? 0;
  if (dmg) { s.integrity -= dmg; lines.push(`The horde did ${dmg} damage to the safe zone.`); }
  const survived = r.survivors.length > 0;
  if (!survived) {
    s.integrity -= 25;
    lines.push('With no one left standing, the horde ransacked the safe zone.');
  } else {
    lines.push(`The horde broke against the walls. Night ${s.day} survived.`);
    s.resources.scrap += 3;
  }
  return { lines, repelled: survived };
}

/** After the night (auto or tactical) finishes: upkeep, win/loss check, roll next day. */
export function finishNight(s: RunState, report: NightReport): NightReport {
  upkeep(s, report.lines);
  for (const line of report.lines) log(s, line, report.repelled ? 'info' : 'bad');
  s.heat = Math.max(0, Math.floor(s.heat * 0.5));
  if (s.integrity <= 0 || s.crew.length === 0) {
    s.integrity = Math.max(0, s.integrity);
    s.phase = 'over';
    s.result = 'lost';
    log(s, s.crew.length === 0 ? 'No one is left. The safe zone goes dark.' : 'The walls are gone. The safe zone has fallen.', 'bad');
    return report;
  }
  if (s.day >= WIN_DAY) {
    s.phase = 'over';
    s.result = 'won';
    log(s, 'Headlights at dawn: the relief convoy found you. You made it.', 'good');
    return report;
  }
  s.day++;
  for (const c of s.crew) c.tired = false;
  s.missionDoneToday = false;
  s.phase = 'base';
  rollDay(s);
  return report;
}

/** Helper used by the UI: everyone able to go out today. */
export function availableForMission(s: RunState): Survivor[] {
  return s.crew.filter((c) => isFit(c) && !c.tired);
}
