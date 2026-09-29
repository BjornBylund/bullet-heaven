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
      range: 460,      // travel distance
      speed: 560,
      radius: 7,
    },
    // BASE PIERCE is the structural half of the fix. Measured against a packed
    // crowd, a no-pierce Projectile managed 15 dps against a Burst's 738 -- not
    // because its damage was low, but because one cast touched one enemy, which
    // divides its trigger delivery by the crowd as well. Piercing four bodies
    // multiplies damage and trigger firings at the same time.
    baseFlags: { pierce: 3 },
  },

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

/** What the player may pick. `field` is a kind, not a choice -- see above. */
export const FOCUS_IDS = ['projectile', 'cone', 'burst'];
