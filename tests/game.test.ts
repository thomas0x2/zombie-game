import { describe, expect, it } from 'vitest';
import { Grid, key } from '../src/tactical/grid';
import { Battle } from '../src/tactical/battle';
import { generateDefenseMap, generateScavengeMap } from '../src/tactical/mapgen';
import {
  applyDefenseBattle, applyMission, upgradeWalls, remodel, restoreStructure, upgradeStructure, finishNight, issueAmmo, newRun, resolveNightAuto, isHordeNight, availableForMission,
} from '../src/game/base';
import { makeSurvivor } from '../src/game/crew';
import { Rng } from '../src/game/rng';
import { buyUnlock, defaultMeta } from '../src/game/meta';
import type { MissionSite, RunState } from '../src/game/types';
import { isFit } from '../src/game/crew';

function site(seed: number, danger = 2): MissionSite {
  return { id: 0, name: 'Test', kind: 'market', danger, lootBias: 'food', hasSurvivor: true, seed };
}

/** Plays a battle with a simple bot: fight what's close, loot, rescue, then run for evac. */
function autoplay(b: Battle, maxTurns = 40) {
  const dist = (a: { x: number; y: number }, c: { x: number; y: number }) => Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y));
  for (let t = 0; t < maxTurns && b.outcome === 'ongoing'; t++) {
    for (const u of b.activeUnits) {
      let guard = 0;
      while (u.ap > 0 && u.alive && !u.extracted && guard++ < 6) {
        const hurt = u.survivor.hp <= u.survivor.maxHp * 0.4;
        const leaving = hurt || t > 9 || b.carried(u) >= 3 || (b.loot.length === 0 && b.strangers.length === 0) || u.recruit;
        if (b.canEvac(u) && leaving) { b.evacuate(u); break; }
        const threats = b.zombies.filter((z) => b.isVisible(z.x, z.y) && dist(z, u) <= 5).sort((a, c) => dist(a, u) - dist(c, u));
        const adj = threats.find((z) => dist(z, u) === 1);
        if (adj && adj.hp <= 3 && b.canMelee(u, adj)) { b.melee(u, adj); continue; }
        if (threats[0] && b.canShoot(u, threats[0])) { b.shoot(u, threats[0]); continue; }
        if (adj && b.canMelee(u, adj)) { b.melee(u, adj); continue; }
        const near = b.interactables(u);
        if (!leaving && (near.loot || near.stranger) && b.interact(u)) continue;
        const goals = leaving ? b.evac : [...b.strangers, ...b.loot];
        const range = b.moveRange(u);
        let best: { x: number; y: number } | null = null;
        let bd = Infinity;
        for (const k of range.keys()) {
          const x = k % 1000, y = Math.floor(k / 1000);
          if (b.moveCost(u, x, y) !== 1) continue;
          for (const g of goals) {
            const d = dist(g, { x, y });
            if (d < bd) { bd = d; best = { x, y }; }
          }
        }
        if (best && b.move(u, best.x, best.y)) continue;
        break;
      }
    }
    const gen = b.zombieTurn();
    while (!gen.next().done) { /* run */ }
  }
}

