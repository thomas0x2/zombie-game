/** Rogue-lite meta progression: "Hope" earned per run buys permanent head starts. */

export type UnlockId = 'stockpile' | 'medkits' | 'palisade' | 'veteran' | 'radio' | 'gunsmith';

export interface UnlockDef {
  id: UnlockId;
  name: string;
  desc: string;
  cost: number;
}

export const UNLOCKS: UnlockDef[] = [
  { id: 'stockpile', name: 'Hidden Stockpile', desc: 'Start with +8 food and +8 ammo.', cost: 4 },
  { id: 'medkits', name: 'Field Medkits', desc: 'Start with +4 meds.', cost: 3 },
  { id: 'palisade', name: 'Old Palisade', desc: 'Start with Walls at level 1.', cost: 6 },
  { id: 'gunsmith', name: 'Gunsmith Notes', desc: 'Start with Workshop at level 1.', cost: 6 },
  { id: 'veteran', name: 'Seasoned Hand', desc: 'Start with a fourth survivor who has two traits.', cost: 8 },
  { id: 'radio', name: 'Shortwave Set', desc: 'Start with the Radio built.', cost: 8 },
];

export interface MetaState {
  hope: number;
  unlocked: UnlockId[];
  runs: number;
  bestDay: number;
  wins: number;
}

const KEY = 'station-nine-meta-v1';

export function defaultMeta(): MetaState {
  return { hope: 0, unlocked: [], runs: 0, bestDay: 0, wins: 0 };
}

export function loadMeta(): MetaState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) return { ...defaultMeta(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return defaultMeta();
}

export function saveMeta(m: MetaState): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage unavailable */
  }
}

export function buyUnlock(m: MetaState, id: UnlockId): boolean {
  const def = UNLOCKS.find((u) => u.id === id);
  if (!def || m.unlocked.includes(id) || m.hope < def.cost) return false;
  m.hope -= def.cost;
  m.unlocked.push(id);
  return true;
}

export function hopeForRun(days: number, rescued: number, won: boolean): number {
  return Math.max(1, days - 1) + rescued * 2 + (won ? 15 : 0);
}
