import { Grid } from './spatial.js';
import { CFG } from './config.js';

/**
 * Mutable game state, shared by every system. Deliberately one plain object
 * rather than a class: systems import `G` directly, which keeps the module
 * graph acyclic (no system needs to import another just to reach state).
 */
export const G = {
  app: null,
  tex: null,
  layers: {},          // ground / world / gems / enemies / player / proj / fx
  grid: new Grid(CFG.world.cellSize),

  t: 0,                // elapsed run seconds
  running: false,
  paused: false,
  over: false,

  kills: 0,
  gold: 0,
  pendingLevels: 0,
  statsDirty: false,

  player: null,
  enemies: null,       // Pool
  projectiles: null,
  shots: null,        // enemy projectiles
  rangedAlive: 0,     // live ranged enemies, recounted each frame

  boss: null,         // the live boss entity, or null
  finalBoss: false,   // the run's last fight has begun; no more are scheduled
  godMode: false,     // dev only, via BH.god(): the player takes no damage
  bossIndex: 0,       // bosses summoned so far; picks who comes next
  bossWarn: 0,        // seconds left on the arrival banner
  bossWarnDef: null,  // which boss the banner is announcing
  gems: null,
  drops: null,
  particles: null,
  floaters: null,
  effects: null,       // rings, arcs, lightning - visual only, self-expiring

  cam: { x: 0, y: 0 },
  shake: 0,
  screen: { w: 0, h: 0 },

  // reusable scratch arrays, so the hot loop never allocates
  scratch: [],
  scratch2: [],
};

/** Elapsed-time difficulty multipliers, read by the spawner and enemy setup. */
export function difficulty() {
  const m = G.t / 60;
  return {
    minutes: m,
    hp: 1 + m * CFG.scaling.hpLin + m * m * CFG.scaling.hpQuad,
    dmg: 1 + m * CFG.scaling.dmgLin,
  };
}

/** True when the point is far enough outside the viewport to skip drawing it. */
export function offscreen(x, y, pad = 0) {
  const m = CFG.world.cullMargin + pad;
  return (
    x < G.cam.x - G.screen.w / 2 - m || x > G.cam.x + G.screen.w / 2 + m ||
    y < G.cam.y - G.screen.h / 2 - m || y > G.cam.y + G.screen.h / 2 + m
  );
}
