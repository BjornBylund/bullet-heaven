/**
 * What each entity kind actually READS, and the handful of judgement calls.
 *
 * The suite's verdict for "this rune did nothing" needs to distinguish a BUG
 * from a rune that was never going to matter here. Pierce on a Burst is not
 * broken -- a burst hits everything inside its radius and has no concept of
 * passing through a body. Orbit on a Projectile IS broken, because the rune
 * says "adds orbiting movement", charges three attunement for it, and the
 * projectile code never looks at the flag.
 *
 * Both look identical from outside: a flag changes, behaviour does not. The
 * difference is whether the owning kind was ever supposed to read it. So that
 * is written down, once, here.
 *
 * KEEPING THIS HONEST. The table is derived from the update functions in
 * cast.js -- `updateProjectile`, `updateBurst`, `updateField` -- plus the
 * shared paths (`castSpell`, `spawn`, `dealDamage`). `npm run test:consumes`
 * greps the source for every flag named below and fails if one is listed as
 * consumed but appears nowhere, which is what stops the table drifting away
 * from the code as runes are added.
 */

// Read by every kind: set in castSpell/spawn, or applied in dealDamage.
const SHARED = [
  'stats.dmg', 'stats.cooldown', 'stats.range',
  'flags.size', 'flags.split', 'flags.crit', 'flags.critVsBurn',
  'flags.vsFrozen', 'flags.vsChilled', 'flags.knock', 'flags.baseSize',
  'statuses', 'look', 'triggerCount',
];

// Read by castSpell when laying out copies. emitField ignores all of it, so a
// field's copies are placed by the orbit/cap rules instead.
const LAYOUT = ['flags.scatter', 'flags.ring', 'flags.line', 'flags.cone'];

export const CONSUMES = {
  projectile: [
    ...SHARED, ...LAYOUT,
    'stats.speed',          // velocity, and the trail's drip spacing
    'flags.pierce',         // bodies passed through before dying
    'flags.homing',
    'flags.spiral',
    'flags.returns',
    'flags.grow',           // radius grows with distance travelled
    'spacing', 'cap', 'alpha',   // trail descriptor
  ],
  burst: [
    ...SHARED, ...LAYOUT,
    'stats.expand',         // seconds to reach full radius; also its lifetime
  ],
  field: [
    ...SHARED,
    'stats.life',
    'stats.tick',
    'flags.orbit',
    'flags.anchor',
    'flags.pull',
    'flags.grow',
    'cap', 'alpha', 'spacing',
  ],
};
// Cone is a Projectile at runtime -- same entity, same update function.
CONSUMES.cone = CONSUMES.projectile;

/** Does this focus's code path ever read the key the rune changed? */
export function consumes(kind, key) {
  const list = CONSUMES[kind] || CONSUMES.projectile;
  return list.includes(key) || key.startsWith('trigger');
}

/**
 * Runes that need a different world to be measurable at all.
 *
 * Not a fudge: each one states a condition the rune is explicitly gated on, and
 * measuring it in a world without that condition would report a verdict about
 * the world. The rune-bench in tools/ carries the same warning about density.
 */
const DENSE = { crowd: 90, crowdNear: 40, crowdFar: 300 };

export const WORLD = {
  // Projectile is born with pierce 3 and meets barely two bodies in a sparse
  // crowd, so more pierce buys nothing there. Measured dense it goes from 3
  // hits to 11.6 and nearly triples its damage.
  piercingEyes: DENSE,
  silentGrudge: DENSE,         // also grants pierce

  // Conditional on a debuff a bare spell never applies. Holding the condition
  // open measures the rune rather than the spell that failed to set it up.
  frostbite: { preStatus: ['freeze'] },
  burnedToDeath: { preStatus: ['burn'] },
  deepFreeze: { preStatus: ['chill'] },
};

/**
 * Trees for runes that cannot be measured sitting alone under the Focus.
 *
 * A positional rune reads the graph around it: Pressure Buildup multiplies by
 * the number of runes ABOVE it, which is zero when it is the only child, so it
 * compiles to an identical spell and looks like a dead rune. The function is
 * called with the rune node, and with `null` to build the matching bare tree,
 * so both sides of the comparison carry the same scaffolding and only the rune
 * under test differs.
 */
const CHAIN = (n) => [{ id: 'heavyBurden', level: 1, children: n ? [n] : [] }];

export const TREE = {
  pressureBuildup: CHAIN,
};

