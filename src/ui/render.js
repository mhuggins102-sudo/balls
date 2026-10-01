// Canvas renderer for the board. Flat shapes, clear colours.

import { BALL_TYPES } from '../balls.js';
import { roofSegments } from '../drop.js';

const C = {
  bg: '#0f1320',
  board: '#1a2033',
  wall: '#4a557a',
  peg: '#aab3cc',
  pegEdge: '#6c7799',
  divider: '#4a557a',
  slot: '#131829',
  slotText: '#e8ecf5',
  slotMuted: '#9aa5c4',
  highlight: 'rgba(255, 214, 90, 0.20)',
  highlightEdge: '#ffd65a',
  perkSlot: 'rgba(184, 135, 255, 0.28)',
  perkEdge: '#b887ff',
  doubled: '#7df0a8',
  blocked: '#ff7b7b',
  perkWall: '#ff9f43',
  target: 'rgba(255,255,255,0.9)',
  spawn: '#5b8cff',
};

export class Renderer {
  constructor(canvas, board, cfg) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.board = board;
    this.cfg = cfg;
    this.dpr = 1;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.cssW = 0;
    this.cssH = 0;
    this.resize();
  }

  setBoard(board, cfg) { this.board = board; this.cfg = cfg; this.computeTransform(); }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.dpr = dpr;
    this.computeTransform();
  }

  computeTransform() {
    const b = this.board.bounds;
    const pad = 0.35;
    const w = b.maxX - b.minX + 2 * pad;
    const h = b.maxY - b.minY + 2 * pad;
    this.scale = Math.min(this.cssW / w, this.cssH / h);
    this.ox = this.cssW / 2;
    this.oy = (this.cssH - h * this.scale) / 2 + pad * this.scale;
  }

  toScreen(x, y) { return [this.ox + x * this.scale, this.oy + y * this.scale]; }
  toWorld(sx, sy) { return [(sx - this.ox) / this.scale, (sy - this.oy) / this.scale]; }

  /**
   * scene: { layout, mods, bodies, shapes, targets, phase }
   *   targets: { kind: 'gap' | 'slot' | 'ball', items: [...] } | null
   */
  draw(scene) {
    const ctx = this.ctx;
    const { board, cfg, scale } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const P = (x, y) => this.toScreen(x, y);
    const hw = board.halfWidth;

    // Board body.
    ctx.beginPath();
    let p = P(0, 0); ctx.moveTo(p[0], p[1]);
    p = P(hw, board.lastRowY); ctx.lineTo(p[0], p[1]);
    p = P(hw, board.floorY); ctx.lineTo(p[0], p[1]);
    p = P(-hw, board.floorY); ctx.lineTo(p[0], p[1]);
    p = P(-hw, board.lastRowY); ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fillStyle = C.board;
    ctx.fill();

    // Slots.
    const layout = scene.layout;
    const mods = scene.mods || { walls: [], blocked: [], doubled: [] };
    const slotTop = board.slotTopY;
    const fontPx = Math.max(10, Math.min(22, board.slotWidth * scale * 0.42));
    for (let i = 0; i < board.slotCount; i++) {
      const xl = board.slotLeftX(i);
      const [sx, sy] = P(xl, slotTop);
      const w = board.slotWidth * scale;
      const h = (board.floorY - slotTop) * scale;
      ctx.fillStyle = C.slot;
      ctx.fillRect(sx + 1, sy, w - 2, h);
      if (!layout) continue;
      const highlighted = layout.highlighted.includes(i);
      const isPerk = layout.perkSlot === i;
      if (highlighted) {
        ctx.fillStyle = C.highlight;
        ctx.fillRect(sx + 1, sy, w - 2, h);
      }
      if (isPerk) {
        ctx.fillStyle = C.perkSlot;
        ctx.fillRect(sx + 1, sy, w - 2, h);
      }
      // Value text.
      const cx = sx + w / 2;
      const baseY = sy + h - fontPx * 0.9;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (isPerk) {
        ctx.fillStyle = C.perkEdge;
        ctx.font = `700 ${Math.round(fontPx * 0.72)}px system-ui, sans-serif`;
        ctx.fillText('PERK', cx, baseY);
      } else {
        const doubles = mods.doubled.filter((d) => d === i).length;
        const value = layout.values[i] * Math.pow(2, doubles);
        ctx.fillStyle = doubles ? C.doubled : C.slotText;
        ctx.font = `700 ${Math.round(fontPx)}px system-ui, sans-serif`;
        ctx.fillText(`$${value}`, cx, baseY);
        if (doubles) {
          ctx.font = `700 ${Math.round(fontPx * 0.7)}px system-ui, sans-serif`;
          ctx.fillText(`×${Math.pow(2, doubles)}`, cx, baseY - fontPx * 1.05);
        }
      }
      if (highlighted) {
        ctx.fillStyle = C.highlightEdge;
        ctx.font = `${Math.round(fontPx * 0.8)}px system-ui, sans-serif`;
        ctx.fillText('★', cx, sy + fontPx * 0.9);
      }
    }

    // Dividers and caps.
    ctx.strokeStyle = C.divider;
    ctx.lineWidth = Math.max(2, cfg.dividerCapRadius * 2 * scale);
    ctx.lineCap = 'round';
    for (const d of board.dividers) {
      const a = P(d.x1, d.y1), b = P(d.x2, d.y2);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    // Walls.
    ctx.strokeStyle = C.wall;
    ctx.lineWidth = Math.max(2, 0.08 * scale);
    for (const s of board.segments) {
      if (s.kind !== 'wall' && s.kind !== 'floor') continue;
      const a = P(s.x1, s.y1), b = P(s.x2, s.y2);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    // Pegs (field and wall bumps).
    ctx.fillStyle = C.peg;
    ctx.strokeStyle = C.pegEdge;
    ctx.lineWidth = 1;
    for (const peg of board.pegs) {
      const [x, y] = P(peg.x, peg.y);
      ctx.beginPath(); ctx.arc(x, y, peg.r * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const wp of board.wallPegs) {
      const [x, y] = P(wp.x, wp.y);
      ctx.beginPath(); ctx.arc(x, y, wp.r * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // Perk shapes: walls and roofs.
    ctx.strokeStyle = C.perkWall;
    ctx.lineWidth = Math.max(3, cfg.perkWallThickness * 2 * scale);
    ctx.lineCap = 'round';
    for (const w of mods.walls) {
      const a = board.pegAt(w.row, w.gap), b = board.pegAt(w.row, w.gap + 1);
      if (!a || !b) continue;
      const pa = P(a.x, a.y), pb = P(b.x, b.y);
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    }
    ctx.strokeStyle = C.blocked;
    ctx.lineWidth = Math.max(3, cfg.dividerCapRadius * 1.2 * scale);
    for (const slot of mods.blocked) {
      ctx.beginPath();
      roofSegments(board, cfg, slot).forEach(([x1, y1, x2, y2], i) => {
        const a = P(x1, y1), b = P(x2, y2);
        if (i === 0) ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      });
      ctx.stroke();
    }

    // Spawn marker.
    {
      const [x, y] = P(board.spawn.x, board.spawn.y - cfg.ballRadius * 1.6);
      ctx.fillStyle = C.spawn;
      ctx.beginPath();
      ctx.moveTo(x, y + 6); ctx.lineTo(x - 6, y - 4); ctx.lineTo(x + 6, y - 4); ctx.closePath();
      ctx.fill();
    }

    // Balls.
    const bodies = scene.bodies || [];
    for (const b of bodies) {
      if (!b || b.removed) continue;
      const [x, y] = P(b.x, b.y);
      const r = b.r * scale;
      const type = BALL_TYPES[b.ref.type] || BALL_TYPES.white;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = type.color; ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
      if (b.ref.type === 'bouncy') {
        ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = Math.max(1, r * 0.22); ctx.stroke();
      } else if (b.ref.type === 'gold') {
        ctx.fillStyle = 'rgba(120, 80, 0, 0.55)';
        ctx.font = `700 ${Math.round(r * 1.2)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('×3', x, y + r * 0.05);
      } else if (b.ref.type === 'green') {
        ctx.fillStyle = 'rgba(0, 60, 20, 0.6)';
        ctx.font = `700 ${Math.round(r * 1.3)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('+', x, y + r * 0.05);
      }
    }

    // Placement targets.
    const targets = scene.targets;
    if (targets) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = C.target;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      if (targets.kind === 'gap') {
        for (const g of board.gaps) {
          const [x, y] = P(g.x, g.y);
          const r = 0.3 * scale;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x + r * 0.5, y); ctx.stroke();
          ctx.setLineDash([5, 4]);
        }
      } else if (targets.kind === 'slot') {
        for (let i = 0; i < board.slotCount; i++) {
          if (targets.exclude && targets.exclude.includes(i)) continue;
          const [sx, sy] = P(board.slotLeftX(i), slotTop);
          const w = board.slotWidth * scale, h = (board.floorY - slotTop) * scale;
          ctx.strokeRect(sx + 3, sy + 3, w - 6, h - 6);
        }
      } else if (targets.kind === 'ball') {
        for (const b of bodies) {
          if (!b || b.removed) continue;
          const [x, y] = P(b.x, b.y);
          ctx.beginPath(); ctx.arc(x, y, b.r * scale + 5, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
  }

  /** Nearest wall gap to a screen point, within a touch radius. */
  gapAt(sx, sy) {
    const [x, y] = this.toWorld(sx, sy);
    let best = null, bestD = Infinity;
    for (const g of this.board.gaps) {
      const d = Math.hypot(g.x - x, g.y - y);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best && bestD <= 0.5 ? best : null;
  }

  slotAt(sx, sy) {
    const [x, y] = this.toWorld(sx, sy);
    if (y < this.board.lastRowY) return -1;
    return this.board.slotIndexAt(x);
  }

  bodyAt(sx, sy, bodies) {
    const [x, y] = this.toWorld(sx, sy);
    let best = null, bestD = Infinity;
    for (const b of bodies) {
      if (!b || b.removed) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best && bestD <= Math.max(0.45, best.r * 2) ? best : null;
  }
}