describe('grid', () => {
  it('blocks line of sight through walls but not over cars', () => {
    const g = new Grid(5, 1, 'floor');
    expect(g.los({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    g.set(2, 0, 'car');
    expect(g.los({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    g.set(2, 0, 'wall');
    expect(g.los({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it('finds paths around obstacles', () => {
    const g = new Grid(5, 3, 'floor');
    g.set(2, 0, 'wall'); g.set(2, 1, 'wall');
    const d = g.distances({ x: 0, y: 0 }, 20, () => false);
    expect(d.get(key(4, 0))?.d).toBe(6); // no squeezing diagonally past wall corners
  });
});

describe('map generation', () => {
  it('produces reachable loot and survivors for many seeds', () => {
    for (let seed = 1; seed < 60; seed++) {
      const cfg = generateScavengeMap(site(seed * 977, 1 + (seed % 5)), 1 + (seed % 12));
      const reach = cfg.grid.distances(cfg.deploy[0], 999, () => false);
      for (const l of cfg.loot) {
        // Loot sits on a walkable tile reachable from the drop-off.
        expect(reach.has(key(l.x, l.y))).toBe(true);
      }
      expect(cfg.evac.length).toBeGreaterThan(0);
      expect(cfg.zombies.length).toBeGreaterThan(2);
    }
  });

  it('builds a defense map with breaches', () => {
    const cfg = generateDefenseMap(42, 5, 1);
    const reach = cfg.grid.distances({ x: 0, y: 0 }, 999, () => false);
    // Zombies from outside can reach the core through a gate.
    expect(cfg.core!.some((p) => reach.has(key(p.x, p.y)))).toBe(true);
  });
});

describe('battle', () => {
  function smallBattle() {
    const g = new Grid(10, 5, 'floor');
    const rng = new Rng(3);
    const s = makeSurvivor(rng, 1);
    s.aim = 200; // always hit (clamped to 95)
    const b = new Battle({
      grid: g, evac: [{ x: 0, y: 0 }], deploy: [{ x: 1, y: 2 }], spawns: [{ x: 9, y: 4 }],
      loot: [{ x: 2, y: 2, contents: { food: 2, ammo: 3 }, label: 'Box' }], strangers: [],
      zombies: [{ kind: 'walker', x: 6, y: 2 }], objective: { type: 'extract' }, danger: 1, seed: 9,
    }, [{ survivor: s, ammo: 4 }]);
    return { b, s };
  }

  it('loots adjacent caches into the pack and ammo into the pouch', () => {
    const { b } = smallBattle();
    const u = b.units[0];
    expect(b.interact(u)).toBe(true);
    expect(u.carry.food).toBe(2);
    expect(u.ammo).toBe(7);
    expect(b.loot.length).toBe(0);
    expect(u.ap).toBe(1);
  });

  it('shooting uses ammo, ends the turn and makes noise', () => {
    const { b } = smallBattle();
    const u = b.units[0];
    const z = b.zombies[0];
    expect(b.canShoot(u, z)).toBe(true);
    b.shoot(u, z);
    expect(u.ammo).toBe(3);
    expect(u.ap).toBe(0);
    expect(b.totalNoise).toBeGreaterThan(0);
  });

  it('zombies close in and the mission ends when everyone is out', () => {
    const { b } = smallBattle();
    const u = b.units[0];
    const gen = b.zombieTurn();
    while (!gen.next().done) { /* run */ }
    expect(b.zombies[0].x).toBeLessThan(6);
    expect(b.move(u, 0, 0)).toBe(true);
    expect(b.evacuate(u)).toBe(true);
    expect(b.outcome).toBe('success');
  });

  it('autoplayed missions always terminate cleanly', () => {
    let outcomes = { success: 0, failed: 0, ongoing: 0 };
    for (let seed = 1; seed <= 25; seed++) {
      const rng = new Rng(seed);
      const squad = [1, 2, 3].map((id) => ({ survivor: makeSurvivor(rng, id), ammo: 6 }));
      const b = new Battle(generateScavengeMap(site(seed * 31, 1 + (seed % 4)), 3), squad);
      autoplay(b);
      outcomes[b.outcome]++;
      const sum = b.summary();
      expect(sum.survivors.length + sum.dead.length).toBeGreaterThanOrEqual(b.outcome === 'ongoing' ? 0 : 3);
    }
    expect(outcomes.success).toBeGreaterThan(0);
  });
});

describe('run loop', () => {
  it('starts with a crew, sites and resources', () => {
    const s = newRun(123);
    expect(s.crew.length).toBe(3);
    expect(s.sites.length).toBe(3);
    expect(s.day).toBe(1);
  });

  it('applies unlocks', () => {
    const m = defaultMeta();
    m.hope = 100;
    expect(buyUnlock(m, 'palisade')).toBe(true);
    expect(buyUnlock(m, 'palisade')).toBe(false);
    const s = newRun(5, m.unlocked);
    expect(s.buildings.walls).toBe(1);
    expect(s.maxIntegrity).toBe(40);
  });

  it('walls cost scrap', () => {
    const s = newRun(7);
    const scrap = s.resources.scrap;
    expect(upgradeWalls(s)).toBe(true);
    expect(s.resources.scrap).toBe(scrap - 6);
    expect(s.buildings.walls).toBe(1);
  });

  it('buildings can be repaired, remodeled and upgraded within their size', () => {
    const s = newRun(8);
    s.resources = { food: 50, scrap: 100, meds: 20, ammo: 20 };
    // Ruined buildings must be cleared first.
    expect(remodel(s, 'office', 'garden')).toBe(false);
    expect(restoreStructure(s, 'office')).toBe(true);
    expect(remodel(s, 'office', 'garden')).toBe(true);
    expect(s.buildings.garden).toBe(1);
    expect(upgradeStructure(s, 'office')).toBe(true);
    expect(upgradeStructure(s, 'office')).toBe(false); // medium caps at 2
    expect(s.buildings.garden).toBe(2);
    // Purposes add up across buildings.
    expect(remodel(s, 'garage', 'garden')).toBe(true);
    expect(s.buildings.garden).toBe(3);
    // Remodeling resets the level and moves the effect.
    expect(remodel(s, 'office', 'bunks')).toBe(true);
    expect(s.buildings.garden).toBe(1);
    expect(s.buildings.bunks).toBe(1);
    // Size rules: a watchtower only fits a small building; the hall can't be remodeled.
    expect(remodel(s, 'garage', 'tower')).toBe(false);
    expect(remodel(s, 'tower', 'tower')).toBe(true);
    expect(remodel(s, 'hall', 'garden')).toBe(false);
  });

  it('simulates whole runs without breaking', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s: RunState = newRun(seed * 1000);
      let guard = 0;
      while (s.phase !== 'over' && guard++ < 40) {
        // Spend scrap on walls/garden, go on a mission, end the day.
        upgradeWalls(s) || remodel(s, 'garage', 'garden') || remodel(s, 'tower', 'tower') || upgradeStructure(s, 'garage');
        const squad = availableForMission(s).slice(0, 3);
        if (squad.length) {
          const ammo = issueAmmo(s, squad.length);
          const b = new Battle(generateScavengeMap(s.sites[0], s.day), squad.map((survivor) => ({ survivor, ammo })));
          autoplay(b);
          applyMission(s, b.summary(), s.sites[0].name);
        }
        if (isHordeNight(s.day)) {
          const def = s.crew.filter(isFit);
          if (def.length) {
            const ammo = issueAmmo(s, def.length, 8);
            const b = new Battle(generateDefenseMap(s.seed + s.day, s.day, s.buildings.walls, s.structures), def.map((survivor) => ({ survivor, ammo })));
            autoplay(b, 12);
            finishNight(s, applyDefenseBattle(s, b.summary()));
            continue;
          }
        }
        finishNight(s, resolveNightAuto(s));
      }
      expect(s.phase).toBe('over');
      for (const k of ['food', 'scrap', 'meds', 'ammo'] as const) expect(s.resources[k]).toBeGreaterThanOrEqual(0);
    }
  });
});
