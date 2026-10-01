#!/usr/bin/env node
// Headless simulation harness. Imports the same physics and game logic as
// the browser build.
//
//   node sim/harness.js dist         landing distributions per slot
//   node sim/harness.js perks        how a wall and a blocked slot shift them
//   node sim/harness.js bots         full runs by simple bots
//   node sim/harness.js determinism  checksum to compare with the browser
//   node sim/harness.js all          everything plus the tuning checklist
//
// Options: --drops N (default 10000)  --runs N (default 300)  --seed N
//          --set key=value (repeatable, e.g. --set pegRows=5 --set ballPrices.gold=14)
//          --json path (write all results as JSON)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { mergeConfig, parseOverrides } from '../src/config.js';
import { buildBoard } from '../src/board.js';
import { Rng } from '../src/rng.js';
import { DropController } from '../src/drop.js';
import { determinismScenario } from '../src/determinism.js';
import { BOTS, BOT_IDS, playRun } from './bots.js';

// ----------------------------------------------------------------- CLI args

function parseArgs(argv) {
  const opts = { command: 'all', drops: 10000, runs: 300, seed: 1, set: [], json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--drops') opts.drops = Number(argv[++i]);
    else if (a === '--runs') opts.runs = Number(argv[++i]);
    else if (a === '--seed') opts.seed = Number(argv[++i]);
    else if (a === '--set') opts.set.push(argv[++i]);
    else if (a === '--json') opts.json = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else opts.command = a;
  }
  return opts;
}

// ----------------------------------------------------------------- measuring

export function measureDistribution({ cfg, board, type, mode, drops, seed, mods = {} }) {
  const rng = new Rng(seed);
  const k = cfg.slots;
  const counts = new Array(k).fill(0);
  let n = 0, steps = 0, nudges = 0, timeouts = 0, dropsRun = 0, maxTime = 0;
  const handSize = mode === 'single' ? 1 : cfg.handSize;
  while (n < drops) {
    const hand = Array.from({ length: handSize }, (_, i) => ({ id: i + 1, type }));
    const c = new DropController({ board, cfg, rng, hand, mode, mods });
    for (const r of c.runToCompletion()) { counts[r.slot]++; n++; }
    steps += c.world.stepCount;
    dropsRun++;
    maxTime = Math.max(maxTime, c.world.time);
    if (c.world.time >= cfg.maxDropTime) timeouts++;
    for (const b of c.world.balls) nudges += b.nudges;
  }
  const pct = counts.map((c) => (100 * c) / n);
  const mean = pct.reduce((a, p, i) => a + (p / 100) * i, 0);
  const sd = Math.sqrt(pct.reduce((a, p, i) => a + (p / 100) * (i - mean) ** 2, 0));
  return {
    type, mode, mods, drops: n, counts, pct, mean, sd,
    outerLeft: pct[0], outerRight: pct[k - 1], outerAvg: (pct[0] + pct[k - 1]) / 2,
    center: pct[Math.floor((k - 1) / 2)],
    avgTime: (steps * cfg.timestep) / dropsRun, maxTime, nudgesPerBall: nudges / n, timeouts,
  };
}

function fmtDist(label, d) {
  const cells = d.pct.map((p) => p.toFixed(1).padStart(6)).join('');
  return `${label.padEnd(26)}${cells}   sd ${d.sd.toFixed(2)}  outer ${d.outerAvg.toFixed(1)}%  time ${d.avgTime.toFixed(2)}s  nudges/ball ${d.nudgesPerBall.toFixed(3)}${d.timeouts ? `  TIMEOUTS ${d.timeouts}` : ''}`;
}

function slotHeader(k) {
  return `${''.padEnd(26)}${Array.from({ length: k }, (_, i) => `s${i}`.padStart(6)).join('')}`;
}

// ----------------------------------------------------------------- commands

function runDist(cfg, board, opts, out) {
  console.log(`\n== Landing distribution (${opts.drops} balls each, % per slot, left → right) ==`);
  console.log(slotHeader(cfg.slots));
  const results = {};
  for (const type of ['white', 'bouncy']) {
    for (const mode of ['single', 'cluster']) {
      const d = measureDistribution({ cfg, board, type, mode, drops: opts.drops, seed: opts.seed });
      results[`${type}-${mode}`] = d;
      console.log(fmtDist(`${type === 'white' ? 'standard' : 'bouncy'} / ${mode}`, d));
    }
  }
  out.dist = results;
  return results;
}

