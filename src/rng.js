// Seeded PRNG (sfc32) plus seed derivation. Only integer arithmetic and
// divisions by powers of two are used, so sequences are identical in every
// JavaScript engine (browser or Node).

function mix32(x) {
  x |= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function hashString(str) {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

// Derive a sub-seed from a seed and any number of labels (strings or ints).
export function deriveSeed(seed, ...parts) {
  let h = mix32(seed >>> 0);
  for (const p of parts) {
    const v = typeof p === 'string' ? hashString(p) : (p >>> 0);
    h = mix32((h ^ v) + 0x9e3779b9 | 0);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    if (Array.isArray(seed)) {
      this.a = seed[0] | 0; this.b = seed[1] | 0; this.c = seed[2] | 0; this.d = seed[3] | 0;
      return;
    }
    let s = (seed >>> 0) | 0;
    const next = () => { s = s + 0x9e3779b9 | 0; return mix32(s) | 0; };
    this.a = next(); this.b = next(); this.c = next(); this.d = next();
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  static fromState(state) { return new Rng(state); }
  getState() { return [this.a, this.b, this.c, this.d]; }

  nextU32() {
    const t = ((this.a + this.b) | 0) + this.d | 0;
    this.d = this.d + 1 | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = this.c + (this.c << 3) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = this.c + t | 0;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next() { return this.nextU32() / 4294967296; }
  range(lo, hi) { return lo + (hi - lo) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** entries: [[value, weight], ...] */
  weighted(entries) {
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.next() * total;
    for (const e of entries) {
      r -= e[1];
      if (r < 0) return e[0];
    }
    return entries[entries.length - 1][0];
  }

  /** A new independent generator derived from this one and the labels. */
  derive(...parts) { return new Rng(deriveSeed(this.nextU32(), ...parts)); }
}

/** Non-deterministic seed for a fresh run. */
export function randomSeed() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}

export function seedToString(seed) {
  return (seed >>> 0).toString(16).padStart(8, '0');
}

/** Accepts the 8-hex-digit form shown on the end screen, or any text. */
export function parseSeed(str) {
  const s = String(str).trim();
  if (/^[0-9a-fA-F]{1,8}$/.test(s)) return parseInt(s, 16) >>> 0;
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  return hashString(s);
}
