import { Rng } from './rng';
import type { Survivor, TraitId } from './types';

const FIRST = [
  'Ada', 'Bram', 'Cora', 'Dez', 'Eli', 'Fen', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kit', 'Lena', 'Milo', 'Nell',
  'Oren', 'Pia', 'Quin', 'Rosa', 'Sol', 'Tam', 'Uma', 'Vic', 'Wren', 'Yara', 'Zed', 'Arlo', 'Bea', 'Cass',
];
const LAST = [
  'Okafor', 'Lindqvist', 'Moreau', 'Haddad', 'Novak', 'Reyes', 'Brandt', 'Ito', 'Kowal', 'Mensah', 'Price',
  'Varga', 'Quill', 'Ashby', 'Delacroix', 'Faulk', 'Greer', 'Holm', 'Ibarra', 'Jensen',
];

export const TRAITS: Record<TraitId, { name: string; desc: string }> = {
  sharpshooter: { name: 'Sharpshooter', desc: '+12 aim' },
  brawler: { name: 'Brawler', desc: '+2 melee damage' },
  scavenger: { name: 'Scavenger', desc: 'Carries 2 more loot' },
  quiet: { name: 'Quiet', desc: 'Gunshots make half the noise' },
  medic: { name: 'Medic', desc: 'Can patch up an ally on missions; faster healing at base' },
  tough: { name: 'Tough', desc: '+3 max HP' },
  quick: { name: 'Quick', desc: '+2 mobility' },
  leader: { name: 'Leader', desc: '+2 base defense when at home' },
};

const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

export function makeSurvivor(rng: Rng, id: number, opts: { veteran?: boolean } = {}): Survivor {
  const traits: TraitId[] = [rng.pick(TRAIT_IDS)];
  if (opts.veteran || rng.chance(0.25)) {
    const t = rng.pick(TRAIT_IDS);
    if (!traits.includes(t)) traits.push(t);
  }
  let maxHp = rng.int(8, 11);
  let aim = rng.int(58, 72);
  let mobility = rng.int(4, 5);
  let melee = 0;
  if (traits.includes('tough')) maxHp += 3;
  if (traits.includes('sharpshooter')) aim += 12;
  if (traits.includes('quick')) mobility += 2;
  if (traits.includes('brawler')) melee += 2;
  return {
    id,
    name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    hp: maxHp,
    maxHp,
    aim,
    mobility,
    melee,
    traits,
    xp: 0,
    level: 1,
    kills: 0,
    injuredDays: 0,
    tired: false,
  };
}

export const XP_PER_LEVEL = 4;

/** Apply xp; returns number of level-ups. */
export function grantXp(s: Survivor, xp: number): number {
  s.xp += xp;
  let ups = 0;
  while (s.xp >= XP_PER_LEVEL * s.level && s.level < 6) {
    s.xp -= XP_PER_LEVEL * s.level;
    s.level++;
    s.aim += 4;
    s.maxHp += 1;
    s.hp = Math.min(s.maxHp, s.hp + 1);
    ups++;
  }
  return ups;
}

export function isFit(s: Survivor): boolean {
  return s.injuredDays === 0 && s.hp > 0;
}

export function carryCapacity(s: Survivor): number {
  return 4 + (s.traits.includes('scavenger') ? 2 : 0);
}
