import * as PIXI from './pixi.js';
import { G } from './state.js';
import { Pool, TAU, rand, randInt } from './util.js';
import { gainXp, grantLevels, heal, addGold } from './progress.js';
import { burst, shake, shockwave } from './fx.js';
import { sfx } from './audio.js';

/** XP gems and the occasional heart / chest / magnet drop. */

const GEM_CAP = 700;       // beyond this, new gem value is merged into a nearby gem
const MERGE_SAMPLES = 8;   // sampled linear scan instead of a full nearest search

// Gem tiers read apart by colour and size alone, which is how you tell at a
// glance whether that pile across the screen is worth walking into.
// Sizes are in pixels, not texture-scale factors: the art can then be redrawn
// at any resolution without silently resizing every gem in the game.
const TIERS = [
  { min: 0,   tint: 0x4d9dff, px: 13 },
  { min: 6,   tint: 0x5ce8a8, px: 16 },
  { min: 30,  tint: 0xffd34d, px: 20 },
  { min: 150, tint: 0xff6ad5, px: 25 },
];
const GEM_ASPECT = 58 / 44;

function tierFor(value) {
  let t = TIERS[0];
  for (const c of TIERS) if (value >= c.min) t = c;
  return t;
}

const DROPS = {
  // green rather than the conventional red: a heart is a small, bright,
  // round thing on the field, which is exactly what an incoming shot is
  heart:  { tint: 0x4ce87a, px: 30 },
  chest:  { tint: 0xffc861, px: 42 },
  magnet: { tint: 0x8f7bff, px: 32 },
};

export function initPickups() {
  G.gems = new Pool(() => {
    const s = new PIXI.Sprite(G.tex.shard);
    s.anchor.set(0.5);
    s.visible = false;
    G.layers.gems.addChild(s);
    const glow = new PIXI.Sprite(G.tex.glow);
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.visible = false;
    G.layers.gems.addChild(glow);
    return { alive: false, s, glow, x: 0, y: 0, vx: 0, vy: 0, value: 1, magnet: false, bob: 0 };
  }, 400);

  G.drops = new Pool(() => {
    const s = new PIXI.Sprite(G.tex.blob);
    s.anchor.set(0.5);
    s.visible = false;
    G.layers.gems.addChild(s);
    const glow = new PIXI.Sprite(G.tex.glow);
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.visible = false;
    G.layers.gems.addChild(glow);
    return { alive: false, s, glow, x: 0, y: 0, kind: 'heart', bob: 0 };
  }, 24);
}

export function clearPickups() {
  G.gems.clear((g) => { g.s.visible = false; g.glow.visible = false; });
  G.drops.clear((d) => { d.s.visible = false; d.glow.visible = false; });
}

function styleGem(g) {
  const t = tierFor(g.value);
  g.s.tint = t.tint;
  g.s.width = t.px;
  g.s.height = t.px * GEM_ASPECT;
  g.glow.tint = t.tint;
  g.glow.width = g.glow.height = t.px * 2.1;
  g.glow.alpha = 0.5;
}

export function spawnGem(x, y, value) {
  // Keep the gem count bounded during late-run kill storms by folding value
  // into an existing nearby gem rather than adding another entity.
  if (G.gems.count >= GEM_CAP) {
    const act = G.gems.active;
    let best = null, bestD = Infinity;
    for (let i = 0; i < MERGE_SAMPLES; i++) {
      const c = act[(Math.random() * act.length) | 0];
      if (!c) continue;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) { best.value += value; styleGem(best); return; }
  }

  const g = G.gems.spawn();
  g.x = x + rand(-7, 7);
  g.y = y + rand(-7, 7);
  // small pop outward so a pile of drops spreads instead of stacking on one pixel
  const a = rand(0, TAU), sp = rand(18, 60);
  g.vx = Math.cos(a) * sp;
  g.vy = Math.sin(a) * sp;
  g.value = value;
  g.magnet = false;
  g.bob = rand(0, TAU);
  styleGem(g);
  g.s.visible = true;
  g.glow.visible = true;
}

