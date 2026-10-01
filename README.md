# Ball-Drop Bag Builder

A phone-first web game: balls fall from the top of a triangular peg board,
bounce through the pegs and land in money slots. Money buys more and better
balls for your bag, and an escalating quota is due at the end of every stage.
Vanilla HTML, JS and CSS. No framework, no build step, deployable as static
files.

This is the first build described in the "Ball-Drop Bag Builder: First Build
Spec" document.

## Run it

Any static file server works. From the repo root:

```sh
npm run serve          # python3 -m http.server 8080
# then open http://localhost:8080 on a phone or in a narrow browser window
```

Open `?seed=3fa9c21b` (any 8 hex digits, or any text) to start a run with a
known seed. The seed of a finished run is shown on the end screen. Run state
is saved to `localStorage` after every phase change, so a closed tab resumes.

## Simulation harness

The headless harness imports the same physics and game code as the browser.

```sh
npm run sim                        # everything: distributions, perks, bots, determinism, tuning checks
node sim/harness.js dist           # landing distribution per slot (10,000 balls per case)
node sim/harness.js perks          # how a wall and a blocked slot shift the distribution
node sim/harness.js bots           # full runs by the bots, win rate, failure stage, balance by round
node sim/harness.js determinism    # checksum to compare with the game's menu → Determinism check
node sim/harness.js all --drops 20000 --runs 1000 --json sim/reports/latest.json
node sim/harness.js bots --set pegRows=5 --set quotas='[30,90,200,360,560]'   # try config changes
```

The latest results and the checkpoint notes are in `sim/REPORT.md`.

```sh
npm test                           # engine tests (node:test)
```

## Layout

```
index.html, styles.css      phone layout: HUD, canvas board, controls below
src/config.js               every tunable number, in one object
src/rng.js                  seeded PRNG (sfc32) and seed derivation
src/board.js                board geometry from the config
src/physics.js              deterministic fixed-step solver (circles, segments)
src/drop.js                 releases a hand into the world: single / cluster, perk shapes, re-drop
src/balls.js, src/perks.js  the four ball types and four perks
src/bag.js                  draw pool and discard pile
src/slots.js                seeded slot layouts: values, highlighted slots, perk slot
src/payout.js               results → money and perks
src/shop.js                 offers and prices
src/game.js                 the run: phases, quota, shop, save/restore
src/determinism.js          the fixed scenario behind the determinism checksum
src/ui/render.js            canvas renderer
src/ui/app.js               DOM glue
sim/harness.js, sim/bots.js the headless harness and the bots
test/                       engine tests
```

## How the pieces fit

- **Determinism.** Everything random comes from `Rng` seeded from the run
  seed, the round index and a stream name (`layout`, `draw`, `physics`,
  `shop`, `reward`). The solver uses only `+ - * /` and `sqrt`, so Node and
  every browser produce identical drops. A drop interrupted by a reload is
  replayed from its seed on resume.
- **Board.** Row `i` has `i + 1` pegs. The side walls pass through a "virtual
  peg" one spacing outside each row and carry a bump at every row so they do
  not funnel balls into the outer slots. Slot dividers sit under the pegs of
  the last row.
- **Drop modes.** Single releases the next ball when the previous one has
  committed to a slot. Cluster releases in a rapid stagger so balls collide.
- **Perks.** Wall adds a segment between two adjacent pegs. Block adds a roof
  over a slot (a one-sided ramp on an edge slot). Double multiplies a slot's
  value. Re-drop lifts one landed ball and drops it again.
- **Quota.** `quotaMode` is `paid` (deducted, surplus carries) or `checked`.
