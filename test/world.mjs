/**
 * A headless slice of the running game.
 *
 * Boots the REAL systems -- spellbook, spell runtime, status, damage -- against
 * the Pixi stub, then drives them a frame at a time. Nothing here reimplements
 * game logic; if a test says a rune does nothing, it is the shipping code that
 * did nothing.
 *
 * Two deliberate departures from a live run, both so a measurement means one
 * thing only:
 *
 *   THE CROWD DOES NOT MOVE. `updateEnemies` is never called, so bodies stay
 *   where they were placed. A chasing crowd converges on the player from every
 *   angle, which hides any change in where a spell puts its damage -- the exact
 *   property most of these tests are looking at.
 *
 *   MATH.RANDOM IS SEEDED. Scatter, cone jitter and crit rolls are all random;
 *   unseeded, every comparison would be noise against noise.
 */
import * as PIXI from '../src/pixi.js';
import { G } from '../src/state.js';
import { CFG } from '../src/config.js';
import { initFx, clearFx } from '../src/fx.js';
import { initPickups, clearPickups } from '../src/pickups.js';
// enemy.js MUST be imported before shots.js. There is an import cycle --
// shots -> player -> status -> enemy -> boss -> shots -- and `boss.js` reads
// `HOSTILE` from shots.js at module top level. Entering the cycle at shots.js
// reaches that read before shots.js has defined it, and the process dies with
// "Cannot access 'HOSTILE' before initialization". Entering at enemy.js works
// because enemy.js lists shots.js above boss.js, so shots finishes first.
// `main.js` gets this right by accident, not by design.
import { initEnemies, resetEnemies, spawnEnemy } from '../src/enemy.js';
import { initShots, clearShots } from '../src/shots.js';
import { initCasting, clearCasting, updateSpellEntities } from '../src/cast.js';
import { initPlayer, resetPlayer, recomputeStats } from '../src/player.js';
import { initBook, resetBook, recompileAll, updateSpellbook } from '../src/spellbook.js';
import { updateEnemyStatus, applyStatus, BURN, CHILL } from '../src/status.js';

const STEP = 1 / 60;

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------

/** mulberry32 -- small, fast, and good enough that seeds behave independently. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const realRandom = Math.random;
export function seedRandom(seed) { Math.random = mulberry32(seed); }
export function restoreRandom() { Math.random = realRandom; }

// ---------------------------------------------------------------------------
// fake assets
// ---------------------------------------------------------------------------

/**
 * Every texture lookup answers with the same inert object.
 *
 * A Proxy rather than a literal because the texture atlas grows with every new
 * look, and a fixed list would have to be edited each time -- a test suite that
 * breaks when art is added teaches people to distrust it.
 */
function fakeTextures() {
  const one = { __tex: true, source: { scaleMode: 'linear' } };
  const bag = new Proxy({}, {
    get(target, key) {
      if (key === 'digits') return new Array(10).fill(one);
      if (key === 'spell') return bag;
      if (typeof key === 'symbol') return undefined;
      return one;
    },
  });
  return bag;
}

// ---------------------------------------------------------------------------
// world
// ---------------------------------------------------------------------------

let booted = false;

/**
 * One-time boot of the pools. The pools are global on `G`, so this happens once
 * per process and each test resets rather than rebuilds -- which is also what
 * the game itself does between runs.
 */
function boot() {
  if (booted) return;
  G.tex = fakeTextures();
  // Real Container instances, not inert stubs: draw ORDER inside a layer is
  // something the game depends on (a boss is kept on top of the swarm by
  // re-adding its sprite), so a layer that forgets its children cannot test it.
  G.layers = new Proxy({}, {
    get(t, k) {
      if (typeof k === 'symbol') return undefined;
      if (!t[k]) t[k] = new PIXI.Container();
      return t[k];
    },
  });
  // Big enough that nothing a test spawns is ever culled. Culling is purely a
  // visibility decision in the shipping code, but keeping everything on screen
  // means a future change that makes it matter shows up as a failure here.
  G.screen = { w: 20000, h: 20000 };
  G.cam = { x: 0, y: 0 };

  initFx();
  initPickups();
  initShots();
  initEnemies();
  initCasting();
  initPlayer();
  initBook();
  booted = true;
}

/**
 * A world with one spell and a static crowd.
 *
 * `atSeconds` fixes run time before anything is spawned: enemy health scales
 * with elapsed time, so two rows measured at different clocks are not
 * comparable. It is held still on every step for the same reason.
 */
