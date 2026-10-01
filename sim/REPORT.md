# Simulation report and checkpoint notes

Generated from `node sim/harness.js all --drops 10000 --runs 500` on the
config in `src/config.js` at the time of the first build. Re-run it after any
config change; `--json sim/reports/latest.json` keeps the raw numbers.

## Checkpoint 1: landing distributions

Board: 6 peg rows, 7 slots, peg radius 0.14, ball radius 0.22, row spacing
1.0, restitution 0.3 (bouncy 0.7). Percent of balls per slot, left → right.

| Case | s0 | s1 | s2 | s3 | s4 | s5 | s6 | sd | outer avg |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| standard, single | 5.4 | 8.3 | 23.8 | 23.3 | 25.4 | 8.6 | 5.3 | 1.46 | 5.4% |
| standard, cluster | 6.9 | 11.3 | 20.7 | 20.9 | 21.0 | 11.4 | 7.9 | 1.63 | 7.4% |
| bouncy, single | 10.9 | 13.3 | 17.3 | 17.3 | 17.1 | 13.4 | 10.5 | 1.83 | 10.7% |
| bouncy, cluster | 11.6 | 13.9 | 16.0 | 17.4 | 16.7 | 13.2 | 11.2 | 1.86 | 11.4% |

A single-mode drop takes about 1.6 s of simulated time per ball; cluster
hands of 5 take about 2 s. No drop hit the 25 s cap and no ball needed the
stuck-ball nudge in these cases.

How the physics got here (the spec's starting values gave a flat, not
center-heavy, distribution):

- The diagonal side walls now carry a bump at every row. Without them a
  ball that reached a wall slid straight into the outer slot (28% per outer
  slot).
- Peg radius 0.1 → 0.14, restitution 0.5 → 0.3 (bouncy 0.85 → 0.7), row
  spacing 0.866 → 1.0. Each of these pulls single mode toward the center.
  With these values the outer slots still get above 3% each.
- Friction only applies on real impacts. Applying it on every contact step
  glued balls to walls; a Coulomb cap wiped out small sideways speeds and
  left balls balanced on pegs.

## Perk effects (standard balls, single mode, 10,000 each)

| Case | s0 | s1 | s2 | s3 | s4 | s5 | s6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 5.4 | 8.3 | 23.8 | 23.3 | 25.4 | 8.6 | 5.3 |
| wall, row 1 center gap | 3.7 | 13.4 | 19.9 | 26.1 | 19.7 | 12.9 | 4.1 |
| wall, row 4 center gap | 5.3 | 7.9 | 29.3 | 14.2 | 12.2 | 26.4 | 4.7 |
| wall, row 5 left edge gap | 9.9 | 1.3 | 26.6 | 23.1 | 25.4 | 8.5 | 5.3 |
| block slot 3 (center) | 5.4 | 8.2 | 35.1 | 0.0 | 37.5 | 8.4 | 5.3 |
| block slot 0 (edge) | 0.0 | 13.7 | 23.8 | 23.3 | 25.4 | 8.6 | 5.3 |
| block slot 2 | 4.2 | 21.3 | 0.0 | 35.4 | 25.3 | 8.6 | 5.3 |

A blocked slot sends its balls to its neighbors. A low wall moves roughly
20 points of probability between neighboring slots; a high wall spreads the
drop slightly. The roof on an edge slot is a one-sided ramp away from the
wall: a peaked roof there formed a closed V with the wall and trapped balls.

## Checkpoint 2: bot runs (500 runs each)

| Bot | Win rate | Fails at S1 / S2 / S3 / S4 / S5 | Clears S1 / S2 / S3 / S4 | Hand, bag at end |
| --- | --- | --- | --- | --- |
| never-buy | 0% | 2 / 31 / 365 / 101 / 1 | 100% / 93% / 20% / 0% | 5, 8 |
| cheapest-ball | 0% | 69 / 179 / 227 / 25 / 0 | 86% / 50% / 5% / 0% | 5, 14 |
| hand-size | 2.8% | 22 / 46 / 214 / 149 / 55 | 96% / 86% / 44% / 14% | 7.2, 8 |
| balanced | 23.4% | 70 / 103 / 120 / 57 / 33 | 86% / 65% / 41% / 30% | 8.8, 14.5 |

Mean income per round, never-buy: 25, 27, 27 · 37, 36, 35 · 45, 45, 46 ·
55, 56, 54 (stage 4 reached by 20% of runs). Balanced: 25, 31, 39 · 57, 68,
77 · 103, 118, 123 · 167, 183, 194 · 254, 281, 303.

Tuning targets:

| Target | Status |
| --- | --- |
| Each outer slot ≥ 3% of standard balls in single mode | PASS, 5.4% / 5.3% |
| Cluster clearly wider than single | PASS, sd 1.63 vs 1.46 |
| Never-buy clears stage 1 most of the time | PASS, 100% |
| Never-buy is out by stage 3 | PASS in 80% of runs, out by stage 4 in 100% |
| A sensible buying bot wins 25%–35% | NOT YET: balanced 23%, hand-size 3%, cheapest-ball 0% |
| No single ball type or purchase wins on its own | PASS: balls only or hand size only both lose |

Economy changes from the spec's placeholders: quotas 25/60/120/220/400 →
35/100/230/360/520 and stage value multipliers 1/1.6/2.4/3.5/5 →
1/1.35/1.75/2.2/2.8. Ball, perk and upgrade prices are unchanged. The
measured income per white ball is about 3.6 at stage 1 (not the 2.25 a
binomial drop would give), so the spec's quotas let the never-buy bot win
95% of runs. Lower late quotas (for example 35/100/220/340/500) move the
balanced bot to about 17%–20%, higher ones below 15%; the ceiling is set by
stage 2 and 3 survival. The bots are simple and keep a reserve for the next
quota, so a human who plans purchases should do better than 23%.

The `balanced` bot was added beyond the three the spec lists, because none
of the three buys the way a player would (gold first, hand size when the bag
allows, remove whites).

## Determinism

Checksum `a56464c9` over 90 trace values (slots, positions, step counts and
hit counts of four scripted drops including a wall, a roof and a re-drop).
The browser's menu → Determinism check printed the same value in headless
Chromium.

## Checkpoint 3: phone play

Not done in this environment. Measured in headless Chromium at 390×844: a
single-mode drop of 5 balls takes about 9 s at normal speed and about 2.5 s
with fast-forward; a cluster drop about 3 s. With the shop, a round should
land near the one-minute target, but it needs a real phone to confirm.
