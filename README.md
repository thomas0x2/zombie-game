# Station Nine

A single-player, rogue-lite, turn-based zombie survival game that runs in the browser.
Build up a safe zone in an old fire station, send your crew on tactical scavenging runs, and hold the walls at night.

See [docs/DESIGN.md](docs/DESIGN.md) for the design and tech plan.

## Play

```bash
npm install
npm run dev      # open the printed localhost URL
```

## Controls (missions)

- **Click** a survivor to select them, **click** a tile to move (blue = 1 AP, amber = 2 AP).
- **Click a zombie** to attack: melee if adjacent (quiet), otherwise shoot (loud, ends that survivor's turn).
- **E** search a cache / talk to a stranger · **O** overwatch · **F** force shooting at adjacent zombies
- **H** medic heal · **X** evacuate from the green zone · **Tab** next survivor · **Space** end turn

## Develop

```bash
npm test         # game logic tests (Vitest)
npm run build    # typecheck + production build into dist/
```
