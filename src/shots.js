import * as PIXI from './pixi.js';
import { G, offscreen } from './state.js';
import { CFG } from './config.js';
import { Pool } from './util.js';
import { damagePlayer } from './player.js';
import { burst } from './fx.js';

/**
 * Enemy projectiles.
 *
 * Separate from the spell entity pool because the collision target is the
 * opposite one: these only ever test against the player, so they need no
 * spatial query at all -- one distance check each.
 *
 * They are deliberately SLOW. The genre's only input is movement, so incoming
 * fire is the one threat that asks the player to read the field and reposition
 * rather than simply out-range the swarm. Fast bullets in a screen with 800
 * enemies are unreadable; slow ones you can weave through.
 *
 * Silhouette matters as much as speed here. Enemies are solid circles, so a
 * shot drawn as another solid circle vanishes into the crowd. These are a small
 * bright core inside a pulsing additive HALO RING -- a shape nothing else in
 * the game uses, so incoming fire is identifiable at a glance.
 */

const DESPAWN = 1400;

/**
 * THE RESERVED COLOUR.
 *
 * Red means exactly one thing in this game: a projectile that is about to hit
 * you. Nothing else on the field may use it -- not enemy bodies, not pickups,
 * not health bars, not any player spell. The channel is worth more spent on one
 * unambiguous signal than spread across a dozen decorative hues.
 *
 * Shooters are told apart by SIZE and by the silhouette that fired them, never
 * by hue, so all three shades sit in a tight band. Splitting them further would
 * reintroduce exactly the ambiguity this exists to remove.
 */
export const HOSTILE = {
  light: 0xff7a6a,   // small, fast, cheap
  mid:   0xff4a3a,   // the default
  deep:  0xd8243f,   // big, slow, heavy -- reads as mass
};

export function initShots() {
  G.shots = new Pool(() => {
    const glow = new PIXI.Sprite(G.tex.ring);
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.visible = false;
    G.layers.shots.addChild(glow);

    const s = new PIXI.Sprite(G.tex.glow);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.visible = false;
    G.layers.shots.addChild(s);

    return {
      alive: false, s, glow,
      x: 0, y: 0, vx: 0, vy: 0,
      r: 8, dmg: 10, life: 0, spin: 0,
    };
  }, 220);
}

export function clearShots() {
  G.shots.clear((p) => { p.s.visible = false; p.glow.visible = false; });
}

/**
 * `priority` marks boss fire, which may exceed the ambient cap. A boss
 * pattern that loses half its ring to a budget shared with the swarm stops
 * being a readable shape, so it gets its own headroom.
 */
export function fireShot(x, y, angle, opts, priority) {
  const cap = CFG.spawn.maxShots + (priority ? CFG.spawn.bossShotHeadroom : 0);
  if (G.shots.count >= cap) return null;
  const p = G.shots.spawn();
  const speed = opts.speed;
  p.x = x; p.y = y;
  p.vx = Math.cos(angle) * speed;
  p.vy = Math.sin(angle) * speed;
  p.r = opts.r;
  p.dmg = opts.dmg;
  p.life = opts.life;
  p.spin = (Math.random() < 0.5 ? -1 : 1) * 2.4;

  p.s.tint = 0xffffff;                 // white-hot core, so the tint reads as the halo
  p.s.width = p.s.height = opts.r * 2.1;
  p.s.alpha = 0.95;
  p.s.visible = true;
  p.glow.tint = opts.tint;
  p.glow.width = p.glow.height = opts.r * 3.4;
  p.glow.alpha = 0.95;
  p.glow.visible = true;
  return p;
}

export function updateShots(dt) {
  const pl = G.player;
  const grabR = pl.radius;

  for (const p of G.shots.active) {
    p.life -= dt;
    if (p.life <= 0) { p.alive = false; continue; }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const dx = pl.x - p.x, dy = pl.y - p.y;
    const rr = p.r + grabR;
    if (dx * dx + dy * dy < rr * rr) {
      damagePlayer(p.dmg);
      burst(p.x, p.y, p.s.tint, 10, 190, 0.5);
      p.alive = false;
      continue;
    }

    // nothing chases the player forever; a stray shot is recycled
    if (dx * dx + dy * dy > DESPAWN * DESPAWN) { p.alive = false; continue; }

    const vis = !offscreen(p.x, p.y, p.r + 30);
    p.s.visible = vis;
    p.glow.visible = vis;
    if (!vis) continue;
    p.s.x = p.glow.x = p.x;
    p.s.y = p.glow.y = p.y;
    p.glow.rotation += p.spin * dt;
    const pulse = 0.82 + Math.sin(G.t * 9 + p.r) * 0.18;
    p.glow.alpha = pulse;
    p.glow.width = p.glow.height = p.r * 3.4 * (0.94 + (1 - pulse) * 0.3);
  }

  G.shots.sweep((p) => { p.s.visible = false; p.glow.visible = false; });
}
