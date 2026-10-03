import * as PIXI from './pixi.js';
import { G, difficulty, offscreen } from './state.js';
import { CFG } from './config.js';
import { Pool, TAU, rand, pick } from './util.js';
import { burst, damageNumber, shake, shockwave } from './fx.js';
import { rollDrop } from './pickups.js';
import { killCredit } from './progress.js';
import { fireShot, HOSTILE } from './shots.js';
import { sfx, setTrack } from './audio.js';
import {
  BOSSES, BOSS_IDS, bossType, bossForIndex,
  initBossState, updateBossBehavior, bossTint,
} from './boss.js';
import {
  initEnemyStatus, resetEnemyStatus, updateEnemyStatus, speedMul, statusTint,
} from './status.js';

/**
 * Enemy archetypes, the spawn director, and the swarm update.
 *
 * Variety here is deliberately along five axes at once -- speed, size, health,
 * SILHOUETTE and BEHAVIOUR. Hues are spread across the roster too: once the
 * shapes became distinct it was obvious that three archetypes shared a green
 * and two shared an orange, which made same-wave packs read as one mass -- because a roster that only varies numbers reads as
 * one enemy wearing different hats, and one that only varies colour reads as a
 * bag of marbles. The behaviours are what make a wave recognisable at a
 * glance:
 *
 *   chase    walks straight at you. The baseline the others are read against.
 *   ranged   holds its preferred distance and shoots slow, dodgeable orbs.
 *   charger  stalks, winds up visibly, then dashes in a straight line.
 *   splitter bursts into smaller enemies when killed.
 *
 * Ranged enemies only fire while on screen. Being shot from beyond the viewport
 * is unreadable and feels arbitrary, and it would waste the projectile pool on
 * fights the player cannot see.
 *
 * COLOUR RULE: no archetype may be red. Red belongs to enemy projectiles alone
 * (see HOSTILE in shots.js), which is why the brute is indigo and the charger
 * is pushed well into orange -- both were close enough to crimson to blur the
 * one signal the player has to read instantly.
 */

