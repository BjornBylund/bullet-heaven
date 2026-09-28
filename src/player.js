import * as PIXI from './pixi.js';
import { G } from './state.js';
import { CFG, xpForLevel } from './config.js';
import { burst, shake, damageNumber } from './fx.js';
import { getAxis } from './input.js';
import { contactDamageMul } from './status.js';

/** The player: movement, derived stats, contact damage, death. */

export function initPlayer() {
  const glow = new PIXI.Sprite(G.tex.glow);
  glow.anchor.set(0.5);
  glow.blendMode = 'add';
  glow.tint = 0x7fe3ff;
  glow.scale.set(1.5);
  glow.alpha = 0.5;

  const body = new PIXI.Sprite(G.tex.mage);
  body.anchor.set(0.5);
  body.tint = 0xdff4ff;
  body.width = body.height = CFG.player.radius * 2.6;

  G.layers.player.addChild(glow);
  G.layers.player.addChild(body);

  G.player = {
    x: 0, y: 0, vx: 0, vy: 0,
    radius: CFG.player.radius,
    facing: 0,
    hp: CFG.player.hp,
    level: 1,
    xp: 0,
    xpNeed: xpForLevel(1),
    invuln: 0,
    hurtFlash: 0,
    book: null,            // spellbook, populated by initBook()
    stats: null,
    glow, body,
  };
  recomputeStats();
  G.player.hp = G.player.stats.maxHp;
}

export function resetPlayer() {
  const p = G.player;
  p.x = p.y = 0;
  p.vx = p.vy = 0;
  p.facing = 0;
  p.level = 1;
  p.xp = 0;
  p.xpNeed = xpForLevel(1);
  p.invuln = 0;
  p.hurtFlash = 0;
  recomputeStats();
  p.hp = p.stats.maxHp;
}

/**
 * Rebuilds every derived stat from base values plus automatic level growth.
 *
 * Passive upgrade cards were cut to keep the level-up screen purely about
 * spells, so survivability and a baseline damage ramp are granted implicitly
 * per level instead. Recomputing wholesale means a stat can never drift.
 */
export function recomputeStats() {
  const p = G.player;
  const g = CFG.levelGrowth;
  const n = Math.max(0, p.level - 1);
  const s = {
    maxHp: CFG.player.hp + g.maxHp * n,
    moveSpeed: CFG.player.moveSpeed,
    pickup: CFG.player.pickup,
    dmg: 1 + g.dmg * n,
    cd: 1,
    area: 1,
    projSpeed: 1,
    armor: 0,
    regen: 0,
    crit: Math.min(0.85, 0.03 + g.crit * n),
    xpMul: 1,
  };
  const prevMax = p.stats ? p.stats.maxHp : s.maxHp;
  p.stats = s;
  // a Vitality pick should grant the new health immediately, not just raise the cap
  if (s.maxHp > prevMax) p.hp += s.maxHp - prevMax;
  p.hp = Math.min(p.hp, s.maxHp);
}

export function damagePlayer(amount) {
  const p = G.player;
  if (p.invuln > 0) return;
  const dealt = Math.max(1, amount - p.stats.armor);
  p.hp -= dealt;
  p.invuln = CFG.player.invuln;
  p.hurtFlash = 0.18;
  // Amber, not red. These particles spray outward from the player and at a
  // glance looked exactly like small incoming shots -- the one reading the
  // colour rule exists to prevent.
  damageNumber(p.x, p.y - 22, dealt, 0xffa83c, true);
  burst(p.x, p.y, 0xffffff, 8, 180, 0.5);
  shake(4 + Math.min(8, dealt * 0.2));
  if (p.hp <= 0) {
    p.hp = 0;
    G.over = true;
  }
}

export function updatePlayer(dt) {
  const p = G.player;
  const st = p.stats;

  const [ax, ay] = getAxis();
  p.vx = ax * st.moveSpeed;
  p.vy = ay * st.moveSpeed;
  if (ax !== 0 || ay !== 0) p.facing = Math.atan2(ay, ax);

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  if (st.regen > 0 && p.hp < st.maxHp) p.hp = Math.min(st.maxHp, p.hp + st.regen * dt);
  if (p.invuln > 0) p.invuln -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;

  // Contact damage lives here rather than in the enemy update so the enemy
  // module never has to import the player module. Each enemy carries its own
  // attack cooldown, and the player's i-frames cap total incoming rate.
  const near = G.scratch;
  G.grid.query(p.x, p.y, p.radius + 40, near);
  for (let i = 0; i < near.length; i++) {
    const e = near[i];
    if (!e.alive || e.atkCd > 0) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    const rr = e.r + p.radius;
    if (dx * dx + dy * dy > rr * rr) continue;
    e.atkCd = 0.6;
    damagePlayer(e.dmg * contactDamageMul(e));
    if (G.over) return;
  }

  p.body.x = p.glow.x = p.x;
  p.body.y = p.glow.y = p.y;
  // blink while invulnerable so the i-frame window is legible
  const blink = p.invuln > 0 && Math.floor(G.t * 22) % 2 === 0;
  p.body.tint = p.hurtFlash > 0 ? 0xffffff : 0xdff4ff;
  p.body.alpha = blink ? 0.45 : 1;
  p.glow.alpha = 0.42 + Math.sin(G.t * 3) * 0.08;
  p.body.rotation += dt * 0.6;      // slow spin, so the facets catch the eye
}
