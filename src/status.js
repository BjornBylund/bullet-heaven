import { damageEnemy } from './enemy.js';
import { burst } from './fx.js';

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
 * Rule: no status applies hard crowd control directly. Hard CC is only ever
 * reached through a stack threshold (see chill -> freeze).
 */

export const STATUS_IDS = ['chill', 'burn', 'weaken', 'brittle'];
export const CHILL = 0, BURN = 1, WEAKEN = 2, BRITTLE = 3;

export const STATUSES = {
  chill: {
    name: 'Chill', icon: '❄', color: 0x86c8ff,
    max: 20,
    drain: 0.35,          // seconds per stack once application stops
    desc: 'Slows. At 20 stacks the target freezes.',
  },
  burn: {
    name: 'Burn', icon: '♨', color: 0xff8a4c,
    max: 10,
    drain: 0.55,
    tick: 0.5,
    desc: 'Damage over time that grows with stacks.',
  },
  weaken: {
    name: 'Weaken', icon: '▼', color: 0xa8b4c6,
    max: 5,
    drain: 1.0,
    desc: 'Reduces the damage enemies deal to you.',
  },
  brittle: {
    name: 'Brittle', icon: '◇', color: 0xff6ad5,
    max: 5,
    drain: 1.0,
    desc: 'Increases all damage the target takes.',
  },
};

const SLOW_PER_STACK = 0.032;   // 20 stacks -> 64% slower, then freeze
const FREEZE_TIME = 1.4;
const WEAKEN_PER_STACK = 0.09;
const BRITTLE_PER_STACK = 0.07;

export function initEnemyStatus(e) {
  e.st = new Float32Array(STATUS_IDS.length);       // stack counts
  e.stDecay = new Float32Array(STATUS_IDS.length);  // time until next stack drains
  e.burnDmg = 0;      // damage per stack per tick, from the strongest applier
  e.burnTick = 0;
  e.frozen = 0;
}

export function resetEnemyStatus(e) {
  e.st.fill(0);
  e.stDecay.fill(0);
  e.burnDmg = 0;
  e.burnTick = 0;
  e.frozen = 0;
}

/**
 * Adds stacks. `magnitude` only matters for burn, where the strongest applier
 * wins so a weak spell cannot dilute a strong one's damage over time.
 */
export function applyStatus(e, idx, stacks, magnitude) {
  if (!e.alive) return;
  const def = STATUSES[STATUS_IDS[idx]];

  // Freeze is a threshold effect, and bosses are immune to it. They can still
  // be chilled -- the stacks just never convert.
  const prev = e.st[idx];
  e.st[idx] = Math.min(def.max, prev + stacks);
  e.stDecay[idx] = def.drain;

  if (idx === BURN && magnitude > e.burnDmg) e.burnDmg = magnitude;

  if (idx === CHILL && e.st[idx] >= def.max && !e.boss) {
    e.st[idx] = 0;
    e.frozen = FREEZE_TIME;
    burst(e.x, e.y, 0x86c8ff, 14, 220, 0.6);
  }
}

/** Per-enemy per-frame tick. Called from the enemy update loop. */
export function updateEnemyStatus(e, dt) {
  if (e.frozen > 0) e.frozen -= dt;

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

/** Movement multiplier from chill and freeze. */
export function speedMul(e) {
  if (e.frozen > 0) return 0;
  const c = e.st[CHILL];
  return c > 0 ? Math.max(0.2, 1 - c * SLOW_PER_STACK) : 1;
}

/** Incoming damage amplification from brittle. */
export function damageTakenMul(e) {
  const b = e.st[BRITTLE];
  return b > 0 ? 1 + b * BRITTLE_PER_STACK : 1;
}

/** Contact damage reduction from weaken. */
export function contactDamageMul(e) {
  const w = e.st[WEAKEN];
  return w > 0 ? Math.max(0.25, 1 - w * WEAKEN_PER_STACK) : 1;
}

/** Tint override so a status is readable at a glance in a crowd. */
export function statusTint(e) {
  if (e.frozen > 0) return 0x9fe4ff;
  if (e.st[BURN] > 0) return 0xff9a5c;
  if (e.st[CHILL] > 0) return 0x86c8ff;
  if (e.st[BRITTLE] > 0) return 0xff8ade;
  return 0;
}

export function hasAnyStatus(e) {
  return e.frozen > 0 || e.st[CHILL] > 0 || e.st[BURN] > 0 ||
         e.st[WEAKEN] > 0 || e.st[BRITTLE] > 0;
}