export const TYPES = {
  // --- chaff: fast, tiny, dies instantly, arrives in crowds -----------------
  swarmling: {
    hp: 5, speed: 152, r: 7, dmg: 4, xp: 1,
    tint: 0xc8a0ff, shape: 'bat', behavior: 'chase',
  },
  bat: {
    hp: 9, speed: 120, r: 9, dmg: 6, xp: 1,
    tint: 0x9b7bdd, shape: 'bat', behavior: 'chase',
  },
  runner: {
    hp: 13, speed: 172, r: 10, dmg: 8, xp: 2,
    tint: 0xe8a552, shape: 'dart', behavior: 'chase',
  },

  // --- line infantry --------------------------------------------------------
  zombie: {
    hp: 24, speed: 74, r: 13, dmg: 10, xp: 1,
    tint: 0x6fae5a, shape: 'lump', behavior: 'chase',
  },
  // ignores separation, so it drifts through the pack and reaches you while
  // everything else is still shoving
  ghost: {
    hp: 28, speed: 98, r: 12, dmg: 9, xp: 2,
    tint: 0x63d3c4, shape: 'wisp', behavior: 'chase', phase: true,
  },
  splitter: {
    hp: 46, speed: 68, r: 17, dmg: 11, xp: 3,
    tint: 0xd7e356, shape: 'cluster', behavior: 'chase',
    splitInto: 'swarmling', splitCount: 3,
  },

  // --- ranged ---------------------------------------------------------------
  spitter: {
    hp: 30, speed: 66, r: 14, dmg: 6, xp: 3,
    tint: 0x7fd4a0, shape: 'sac', behavior: 'ranged',
    prefer: 250, shootCd: 3.1, windup: 0.45,
    shot: { speed: 135, dmg: 20, r: 8, life: 5, tint: HOSTILE.light },
  },
  lobber: {
    hp: 58, speed: 46, r: 19, dmg: 8, xp: 5,
    tint: 0xd98cc8, shape: 'mortar', behavior: 'ranged',
    prefer: 400, shootCd: 4.4, windup: 0.7,
    shot: { speed: 105, dmg: 38, r: 15, life: 7, tint: HOSTILE.deep },
  },
  warden: {
    hp: 190, speed: 42, r: 26, dmg: 14, xp: 12,
    tint: 0x7fa8ff, shape: 'shield', behavior: 'ranged',
    prefer: 320, shootCd: 4.0, windup: 0.6,
    spread: 3, spreadArc: 0.42,
    shot: { speed: 120, dmg: 24, r: 9, life: 6, tint: HOSTILE.mid },
  },

  // --- shock ----------------------------------------------------------------
  charger: {
    hp: 34, speed: 78, r: 13, dmg: 16, xp: 3,
    tint: 0xff9a3c, shape: 'horn', behavior: 'charger',
    chargeRange: 280, chargeSpeed: 430, chargeTime: 0.55, windup: 0.5, recover: 0.9,
  },

  // --- heavies --------------------------------------------------------------
  brute: {
    hp: 105, speed: 60, r: 22, dmg: 18, xp: 6,
    tint: 0x6f5fd0, shape: 'brute', behavior: 'chase',
  },
  golem: {
    hp: 250, speed: 48, r: 30, dmg: 24, xp: 14,
    tint: 0x9aa4b2, shape: 'rock', behavior: 'chase',
  },
  hulk: {
    hp: 640, speed: 33, r: 42, dmg: 32, xp: 30,
    tint: 0x6b6f7a, shape: 'boulder', behavior: 'chase',
  },

  // Bosses are NOT listed here. They are registered from boss.js at init under
  // the keys `boss_<id>`, because a boss is a scripted encounter rather than an
  // archetype the wave director may draw from.
};

/** Which archetypes the director may draw from, by elapsed seconds. */
const WAVES = [
  { t: 0,   pool: ['bat'] },
  { t: 45,  pool: ['bat', 'bat', 'swarmling'] },
  { t: 95,  pool: ['bat', 'zombie', 'swarmling'] },
  { t: 150, pool: ['zombie', 'zombie', 'runner', 'runner', 'spitter'] },
  { t: 215, pool: ['runner', 'ghost', 'swarmling', 'zombie', 'spitter'] },
  { t: 290, pool: ['ghost', 'splitter', 'charger', 'zombie', 'spitter'] },
  { t: 370, pool: ['charger', 'brute', 'runner', 'ghost', 'spitter'] },
  { t: 455, pool: ['brute', 'splitter', 'ghost', 'charger', 'lobber'] },
  { t: 550, pool: ['brute', 'golem', 'charger', 'splitter', 'lobber'] },
  { t: 650, pool: ['golem', 'splitter', 'runner', 'brute', 'warden'] },
  { t: 760, pool: ['golem', 'hulk', 'charger', 'splitter', 'warden'] },
  { t: 880, pool: ['hulk', 'golem', 'splitter', 'charger', 'warden'] },
];

// Every enemy gets a unique id so a projectile can remember which bodies it
// has already passed through. Monotonic, never reused, so a recycled pool slot
// can never be mistaken for the enemy that occupied it before.
let nextEnemyEid = 1;

let spawnTimer = 0;
let nextBoss = CFG.spawn.bossEvery;
let warned = false;

/** How many enemies should be alive right now. */
export function targetPopulation(minutes) {
  const c = CFG.spawn;
  return Math.min(c.maxEnemies, Math.round(c.popBase + c.popLin * minutes + c.popQuad * minutes * minutes));
}

/** Ranged ceiling, scaled so shooters stay a garnish at any density. */
function rangedCeiling(target) {
  const c = CFG.spawn;
  return Math.max(c.minRanged, Math.min(c.maxRangedCap, Math.round(target * c.rangedFraction)));
}

