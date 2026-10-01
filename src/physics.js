// Minimal deterministic 2D solver: dynamic circles (balls) against static
// circles (pegs, divider caps), static segments (walls, floor, dividers,
// perk shapes) and each other. Fixed timestep, no DOM, no transcendental
// math, so Node and the browser produce identical results from the same seed.

import { makeSegment } from './board.js';

export class World {
  constructor(board, cfg, rng) {
    this.board = board;
    this.cfg = cfg;
    this.rng = rng;
    this.dt = cfg.timestep;
    this.time = 0;
    this.stepCount = 0;
    this.balls = [];
    this.segments = board.segments.slice();
    this.circles = board.circles.slice();
  }

  addSegment(x1, y1, x2, y2, opts) {
    const s = makeSegment(x1, y1, x2, y2, opts);
    this.segments.push(s);
    return s;
  }

  addCircle(x, y, r, opts = {}) {
    const c = { x, y, r, e: opts.e, kind: opts.kind || 'circle' };
    this.circles.push(c);
    return c;
  }

  addBall({ ref, x, y, vx = 0, vy = 0, restitution }) {
    const b = {
      ref,
      x, y, vx, vy,
      r: this.cfg.ballRadius,
      e: restitution,
      slot: -1,
      inSlotZone: false,
      settled: false,
      restTime: 0,
      stuckTime: 0,
      nudges: 0,
      hits: 0,
      removed: false,
      releasedAt: this.time,
      progressY: y,
    };
    this.balls.push(b);
    return b;
  }

  step() {
    const { cfg, board, dt, balls } = this;
    const g = cfg.gravity;
    const drag = Math.max(0, 1 - cfg.airDrag * dt);

    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.removed) continue;
      b.vy += g * dt;
      b.vx *= drag;
      b.vy *= drag;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    for (let it = 0; it < cfg.solverIterations; it++) {
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (!b.removed) this.collideStatics(b);
      }
      this.collideBalls();
    }

    const commitY = board.commitY;
    const settleSpeed2 = cfg.settleSpeed * cfg.settleSpeed;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.removed) continue;
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (b.y >= commitY) {
        if (!b.inSlotZone) { b.inSlotZone = true; b.committedAt = this.time; }
        b.slot = board.slotIndexAt(b.x);
      }
      if (b.inSlotZone) {
        if (sp2 < settleSpeed2) b.restTime += dt; else b.restTime = 0;
        b.settled = b.restTime >= cfg.settleTime;
        b.stuckTime = 0;
      } else {
        b.settled = false;
        // Failsafe: a ball that makes no downward progress (resting on a
        // peg, rolling on a wall shelf, balanced on a roof peak) gets a
        // seeded sideways kick that grows with each repeat.
        if (b.y > b.progressY + cfg.stuckProgress) {
          b.progressY = b.y;
          b.stuckTime = 0;
        } else {
          b.stuckTime += dt;
          if (b.stuckTime >= cfg.stuckTimeout) {
            const grow = 1 + 0.5 * Math.min(b.nudges, 4);
            b.vx += this.rng.sign() * cfg.stuckNudge * grow * this.rng.range(0.6, 1.0);
            b.vy -= cfg.stuckNudge * 0.5;
            b.stuckTime = 0;
            b.progressY = b.y;
            b.nudges++;
          }
        }
      }
    }

    this.time += dt;
    this.stepCount++;
  }

  collideStatics(b) {
    const board = this.board;
    const pegs = board.pegs;
    // Pegs: only the three nearest rows and three nearest columns can touch.
    const fi = (b.y - board.rowY0) / board.rowSpacing;
    const i0 = Math.floor(fi + 0.5);
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      if (i < 0 || i >= board.pegRows) continue;
      const fj = b.x / board.pegSpacing + i / 2;
      const j0 = Math.floor(fj + 0.5);
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        if (j < 0 || j > i) continue;
        const p = pegs[(i * (i + 1)) / 2 + j];
        this.collideCircle(b, p.x, p.y, p.r, b.e);
      }
    }
    const circles = this.circles;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const e = c.e === undefined ? b.e : Math.min(b.e, c.e);
      this.collideCircle(b, c.x, c.y, c.r, e);
    }
    const segs = this.segments;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (b.y + b.r < s.minY || b.y - b.r > s.maxY) continue;
      if (b.x + b.r < s.minX || b.x - b.r > s.maxX) continue;
      this.collideSegment(b, s);
    }
  }

  collideSegment(b, s) {
    const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
    let t = ((b.x - s.x1) * ex + (b.y - s.y1) * ey) / s.len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = s.x1 + ex * t;
    const py = s.y1 + ey * t;
    const e = s.e === undefined ? b.e : Math.min(b.e, s.e);
    return this.collideCircle(b, px, py, s.thickness, e);
  }

  collideCircle(b, cx, cy, cr, e) {
    const dx = b.x - cx, dy = b.y - cy;
    const rs = b.r + cr;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rs * rs) return false;
    let nx, ny, d;
    if (d2 > 1e-12) {
      d = Math.sqrt(d2);
      nx = dx / d; ny = dy / d;
    } else {
      d = 0; nx = 0; ny = -1;
    }
    const pen = rs - d;
    b.x += nx * pen;
    b.y += ny * pen;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      // Impact friction: a real hit scrubs a fraction of the tangential
      // speed. Resting and sliding contacts (tiny normal speed) get none, so
      // balls are never glued to walls or the floor.
      let tx = b.vx - vn * nx, ty = b.vy - vn * ny;
      if (-vn > this.cfg.frictionMinImpact) {
        const f = 1 - this.cfg.friction;
        tx *= f; ty *= f;
      }
      b.vx = tx - e * vn * nx;
      b.vy = ty - e * vn * ny;
      b.hits++;
    }
    return true;
  }

  collideBalls() {
    const balls = this.balls;
    const n = balls.length;
    for (let i = 0; i < n; i++) {
      const a = balls[i];
      if (a.removed) continue;
      for (let j = i + 1; j < n; j++) {
        const c = balls[j];
        if (c.removed) continue;
        const dx = c.x - a.x, dy = c.y - a.y;
        const rs = a.r + c.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rs * rs) continue;
        let d, nx, ny;
        if (d2 > 1e-12) {
          d = Math.sqrt(d2);
          nx = dx / d; ny = dy / d;
        } else {
          d = 0; nx = 1; ny = 0;
        }
        const half = (rs - d) * 0.5;
        a.x -= nx * half; a.y -= ny * half;
        c.x += nx * half; c.y += ny * half;
        const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (vn >= 0) continue;
        const e = (a.e + c.e) * 0.5;
        const jimp = -(1 + e) * vn * 0.5; // equal masses
        a.vx -= jimp * nx; a.vy -= jimp * ny;
        c.vx += jimp * nx; c.vy += jimp * ny;
        a.hits++; c.hits++;
      }
    }
  }

  activeBalls() { return this.balls.filter((b) => !b.removed); }
}
