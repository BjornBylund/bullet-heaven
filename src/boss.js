import { G } from './state.js';
import { TAU, rand, pick } from './util.js';
import { fireShot, HOSTILE } from './shots.js';
import { spawnEnemy } from './enemy.js';
import { burst, shockwave, shake } from './fx.js';

/**
 * Boss encounters.
 *
 * A boss is not a big enemy with more health -- it is a fight with a rhythm.
 * Every boss runs the same three-beat loop:
 *
 *   WINDUP    it stops, flares white, and does nothing. This is the tell.
 *   EXECUTE   it runs one attack pattern.
 *   RECOVER   it walks at you and is safe to burn down.
 *
 * Before any of that it runs APPROACH, striding in from the spawn ring at
 * boosted speed and not attacking until it is actually on screen -- the same
 * rule ordinary shooters follow, for the same reason: being hit by a pattern
 * whose origin you cannot see is not a fight, it is weather.
 *
 * That loop is the whole design. In a genre whose only input is movement, a
 * threat is only fair if you can see it coming and only interesting if reacting
 * costs you position. The windup is what turns "you took damage" into "you were
 * standing in the wrong place".
 *
 * Phases swap the pattern pool as health drops, so the same boss asks different
 * questions at 90% and at 20%.
 */

// A boss fight owns the screen, so its shots are allowed past the ambient cap.
const BOSS_SHOT_PRIORITY = true;

const APPROACH_BOOST = 2.2;   // speed multiplier while walking in from the ring
const ENGAGE = 330;           // distance at which it stops approaching and fights

// ---------------------------------------------------------------------------
// attack patterns
// ---------------------------------------------------------------------------
//
// `run(e, dt)` is called every frame of EXECUTE. Patterns that fire once do so
// on the first frame; sustained ones accumulate against `e.patAcc`.

const PATTERNS = {
  /** A full ring of slow shots. Punishes standing still; always has a gap to walk through. */
  radial: {
    windup: 0.85, duration: 0.15, recover: 1.1,
    run(e) {
      if (e.patCount++) return;
      const n = 12 + e.bossPhase * 5;
      const off = rand(0, TAU);
      for (let i = 0; i < n; i++) {
        fireShot(e.x, e.y, off + (i / n) * TAU, e.shotDef, BOSS_SHOT_PRIORITY);
      }
      shake(5);
    },
  },

  /** Two offset rings in quick succession: the gap in the first closes in the second. */
  doubleRing: {
    windup: 1.0, duration: 0.55, recover: 1.2,
    run(e, dt) {
      e.patAcc += dt;
      const n = 11 + e.bossPhase * 4;
      if (e.patCount === 0 || (e.patCount === 1 && e.patAcc > 0.42)) {
        const off = e.patCount * (Math.PI / n);
        for (let i = 0; i < n; i++) {
          fireShot(e.x, e.y, off + (i / n) * TAU, e.shotDef, BOSS_SHOT_PRIORITY);
        }
        e.patCount++;
        shake(4);
      }
    },
  },

  /** A rotating stream. You walk the spiral rather than dodge single shots. */
  spiral: {
    windup: 0.75, duration: 2.6, recover: 1.0,
    run(e, dt) {
      e.patAcc += dt;
      const gap = 0.075;
      while (e.patAcc >= gap) {
        e.patAcc -= gap;
        const arms = 2 + e.bossPhase;
        for (let a = 0; a < arms; a++) {
          fireShot(e.x, e.y, e.patAngle + (a / arms) * TAU, e.shotDef, BOSS_SHOT_PRIORITY);
        }
        e.patAngle += 0.42;
      }
    },
  },

  /** An aimed spread. The one pattern that actually tracks you. */
  volley: {
    windup: 0.65, duration: 0.15, recover: 0.85,
    run(e) {
      if (e.patCount++) return;
      const p = G.player;
      const base = Math.atan2(p.y - e.y, p.x - e.x);
      const n = 5 + e.bossPhase * 2;
      const arc = 0.85;
      for (let i = 0; i < n; i++) {
        fireShot(e.x, e.y, base + (i - (n - 1) / 2) * (arc / (n - 1)), e.shotDef, BOSS_SHOT_PRIORITY);
      }
      shake(4);
    },
  },

  /** Commits to a straight line and slams. Leaves the boss exposed afterwards. */
  charge: {
    windup: 0.9, duration: 0.85, recover: 1.5,
    run(e, dt) {
      if (e.patCount++ === 0) {
        const p = G.player;
        const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
        e.dashX = (p.x - e.x) / d;
        e.dashY = (p.y - e.y) / d;
      }
      e.vx = e.dashX * 430;
      e.vy = e.dashY * 430;
      // shockwave on arrival, so the dash has a landing and not just a stop
      if (e.patT <= dt) {
        shockwave(e.x, e.y, 20, 210, 0.45, e.tint);
        const n = 10;
        for (let i = 0; i < n; i++) {
          fireShot(e.x, e.y, (i / n) * TAU, e.shotDef, BOSS_SHOT_PRIORITY);
        }
        shake(11);
      }
    },
  },

  /** Calls in a wave of adds, so the arena refills even if you cleared it. */
  summon: {
    windup: 0.7, duration: 0.2, recover: 1.0,
    run(e) {
      if (e.patCount++) return;
      const n = 6 + e.bossPhase * 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rand(-0.2, 0.2);
        const d = e.r + 40 + rand(0, 60);
        const add = spawnEnemy(pick(e.bossDef.adds), e.x + Math.cos(a) * d, e.y + Math.sin(a) * d);
        if (add) { add.kx = Math.cos(a) * 260; add.ky = Math.sin(a) * 260; }
      }
      shockwave(e.x, e.y, 10, e.r + 120, 0.4, e.tint);
      shake(6);
    },
  },
};

