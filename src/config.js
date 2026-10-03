export const CFG = {
  runSeconds: 20 * 60,

  player: {
    hp: 100,
    moveSpeed: 195,
    radius: 13,
    pickup: 74,
    invuln: 0.35,      // global i-frames, so a 20-enemy pile can't delete you in one frame
  },

  world: {
    cellSize: 52,        // spatial hash cell; ~2x a mid enemy radius
    despawnRadius: 1500, // enemies that somehow get this far are recycled
    cullMargin: 90,      // px beyond the viewport before we stop drawing / separating
  },

  spawn: {
    maxEnemies: 1500,

    // The director targets a live POPULATION, not a spawn rate.
    //
    // A rate-based spawner silently depends on how fast the player kills: when
    // the HP curve came down, kill rate went up and the field emptied out even
    // though the spawn numbers had not changed. Targeting a population makes
    // density a design decision instead of a side effect -- if the player is
    // deleting the screen, more arrives to replace it.
    //
    //   target = popBase + popLin*minutes + popQuad*minutes^2
    //   minute  0 -> 15      minute 10 -> 285
    //   minute  5 -> 122     minute 15 -> 502     minute 20 -> 775
    //
    // Deliberately lower than a pure density target would suggest. Enemies were
    // dying on contact, which made On Hit chains fire constantly and left no
    // fight in anything. Fewer, tougher bodies give each hit somewhere to land.
    popBase: 15,
    popLin: 16,
    popQuad: 1.1,

    pulse: 0.30,         // seconds between top-up pulses
    // Fraction of the shortfall added per pulse. This governs how closely the
    // field tracks the target while the player is killing: at equilibrium the
    // shortfall settles at killRate / (fill / pulse), so a timid fill leaves a
    // permanent gap. At 0.5 a player killing 100/s sits ~60 short of target.
    fill: 0.50,
    maxPerPulse: 60,     // so a big deficit arrives as waves, not a wall of 400
    wallChance: 0.25,    // odds a pulse arrives as one tight arc
    ringPad: 70,         // spawn this far outside the viewport corner radius
    bossEvery: 150,      // seconds

    // Ranged enemies hold their distance instead of pressing in, so unlike
    // chase types they do not die at the rate they spawn -- left alone they
    // pile into an ever-growing outer ring until they ARE the field. Their
    // ceiling is a FRACTION of the target population so they stay a garnish at
    // every density; past it the director substitutes a chase type, leaving
    // total pressure unchanged and shifting only composition.
    rangedFraction: 0.045,
    minRanged: 6,
    maxRangedCap: 40,

    // Safety net on concurrent incoming fire, so a boss wave cannot flood it.
    maxShots: 70,
    // A boss pattern must never be silently truncated by the ambient shot
    // cap -- half a ring is unreadable and unfair. Boss fire draws from
    // this extra headroom instead.
    bossShotHeadroom: 130,
    bossWarn: 3.0,        // seconds of banner before a boss arrives
    // The field thins out hard during a fight. Two reasons, and the second is
    // the load-bearing one: the boss's patterns have to be legible, and the
    // player has to be able to actually hit the boss. Measured mid-fight, a
    // bare Projectile landed 13 dps on the boss against 48 in a clear arena --
    // auto-aim takes the nearest target and pierce is spent on adds long before
    // a shot reaches the thing with the health bar. Nothing despawns; the swarm
    // just stops being topped up, so the field drains as you fight.
    bossPopMul: 0.30,
  },

  // Enemy scaling over the run: ~5x HP by minute 10, ~12x by minute 20.
  // Tuned by measurement, not feel. A first pass at 1.6x base and a steeper
  // curve made a minute-five zombie take ten hits from a bare bolt, which
  // stalled kills and therefore levelling. This sits ~1.3x the old values --
  // enough that nothing dies on contact, not so much that the opening crawls.
  scaling: {
    hpLin: 0.34, hpQuad: 0.018, dmgLin: 0.11,
    // Bosses take only half the swarm's health curve. The swarm curve is
    // quadratic because player AOE damage grows quadratically too -- more
    // damage times more targets. Against a single boss only the first half
    // of that applies, so putting a boss on the full curve makes every
    // encounter after the first strictly longer than the one before.
    bossHpScale: 0.5,
  },

  // Flat multiplier on every archetype's base HP, so the whole roster can be
  // toughened without editing fourteen numbers.
  enemyHpMul: 1.25,

  // Growth granted automatically on every level, so progression exists without
  // putting stat cards on the upgrade screen.
  levelGrowth: { maxHp: 7, dmg: 0.055, crit: 0.004 },

  spell: {
    // How many PLACED persistent fields one compiled node may have alive at
    // once. Orbiting fields do not use this -- they refresh instead of
    // restacking -- but a field dropped at a location cannot, so an On Kill
    // field trigger would otherwise spawn one per corpse and run away.
    fieldCap: 6,

    // Geometry for a spell that has been given ORBITING movement but was not
    // born a field. A field already carries a radius in `range`, so it needs
    // none of this; a projectile's `range` is a TRAVEL DISTANCE (460px), and
    // reading it as an orbit radius would fling the bodies a screen and a half
    // away and inflate each one to a 200px blob. These are in line with the
    // trigger fields that already orbit -- Solid Defense's stones sit at 90px
    // and are 26 across.
    orbit: {
      dist: 120,     // px from the player the bodies circle at
      body: 30,      // radius of each body, before size runes
      life: 2.5,     // seconds, when the source spell has no lifetime of its own
      tick: 0.5,     // seconds between damage ticks, likewise
    },
    // A trail is MANY small short-lived patches -- that is what makes it a
    // trail -- so it cannot live under the same ceiling as a dropped vortex.
    // At 560 px/s and a patch every 44px it lays about 13 a second, so a five
    // second patch life wants roughly 65 alive at once. Under fieldCap it got
    // six, i.e. about a sixth of the trail, and then stopped drawing entirely
    // until they expired.
    trailCap: 72,
    maxSpells: 4,
    startNodes: 4,
    startAttunement: 6,
    // Link slots: how many children a node accepts. This is the structural
    // constraint that makes the editor a graph rather than a list.
    focusSlots: 3,
    runeSlots: 2,
    // Per-activation trigger cast cap. 0 means uncapped: we deliberately accept
    // the frame cost for now to find out what is fun before constraining it.
    // Mystralia uses 4; turning this on is a one-line change.
    triggerCap: 0,
  },

  maxPassives: 8,
};

/**
 * XP required to go from `level` to `level+1`.
 *
 * The old curve (0.28 * level^2) produced level 83 by minute ten -- an upgrade
 * card every few seconds, with no weight to any single pick. This quadratic
 * term is twelve times steeper, landing near level 22 at minute ten: roughly
 * one card every 25-30s, which is where the genre usually sits.
 *
 * Measured with a MOVING player. A stationary one collects almost no gems, so
 * any pacing number taken from a parked harness reads far too slow.
 */
export const xpForLevel = (level) => Math.floor(8 + level * 10 + level * level * 3.5);
