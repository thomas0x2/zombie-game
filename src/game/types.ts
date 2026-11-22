export type ResourceKey = 'food' | 'scrap' | 'meds' | 'ammo';
export type Resources = Record<ResourceKey, number>;

export const RESOURCE_KEYS: ResourceKey[] = ['food', 'scrap', 'meds', 'ammo'];
export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  food: 'Food',
  scrap: 'Scrap',
  meds: 'Meds',
  ammo: 'Ammo',
};

export type TraitId = 'sharpshooter' | 'brawler' | 'scavenger' | 'quiet' | 'medic' | 'tough' | 'quick' | 'leader';

export interface Survivor {
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  aim: number; // base hit %, before modifiers
  mobility: number; // tiles per move action
  melee: number; // bonus melee damage
  traits: TraitId[];
  xp: number;
  level: number;
  kills: number;
  /** Days remaining until healed enough to fight. 0 = fit. */
  injuredDays: number;
  /** Went on a mission today; defends at half strength tonight. */
  tired: boolean;
}

export type BuildingId = 'walls' | 'tower' | 'garden' | 'workshop' | 'infirmary' | 'bunks' | 'radio';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  maxLevel: number;
  /** Cost to reach level n+1 from level n. */
  cost: (level: number) => Partial<Resources>;
  describe: (level: number) => string;
}

export type LocationKind = 'market' | 'hardware' | 'clinic' | 'precinct' | 'suburb';

export interface MissionSite {
  id: number;
  name: string;
  kind: LocationKind;
  danger: number; // 1..5
  lootBias: ResourceKey;
  hasSurvivor: boolean;
  seed: number;
}

export interface TraderOffer {
  give: Partial<Resources>;
  get: Partial<Resources>;
  taken: boolean;
}

export type Phase = 'base' | 'mission' | 'defense' | 'over';

export interface LogEntry {
  day: number;
  text: string;
  tone?: 'good' | 'bad' | 'info';
}

export interface RunState {
  seed: number;
  rngState: number;
  day: number;
  phase: Phase;
  resources: Resources;
  buildings: Record<BuildingId, number>;
  /** Base integrity; 0 means the base falls. */
  integrity: number;
  maxIntegrity: number;
  crew: Survivor[];
  nextId: number;
  sites: MissionSite[];
  missionDoneToday: boolean;
  trader: TraderOffer[] | null;
  /** Lingering noise from missions attracts bigger night attacks. */
  heat: number;
  log: LogEntry[];
  stats: { kills: number; rescued: number; lost: number; missions: number };
  result?: 'won' | 'lost';
}
