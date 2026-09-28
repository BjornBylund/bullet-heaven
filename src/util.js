export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => (min + Math.random() * (max - min + 1)) | 0;
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/** Angle-preserving normalize. Returns length so callers can skip a second sqrt. */
export function norm(x, y) {
  const d = Math.hypot(x, y);
  return d > 1e-6 ? [x / d, y / d, d] : [0, 0, 0];
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Object pool over a dense active array. Nothing is allocated after warmup:
 * spawn() reuses a freed object, and sweep() swap-removes dead entries so the
 * active array stays contiguous for cache-friendly iteration.
 */
export class Pool {
  constructor(factory, warm = 0) {
    this.factory = factory;
    this.free = [];
    this.active = [];
    for (let i = 0; i < warm; i++) this.free.push(factory());
  }
  spawn() {
    const o = this.free.length ? this.free.pop() : this.factory();
    o.alive = true;
    this.active.push(o);
    return o;
  }
  /** Iterate backwards so swap-removal never skips an element. */
  sweep(onFree) {
    const a = this.active;
    for (let i = a.length - 1; i >= 0; i--) {
      if (a[i].alive) continue;
      const o = a[i];
      a[i] = a[a.length - 1];
      a.pop();
      if (onFree) onFree(o);
      this.free.push(o);
    }
  }
  clear(onFree) {
    for (const o of this.active) { o.alive = false; if (onFree) onFree(o); this.free.push(o); }
    this.active.length = 0;
  }
  get count() { return this.active.length; }
}