export function createWorld({
  seed = 1,
  focus = 'projectile',
  tree = [],
  crowd = 24,
  // The crowd is a BAND, not a ring, and the band is the single most important
  // number in this file.
  //
  // The focuses reach wildly different distances: a Field is 100px, a Burst
  // 170, a Projectile 460. A crowd at one radius is therefore unfair to at
  // least two of them -- placed at 300 it sits entirely outside a Burst, which
  // then deals no damage at all, and EVERY damage rune measures as inert on it.
  // That is not a finding about the runes, it is a finding about the ring.
  //
  // So bodies are spread evenly from inside a Field's radius out past a
  // Projectile's range: every focus has something to hit at its own scale, and
  // a projectile still has room to travel before it meets anything.
  crowdNear = 55,
  crowdFar = 430,
  crowdType = 'zombie',
  atSeconds = 120,
  invulnerable = true,
  // Uniform, small, and the same for every focus.
  //
  // Left at their natural scaled health, a zombie survives everything a slow
  // focus can do inside a test window: Burst and Field scored ZERO kills in
  // three seconds, so every on-kill trigger measured as broken on them. That
  // was the crowd's health, not the trigger. A flat pool that each focus can
  // work through makes the kill channel mean the same thing on all of them.
  crowdHp = 25,
  // Statuses held on the crowd every frame.
  //
  // Several runes are explicitly conditional -- Frostbite pays out on Frozen
  // targets, Burned to Death on burning ones -- and a bare spell applies
  // neither. Measured in a plain world they look broken when they are only
  // unfed. Holding the condition open measures the rune instead of the setup.
  preStatus = null,
  playerLevel = 1,
} = {}) {
  boot();
  seedRandom(seed);

  G.t = atSeconds;
  G.running = true;
  G.paused = false;
  G.over = false;
  G.kills = 0;
  G.boss = null;

  clearCasting();
  clearFx();
  clearPickups();
  clearShots();
  resetEnemies();
  resetPlayer();
  G.player.level = playerLevel;
  recomputeStats();
  G.player.hp = G.player.stats.maxHp;
  G.player.x = 0;
  G.player.y = 0;
  G.player.facing = 0;

  resetBook(focus);
  const entry = G.player.book.spells[0];
  entry.spell = { focus, children: structuredClone(tree) };
  entry.cd = 0;
  recompileAll();

  // A ring, laid out by index rather than at random, so the same crowd faces
  // every spell under test. Deterministic placement is what lets two runs be
  // subtracted from each other.
  const planted = [];
  for (let i = 0; i < crowd; i++) {
    // Golden angle, so successive bodies never line up into spokes that a
    // directional spell could thread between or land squarely on.
    const a = i * 2.39996323;
    const r = crowdNear + (crowdFar - crowdNear) * (i / Math.max(1, crowd - 1));
    const e = spawnEnemy(crowdType, Math.cos(a) * r, Math.sin(a) * r);
    if (e) planted.push(e);
  }

  const HUGE = 1e12;
  for (const e of planted) {
    e.maxHp = e.hp = invulnerable ? HUGE : crowdHp;
  }

  let banked = 0;      // damage absorbed by bodies that have since been replaced

  const world = {
    get entry() { return G.player.book.spells[0]; },
    get compiled() { return G.player.book.spells[0].compiled; },
    planted,
    atSeconds,
    invulnerable,
    crowdType,

    /** One fixed 60Hz frame of exactly the systems a spell touches. */
    step(dt = STEP) {
      G.t = atSeconds;                     // difficulty held still
      G.player.hp = G.player.stats.maxHp;  // contact damage must not end the run

      G.grid.clear();
      for (const e of G.enemies.active) if (e.alive) G.grid.insert(e);

      if (preStatus) {
        for (const e of G.enemies.active) {
          if (!e.alive) continue;
          if (preStatus.includes('burn')) applyStatus(e, BURN, 4, 6);
          if (preStatus.includes('chill')) applyStatus(e, CHILL, 2, 0);
        }
      }

      updateSpellbook(dt);
      updateSpellEntities(dt);
      for (const e of G.enemies.active) if (e.alive) updateEnemyStatus(e, dt);

      if (!invulnerable) {
        // Hold the population steady so later frames shoot into the same crowd
        // the first ones did.
        for (let i = 0; i < world.planted.length; i++) {
          const e = world.planted[i];
          if (e.alive) continue;
          // Bank what the corpse absorbed before letting go of it, or every
          // kill would erase the damage that caused it and a lethal rune would
          // measure as weaker than a feeble one.
          banked += e.maxHp;
          const rep = spawnEnemy(crowdType, e.x, e.y);
          if (rep) { rep.maxHp = rep.hp = crowdHp; world.planted[i] = rep; }
        }
      }
      G.enemies.sweep((e) => { e.s.visible = false; e.hpBg.visible = false; e.hpFill.visible = false; });
    },

    run(seconds) {
      const steps = Math.round(seconds / STEP);
      for (let i = 0; i < steps; i++) world.step(STEP);
      return world;
    },

    /** Damage absorbed by the crowd so far. */
    damageDealt() {
      let d = banked;
      for (const e of world.planted) d += Math.max(0, e.maxHp - e.hp);
      return d;
    },

    liveEntities() {
      return G.spellEntities.active.filter((e) => e.alive);
    },
  };
  return world;
}

export { STEP, G, CFG };