export function initEnemies() {
  // Registered here rather than at module scope: enemy.js and boss.js form
  // an import cycle, so reading BOSSES during evaluation would hit the
  // temporal dead zone whenever boss.js was reached first.
  for (const id of BOSS_IDS) TYPES['boss_' + id] = bossType(BOSSES[id]);

  G.enemies = new Pool(() => {
    const s = new PIXI.Sprite(G.tex.enemy.lump);
    s.anchor.set(0.5);
    s.visible = false;
    G.layers.enemies.addChild(s);

    // Health bars are only drawn once something has actually been damaged, so
    // chaff that dies to one hit never shows one and the screen stays readable.
    // Anchored left so the fill shrinks from the right rather than the centre.
    const hpBg = new PIXI.Sprite(G.tex.bar);
    hpBg.anchor.set(0, 0.5);
    hpBg.tint = 0x1b1016;
    hpBg.visible = false;
    G.layers.bars.addChild(hpBg);
    const hpFill = new PIXI.Sprite(G.tex.bar);
    hpFill.anchor.set(0, 0.5);
    hpFill.visible = false;
    G.layers.bars.addChild(hpFill);

    const e = {
      alive: false, s, hpBg, hpFill, def: null,
      x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0,
      hp: 1, maxHp: 1, speed: 0, r: 8, dmg: 1, xp: 1,
      tint: 0xffffff, boss: false, phase: false,
      flash: 0, atkCd: 0,
      behavior: 'chase', strafe: 1,
      shootCd: 0, state: 0, stateT: 0, dashX: 0, dashY: 0,
      shotMul: 1, shotDef: null,
      // boss encounter state; inert on everything else
      bossDef: null, bossPhase: 0, pat: null, patName: '',
      patState: 0, patT: 0, patAcc: 0, patCount: 0, patAngle: 0,
      eid: 0,            // unique per spawn; see claim() in cast.js
    };
    initEnemyStatus(e);
    return e;
  }, 900);
}

export function resetEnemies() {
  spawnTimer = 0;
  nextBoss = CFG.spawn.bossEvery;
  warned = false;
  G.boss = null;
  G.bossIndex = 0;
  G.bossWarn = 0;
  G.bossWarnDef = null;
  G.enemies.clear((e) => { e.s.visible = false; });
}

function currentPool() {
  let p = WAVES[0].pool;
  for (const w of WAVES) if (G.t >= w.t) p = w.pool;
  return p;
}

/**
 * Picks a type from the wave pool, swapping a ranged pick for a melee one once
 * the ranged ceiling is reached. Substituting rather than skipping keeps total
 * spawn pressure identical; only the composition changes.
 */
function chooseType(pool, rangedCap) {
  const t = pick(pool);
  if (TYPES[t].behavior !== 'ranged' || G.rangedAlive < rangedCap) return t;
  for (let i = 0; i < 4; i++) {
    const alt = pick(pool);
    if (TYPES[alt].behavior !== 'ranged') return alt;
  }
  return 'zombie';
}

/** A point just outside the visible area, so nothing ever pops in on screen. */
function ringPoint(angle) {
  const R = Math.hypot(G.screen.w, G.screen.h) / 2 + CFG.spawn.ringPad;
  return { x: G.cam.x + Math.cos(angle) * R, y: G.cam.y + Math.sin(angle) * R };
}