function runPerks(cfg, board, opts, out) {
  console.log(`\n== Perk effects on standard balls in single mode (${opts.drops} balls each) ==`);
  console.log(slotHeader(cfg.slots));
  const base = measureDistribution({ cfg, board, type: 'white', mode: 'single', drops: opts.drops, seed: opts.seed });
  console.log(fmtDist('baseline', base));
  const center = Math.floor(cfg.slots / 2);
  const cases = [
    { label: 'wall row1 gap0 (center)', mods: { walls: [{ row: 1, gap: 0 }] } },
    { label: `wall row${cfg.pegRows - 2} center`, mods: { walls: [{ row: cfg.pegRows - 2, gap: Math.floor((cfg.pegRows - 2) / 2) }] } },
    { label: `wall row${cfg.pegRows - 1} gap0 (edge)`, mods: { walls: [{ row: cfg.pegRows - 1, gap: 0 }] } },
    { label: `block slot ${center} (center)`, mods: { blocked: [center] } },
    { label: 'block slot 0 (edge)', mods: { blocked: [0] } },
    { label: `block slot ${center - 1}`, mods: { blocked: [center - 1] } },
  ].filter((c) => !c.mods.walls || board.findGap(c.mods.walls[0].row, c.mods.walls[0].gap));
  const results = { baseline: base, cases: [] };
  for (const c of cases) {
    const d = measureDistribution({ cfg, board, type: 'white', mode: 'single', drops: opts.drops, seed: opts.seed, mods: c.mods });
    results.cases.push({ ...c, dist: d });
    console.log(fmtDist(c.label, d));
    const delta = d.pct.map((p, i) => (p - base.pct[i])).map((x) => (x >= 0 ? '+' : '') + x.toFixed(1)).map((s) => s.padStart(6)).join('');
    console.log(`${'   Δ vs baseline'.padEnd(26)}${delta}`);
  }
  // Cluster mode with a wall, for completeness.
  const dc = measureDistribution({ cfg, board, type: 'white', mode: 'cluster', drops: opts.drops, seed: opts.seed, mods: { walls: [{ row: 1, gap: 0 }] } });
  console.log(fmtDist('cluster + wall row1 gap0', dc));
  results.clusterWall = dc;
  out.perks = results;
  return results;
}

function runBots(cfg, opts, out) {
  console.log(`\n== Bot runs (${opts.runs} runs per bot, seeds ${opts.seed}..${opts.seed + opts.runs - 1}) ==`);
  const totalRounds = cfg.stages * cfg.roundsPerStage;
  const results = {};
  for (const id of BOT_IDS) {
    const runs = [];
    for (let i = 0; i < opts.runs; i++) runs.push(playRun(id, opts.seed + i, cfg));
    const wins = runs.filter((r) => r.won).length;
    const failHist = new Array(cfg.stages + 1).fill(0);
    for (const r of runs) if (!r.won) failHist[r.failedStage]++;
    const stageClear = [];
    for (let st = 1; st <= cfg.stages; st++) {
      const cleared = runs.filter((r) => r.won || r.failedStage > st).length;
      stageClear.push((100 * cleared) / runs.length);
    }
    const balanceByRound = new Array(totalRounds).fill(0);
    const incomeByRound = new Array(totalRounds).fill(0);
    const nByRound = new Array(totalRounds).fill(0);
    for (const r of runs) {
      for (const h of r.history) {
        balanceByRound[h.roundIndex] += h.balance;
        incomeByRound[h.roundIndex] += h.income;
        nByRound[h.roundIndex]++;
      }
    }
    const avg = (arr) => arr.map((v, i) => (nByRound[i] ? v / nByRound[i] : null));
    const winScores = runs.filter((r) => r.won).map((r) => r.score);
    const summary = {
      id, name: BOTS[id].name, runs: runs.length, wins, winRate: (100 * wins) / runs.length,
      failHist: failHist.slice(1), stageClear,
      meanWinScore: winScores.length ? winScores.reduce((a, b) => a + b, 0) / winScores.length : null,
      balanceByRound: avg(balanceByRound), incomeByRound: avg(incomeByRound), roundsReached: nByRound,
      meanHandSize: runs.reduce((a, r) => a + r.handSize, 0) / runs.length,
      meanBagSize: runs.reduce((a, r) => a + r.bagSize, 0) / runs.length,
    };
    results[id] = summary;
    console.log(`\n${summary.name} (${id})`);
    console.log(`  win rate ${summary.winRate.toFixed(1)}%   failed at stage: ${summary.failHist.map((n, i) => `S${i + 1}=${n}`).join(' ')}`);
    console.log(`  stage clear %: ${stageClear.map((p, i) => `S${i + 1} ${p.toFixed(0)}%`).join('  ')}`);
    if (summary.meanWinScore !== null) console.log(`  mean score on a win: ${summary.meanWinScore.toFixed(0)}`);
    console.log(`  mean hand size at end ${summary.meanHandSize.toFixed(1)}, bag size ${summary.meanBagSize.toFixed(1)}`);
    console.log(`  round:   ${summary.incomeByRound.map((_, i) => String(i + 1).padStart(5)).join('')}`);
    console.log(`  income:  ${summary.incomeByRound.map((v) => (v === null ? '    -' : v.toFixed(0).padStart(5))).join('')}`);
    console.log(`  balance: ${summary.balanceByRound.map((v) => (v === null ? '    -' : v.toFixed(0).padStart(5))).join('')}`);
    console.log(`  alive:   ${nByRound.map((v) => String(v).padStart(5)).join('')}`);
  }
  out.bots = results;
  return results;
}

