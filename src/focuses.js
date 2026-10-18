/**
 * Focus types: the root of every spell tree.
 *
 * This table does double duty. `FOCUS_IDS` is what the player may CHOOSE, but
 * every entry is also the base-stat block for an entity KIND -- a trigger
 * effect declaring `kind: 'field'` is compiled from FOCUSES.field, and so is
 * the fire trail. That is why `field` is still here after being dropped from
 * character select: Solid Defense, Flash of Swords, Perfect Storm and the
 * trail all spawn field entities and would have nothing to compile from.
 *
 * `kind` is therefore separate from the key. Cone is a Projectile at runtime;
 * it differs only in the flags it is born with.
 *
 * A Focus decides what kind of entity appears in the world. It is the only
 * thing that spawns entities -- a rune never spawns on its own, and a trigger
 * rune hosts a nested Focus which is what does the spawning. That is what makes
 * the worst-case entity count countable from the tree alone.
 *
 * All three cast on a cooldown and produce entities with a finite life, which
 * keeps the runtime uniform.
 */

export const FOCUSES = {
  projectile: {
    id: 'projectile',
    kind: 'projectile',
    name: 'Projectile',
    icon: '➤',
    color: 0x6fd3ff,
    desc: 'Pierces a line through the crowd. Fires fast, hits hard per target.',
    base: {
      dmg: 20,
      // Fires more than twice as often as it used to. Cadence is worth double
      // here: every cast is also an On Cast trigger, so rate buys trigger
      // uptime as well as damage.
      cooldown: 0.42,
      // Slower and longer-lived than it was: 560 speed over 460px meant a bolt
      // existed for 0.82s and was gone. At 380 over 620 it lasts 1.63s, so a
      // shot is something you watch cross the field rather than a line that
      // appears and resolves -- and it spends more of its pierce on the way.
      range: 620,      // travel distance, which is also its lifetime
      speed: 380,
      radius: 7,
    },
    // BASE PIERCE is the structural half of the fix. Measured against a packed
    // crowd, a no-pierce Projectile managed 15 dps against a Burst's 738 -- not
    // because its damage was low, but because one cast touched one enemy, which
    // divides its trigger delivery by the crowd as well. Piercing four bodies
    // multiplies damage and trigger firings at the same time.
    baseFlags: { pierce: 3 },
  },

  // NOT player-selectable any more (see FOCUS_IDS). Kept because Shattering
  // End compiles its corpse detonation from these numbers, exactly as `field`
  // is kept for the trigger effects that spawn one.
  burst: {
    id: 'burst',
    kind: 'burst',
    name: 'Burst',
    icon: '✹',
    color: 0x7fe3ff,
    desc: 'Resolves at a point, expanding outward. Strongest against a crowd.',
    base: {
      dmg: 24,
      // slowed to make room for the other two; hitting everything in a radius
      // is worth far more than cadence
      cooldown: 3.20,
      range: 170,      // radius the shockwave expands to
      expand: 0.34,    // seconds to reach full radius
      radius: 0,
    },
  },

  cone: {
    id: 'cone',
    kind: 'projectile',       // three ordinary projectiles, fanned
    look: 'lightning',        // distinct from Projectile's single bolt
    name: 'Cone',
    icon: '≺',
    color: 0xc9a0ff,
    desc: 'Three bolts in a fan. Everything lands up close; one does at range.',
    base: {
      // The middle ground between one accurate shot and a full-radius blast:
      // more targets than Projectile, far less than Burst, and it has to be
      // aimed. Damage is PER BOLT, so a cast is three times this.
      // Per-bolt damage is kept near Projectile's on purpose. Splitting the
      // same total across more, weaker bolts spreads damage so thinly that
      // nothing dies: at 15 per bolt the kill rate measured 0.8/s against
      // Projectile's 2.8, because a zombie needed four hits instead of three.
      dmg: 22,
      cooldown: 0.68,
      range: 340,
      speed: 500,
      radius: 7,
    },
    // `cone` is the half-angle of the fan; `split` is how many bolts. Range
    // does the balancing for free -- at point blank all three strike one body,
    // at full range they have spread far enough that only the centre does.
    // A WIDE fan, deliberately. At 0.38 all three bolts still converged on a
    // single body at normal engagement range, which made Cone a better
    // single-target spell than Projectile -- exactly backwards.
    baseFlags: { split: 3, cone: 0.52, pierce: 2 },
  },

  /**
   * A fast stream of bolts that curve as they fly.
   *
   * The third slot was an ORBIT focus before this -- bodies circling the
   * player -- and it failed for a reason worth writing down. Enemies converge
   * on the player and stop at contact range, so the dense part of a crowd sits
   * within about 60px of you; a ring at 120px is a donut with the fight
   * happening in its hole. Benched against a static crowd it looked 2.7x too
   * strong, and measured in a real run with enemies actually chasing it scored
   * ZERO kills in fifteen seconds while Projectile scored 51.
   *
   * Spiral keeps the thing orbiting was reaching for -- an effect that covers
   * the space around you rather than a line you aim -- without the hole. The
   * bolts bend tightly enough to stay inside that 60px shell instead of
   * arcing out over it, and at this cadence the overlapping arcs read as
   * cover rather than as separate shots.
   */
  spiral: {
    id: 'spiral',
    kind: 'projectile',
    look: 'flame',
    name: 'Spiral',
    icon: '◎',
    color: 0x9fe3c4,
    desc: 'A rapid stream of curving bolts. Covers ground rather than aiming at it.',
    base: {
      dmg: 7,
      cooldown: 0.19,    // nearly half Projectile's, which is the whole idea
      range: 280,        // literal reach: how far the arm gets from you
      speed: 150,        // how fast it opens out, so it lives 280/150 = 1.9s
      radius: 7,
    },
    // `spiral` is the sweep rate in rad/s, and it is capped by what happens at
    // the RIM: tangential speed is radius x sweep, so a bolt 280px out at 1.3
    // is already moving 364px/s sideways on top of its 150px/s outward. Two
    // earlier attempts (2.6 and 3.8) looked frantic for exactly this reason --
    // most of a bolt's life is spent far enough out that the sweep dominates.
    // At 1.3 one bolt covers about 130 degrees before it expires, and the
    // stream reads as a spiral because the LAUNCH bearing steps between casts
    // (SPIRAL_STEP in cast.js), not because any single bolt goes all the way
    // round.
    //
    // Pierce is high because the CURVE has to be visible, and at pierce 2 it
    // was not: measured in a crowd, every bolt was consumed inside the frame
    // it spawned in, so the focus fired an invisible stream and the spiral
    // never happened on screen. A bolt needs to survive a few bodies to live
    // long enough to bend.
    baseFlags: { spiral: 1.3, pierce: 5 },
  },

  // NOT player-selectable (see FOCUS_IDS). Kept because trigger effects and the
  // fire trail compile their field entities from these numbers.
  field: {
    id: 'field',
    kind: 'field',
    name: 'Field',
    icon: '◉',
    color: 0xff8a4c,
    desc: 'A lingering area that grinds down whatever stands in it.',
    base: {
      dmg: 7,
      cooldown: 1.90,
      range: 100,
      life: 2.00,
      tick: 0.60,
      radius: 0,
    },
  },
};

/** What the player may pick. `field` and `burst` are kinds, not choices. */
export const FOCUS_IDS = ['projectile', 'cone', 'spiral'];
