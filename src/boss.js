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
// ...and the distance at which it gives up on the current beat and strides
// after the player again. A boss only moves during RECOVER, so one that was
// engaged once and then outrun stands in place running patterns at someone a
// screen and a half away -- measured at 13,000px while the Ruin dutifully
// fired rings into empty space.
const DISENGAGE = 620;

// ---------------------------------------------------------------------------
// attack patterns
// ---------------------------------------------------------------------------
//
// `run(e, dt)` is called every frame of EXECUTE. Patterns that fire once do so
// on the first frame; sustained ones accumulate against `e.patAcc`.

/**
 * Scales a pattern's projectile count by rage.
 *
 * Phases already thicken the patterns, but in four steps -- and a boss whose
 * whole job is to close the screen should do it continuously. By full rage a
 * ring carries nearly twice the shots it opened with, which is what turns
 * "walk through the gap" into "there is no gap".
 *
 * Normal bosses have no rage, so this is the identity for them.
 */
const dense = (e, n) => Math.round(n * (1 + 0.9 * (e.rage || 0)));

const PATTERNS = {
  /** A full ring of slow shots. Punishes standing still; always has a gap to walk through. */
  radial: {
    windup: 0.85, duration: 0.15, recover: 1.1,
    run(e) {
      if (e.patCount++) return;
      const n = dense(e, 12 + e.bossPhase * 5);
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
      const n = dense(e, 11 + e.bossPhase * 4);
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
        const arms = dense(e, 2 + e.bossPhase);
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
      const n = dense(e, 5 + e.bossPhase * 2);
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
        const n = dense(e, 10);
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

/** How many scheduled bosses the player clears before the run's last fight. */
export const FINAL_AFTER = BOSS_IDS.length;

/**
 * The run's ending.
 *
 * Arrives the moment the third boss dies, and finishes the run. There is no
 * timer and no win condition: the twenty minute cap was never an ending, it
 * was a timeout, and a game whose conclusion is "the clock ran out" has no
 * final beat. This is the final beat, and it always lands.
 *
 * IT CANNOT BE KILLED. It takes no damage at all, and nothing it does is a
 * fight to be won -- it is how the run stops. What it still does is MOVE like
 * a boss: the same windup-execute-recover loop and the same readable tells,
 * because an ending you cannot read is just a wall. Rage then takes those
 * readable beats and closes them in -- faster, denser, and finally quicker
 * than the player -- so the only question left is how long.
 *
 * It wears a skull, which took the enemy layer to SIXTEEN textures -- exactly
 * Pixi's per-batch sampler limit. Measured after adding it, with all sixteen
 * on screen at once and 440 enemies: 0.1ms average render. Batching held. The
 * next shape after this one does need a second layer.
 */
export const FINAL_BOSS = {
  id: 'ruin',
  name: 'THE RUIN',
  title: 'Nothing Was Built To Last',
  final: true,
  // `hp` is inert: it takes no damage, so this is only what the health bar
  // would have read, and the bar is hidden for it. Its phases run on rage.
  hp: 7000, r: 72, speed: 74, dmg: 115, xp: 0,
  // Pale violet. Bone-white is what a skull wants and is the one colour it
  // cannot have: white is the windup tell every boss flashes, and a boss that
  // is already white has no tell left. Red is spoken for by enemy projectiles.
  // This is as close to bone as the palette allows while keeping the flash
  // readable against it.
  tint: 0xc9b8e8, shape: 'skull',
  adds: ['charger', 'runner'],
  // Shot speed is the single number that decides whether this fight can end.
  // The player moves at 195, so every other boss's fire -- 128 to 150 -- is
  // outrun by simply walking away from it, which measured as a player
  // surviving the Ruin indefinitely. At 250 it closes, and running is a way to
  // buy a second rather than a way to opt out of the fight.
  shot: { speed: 250, dmg: 48, r: 13, life: 7, tint: HOSTILE.deep },
  // No phase opens on a single pattern. Every other boss earns its density by
  // degrading; this one starts where they finish.
  phases: [
    { at: 1.00, patterns: ['doubleRing', 'spiral', 'volley'] },
    { at: 0.72, patterns: ['spiral', 'doubleRing', 'charge', 'summon'] },
    { at: 0.45, patterns: ['doubleRing', 'spiral', 'charge', 'volley', 'summon'] },
    { at: 0.20, patterns: ['doubleRing', 'spiral', 'charge', 'doubleRing', 'summon'] },
  ],
};

/**
 * Seconds for the final boss to reach full rage.
 *
 * Rage exists to guarantee the run ENDS. Without it a patient player can kite
 * the last fight indefinitely and the game has merely swapped one timeout for
 * another. With it, every second the fight lasts is a second the player has
 * less room, so the encounter resolves one way or the other.
 */
const RAGE_FULL = 75;

/**
 * Rage shortens RECOVER hard and the WINDUP barely at all.
 *
 * That split is the whole of it. Recover is the player's breathing room and
 * their damage window, so taking it away is what makes the fight close in.
 * Windup is the TELL -- the thing that makes a hit the player's fault rather
 * than the game's -- and an unreadable tell is not difficulty, it is noise. So
 * the boss gets relentless without ever becoming unfair.
 */
function ragePace(e, phase) {
  const r = e.rage || 0;
  return phase === 'recover' ? 1 - 0.70 * r : 1 - 0.20 * r;
}

/**
 * Dev: jump the rage ramp to a point, rather than waiting 75 seconds for it.
 *
 * Writes the CLOCK, not the value -- `tickRage` recomputes `rage` from
 * `rageT` every frame, so setting `rage` directly is overwritten before
 * anything reads it.
 */
export function setBossRage(e, v) {
  e.rageT = RAGE_FULL * Math.max(0, Math.min(1, v));
  // Applied immediately rather than left for the next frame. `rage` and every
  // stat derived from it are recomputed by `tickRage`, so without this the
  // tool reports a value the boss has not taken yet -- and a paused or stalled
  // game would report it forever.
  tickRage(e, 0);
  return e.rage;
}

function tickRage(e, dt) {
  e.rageT += dt;
  e.rage = Math.min(1, e.rageT / RAGE_FULL);
  e.dmg = e.baseDmg * (1 + e.rage);
  e.shotDef.dmg = e.baseShotDmg * (1 + e.rage * 1.2);
  // Ends at 1.35x the player's own speed. A boss that cannot out-walk the
  // player can be kited forever no matter how hard it hits, and the whole
  // point of this fight is that it concludes.
  e.speed = e.baseSpeed * (1 + 2.6 * e.rage);
  e.shotDef.speed = e.baseShotSpeed * (1 + 0.4 * e.rage);
}

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
export function initBossState(e, def, dmgMul = 1) {
  e.bossDef = def;
  e.shotDef = Object.assign({}, def.shot);
  // Scaled HERE rather than by the caller afterwards. The rage ramp reads
  // `baseShotDmg` and rewrites `shotDef.dmg` from it every frame, so a caller
  // that scaled the shot after this ran would have its scaling silently undone
  // on the final boss's first frame.
  e.shotDef.dmg = Math.round(e.shotDef.dmg * dmgMul);
  e.bossPhase = 0;
  e.patState = 3;          // APPROACH: stride in before the fight starts
  e.patT = 0;
  e.pat = null;
  e.patAcc = 0;
  e.patCount = 0;
  e.patAngle = 0;
  // Rage reads off these, so the ramp is always relative to the definition
  // rather than compounding on last frame's already-raised value.
  e.rage = 0;
  e.rageT = 0;
  e.baseDmg = e.dmg;
  e.baseShotDmg = e.shotDef.dmg;
  e.baseSpeed = e.speed;
  e.baseShotSpeed = e.shotDef.speed;
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
  e.patT = e.pat.windup * ragePace(e, 'windup');
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
  if (def.final) tickRage(e, dt);

  if (e.patState !== 3 && dist > DISENGAGE) {
    e.patState = 3;               // back to APPROACH: come and find them
    e.pat = null;
    e.patName = '';
  }

  // Phases are health thresholds for every other boss. The Ruin never loses
  // any, so its phases run on RAGE instead and it escalates on a clock -- the
  // same four pattern pools, reached by surviving rather than by damage.
  const frac = def.final ? 1 - e.rage : e.hp / e.maxHp;
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
    if (e.patT <= 0) { e.patState = 2; e.patT = e.pat.recover * ragePace(e, 'recover'); }
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