export function spawnDrop(x, y, kind) {
  const d = G.drops.spawn();
  const def = DROPS[kind];
  d.x = x; d.y = y;
  d.kind = kind;
  d.bob = rand(0, TAU);
  d.s.tint = def.tint;
  d.s.width = d.s.height = def.px;
  d.s.visible = true;
  d.glow.tint = def.tint;
  d.glow.width = d.glow.height = def.px * 2.2;
  d.glow.alpha = 0.6;
  d.glow.visible = true;
}

/** Rolls what a dying enemy leaves behind. */
export function rollDrop(x, y, xpValue, isBoss) {
  spawnGem(x, y, xpValue);
  if (isBoss) {
    spawnDrop(x, y, 'chest');
    return;
  }
  const r = Math.random();
  if (r < 0.006) spawnDrop(x, y, 'heart');
  else if (r < 0.009) spawnDrop(x, y, 'magnet');
}

function collectGem(g) {
  sfx.pickup();
  gainXp(g.value);
  g.alive = false;
}

function collectDrop(d) {
  const p = G.player;
  if (d.kind === 'heart') {
    heal(p.stats.maxHp * 0.25);
  } else if (d.kind === 'chest') {
    sfx.chest();
    grantLevels(randInt(1, 3));
    addGold(40);
    shockwave(d.x, d.y, 10, 160, 0.5, 0xffc861);
    shake(8);
  } else if (d.kind === 'magnet') {
    for (const g of G.gems.active) g.magnet = true;
    shockwave(p.x, p.y, 10, 520, 0.55, 0x8f7bff);
  }
  burst(d.x, d.y, DROPS[d.kind].tint, 18, 220, 0.8);
  d.alive = false;
}

export function updatePickups(dt) {
  const p = G.player;
  const pickR = p.stats.pickup;
  const pickR2 = pickR * pickR;
  const grabR2 = (p.radius + 10) ** 2;

  for (const g of G.gems.active) {
    const dx = p.x - g.x, dy = p.y - g.y;
    const d2 = dx * dx + dy * dy;

    if (!g.magnet && d2 < pickR2) g.magnet = true;

    if (g.magnet) {
      const d = Math.sqrt(d2) || 1;
      // accelerate hard as it closes, so pickup feels like a vacuum rather than a drift
      const accel = 900 + 2600 / d;
      g.vx += (dx / d) * accel * dt;
      g.vy += (dy / d) * accel * dt;
      g.vx *= 1 - 3.2 * dt;
      g.vy *= 1 - 3.2 * dt;
      if (d2 < grabR2) { collectGem(g); continue; }
    } else {
      g.vx *= 1 - 5 * dt;
      g.vy *= 1 - 5 * dt;
    }

    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.bob += dt * 3;

    g.s.x = g.x;
    g.s.y = g.y + Math.sin(g.bob) * 1.8;
    g.s.rotation = Math.sin(g.bob * 0.5) * 0.25;
    g.glow.x = g.s.x;
    g.glow.y = g.s.y;
    g.glow.alpha = 0.4 + Math.sin(g.bob) * 0.15;
  }
  G.gems.sweep((g) => { g.s.visible = false; g.glow.visible = false; });

  for (const d of G.drops.active) {
    const dx = p.x - d.x, dy = p.y - d.y;
    if (dx * dx + dy * dy < grabR2 + 200) { collectDrop(d); continue; }
    d.bob += dt * 2.5;
    d.s.x = d.x;
    d.s.y = d.y + Math.sin(d.bob) * 3;
    d.s.rotation = Math.sin(d.bob * 0.7) * 0.2;
    d.glow.x = d.s.x;
    d.glow.y = d.s.y;
    d.glow.alpha = 0.45 + Math.sin(d.bob * 1.4) * 0.2;
  }
  G.drops.sweep((d) => { d.s.visible = false; d.glow.visible = false; });
}