export function spawnEnemy(typeName, x, y, scaleMul) {
  const def = TYPES[typeName];
  if (!def) return null;
  // The population cap bounds the cost of the SWARM, and a boss is one body.
  // Refusing it here is never the right trade: a field pinned at the cap used
  // to swallow the boss silently -- after the banner and the screen shake had
  // already played -- and because the schedule advanced anyway, that boss was
  // gone for the rest of the run. Measured from minute 32.5 onward, every boss
  // in the run was lost this way.
  if (!def.boss && G.enemies.count >= CFG.spawn.maxEnemies) return null;
  const d = difficulty();
  const sm = scaleMul || 1;

  const e = G.enemies.spawn();
  e.def = def;
  e.x = x; e.y = y;
  e.vx = e.vy = e.kx = e.ky = 0;
  const hpScale = def.boss ? 1 + (d.hp - 1) * CFG.scaling.bossHpScale : d.hp;
  e.maxHp = e.hp = def.hp * CFG.enemyHpMul * sm * hpScale;
  e.speed = def.speed * rand(0.92, 1.08);
  e.r = def.r * sm;
  e.dmg = def.dmg * d.dmg;
  // shots scale with the run too, or shooters stop mattering by minute ten
  e.shotMul = d.dmg;
  // pooled objects are reused across types, so the cached shot must be dropped
  e.shotDef = null;
  e.xp = def.xp;
  e.tint = def.tint;
  e.boss = !!def.boss;
  e.phase = !!def.phase;
  e.behavior = def.behavior;
  e.strafe = Math.random() < 0.5 ? -1 : 1;
  e.flash = 0;
  e.atkCd = 0;
  e.state = 0;
  e.stateT = 0;
  // stagger the first shot so a wave of shooters does not fire in unison
  e.shootCd = def.shootCd ? rand(0.5, def.shootCd) : 0;
  e.eid = nextEnemyEid++;
  resetEnemyStatus(e);

  e.s.tint = def.tint;
  e.s.texture = G.tex.enemy[def.shape];
  // sized from the hitbox rather than a per-type magic number, so the sprite
  // and the thing you actually collide with can never drift apart
  e.s.width = e.s.height = e.r * 2.15;
  e.s.alpha = def.phase ? 0.72 : 1;
  e.s.visible = true;
  if (def.behavior === 'boss') {
    initBossState(e, def.bossDef);
    // shot damage scales with the run like every other shooter's
    e.shotDef.dmg = Math.round(e.shotDef.dmg * d.dmg);
    G.boss = e;
  }
  e.hpBg.visible = false;
  e.hpFill.visible = false;
  return e;
}

export function updateSpawner(dt) {
  const d = difficulty();
  // The swarm thins while a boss is up. Nothing despawns -- the field simply
  // stops being refilled, so it drains as you fight and the boss's patterns
  // stay readable instead of competing with 300 bodies for attention.
  const live = G.boss && G.boss.alive;
  const target = Math.round(targetPopulation(d.minutes) * (live ? CFG.spawn.bossPopMul : 1));
  const rangedCap = rangedCeiling(target);
  const pool = currentPool();

  spawnTimer -= dt;
  while (spawnTimer <= 0) {
    spawnTimer += CFG.spawn.pulse;

    // Close a fraction of the shortfall per pulse rather than all of it, so a
    // big deficit arrives as successive waves instead of one instant wall.
    const deficit = target - G.enemies.count;
    if (deficit <= 0) continue;
    const n = Math.max(1, Math.min(CFG.spawn.maxPerPulse, Math.ceil(deficit * CFG.spawn.fill)));

    // One pulse in four arrives as a tight arc instead of scattered singles,
    // which keeps the field from settling into an even ring.
    const wall = Math.random() < CFG.spawn.wallChance;
    const base = rand(0, TAU);
    for (let i = 0; i < n; i++) {
      const a = wall ? base + rand(-0.38, 0.38) : rand(0, TAU);
      const q = ringPoint(a);
      spawnEnemy(chooseType(pool, rangedCap), q.x + rand(-24, 24), q.y + rand(-24, 24));
    }
  }

  // --- boss schedule -------------------------------------------------------
  // The banner leads the arrival. A boss that simply appears in a busy field is
  // indistinguishable from a brute until its first pattern lands, which is far
  // too late to reposition for.
  if (G.bossWarn > 0) {
    G.bossWarn -= dt;
    if (G.bossWarn <= 0) G.bossWarnDef = null;
  }
  if (!warned && G.t >= nextBoss - CFG.spawn.bossWarn) {
    warned = true;
    G.bossWarnDef = bossForIndex(G.bossIndex);
    G.bossWarn = CFG.spawn.bossWarn;
    sfx.bossWarn();
  }

  if (G.t >= nextBoss) {
    // Nothing about the schedule moves until the boss is actually standing in
    // the world. Advancing first meant a failed spawn still consumed the slot,
    // so the encounter was not delayed -- it was deleted, and the next one in
    // the rotation took its place.
    const def = bossForIndex(G.bossIndex);
    const b = ringPoint(rand(0, TAU));
    const boss = spawnEnemy('boss_' + def.id, b.x, b.y);
    if (boss) {
      nextBoss += CFG.spawn.bossEvery;
      warned = false;
      G.bossIndex++;
      shake(14);
      // a boss arrives with an escort, so it cannot simply be kited in the open
      for (let i = 0; i < 8 + Math.floor(d.minutes); i++) {
        const q = ringPoint(rand(0, TAU));
        spawnEnemy(chooseType(pool, rangedCap), q.x, q.y);
      }
    }
  }
}

