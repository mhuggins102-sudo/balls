// The bag: a draw pool and a discard pile of ball instances ({ id, type }).

export class Bag {
  constructor({ pool = [], discard = [], nextId = 1 } = {}) {
    this.pool = pool.map((b) => ({ ...b }));
    this.discard = discard.map((b) => ({ ...b }));
    this.nextId = nextId;
  }

  static starting(cfg) {
    const bag = new Bag();
    for (const [type, count] of Object.entries(cfg.startingBag)) {
      for (let i = 0; i < count; i++) bag.pool.push(bag.makeBall(type));
    }
    return bag;
  }

  static fromJSON(json) { return new Bag(json); }
  toJSON() { return { pool: this.pool.map((b) => ({ ...b })), discard: this.discard.map((b) => ({ ...b })), nextId: this.nextId }; }

  makeBall(type) { return { id: this.nextId++, type }; }

  get size() { return this.pool.length + this.discard.length; }

  all() { return [...this.pool, ...this.discard]; }

  counts() {
    const tally = (list) => list.reduce((acc, b) => { acc[b.type] = (acc[b.type] || 0) + 1; return acc; }, {});
    return { pool: tally(this.pool), discard: tally(this.discard), total: tally(this.all()) };
  }

  /**
   * Draw n balls at random from the pool. When the pool runs short, take what
   * remains, return the discard pile to the pool, and finish the draw.
   */
  draw(rng, n) {
    const hand = [];
    const take = () => {
      const i = rng.int(this.pool.length);
      hand.push(this.pool.splice(i, 1)[0]);
    };
    while (hand.length < n && this.pool.length) take();
    if (hand.length < n && this.discard.length) {
      this.pool.push(...this.discard);
      this.discard = [];
      while (hand.length < n && this.pool.length) take();
    }
    return hand;
  }

  discardAll(balls) { for (const b of balls) this.discard.push({ ...b }); }

  /** Bought balls enter the discard pile. */
  add(type) {
    const b = this.makeBall(type);
    this.discard.push(b);
    return b;
  }

  find(id) { return this.all().find((b) => b.id === id) || null; }

  remove(id) {
    for (const list of [this.pool, this.discard]) {
      const i = list.findIndex((b) => b.id === id);
      if (i >= 0) return list.splice(i, 1)[0];
    }
    return null;
  }
}