// ---------------------------------------------------------------------------
// the roster
// ---------------------------------------------------------------------------
//
// The three read apart as blue / green / purple, and none of them is red --
// a boss is the largest body on the field, so a red one would drown out the
// incoming fire the player is supposed to be watching, including its own.
//
// Health is sized against MEASURED bare single-target damage (tools/boss-bench
// .js), not guessed. The bare Focuses deal 48, 12 and 7 damage per second --
// Projectile, Field, Burst -- which is the exact inverse of their standing
// against a crowd, where Burst leads Projectile roughly three to one.
//
// That inversion is the point: a boss is the one fight where the single-target
// Focus is king, and it is why a boss is worth having in a game otherwise
// entirely about crowds. But it also means an AOE build cannot be measured
// against these numbers bare and must lean on its runes, so boss health is
// tuned to give a geared Projectile build a fight of roughly twenty to thirty
// seconds rather than to be survivable by a bare Burst.

export const BOSSES = {
  warden: {
    id: 'warden',
    name: 'The Iron Warden',
    title: 'Keeper of the First Gate',
    hp: 1500, r: 44, speed: 52, dmg: 34, xp: 120,
    tint: 0x7fa8ff, shape: 'warlord',
    adds: ['zombie', 'bat'],
    shot: { speed: 128, dmg: 22, r: 10, life: 6, tint: HOSTILE.mid },
    // patterns get nastier and more numerous as it degrades
    phases: [
      { at: 1.00, patterns: ['radial', 'volley'] },
      { at: 0.66, patterns: ['radial', 'volley', 'summon'] },
      { at: 0.33, patterns: ['doubleRing', 'volley', 'summon'] },
    ],
  },

  devourer: {
    id: 'devourer',
    name: 'The Devourer',
    title: 'It Comes For The Field',
    hp: 2000, r: 50, speed: 66, dmg: 42, xp: 180,
    tint: 0x8ed13a, shape: 'maw',
    adds: ['swarmling', 'runner'],
    shot: { speed: 150, dmg: 26, r: 11, life: 5, tint: HOSTILE.deep },
    phases: [
      { at: 1.00, patterns: ['charge', 'volley'] },
      { at: 0.66, patterns: ['charge', 'radial', 'summon'] },
      { at: 0.33, patterns: ['charge', 'charge', 'doubleRing', 'summon'] },
    ],
  },

  stormCrown: {
    id: 'stormCrown',
    name: 'The Storm Crown',
    title: 'Everything Turns',
    hp: 2600, r: 54, speed: 58, dmg: 48, xp: 260,
    tint: 0xc9a0ff, shape: 'crown',
    adds: ['ghost', 'charger'],
    shot: { speed: 135, dmg: 30, r: 11, life: 5, tint: HOSTILE.mid },
    phases: [
      { at: 1.00, patterns: ['spiral', 'volley'] },
      { at: 0.66, patterns: ['spiral', 'doubleRing', 'summon'] },
      { at: 0.33, patterns: ['spiral', 'doubleRing', 'charge', 'summon'] },
    ],
  },
};

export const BOSS_IDS = Object.keys(BOSSES);

/** Which boss for the Nth encounter. Cycles, so a long run keeps rotating. */
export function bossForIndex(i) {
  return BOSSES[BOSS_IDS[i % BOSS_IDS.length]];
}