/** Returns true if this hit killed the enemy. */
export function damageEnemy(e, amount, opts) {
  if (!e.alive) return false;
  const o = opts || {};
  e.hp -= amount;
  e.flash = 0.11;

  if (o.knockback && !e.boss) {
    const dx = e.x - o.fromX, dy = e.y - o.fromY;
    const d = Math.hypot(dx, dy) || 1;
    // heavier enemies shrug off knockback, which keeps brutes threatening
    const mass = Math.max(0.35, 1 - e.r / 46);
    e.kx += (dx / d) * o.knockback * mass;
    e.ky += (dy / d) * o.knockback * mass;
  }
  // Burn ticks pass `silent`: a DoT on hundreds of enemies would bury the
  // floater cap in fx.js and turn the screen into noise.
  if (!o.silent) damageNumber(e.x, e.y - e.r, amount, o.color || 0xffffff, !!o.big);

  if (e.hp <= 0) { killEnemy(e); return true; }
  return false;
}

function killEnemy(e) {
  e.alive = false;
  killCredit(e.boss);
  if (G.boss === e) {
    sfx.bossDie();
    G.boss = null;
    // the death gets its own beat: a wave that clears the boss's own fire
    // off the screen, so the fight ends on a visible full stop
    shockwave(e.x, e.y, 20, 620, 0.7, e.tint);
    shake(22);
    G.shots.clear((q) => { q.s.visible = false; q.glow.visible = false; });
  }
  burst(e.x, e.y, e.tint, e.boss ? 40 : 7, e.boss ? 420 : 170, e.boss ? 1.1 : 0.5);
  rollDrop(e.x, e.y, e.xp, e.boss);

  // Splitters burst into smaller enemies. The children are a plain chase type,
  // so a split can never cascade.
  const def = e.def;
  if (def && def.splitInto) {
    for (let i = 0; i < def.splitCount; i++) {
      const a = (i / def.splitCount) * TAU + rand(-0.3, 0.3);
      const c = spawnEnemy(def.splitInto, e.x + Math.cos(a) * 16, e.y + Math.sin(a) * 16);
      if (c) { c.kx = Math.cos(a) * 190; c.ky = Math.sin(a) * 190; }
    }
  }
}

// ---------------------------------------------------------------------------
// behaviours
// ---------------------------------------------------------------------------

/**
 * Ranged: hold a preferred band, strafe inside it, and fire on a cooldown with
 * a visible windup. Only fires while on screen -- being shot from off screen is
 * unreadable and feels arbitrary.
 */
