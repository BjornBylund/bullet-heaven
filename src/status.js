import { damageEnemy } from './enemy.js';
import { G } from './state.js';
import { CFG } from './config.js';

/**
 * Debuffs.
 *
 * Every status defines its own stacking semantics; there is no global model.
 * Decay is drain-based: stacks fall off one at a time at a fixed rate once
 * application stops, which creates a race between your application rate and the
 * drain rate. That race is what makes "can I reach freeze?" a real question
 * about your build rather than a yes/no from a single rune.
 *
 * Storage is two flat arrays per enemy indexed by status id, so the per-frame
 * cost across 1500 enemies is a handful of decrements.
 *
 * Rule: NO STATUS APPLIES HARD CROWD CONTROL. Chill used to convert to a
 * freeze at full stacks, and that freeze was the only stun in the game. It
 * went because a threshold effect makes a status binary -- everything below
 * the line is worth nothing and everything above it removes the enemy -- and
 * because it quietly did half the work of anything that gathered a crowd.
 * Chill now just slows, all the way up to its cap, which makes every stack
 * worth the same as the last.
 */

export const STATUS_IDS = ['chill', 'burn', 'brittle'];
export const CHILL = 0, BURN = 1, BRITTLE = 2;

export const STATUSES = {
  chill: {
    name: 'Chill', icon: '❄', color: 0x86c8ff,
    max: 20,
    drain: 0.35,          // seconds per stack once application stops
    desc: 'Slows, up to 64% at full stacks.',
  },
  burn: {
    name: 'Burn', icon: '♨', color: 0xff8a4c,
    max: 10,
    drain: 0.55,
    tick: 0.5,
    desc: 'Damage over time that grows with stacks.',
  },
  brittle: {
    name: 'Brittle', icon: '◇', color: 0xff6ad5,
    max: 5,
    drain: 1.0,
    desc: 'Increases all damage the target takes.',
  },
};

const SLOW_PER_STACK = 0.032;   // 20 stacks -> 64% slower
const BRITTLE_PER_STACK = 0.07;

/**
 * Burn damage per stack per tick, from the PLAYER'S LEVEL.
 *
 * It used to be a fraction of the casting spell's damage, which meant the same
 * rune was worth wildly different amounts depending on what it was socketed
 * into -- and worth nothing at all under a weak trigger, where the percentage
 * was taken of an already-reduced figure. Keying it to the level makes a Burn
 * rune mean one thing wherever it sits, and keeps it relevant late without
 * having to track whatever spell happened to light the fire.
 *
 * `magFrac` is what the rune itself brings: Potent Burn is still the rune that
 * makes burn hurt.
 */
export function burnDamage(magFrac) {
  const lvl = G.player ? G.player.level : 1;
  const b = CFG.burn;
  return (b.base + b.perLevel * (lvl - 1)) * (magFrac || 0);
}

export function initEnemyStatus(e) {
  e.st = new Float32Array(STATUS_IDS.length);       // stack counts
  e.stDecay = new Float32Array(STATUS_IDS.length);  // time until next stack drains
  e.burnDmg = 0;      // damage per stack per tick, from the strongest applier
  e.burnTick = 0;
}

export function resetEnemyStatus(e) {
  e.st.fill(0);
  e.stDecay.fill(0);
  e.burnDmg = 0;
  e.burnTick = 0;
}

/**
 * Adds stacks. `magFrac` only matters for burn, where the strongest applier
 * wins so a weak rune cannot dilute a strong one's damage over time.
 */
export function applyStatus(e, idx, stacks, magFrac) {
  if (!e.alive) return;
  const def = STATUSES[STATUS_IDS[idx]];

  e.st[idx] = Math.min(def.max, e.st[idx] + stacks);
  e.stDecay[idx] = def.drain;

  // Resolved HERE rather than at compile time, because it reads the player's
  // level and that changes during a run.
  if (idx === BURN) {
    const mag = burnDamage(magFrac);
    if (mag > e.burnDmg) e.burnDmg = mag;
  }
}

/** Per-enemy per-frame tick. Called from the enemy update loop. */
export function updateEnemyStatus(e, dt) {
  for (let i = 0; i < STATUS_IDS.length; i++) {
    if (e.st[i] <= 0) continue;
    e.stDecay[i] -= dt;
    if (e.stDecay[i] <= 0) {
      e.st[i] = Math.max(0, e.st[i] - 1);
      e.stDecay[i] = STATUSES[STATUS_IDS[i]].drain;
      if (i === BURN && e.st[i] === 0) e.burnDmg = 0;
    }
  }

  if (e.st[BURN] > 0 && e.burnDmg > 0) {
    e.burnTick -= dt;
    if (e.burnTick <= 0) {
      e.burnTick = STATUSES.burn.tick;
      // Silent by design: a DoT on hundreds of enemies would bury the floater
      // cap in fx.js and turn the screen into noise.
      damageEnemy(e, e.burnDmg * e.st[BURN], { silent: true, color: 0xff8a4c });
    }
  }
}

/** Movement multiplier from chill. */
export function speedMul(e) {
  const c = e.st[CHILL];
  return c > 0 ? Math.max(0.2, 1 - c * SLOW_PER_STACK) : 1;
}

/** Incoming damage amplification from brittle. */
export function damageTakenMul(e) {
  const b = e.st[BRITTLE];
  return b > 0 ? 1 + b * BRITTLE_PER_STACK : 1;
}

/** Tint override so a status is readable at a glance in a crowd. */
export function statusTint(e) {
  if (e.st[BURN] > 0) return 0xff9a5c;
  if (e.st[CHILL] > 0) return 0x86c8ff;
  if (e.st[BRITTLE] > 0) return 0xff8ade;
  return 0;
}

export function hasAnyStatus(e) {
  return e.st[CHILL] > 0 || e.st[BURN] > 0 || e.st[BRITTLE] > 0;
}
