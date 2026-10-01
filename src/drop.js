// Runs one drop: releases the hand into a World according to the drop mode,
// applies this round's perk shapes, and reports where each ball ends up.
// The same controller drives the animated browser drop (stepped over time)
// and the headless harness (runToCompletion).

import { World } from './physics.js';
import { restitutionFor } from './balls.js';

export class DropController {
  constructor({ board, cfg, rng, hand, mode, mods }) {
    this.board = board;
    this.cfg = cfg;
    this.rng = rng;
    this.mode = mode === 'cluster' ? 'cluster' : 'single';
    this.mods = mods || {};
    this.world = new World(board, cfg, rng);
    this.shapes = applyMods(this.world, board, cfg, this.mods);
    this.hand = hand;
    this.queue = hand.map((ball, index) => ({ ball, index }));
    this.bodies = new Array(hand.length).fill(null);
    this.lastReleased = null;
    this.nextRelease = this.mode === 'cluster' ? 0 : -1;
    this.startTime = 0;
    this.finished = false;
  }

  get time() { return this.world.time; }

  spawn(ball) {
    const cfg = this.cfg;
    const sp = this.board.spawn;
    const x = sp.x + this.rng.range(-cfg.releaseJitterX, cfg.releaseJitterX);
    const vx = this.rng.range(-cfg.releaseJitterVx, cfg.releaseJitterVx);
    return this.world.addBall({ ref: ball, x, y: sp.y, vx, vy: 0, restitution: restitutionFor(ball.type, cfg) });
  }

  releaseNext() {
    const { ball, index } = this.queue.shift();
    const body = this.spawn(ball);
    this.bodies[index] = body;
    this.lastReleased = body;
    return body;
  }

  step() {
    if (this.finished) return;
    const w = this.world;
    const cfg = this.cfg;

    if (this.queue.length) {
      if (this.mode === 'cluster') {
        if (w.time >= this.nextRelease) {
          this.releaseNext();
          const jitter = 1 + this.rng.range(-cfg.clusterReleaseJitter, cfg.clusterReleaseJitter);
          this.nextRelease = w.time + cfg.clusterReleaseInterval * jitter;
        }
      } else {
        const last = this.lastReleased;
        const stalled = last && w.time - last.releasedAt >= cfg.singleStallTimeout;
        if (!last) {
          this.releaseNext();
        } else if (last.inSlotZone || last.removed || stalled) {
          if (this.nextRelease < 0) this.nextRelease = w.time + cfg.singleReleaseDelay;
          if (w.time >= this.nextRelease) {
            this.releaseNext();
            this.nextRelease = -1;
          }
        }
      }
    }

    w.step();

    if (!this.queue.length) {
      let all = true;
      const balls = w.balls;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (!b.removed && !b.settled) { all = false; break; }
      }
      if (all || w.time - this.startTime >= cfg.maxDropTime) this.finish();
    }
  }

  finish() {
    for (const b of this.world.balls) {
      if (!b.removed && b.slot < 0) b.slot = this.board.slotIndexAt(b.x);
    }
    this.finished = true;
  }

  runToCompletion() {
    while (!this.finished) this.step();
    return this.results();
  }

  /** Drop one landed ball again (Re-drop perk). */
  redrop(index) {
    const old = this.bodies[index];
    if (!old) throw new Error(`No ball at hand index ${index}`);
    old.removed = true;
    const body = this.spawn(old.ref);
    this.bodies[index] = body;
    this.lastReleased = body;
    this.startTime = this.world.time;
    this.nextRelease = -1;
    this.finished = false;
    return body;
  }

  results() {
    return this.bodies.map((b, index) => ({
      index,
      ball: b ? b.ref : this.hand[index],
      slot: b ? b.slot : -1,
    }));
  }
}

/** Adds this round's perk shapes to the world. Returns them for rendering. */
export function applyMods(world, board, cfg, mods) {
  const shapes = { walls: [], roofs: [] };
  for (const w of mods.walls || []) {
    const a = board.pegAt(w.row, w.gap);
    const b = board.pegAt(w.row, w.gap + 1);
    if (!a || !b) continue;
    shapes.walls.push(world.addSegment(a.x, a.y, b.x, b.y, { thickness: cfg.perkWallThickness, kind: 'perkwall' }));
  }
  for (const slot of mods.blocked || []) {
    for (const [x1, y1, x2, y2] of roofSegments(board, cfg, slot)) {
      shapes.roofs.push(world.addSegment(x1, y1, x2, y2, { thickness: cfg.dividerCapRadius * 0.6, e: cfg.dividerRestitution, kind: 'roof' }));
    }
  }
  return shapes;
}

/**
 * The roof placed over a blocked slot, as [x1, y1, x2, y2] segments. Interior
 * slots get a peaked roof. An edge slot gets a single ramp sloping away from
 * the side wall, because a peak there would form a closed V with the wall and
 * trap balls.
 */
export function roofSegments(board, cfg, slot) {
  const xl = board.slotLeftX(slot);
  const xr = xl + board.slotWidth;
  const yTop = board.slotTopY;
  const yPeak = yTop - cfg.blockCapHeight;
  if (slot === 0) return [[xl, yPeak, xr, yTop]];
  if (slot === board.slotCount - 1) return [[xl, yTop, xr, yPeak]];
  const xm = (xl + xr) / 2;
  return [[xl, yTop, xm, yPeak], [xm, yPeak, xr, yTop]];
}
