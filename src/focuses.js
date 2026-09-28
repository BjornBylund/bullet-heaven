/**
 * Focus types: the root of every spell tree.
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

  field: {
    id: 'field',
    name: 'Field',
    icon: '◉',
    color: 0xff8a4c,
    desc: 'A lingering area that grinds down whatever stands in it.',
    base: {
      dmg: 7,
      cooldown: 1.90,
      range: 100,      // radius of the field
      life: 2.00,      // slight overlap with cooldown, so it reads as continuous
      tick: 0.60,      // slower grind: its strength is uptime, not burst

      radius: 0,
    },
  },
};

export const FOCUS_IDS = Object.keys(FOCUSES);