function runDeterminism(cfg, out) {
  console.log('\n== Determinism ==');
  const a = determinismScenario(cfg);
  const b = determinismScenario(cfg);
  const same = a.checksum === b.checksum;
  console.log(`  checksum ${a.checksum} (${a.trace.length} trace values), repeat run ${same ? 'identical' : 'DIFFERENT'}`);
  console.log('  Compare with the browser: menu → Determinism check. The two must print the same checksum.');
  out.determinism = { checksum: a.checksum, traceLength: a.trace.length, repeatable: same };
  return out.determinism;
}

function tuningChecks(cfg, out) {
  console.log('\n== Tuning targets ==');
  const checks = [];
  const add = (ok, text) => { checks.push({ ok, text }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${text}`); };
  if (out.dist) {
    const s = out.dist['white-single'], c = out.dist['white-cluster'], b = out.dist['bouncy-single'];
    add(Math.min(s.outerLeft, s.outerRight) >= 3, `each outer slot ≥ 3% of standard balls in single mode (${s.outerLeft.toFixed(1)}% / ${s.outerRight.toFixed(1)}%)`);
    add(c.sd > s.sd * 1.08, `cluster spread clearly wider than single (sd ${c.sd.toFixed(2)} vs ${s.sd.toFixed(2)})`);
    add(b.sd > s.sd * 1.08, `bouncy spread wider than standard (sd ${b.sd.toFixed(2)} vs ${s.sd.toFixed(2)})`);
    add(Object.values(out.dist).every((d) => d.timeouts === 0), 'no drop hit the time cap');
  }
  if (out.bots) {
    const nb = out.bots['never-buy'];
    add(nb.stageClear[0] >= 70, `never-buy clears stage 1 most of the time (${nb.stageClear[0].toFixed(0)}%)`);
    add(nb.stageClear[2] <= 30 && nb.stageClear[3] <= 2, `never-buy is out by stage 3 in most runs (clears stage 3 in ${nb.stageClear[2].toFixed(0)}%, stage 4 in ${nb.stageClear[3].toFixed(0)}%)`);
    const buyers = BOT_IDS.filter((id) => id !== 'never-buy').map((id) => out.bots[id]);
    const inBand = buyers.filter((b) => b.winRate >= 25 && b.winRate <= 35);
    add(inBand.length > 0, `a buying bot wins 25%–35% of runs (${buyers.map((b) => `${b.id} ${b.winRate.toFixed(0)}%`).join(', ')})`);
  }
  out.checks = checks;
}

// ----------------------------------------------------------------- main

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const overrides = parseOverrides(opts.set);
  const cfg = mergeConfig(overrides);
  const board = buildBoard(cfg);
  const out = { config: cfg, overrides, options: opts };
  if (opts.set.length) console.log(`Config overrides: ${JSON.stringify(overrides)}`);
  console.log(`Board: ${cfg.pegRows} peg rows, ${cfg.slots} slots, peg r ${cfg.pegRadius}, ball r ${cfg.ballRadius}, restitution ${cfg.standardRestitution}/${cfg.bouncyRestitution} (bouncy), dt 1/${Math.round(1 / cfg.timestep)}`);
  const t0 = Date.now();
  const cmd = opts.command;
  if (cmd === 'dist' || cmd === 'all') runDist(cfg, board, opts, out);
  if (cmd === 'perks' || cmd === 'all') runPerks(cfg, board, opts, out);
  if (cmd === 'bots' || cmd === 'all') runBots(cfg, opts, out);
  if (cmd === 'determinism' || cmd === 'all') runDeterminism(cfg, out);
  if (!['dist', 'perks', 'bots', 'determinism', 'all'].includes(cmd)) {
    console.error(`Unknown command "${cmd}". Use dist | perks | bots | determinism | all.`);
    process.exit(2);
  }
  if (cmd === 'all' || cmd === 'dist' || cmd === 'bots') tuningChecks(cfg, out);
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (opts.json) {
    mkdirSync(dirname(opts.json), { recursive: true });
    writeFileSync(opts.json, JSON.stringify(out, null, 2));
    console.log(`Wrote ${opts.json}`);
  }
}

main();
