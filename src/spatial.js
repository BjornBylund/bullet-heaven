/**
 * Uniform spatial hash. Rebuilt from scratch every frame — clearing and
 * re-inserting N entities is cheaper than incrementally maintaining buckets
 * when essentially every entity moves every frame.
 *
 * Bucket arrays are retained between frames (length reset to 0 instead of
 * dropping the Map) so steady-state frames allocate nothing.
 */
export class Grid {
  constructor(cellSize) {
    this.cell = cellSize;
    this.map = new Map();
    this.used = [];
  }

  // cx * PRIME + cy is collision-free while |cy| stays well under the prime,
  // which holds for any world position a 20-minute run can reach.
  static key(cx, cy) { return cx * 40961 + cy; }

  clear() {
    for (let i = 0; i < this.used.length; i++) this.used[i].length = 0;
    this.used.length = 0;
  }

  insert(e) {
    const c = this.cell;
    const k = Grid.key(Math.floor(e.x / c), Math.floor(e.y / c));
    let b = this.map.get(k);
    if (b === undefined) { b = []; this.map.set(k, b); }
    if (b.length === 0) this.used.push(b);
    b.push(e);
  }

  /** Collects every entity in cells overlapping the circle into `out` (reused, never allocated). */
  query(x, y, r, out) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = this.map.get(Grid.key(cx, cy));
        if (b !== undefined) for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }

  /** Nearest live entity to a point, or null. Expands ring by ring so we stop early. */
  nearest(x, y, maxR, scratch, reject) {
    const c = this.cell;
    const maxRings = Math.ceil(maxR / c);
    const ccx = Math.floor(x / c), ccy = Math.floor(y / c);
    let best = null, bestD = maxR * maxR, foundRing = -1;

    for (let ring = 0; ring <= maxRings; ring++) {
      // A hit found in ring N can still be beaten from ring N+1, but no further,
      // so we always scan exactly one ring past the first success.
      if (foundRing >= 0 && ring > foundRing + 1) break;
      for (let cx = ccx - ring; cx <= ccx + ring; cx++) {
        for (let cy = ccy - ring; cy <= ccy + ring; cy++) {
          // only the shell of this ring; inner cells were covered already
          if (ring > 0 && Math.abs(cx - ccx) !== ring && Math.abs(cy - ccy) !== ring) continue;
          const b = this.map.get(Grid.key(cx, cy));
          if (b === undefined) continue;
          for (let i = 0; i < b.length; i++) {
            const e = b[i];
            if (reject !== undefined && reject(e)) continue;
            const dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = e; if (foundRing < 0) foundRing = ring; }
          }
        }
      }
    }
    return best;
  }
}
