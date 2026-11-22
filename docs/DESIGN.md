# Station Nine — design & tech plan

Working title. Single-player, rogue-lite, turn-based top-down tactics in a zombie apocalypse.
You hold a safe zone in an old fire station, send a crew out to scavenge by day, and defend the walls by night.

## Pillars

1. **Every trip out is a gamble.** Missions are short extraction runs: you only keep what you
   carry back to the evac zone. Guns are loud and pull more of the dead in; melee is quiet but risky.
2. **The base is the long game.** What you bring home becomes walls, food, medicine and gear, and
   the base decides whether you survive the night.
3. **People matter.** Survivors have names, traits, levels and scars. Death is permanent.
   Finding new people is as important as finding food.
4. **Runs end; you get better.** When the safe zone falls you earn *Hope* that buys permanent
   head starts for the next run.

## Core loop

```
 ┌──────────── Day ─────────────┐      ┌──────── Night ────────┐
 │ Build / upgrade / repair     │      │ Normal night:          │
 │ Treat wounds, trade          │ ───▶ │   auto-resolved attack │
 │ Send ≤4 crew on one mission  │      │ Every 5th night:       │
 │   (tactical extraction run)  │      │   tactical horde fight │
 └──────────────────────────────┘      └───────────┬───────────┘
              ▲                                    │ upkeep: food, healing,
              └────────────── next day ◀───────────┘ garden & workshop output
```

Win: survive 15 nights. Lose: the safe zone's integrity hits 0 or no crew left.

## Systems in this first slice

| System | What's in |
| --- | --- |
| Tactical missions | 26×18 procedural city block (buildings, road, wrecks, fences). 2 AP per survivor: move (1 or 2 AP), shoot (ends turn, loud), melee (quiet), overwatch, search, rescue, medic heal, evacuate. Line of sight, fog of war, low cover (−20 to hit), range penalties. |
| Zombies | Shambler, Sprinter, Bloater. Dormant until they see you or hear noise. Noise and time on the map raise spawn pressure. |
| Extraction | Loot goes into a limited pack. A fallen survivor drops their pack where they died. Rescued strangers join the crew only if they reach the evac zone. |
| Safe zone | A modeled fire-station compound: Station Hall (stores, fixed) plus six existing buildings (Hose Tower, Engine Garage, Dispatch Office, Chief's House, Tool Shed, Shipping Container). Some start ruined and must be cleared. Each can be remodeled as Bunkhouse, Garden, Workshop, Infirmary, Radio or Watchtower (allowed purposes depend on size) and upgraded up to its size (small 1, medium 2, large 3). Levels of the same purpose add up. Perimeter fence → walls, integrity + repairs. |
| Crew | Random names, 8 traits, XP & levels, injuries that take days to heal, tiredness after missions. |
| Economy | Food, scrap, meds, ammo. Daily food upkeep. Ammo issued per mission, leftovers returned. |
| Trade | A trader sometimes waits at the gate with three swaps (more often with a Radio). |
| Night | Defense rating vs. growing attack strength; "heat" from noisy missions makes nights worse. Horde nights are an 8-turn tactical defense fought on the safe zone's own map, with your buildings and furniture; walls level changes how many breaches there are. |
| Meta | Hope earned per run; six permanent unlocks. Saved in `localStorage`, along with the current run. |

## Tech

- **TypeScript + Vite**, no engine. Canvas 2D for the tactical map, plain DOM for menus.
- **Game logic is UI-free** (`src/game`, `src/tactical`), so it's unit-tested with Vitest and could
  move to another renderer or engine later.
- Seeded RNG (`mulberry32`) for reproducible maps and runs.

```
src/
  game/       run state, base, crew, economy, meta progression (pure logic)
  tactical/   grid, pathfinding, line of sight, battle rules, map generators (pure logic)
  ui/         DOM base screen, canvas tactical view
  main.ts     screen flow, saving
tests/        Vitest: grid, mapgen, battle rules, bot-played missions and whole runs
```

## Next steps (proposed)

1. **Art & feel**: sprite set, simple animations, sound (gunshot noise should *feel* loud).
2. **More mission types**: rescue-only, supply drop with a timer, trader outpost, night raids.
3. **Gear**: weapons with different noise/damage/range, armor; workshop crafting.
4. **Human factions**: raiders who shoot back (makes cover matter more), friendly settlements to trade with.
5. **World map**: districts that get picked clean and more dangerous over time.
6. **Base layout**: building new structures on empty ground; barricades and traps you place on the base map.
7. **Balance pass** from real play; the tests include a bot that plays full runs, which can grow
   into a balance harness.