/** A TYPES-compatible entry, so bosses spawn through the normal enemy path. */
export function bossType(def) {
  return {
    hp: def.hp, speed: def.speed, r: def.r, dmg: def.dmg, xp: def.xp,
    tint: def.tint, shape: def.shape,
    behavior: 'boss', boss: true, bossDef: def,
  };
}

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

/**
 * NB: the phase index is `bossPhase`, not `phase` -- enemies already use
 * `e.phase` for the ghost's pass-through flag, and a numeric 0 there would
 * silently switch a boss between solid and incorporeal as it took damage.
 */
export function initBossState(e, def) {
  e.bossDef = def;
  e.shotDef = Object.assign({}, def.shot);
  e.bossPhase = 0;
  e.patState = 3;          // APPROACH: stride in before the fight starts
  e.patT = 0;
  e.pat = null;
  e.patAcc = 0;
  e.patCount = 0;
  e.patAngle = 0;
}

function choosePattern(e) {
  const phase = e.bossDef.phases[e.bossPhase];
  // avoid repeating the same pattern back to back when there is a choice
  let next = pick(phase.patterns);
  if (phase.patterns.length > 1) {
    for (let i = 0; i < 3 && next === e.patName; i++) next = pick(phase.patterns);
  }
  e.patName = next;
  e.pat = PATTERNS[next];
  e.patState = 0;
  e.patT = e.pat.windup;
  e.patAcc = 0;
  e.patCount = 0;
}

function enterPhase(e) {
  // a phase change is an event: clear the beat, punch the screen, breathe
  shockwave(e.x, e.y, 10, e.r + 190, 0.5, e.tint);
  burst(e.x, e.y, e.tint, 28, 300, 0.9);
  shake(10);
  e.patState = 2;
  e.patT = 0.9;
}

/**
 * The boss beat. Returns nothing; sets velocity like any other behaviour so the
 * shared separation and integration code still applies.
 */
export function updateBossBehavior(e, dt, ux, uy, dist, speed) {
  const def = e.bossDef;

  const frac = e.hp / e.maxHp;
  let ph = 0;
  for (let i = 0; i < def.phases.length; i++) if (frac <= def.phases[i].at) ph = i;
  if (ph !== e.bossPhase) { e.bossPhase = ph; enterPhase(e); return; }

  e.patT -= dt;

  if (e.patState === 0) {                 // WINDUP -- held still, flaring
    e.vx = e.vy = 0;
    if (e.patT <= 0) {
      e.patState = 1;
      e.patT = e.pat.duration;
      e.patAcc = 0;
      e.patCount = 0;
    }
  } else if (e.patState === 1) {          // EXECUTE
    e.vx = e.vy = 0;
    e.pat.run(e, dt);
    if (e.patT <= 0) { e.patState = 2; e.patT = e.pat.recover; }
  } else if (e.patState === 2) {          // RECOVER -- closes in, vulnerable
    // Walks straight at you instead of holding a range band. An earlier version
    // held at 210px, which made it literally unreachable for two of the three
    // Focuses -- a Field has 100px of reach and a Burst 170. Closing to contact
    // is also what makes the windups matter: the space you buy by backing off
    // is the resource the fight actually spends.
    // ...but stops at contact rather than walking through you. A 50px body
    // parked on the player's centre hides the one sprite you have to be able to
    // see, and the boss is already dealing contact damage at that range.
    const touch = e.r + G.player.radius;
    const close = dist > touch ? 1 : 0;
    e.vx = ux * speed * close;
    e.vy = uy * speed * close;
    if (e.patT <= 0) choosePattern(e);
  } else {                                // APPROACH -- striding in, no attacks
    // Boosted, because the spawn ring sits ~900px out and a boss that took the
    // better part of a minute to arrive turned its own entrance into downtime.
    e.vx = ux * speed * APPROACH_BOOST;
    e.vy = uy * speed * APPROACH_BOOST;
    if (dist < ENGAGE) choosePattern(e);
  }
}

/** Tint override that makes the tell unmissable in a full screen. */
export function bossTint(e) {
  if (e.patState === 3) return 0;          // approaching: no tell to show
  if (e.patState === 0) {
    // flicker faster as the windup completes
    const k = e.pat ? 1 - e.patT / e.pat.windup : 0;
    return Math.floor(G.t * (8 + k * 30)) % 2 === 0 ? 0xffffff : e.tint;
  }
  if (e.patState === 1) return 0xffffff;
  return 0;
}
