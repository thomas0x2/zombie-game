import './styles.css';
import {
  applyDefenseBattle, applyMission, finishNight, isHordeNight, issueAmmo, newRun, resolveNightAuto, WIN_DAY,
  type NightReport,
} from './game/base';
import { isFit } from './game/crew';
import { UNLOCKS, buyUnlock, hopeForRun, loadMeta, saveMeta } from './game/meta';
import type { MissionSite, RunState } from './game/types';
import { Battle } from './tactical/battle';
import { generateDefenseMap, generateScavengeMap } from './tactical/mapgen';
import { mountBase } from './ui/baseView';
import { mountTactical } from './ui/tacticalView';
import { drawRooms } from './ui/sprites';
import { h, clear } from './ui/dom';

const RUN_KEY = 'station-nine-run-v1';
const root = document.getElementById('app')!;
let meta = loadMeta();
let run: RunState | null = loadRun();
let disposeTactical: (() => void) | null = null;

function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as RunState;
    if (s.phase === 'over' || !Array.isArray(s.structures)) return null; // finished, or a save from before the base map
    if (s.phase === 'mission' || s.phase === 'defense') {
      // Reloaded mid-battle: the squad limps home with nothing.
      s.phase = 'base';
      if (s.missionDoneToday === false) s.missionDoneToday = true;
    }
    return s;
  } catch {
    return null;
  }
}
function saveRun() {
  try {
    if (run && run.phase !== 'over') localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch { /* storage unavailable */ }
}

function stopTactical() {
  disposeTactical?.();
  disposeTactical = null;
}

// ---------- title / meta ----------

function showTitle() {
  stopTactical();
  clear(root);
  const unlocks = h('div', { class: 'list unlocks' }, UNLOCKS.map((u) => {
    const owned = meta.unlocked.includes(u.id);
    return h('div', { class: `card ${owned ? 'sel' : ''}` },
      h('div', { class: 'row' }, h('b', {}, u.name), h('span', { class: 'pill' }, owned ? 'Owned' : `${u.cost} hope`)),
      h('div', { class: 'small muted' }, u.desc),
      owned ? null : h('button', { class: 'btn small', disabled: meta.hope < u.cost, onclick: () => { buyUnlock(meta, u.id); saveMeta(meta); showTitle(); } }, 'Unlock'),
    );
  }));
  root.append(h('div', { class: 'title-screen' },
    h('h1', {}, 'STATION NINE'),
    h('p', { class: 'tagline' }, 'Hold the old fire station. Scavenge the dead city. Make it to day ' + WIN_DAY + '.'),
    h('div', { class: 'row center' },
      run ? h('button', { class: 'btn primary big', onclick: () => showBase() }, `Continue (day ${run.day})`) : null,
      h('button', { class: `btn big ${run ? '' : 'primary'}`, onclick: startRun }, run ? 'Abandon & start new run' : 'Start a run'),
    ),
    h('p', { class: 'muted' }, `Runs: ${meta.runs} · Best day: ${meta.bestDay} · Wins: ${meta.wins} · Hope: ${meta.hope}`),
    h('div', { class: 'panel' }, h('h3', {}, 'Head starts (kept between runs)'), unlocks),
    h('div', { class: 'panel small muted how' },
      h('h3', {}, 'How it works'),
      h('p', {}, 'Each day, send up to 4 survivors on a scavenging run. Turn-based, 2 actions each: move, shoot, swing, search, overwatch. Guns are loud and draw more dead. Only what you carry back to the green evac zone counts.'),
      h('p', {}, 'Each night, the dead test your walls. Build up the station, keep everyone fed and patched up, and fight off a full horde every 5th night.'),
      h('p', {}, 'When the station falls, you earn Hope to spend on head starts for the next run.'),
    ),
  ));
}

function startRun() {
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  run = newRun(seed, meta.unlocked);
  meta.runs++;
  saveMeta(meta);
  saveRun();
  showBase();
}

// ---------- base ----------

function showBase() {
  stopTactical();
  if (!run) return showTitle();
  if (run.phase === 'over') return showRunOver();
  const s = run;
  mountBase(root, s, {
    save: saveRun,
    quit: showTitle,
    launch: (site, ids) => launchMission(s, site, ids),
    endDay: () => startNight(s),
  });
}

function launchMission(s: RunState, site: MissionSite, ids: number[]) {
  const squad = s.crew.filter((c) => ids.includes(c.id));
  const ammo = issueAmmo(s, squad.length);
  const cfg = generateScavengeMap(site, s.day);
  cfg.dmgBonus = s.buildings.workshop;
  const battle = new Battle(cfg, squad.map((survivor) => ({ survivor, ammo })));
  s.phase = 'mission';
  saveRun();
  disposeTactical = mountTactical(root, battle, {
    title: `${site.name} · Danger ${site.danger}`,
    onDone: (b) => {
      const sum = b.summary();
      s.phase = 'base';
      const lines = applyMission(s, sum, site.name);
      showReport(b.outcome === 'success' ? 'Back at the station' : 'A bad day', lines, showBase);
    },
  });
}

function startNight(s: RunState) {
  if (isHordeNight(s.day)) {
    const defenders = s.crew.filter(isFit).slice(0, 6);
    if (defenders.length) {
      const ammo = issueAmmo(s, defenders.length, 8);
      const cfg = generateDefenseMap(s.seed + s.day * 31, s.day, s.buildings.walls, s.structures);
      cfg.dmgBonus = s.buildings.workshop;
      cfg.aimBonus = s.buildings.tower * 8;
      const battle = new Battle(cfg, defenders.map((survivor) => ({ survivor, ammo })));
      s.phase = 'defense';
      saveRun();
      disposeTactical = mountTactical(root, battle, {
        title: `Horde night ${s.day}`,
        decor: (c) => drawRooms(c, s.structures),
        onDone: (b) => {
          const rep = applyDefenseBattle(s, b.summary());
          endNight(s, rep);
        },
      });
      return;
    }
  }
  endNight(s, resolveNightAuto(s));
}

function endNight(s: RunState, rep: NightReport) {
  finishNight(s, rep);
  saveRun();
  if (s.phase === 'over') return showRunOver();
  showReport(rep.repelled ? 'Dawn' : 'A rough night', rep.lines, showBase);
}

function showReport(title: string, lines: string[], next: () => void) {
  stopTactical();
  clear(root);
  root.append(h('div', { class: 'overlay solid' }, h('div', { class: 'modal' },
    h('h2', {}, title),
    ...lines.map((l) => h('p', {}, l)),
    h('button', { class: 'btn primary', onclick: next }, 'Continue'),
  )));
}

function showRunOver() {
  stopTactical();
  if (!run) return showTitle();
  const s = run;
  const won = s.result === 'won';
  const hope = hopeForRun(s.day, s.stats.rescued, won);
  meta.hope += hope;
  meta.bestDay = Math.max(meta.bestDay, s.day);
  if (won) meta.wins++;
  saveMeta(meta);
  run = null;
  saveRun();
  clear(root);
  root.append(h('div', { class: 'overlay solid' }, h('div', { class: 'modal' },
    h('h2', {}, won ? 'You made it' : 'The station has fallen'),
    h('p', {}, won ? `The convoy rolled in on day ${s.day}.` : `You held out until day ${s.day}.`),
    h('p', {}, `Zombies put down: ${s.stats.kills} · Survivors rescued: ${s.stats.rescued} · Crew lost: ${s.stats.lost} · Runs made: ${s.stats.missions}`),
    h('p', { class: 'good' }, `+${hope} hope`),
    h('button', { class: 'btn primary', onclick: showTitle }, 'Back to the menu'),
  )));
}

showTitle();
