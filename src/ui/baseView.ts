import {
  REPAIR_AMOUNT, REPAIR_COST, WIN_DAY, AMMO_PER_MEMBER, WALLS_MAX, attackEstimate, availableForMission, canAfford,
  canRemodel, crewCap, defenseRating, isHordeNight, purposeDef, remodel, remodelCost, repair, restoreCost, restoreStructure,
  trade, treat, upgradeCost, upgradeStructure, upgradeWalls, wallsCost,
} from '../game/base';
import { ALLOWED, SIZE_CAP, type Purpose, type Structure } from '../game/layout';
import { mountBaseMap } from './baseMap';
import { TRAITS, XP_PER_LEVEL, isFit } from '../game/crew';
import { RESOURCE_KEYS, RESOURCE_LABEL, type MissionSite, type Resources, type RunState } from '../game/types';
import { h, clear } from './dom';

export interface BaseHandlers {
  launch: (site: MissionSite, squadIds: number[]) => void;
  endDay: () => void;
  save: () => void;
  quit: () => void;
}

const KIND_ICON: Record<string, string> = { market: '🥫', hardware: '🔩', clinic: '💊', precinct: '🎯', suburb: '🏠' };

export function costText(c: Partial<Resources>): string {
  return RESOURCE_KEYS.filter((k) => c[k]).map((k) => `${c[k]} ${RESOURCE_LABEL[k].toLowerCase()}`).join(', ');
}

