import * as PIXI from './pixi.js';
import { G, offscreen } from './state.js';
import { Pool, TAU, rand } from './util.js';

/** Visual-only systems: damage numbers, particles, transient sprites, screen shake. */

const MAX_FLOATER_DIGITS = 5;

export function initFx() {
  // Floating damage numbers.
  // Built from pre-rendered digit textures rather than PIXI.Text: changing a
  // Text object's string re-rasterises it, which at hundreds of kills per
  // second is a real cost. Digit sprites just get repositioned, and they batch
  // with every other sprite in the scene.
  G.floaters = new Pool(() => {
    const c = new PIXI.Container();
    const digits = [];
    for (let i = 0; i < MAX_FLOATER_DIGITS; i++) {
      const s = new PIXI.Sprite(G.tex.digits[0]);
      s.anchor.set(0.5);
      s.visible = false;
      c.addChild(s);
      digits.push(s);
    }
    c.visible = false;
    G.layers.fx.addChild(c);
    return { alive: false, c, digits, x: 0, y: 0, vy: 0, life: 0, maxLife: 0, scale: 1 };
  }, 48);

  // Impact particles.
  G.particles = new Pool(() => {
    const s = new PIXI.Sprite(G.tex.spark);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.visible = false;
    G.layers.fx.addChild(s);
    return { alive: false, s, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 1, drag: 0 };
  }, 220);

  // Transient sprites: nova rings, melee arcs, lightning segments.
  G.effects = new Pool(() => {
    const s = new PIXI.Sprite(G.tex.ring);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.visible = false;
    G.layers.fx.addChild(s);
    return {
      alive: false, s, x: 0, y: 0, life: 0, maxLife: 0,
      from: 0, to: 0, rot: 0, spin: 0, alpha: 1, follow: false, segment: false,
    };
  }, 64);
}

export function clearFx() {
  G.floaters.clear((f) => { f.c.visible = false; });
  G.particles.clear((p) => { p.s.visible = false; });
  G.effects.clear((e) => { e.s.visible = false; e.segment = false; });
  G.shake = 0;
}

export function damageNumber(x, y, value, color = 0xffffff, big = false) {
  if (offscreen(x, y, 40)) return;     // no point paying for text nobody sees
  if (G.floaters.count > 40) return;   // hard cap during late-run kill storms

  const v = Math.max(1, Math.round(value));
  const str = v >= 100000 ? '99999' : String(v);
  const f = G.floaters.spawn();
  f.x = x + rand(-5, 5);
  f.y = y - 6;
  f.vy = big ? -62 : -46;
  f.maxLife = f.life = big ? 0.85 : 0.6;
  f.scale = big ? 0.92 : 0.62;

  const n = Math.min(str.length, MAX_FLOATER_DIGITS);
  const glyphW = 13 * f.scale;
  for (let i = 0; i < MAX_FLOATER_DIGITS; i++) {
    const s = f.digits[i];
    if (i < n) {
      s.texture = G.tex.digits[str.charCodeAt(i) - 48];
      s.visible = true;
      s.tint = color;
      s.scale.set(f.scale);
      s.x = (i - (n - 1) / 2) * glyphW;
      s.y = 0;
    } else {
      s.visible = false;
    }
  }
  f.c.visible = true;
  f.c.alpha = 1;
}

export function burst(x, y, color, count = 6, speed = 150, size = 0.55) {
  if (offscreen(x, y, 30)) return;
  for (let i = 0; i < count; i++) {
    if (G.particles.count > 400) return;
    const p = G.particles.spawn();
    const a = rand(0, TAU);
    const sp = rand(speed * 0.4, speed);
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * sp;
    p.vy = Math.sin(a) * sp;
    p.maxLife = p.life = rand(0.18, 0.42);
    p.size = size * rand(0.7, 1.35);
    p.drag = 4.5;
    p.s.tint = color;
    p.s.visible = true;
  }
}

/** Expanding shockwave. `follow` pins it to the player, which Nova uses. */
export function shockwave(x, y, from, to, life, color, follow = false) {
  const e = G.effects.spawn();
  e.s.texture = G.tex.ring;
  e.x = x; e.y = y;
  e.from = from; e.to = to;
  e.maxLife = e.life = life;
  e.rot = 0; e.spin = 0;
  e.alpha = 0.85;
  e.follow = follow;
  e.segment = false;
  e.s.tint = color;
  e.s.visible = true;
  return e;
}

/** One melee swing: a crescent that flares outward and fades. */
export function sweep(x, y, angle, radius, life, color) {
  const e = G.effects.spawn();
  e.s.texture = G.tex.arc;
  e.x = x; e.y = y;
  e.from = radius * 0.72; e.to = radius;
  e.maxLife = e.life = life;
  e.rot = angle; e.spin = 0;
  e.alpha = 0.8;
  e.follow = false;
  e.segment = false;
  e.s.tint = color;
  e.s.visible = true;
  return e;
}

/** Draws a polyline as stretched capsule sprites: cheap, and it batches. */
export function lightning(points, color, life = 0.16) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const e = G.effects.spawn();
    e.s.texture = G.tex.capsule;
    e.x = (a.x + b.x) / 2;
    e.y = (a.y + b.y) / 2;
    e.rot = Math.atan2(dy, dx);
    e.spin = 0;
    e.maxLife = e.life = life;
    e.from = len; e.to = len;   // segments hold their length and just fade out
    e.alpha = 1;
    e.follow = false;
    e.segment = true;
    e.s.tint = color;
    e.s.visible = true;
  }
}

export function shake(amount) {
  G.shake = Math.min(26, G.shake + amount);
}

export function updateFx(dt) {
  for (const f of G.floaters.active) {
    f.life -= dt;
    if (f.life <= 0) { f.alive = false; continue; }
    f.vy += 52 * dt;                 // slight gravity so they arc instead of sliding
    f.y += f.vy * dt;
    f.c.x = f.x; f.c.y = f.y;
    const k = f.life / f.maxLife;
    f.c.alpha = k > 0.55 ? 1 : k / 0.55;
  }
  G.floaters.sweep((f) => { f.c.visible = false; });

  for (const p of G.particles.active) {
    p.life -= dt;
    if (p.life <= 0) { p.alive = false; continue; }
    const d = 1 - p.drag * dt;
    p.vx *= d; p.vy *= d;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const k = p.life / p.maxLife;
    p.s.x = p.x; p.s.y = p.y;
    p.s.alpha = k;
    p.s.scale.set(p.size * (0.35 + k * 0.85));
  }
  G.particles.sweep((p) => { p.s.visible = false; });

  for (const e of G.effects.active) {
    e.life -= dt;
    if (e.life <= 0) { e.alive = false; continue; }
    const k = 1 - e.life / e.maxLife;          // 0 at spawn, 1 at expiry
    if (e.follow) { e.x = G.player.x; e.y = G.player.y; }
    e.s.x = e.x; e.s.y = e.y;
    e.s.rotation = e.rot;
    e.rot += e.spin * dt;

    if (e.segment) {
      e.s.width = e.from;
      e.s.height = 7 * (1 - k) + 2;
      e.s.alpha = e.alpha * (1 - k);
    } else {
      const size = e.from + (e.to - e.from) * k;
      e.s.width = e.s.height = size * 2;
      e.s.alpha = e.alpha * (1 - k * k);       // stays bright, then drops off fast
    }
  }
  G.effects.sweep((e) => { e.s.visible = false; e.segment = false; });

  if (G.shake > 0) G.shake = Math.max(0, G.shake - G.shake * 9 * dt - 8 * dt);
}