function actRanged(e, dt, ux, uy, dist, speed, visible) {
  const def = e.def;
  let mx = ux, my = uy;

  if (dist > def.prefer * 1.15) {
    // close the gap
  } else if (dist < def.prefer * 0.75) {
    mx = -ux; my = -uy;                       // too close, back off
  } else {
    mx = -uy * e.strafe; my = ux * e.strafe;  // hold the band and circle
  }
  e.vx = mx * speed;
  e.vy = my * speed;

  if (!visible) return;
  e.shootCd -= dt;
  if (e.shootCd > 0) return;
  e.shootCd = def.shootCd * rand(0.85, 1.15);

  const base = Math.atan2(uy, ux);
  const n = def.spread || 1;
  const arc = def.spreadArc || 0;
  const shot = e.shotDef || (e.shotDef = Object.assign({}, def.shot));
  shot.dmg = def.shot.dmg * e.shotMul;
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? base : base + (i - (n - 1) / 2) * (arc / Math.max(1, n - 1));
    fireShot(e.x, e.y, a, shot);
  }
  if (e.boss) shake(2.5);
}

/**
 * Charger: stalk, wind up in place (the tell), dash in a straight line, then
 * stand exposed while it recovers. The windup is what makes it fair.
 */
function actCharger(e, dt, ux, uy, dist, speed) {
  const def = e.def;
  e.stateT -= dt;

  if (e.state === 0) {                        // stalking
    e.vx = ux * speed;
    e.vy = uy * speed;
    if (dist < def.chargeRange) { e.state = 1; e.stateT = def.windup; }
  } else if (e.state === 1) {                 // winding up, held still
    e.vx = e.vy = 0;
    if (e.stateT <= 0) {
      e.state = 2;
      e.stateT = def.chargeTime;
      e.dashX = ux; e.dashY = uy;             // direction locks in now
    }
  } else if (e.state === 2) {                 // committed dash
    e.vx = e.dashX * def.chargeSpeed;
    e.vy = e.dashY * def.chargeSpeed;
    if (e.stateT <= 0) { e.state = 3; e.stateT = def.recover; }
  } else {                                    // recovering
    e.vx = ux * speed * 0.25;
    e.vy = uy * speed * 0.25;
    if (e.stateT <= 0) e.state = 0;
  }
}

