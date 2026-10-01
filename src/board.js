// Static board geometry derived from the config. Pure arithmetic, no DOM.
//
// Coordinates: x grows to the right, y grows DOWN. The triangle apex is at
// (0, 0). Peg row i sits at y = (i + 2) * rowSpacing so that the diagonal
// side walls, which pass through "virtual pegs" one spacing outside each
// row's outermost peg, meet exactly at the apex.

export function buildBoard(cfg) {
  const s = cfg.pegSpacing;
  const rs = cfg.rowSpacing;
  const n = cfg.pegRows;
  const k = cfg.slots;

  const rowY = (i) => (i + 2) * rs;

  const pegs = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      pegs.push({ x: (j - i / 2) * s, y: rowY(i), r: cfg.pegRadius, row: i, col: j });
    }
  }

  const lastRowY = rowY(n - 1);
  const halfWidth = ((n + 1) * s) / 2;       // wall x at the last peg row (one virtual peg out)
  const slotTopY = lastRowY + rs;            // divider cap height, one row below the last pegs
  const floorY = slotTopY + cfg.slotDepth;
  const slotWidth = (2 * halfWidth) / k;
  const spawn = { x: 0, y: cfg.dropDepth };
  const commitY = slotTopY + cfg.dividerCapRadius + cfg.ballRadius + 0.05;

  const segments = [];
  const circles = [];
  const seg = (x1, y1, x2, y2, opts = {}) => {
    const o = makeSegment(x1, y1, x2, y2, opts);
    segments.push(o);
    return o;
  };

  // Diagonal side walls: apex to the last peg row, passing through the
  // "virtual peg" one spacing outside each row's outermost peg.
  seg(0, 0, -halfWidth, lastRowY, { kind: 'wall' });
  seg(0, 0, halfWidth, lastRowY, { kind: 'wall' });
  // Vertical outer walls from the last peg row down to the floor.
  seg(-halfWidth, lastRowY, -halfWidth, floorY, { kind: 'wall' });
  seg(halfWidth, lastRowY, halfWidth, floorY, { kind: 'wall' });
  // Floor.
  seg(-halfWidth, floorY, halfWidth, floorY, { kind: 'floor', e: cfg.floorRestitution });
  // Bumps embedded in the side walls at every virtual peg position, so a
  // ball running down a wall is kicked back into the field instead of
  // sliding straight into the outer slot.
  const wallPegs = [];
  if (cfg.wallPegs) {
    for (let i = 0; i < n; i++) {
      const x = (i / 2 + 1) * s;
      const y = rowY(i);
      for (const sx of [-1, 1]) {
        const c = { x: sx * x, y, r: cfg.pegRadius, kind: 'wallpeg', row: i };
        circles.push(c);
        wallPegs.push(c);
      }
    }
  }
  // Dividers with rounded caps.
  const dividers = [];
  for (let i = 1; i < k; i++) {
    const x = -halfWidth + i * slotWidth;
    dividers.push(seg(x, slotTopY, x, floorY, { kind: 'divider', e: cfg.dividerRestitution }));
    circles.push({ x, y: slotTopY, r: cfg.dividerCapRadius, e: cfg.dividerRestitution, kind: 'cap' });
  }

  // Gaps between adjacent pegs in a row: the Wall perk's placement targets.
  const gaps = [];
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const a = pegs[pegIndex(i, j)];
      const b = pegs[pegIndex(i, j + 1)];
      gaps.push({ row: i, gap: j, x: (a.x + b.x) / 2, y: a.y });
    }
  }

  return {
    cfg,
    pegs,
    pegRows: n,
    slotCount: k,
    pegSpacing: s,
    rowSpacing: rs,
    rowY0: rowY(0),
    rowY,
    pegIndex,
    pegAt: (i, j) => pegs[pegIndex(i, j)],
    slotTopY,
    lastRowY,
    halfWidth,
    floorY,
    slotWidth,
    spawn,
    apex: { x: 0, y: 0 },
    commitY,
    segments,
    circles,
    dividers,
    wallPegs,
    gaps,
    bounds: { minX: -halfWidth, maxX: halfWidth, minY: 0, maxY: floorY },
    slotIndexAt(x) {
      const i = Math.floor((x + halfWidth) / slotWidth);
      return i < 0 ? 0 : i >= k ? k - 1 : i;
    },
    slotCenterX(i) { return -halfWidth + (i + 0.5) * slotWidth; },
    slotLeftX(i) { return -halfWidth + i * slotWidth; },
    findGap(row, gap) { return gaps.find((g) => g.row === row && g.gap === gap) || null; },
  };
}

export function pegIndex(i, j) { return (i * (i + 1)) / 2 + j; }

export function makeSegment(x1, y1, x2, y2, opts = {}) {
  const ex = x2 - x1, ey = y2 - y1;
  return {
    x1, y1, x2, y2,
    len2: ex * ex + ey * ey || 1e-12,
    thickness: opts.thickness || 0,
    e: opts.e,
    kind: opts.kind || 'segment',
    minX: Math.min(x1, x2) - (opts.thickness || 0),
    maxX: Math.max(x1, x2) + (opts.thickness || 0),
    minY: Math.min(y1, y2) - (opts.thickness || 0),
    maxY: Math.max(y1, y2) + (opts.thickness || 0),
  };
}