/**
 * Runes whose headline promise maps to one specific channel.
 *
 * Without this a rune can pass by accident. Self-Centered raises Spawn count
 * and Duration as well as adding orbiting movement, so it changes SOMETHING on
 * every focus and a plain did-anything-happen test calls it working -- while
 * the orbiting, the reason it costs three attunement, never happens at all.
 */
export const CLAIMS = {
  // `kinds` scopes a claim to the entity kinds it was ever meant to apply to.
  // Short Fuse cuts range on projectiles ONLY -- deliberately, because on a
  // field `range` is the radius and cutting it measured at -100% damage. Its
  // damage and speed still apply everywhere, so the rune is not inert on a
  // burst; only its range promise is, and only there.
  selfCentered: { channel: 'avgSweep', says: 'adds orbiting movement' },
  messengerOfPeace: { channel: 'avgSweep', says: 'homing' },
  piercingEyes: { channel: 'avgHits', says: 'pierce +N' },
  speedUp: { channel: 'maxDist', says: 'projectile speed' },
  shortFuse: { channel: 'maxDist', says: 'shorter range', kinds: ['projectile', 'cone'] },
  heavyHitter: { channel: 'damage', says: 'more damage' },
  heavyBurden: { channel: 'damage', says: 'more damage and size' },
  freneticEnergy: { channel: 'ownEntities', says: 'faster cadence' },
  backAndForth: { channel: 'ownEntities', says: 'more copies' },
  starsAligned: { channel: 'ownEntities', says: 'more copies' },
  firewalking: { channel: 'statusStacks', says: 'applies Burn' },
  icyWind: { channel: 'statusStacks', says: 'applies Chill' },
  potentBurn: { channel: 'damage', says: 'stronger Burn' },
  destructivePath: { channel: 'entities', says: 'leaves a fire trail' },
  ret: { channel: 'avgLifeFrames', says: 'returns to you' },
};

/**
 * Explicit exceptions, for cases the consumption table cannot express.
 * `false` means "expected to do nothing here". Keep this list short: an entry
 * is a decision that a rune may charge attunement and do nothing.
 */
export const EXPECT = {
  // Rolling Stone's boulder is born with pierce 99 -- it already ploughs
  // through everything -- so more pierce has nothing left to buy.
  'piercingEyes>rollingStone': false,

  // Spiraling Rage sets `spiral`, and updateProjectile reads
  // `if (f.spiral) ... else if (f.homing)`. Spiral wins outright, so homing on
  // a spiralling bolt is dead by construction. Worth knowing when reading the
  // rune table: these two runes do not combine.
  'messengerOfPeace>spiralingRage': false,

  // Both triggers already apply Burn (2 and 3 stacks). More Burn lands on
  // bodies that are already burning, and the fingerprint counts stacks, not
  // appliers.
  'firewalking>spiralingRage': false,
  'firewalking>furiousOutburst': false,

  // Both already set `orbit: 1` in their own effect: the stones and the blades
  // circle you by definition. Self-Centered has no orbiting left to add.
  'selfCentered>solidDefense': false,
  'selfCentered>flashOfSwords': false,

  // A trigger's projectile is born with pierce 0, and these triggers cast INTO
  // the crowd, so it dies on the first body it touches. Measured: Gust of
  // Wind's wind ball covers 33px of its 300px range with a crowd present, and
  // 293px with the crowd removed -- where Return then works perfectly, flying
  // 860px and coming back. So these runes are not dead, they are starved: the
  // bolt never survives far enough for a travel-shaping rune to matter.
  //
  // Left as an expectation rather than "fixed", because the only fix is to
  // give trigger projectiles pierce, and that is a balance decision rather
  // than a correctness one.
  'ret>gustOfWind': false,
  'ret>spiralingRage': false,
  'messengerOfPeace>gustOfWind': false,
};

export const REASON = {
  'piercingEyes>rollingStone': 'the boulder already has pierce 99',
  'messengerOfPeace>spiralingRage': 'spiral takes precedence over homing in updateProjectile',
  'firewalking>spiralingRage': 'the trigger already applies Burn',
  'firewalking>furiousOutburst': 'the trigger already applies Burn',
  'selfCentered>solidDefense': 'the stones already orbit',
  'selfCentered>flashOfSwords': 'the blades already orbit',
  'ret>gustOfWind': 'the wind ball dies on contact after 33px of its 300px range',
  'ret>spiralingRage': 'the bolt dies on contact long before reaching full range',
  'messengerOfPeace>gustOfWind': 'the wind ball dies on contact before homing can curve it',
};

export const reason = (id, target) => REASON[`${id}@${target}`] || REASON[`${id}>${target}`] || '';