export function mountBase(root: HTMLElement, s: RunState, hd: BaseHandlers): void {
  let chosenSite: number | null = null;
  let selectedId = 'hall';
  const squad = new Set<number>();

  function render() {
    hd.save();
    clear(root);
    const horde = isHordeNight(s.day);
    const [lo, hi] = attackEstimate(s);
    const def = defenseRating(s);

    const top = h('div', { class: 'topbar' },
      h('div', { class: 'brand' }, 'STATION NINE'),
      h('div', { class: 'day' }, `Day ${s.day} / ${WIN_DAY}`),
      ...RESOURCE_KEYS.map((k) => h('div', { class: 'res' }, h('span', { class: 'muted' }, RESOURCE_LABEL[k]), h('b', {}, s.resources[k]))),
      h('div', { class: 'res' }, h('span', { class: 'muted' }, 'Integrity'), h('b', { class: s.integrity < s.maxIntegrity / 3 ? 'bad' : '' }, `${s.integrity}/${s.maxIntegrity}`)),
      h('button', { class: 'btn ghost', onclick: hd.quit }, 'Menu'),
    );

    // Crew
    const cap = crewCap(s.buildings.bunks);
    const crewList = h('div', { class: 'list' });
    for (const c of s.crew) {
      const status = c.injuredDays > 0 ? `Injured (${c.injuredDays}d)` : c.tired ? 'Tired' : 'Ready';
      const sel = squad.has(c.id);
      const canGo = isFit(c) && !c.tired && !s.missionDoneToday;
      crewList.append(h('div', { class: `card ${sel ? 'sel' : ''} ${!canGo ? 'dim' : ''}` },
        h('div', { class: 'row' },
          h('b', {}, c.name),
          h('span', { class: 'pill' }, `Lv ${c.level}`),
          h('span', { class: `pill ${c.injuredDays ? 'bad' : c.tired ? 'warn' : 'good'}` }, status),
        ),
        h('div', { class: 'bar' }, h('div', { class: 'fill', style: { width: `${(100 * c.hp) / c.maxHp}%` } })),
        h('div', { class: 'small muted' }, `HP ${c.hp}/${c.maxHp} · Aim ${c.aim} · Move ${c.mobility} · XP ${c.xp}/${XP_PER_LEVEL * c.level} · Kills ${c.kills}`),
        h('div', { class: 'small' }, c.traits.map((t) => h('span', { class: 'trait', title: TRAITS[t].desc }, TRAITS[t].name))),
        h('div', { class: 'row' },
          canGo && chosenSite !== null
            ? h('button', { class: `btn small ${sel ? 'primary' : ''}`, onclick: () => { if (sel) squad.delete(c.id); else if (squad.size < 4) squad.add(c.id); render(); } }, sel ? 'In squad' : 'Add to squad')
            : null,
          (c.hp < c.maxHp || c.injuredDays) ? h('button', { class: 'btn small', disabled: s.resources.meds < 1, onclick: () => { treat(s, c.id); render(); } }, 'Treat (1 med)') : null,
        ),
      ));
    }

    // Missions
    const missions = h('div', { class: 'list' });
    if (s.missionDoneToday) {
      missions.append(h('p', { class: 'muted' }, 'The squad is back for the day. Get ready for the night.'));
    } else {
      for (const site of s.sites) {
        const isSel = chosenSite === site.id;
        missions.append(h('div', { class: `card site ${isSel ? 'sel' : ''}`, onclick: () => { chosenSite = isSel ? null : site.id; render(); } },
          h('div', { class: 'row' }, h('span', { class: 'icon' }, KIND_ICON[site.kind]), h('b', {}, site.name)),
          h('div', { class: 'small' }, `Danger ${'☠'.repeat(site.danger)}${'·'.repeat(5 - site.danger)} · Mostly ${RESOURCE_LABEL[site.lootBias].toLowerCase()}`),
          site.hasSurvivor ? h('div', { class: 'small good' }, 'Radio chatter: someone is holed up here.') : null,
        ));
      }
      if (chosenSite !== null) {
        const site = s.sites.find((x) => x.id === chosenSite)!;
        const ready = availableForMission(s);
        const ammoEach = Math.min(AMMO_PER_MEMBER, Math.floor(s.resources.ammo / Math.max(1, squad.size)));
        missions.append(h('div', { class: 'launch' },
          h('div', {}, `Squad: ${squad.size}/4 picked from ${ready.length} ready. Each takes ${ammoEach} rounds.`),
          h('button', {
            class: 'btn primary', disabled: squad.size === 0,
            onclick: () => hd.launch(site, [...squad]),
          }, `Go to ${site.name}`),
        ));
      } else {
        missions.append(h('p', { class: 'small muted' }, 'Pick a site, then choose up to 4 ready survivors. Whatever they carry out is yours; whatever they drop stays there.'));
      }
    }

    // Base map and the selected building.
    const mapHost = h('div', { class: 'base-map' });
    mountBaseMap(mapHost, s, selectedId, (id: string) => { selectedId = id; render(); });
    const st = s.structures.find((x) => x.id === selectedId) ?? s.structures[0];
    const detail = h('div', { class: 'panel bld' }, ...structurePanel(st));

    const perimeter = h('div', { class: 'panel' },
      h('h3', {}, 'Perimeter'),
      h('div', { class: 'small muted' }, s.buildings.walls === 0
        ? 'A sagging chain-link fence with four wide gaps.'
        : `Level ${s.buildings.walls} walls: +${s.buildings.walls * 5} night defense, ${s.buildings.walls >= 2 ? 'two' : 'three'} narrow gates.`),
      h('div', { class: 'row' },
        s.buildings.walls < WALLS_MAX
          ? h('button', { class: 'btn small', disabled: !canAfford(s, wallsCost(s.buildings.walls)), onclick: () => { upgradeWalls(s); render(); } },
            `${s.buildings.walls ? 'Reinforce' : 'Build walls'} (${costText(wallsCost(s.buildings.walls))})`)
          : h('span', { class: 'pill good' }, 'Fully fortified'),
        h('button', { class: 'btn small', disabled: s.integrity >= s.maxIntegrity || s.resources.scrap < REPAIR_COST, onclick: () => { repair(s); render(); } },
          `Patch walls +${REPAIR_AMOUNT} (${REPAIR_COST} scrap)`),
      ),
    );

    // Trader
    const traderBox = s.trader ? h('div', { class: 'panel' },
      h('h3', {}, 'Trader at the gate'),
      h('div', { class: 'list' }, s.trader.map((o, i) => h('div', { class: 'card row' },
        h('span', {}, `${costText(o.give)} → ${costText(o.get)}`),
        h('button', { class: 'btn small', disabled: o.taken || !canAfford(s, o.give), onclick: () => { trade(s, i); render(); } }, o.taken ? 'Done' : 'Trade'),
      ))),
    ) : null;

    // Night forecast
    const fit = s.crew.filter(isFit).length;
    const night = h('div', { class: `panel night ${horde ? 'horde' : ''}` },
      h('h3', {}, horde ? `Tonight: HORDE NIGHT` : 'Tonight'),
      horde
        ? h('p', {}, `A horde is coming. Every fit survivor (${fit}) will fight on the walls in a tactical battle. Hold for 8 turns.`)
        : h('p', {}, s.buildings.tower ? `Watchtower estimate: ${lo}–${hi} attack strength vs your defense of ${def}.` : `Expected attack is unknown without a watchtower. Your defense: ${def}.`),
      h('p', { class: 'small muted' }, `Survivors who went out today defend at 75%. Upkeep: ${s.crew.length} food. Crew ${s.crew.length}/${cap}.`),
      h('button', { class: 'btn primary', onclick: hd.endDay }, horde ? 'Man the walls' : 'End day'),
    );

    const logBox = h('div', { class: 'panel' }, h('h3', {}, 'Journal'),
      h('div', { class: 'log' }, s.log.slice(0, 18).map((l) => h('div', { class: `log-${l.tone ?? 'info'}` }, h('span', { class: 'muted' }, `D${l.day} `), l.text))));

    root.append(top,
      h('div', { class: 'base-top' }, mapHost, h('div', { class: 'col' }, detail, perimeter)),
      h('div', { class: 'base-grid' },
        h('div', { class: 'col' }, h('div', { class: 'panel' }, h('h3', {}, `Crew (${s.crew.length}/${cap})`), crewList)),
        h('div', { class: 'col' }, h('div', { class: 'panel' }, h('h3', {}, 'Scavenging runs'), missions), night, traderBox),
        h('div', { class: 'col' }, logBox),
      ));
  }

  function structurePanel(st: Structure): (Node | null)[] {
    const sizeName = { small: 'Small', medium: 'Medium', large: 'Large' }[st.size];
    const out: (Node | null)[] = [
      h('div', { class: 'row' }, h('h3', {}, st.name), h('span', { class: 'pill' }, `${sizeName} · up to level ${SIZE_CAP[st.size]}`)),
    ];
    if (st.fixed) {
      out.push(h('p', { class: 'small' }, `The heart of the station: the stores, the kitchen and ${crewCap(0)} beds. If the dead reach the stores on a horde night, the base takes damage.`));
      out.push(h('p', { class: 'small muted' }, 'Click another building on the map to repair, remodel or upgrade it.'));
      return out;
    }
    if (st.ruined) {
      const cost = restoreCost(st);
      out.push(
        h('p', { class: 'small' }, 'Caved-in roof, rubble everywhere. It needs clearing before it can be used.'),
        h('button', { class: 'btn primary small', disabled: !canAfford(s, cost), onclick: () => { restoreStructure(s, st.id); render(); } }, `Clear & repair (${costText(cost)})`),
      );
      return out;
    }
    if (st.purpose) {
      const def = purposeDef(st.purpose);
      const up = upgradeCost(st);
      out.push(
        h('p', {}, h('b', {}, `${def.name} · level ${st.level}`)),
        h('p', { class: 'small muted' }, `Whole station: ${def.describe(s.buildings[st.purpose])}`),
        up
          ? h('button', { class: 'btn primary small', disabled: !canAfford(s, up), onclick: () => { upgradeStructure(s, st.id); render(); } }, `Upgrade to level ${st.level + 1} (${costText(up)})`)
          : h('span', { class: 'pill' }, 'As big as this building allows'),
      );
    } else {
      out.push(h('p', { class: 'small' }, 'Empty and usable. Pick what to turn it into.'));
    }
    const options = ALLOWED[st.size].filter((p) => p !== st.purpose);
    out.push(h('div', { class: 'small muted' }, st.purpose ? 'Remodel as (resets to level 1):' : 'Remodel as:'));
    out.push(h('div', { class: 'remodel' }, options.map((p: Purpose) => {
      const def = purposeDef(p);
      const cost = remodelCost(st, p);
      return h('button', {
        class: 'btn small', title: def.describe(1),
        disabled: !canRemodel(st, p) || !canAfford(s, cost),
        onclick: () => { remodel(s, st.id, p); render(); },
      }, h('b', {}, def.name), h('span', { class: 'muted' }, ` ${costText(cost)}`));
    })));
    return out;
  }
  render();
}