/** Tint override that makes a wind-up readable in a crowded screen. */
function behaviourTint(e) {
  if (e.behavior === 'boss') return bossTint(e);
  if (e.behavior === 'charger') {
    if (e.state === 1) return 0xffffff;       // about to dash
    if (e.state === 2) return 0xffd36e;       // dashing
  } else if (e.behavior === 'ranged' && e.def.windup && e.shootCd < e.def.windup) {
    return 0xffffff;                          // about to fire
  }
  return 0;
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export function updateEnemies(dt) {
  const p = G.player;
  const grid = G.grid;
  const near = G.scratch;

  // Rebuild the hash from scratch: essentially every enemy moves every frame,
  // so a full rebuild beats incrementally maintaining buckets.
  grid.clear();
  for (const e of G.enemies.active) grid.insert(e);

  const despawn2 = CFG.world.despawnRadius * CFG.world.despawnRadius;
  let ranged = 0;

  for (const e of G.enemies.active) {
    if (e.flash > 0) e.flash -= dt;
    if (e.atkCd > 0) e.atkCd -= dt;

    updateEnemyStatus(e, dt);
    if (!e.alive) continue;          // a burn tick can kill

    const dx = p.x - e.x, dy = p.y - e.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 > despawn2) {
      e.alive = false;
      if (G.boss === e) G.boss = null;    // do not leave a dangling boss
      continue;
    }

    const dist = Math.sqrt(dist2) || 1;
    const ux = dx / dist, uy = dy / dist;
    const speed = e.speed * speedMul(e);
    const visible = !offscreen(e.x, e.y, e.r);

    if (e.behavior === 'boss') {
      updateBossBehavior(e, dt, ux, uy, dist, speed);
    } else if (e.behavior === 'ranged') {
      ranged++;
      actRanged(e, dt, ux, uy, dist, speed, visible);
    } else if (e.behavior === 'charger') {
      actCharger(e, dt, ux, uy, dist, speed);
    } else {
      e.vx = ux * speed;
      e.vy = uy * speed;
    }

    // Separation is what makes the swarm read as a crowd rather than a laser
    // line into the player. It is also the most expensive thing in this loop,
    // so it only runs for enemies actually on screen. A committed dash ignores
    // it, otherwise the pack would smother the charge that makes it dangerous.
    const dashing = e.behavior === 'charger' && e.state === 2;
    // A boss is immovable: separation from a hundred adds would drift it out
    // of the arena and shift every pattern's origin mid-cast.
    if (visible && !e.phase && !dashing && !e.boss) {
      grid.query(e.x, e.y, e.r * 2, near);
      let sx = 0, sy = 0;
      for (let i = 0; i < near.length; i++) {
        const o = near[i];
        if (o === e || o.phase) continue;
        const ox = e.x - o.x, oy = e.y - o.y;
        const od2 = ox * ox + oy * oy;
        const minD = e.r + o.r;
        if (od2 > minD * minD || od2 < 1e-5) continue;
        const od = Math.sqrt(od2);
        const push = (minD - od) / minD;
        sx += (ox / od) * push;
        sy += (oy / od) * push;
      }
      e.vx += sx * speed * 1.1;
      e.vy += sy * speed * 1.1;
    }

    e.x += (e.vx + e.kx) * dt;
    e.y += (e.vy + e.ky) * dt;
    // knockback decays fast, so a hit reads as a shove rather than a launch
    const kd = 1 - 9 * dt;
    e.kx *= kd; e.ky *= kd;

    const s = e.s;
    s.visible = visible;
    drawHealthBar(e, visible);
    if (visible) {
      s.x = e.x;
      s.y = e.y;
      if (e.flash > 0) {
        s.tint = 0xffffff;
      } else {
        const bt = behaviourTint(e);
        const st = bt || statusTint(e);
        s.tint = st !== 0 ? st : e.tint;
      }
    }
  }

  G.rangedAlive = ranged;
  // Driven from liveness rather than hooked at each spawn and death site, so a
  // boss that dies, despawns, or is cleared by a restart all land here. setTrack
  // returns immediately when the track is already right.
  setTrack(G.boss && G.boss.alive ? 'boss' : 'main');
  G.enemies.sweep((e) => {
    e.s.visible = false;
    e.hpBg.visible = false;
    e.hpFill.visible = false;
  });
}

const BAR_H = 4;

/**
 * Green above half, amber above a quarter, orange below. The critical band is
 * orange rather than the conventional red: these bars sit in the world, a few
 * pixels across, and red is spoken for by incoming fire.
 */
function healthTint(frac) {
  if (frac > 0.5) return 0x6ee7a0;
  if (frac > 0.25) return 0xffd36e;
  return 0xff9a3c;
}

function drawHealthBar(e, visible) {
  const frac = e.hp / e.maxHp;
  // a boss reports to the banner bar at the top of the screen instead; a
  // second bar floating over its head is just clutter
  if (!visible || frac >= 0.999 || e.boss) {
    e.hpBg.visible = false;
    e.hpFill.visible = false;
    return;
  }
  // width tracks the body, so a hulk reads as a big bar and a bat a small one
  const w = Math.max(16, e.r * 2.1);
  const x = e.x - w / 2;
  const y = e.y - e.r - 7;

  e.hpBg.x = x; e.hpBg.y = y;
  e.hpBg.width = w; e.hpBg.height = BAR_H;
  e.hpBg.visible = true;

  e.hpFill.x = x; e.hpFill.y = y;
  e.hpFill.width = Math.max(1, w * Math.max(0, frac));
  e.hpFill.height = BAR_H;
  e.hpFill.tint = healthTint(frac);
  e.hpFill.visible = true;
}
