import { CHILL, BURN, BRITTLE } from './status.js';

/**
 * Runes, modelled on the Memory cards of Echoes of Mystralia.
 *
 * Two kinds only:
 *
 *   TRIGGER  - a complete effect with a condition. `On Spawn` fires once per
 *              ENTITY the parent creates, so a three-bolt Cone fires it three
 *              times; the other conditions already scaled that way. It casts something of its
 *              own, for a PERCENTAGE of the damage of the Spell or Trigger
 *              above it. Triggers are not plumbing you have to fill; socketing
 *              one immediately does something.
 *
 *   MODIFIER - changes the Spell or Trigger it hangs under.
 *
 * Every rune has a tier (common/rare/epic), 0-3 focus points (the attunement
 * cost), and three levels whose numbers step hard rather than creeping.
 * Tier and level together are the power curve now that passives are gone.
 *
 * `dmg` is a multiplier on the parent it attaches to. Penalties are
 * multiplicative and do NOT compound down the chain -- a trigger's effect
 * starts from its own percentage and is modified only by its own children.
 */

export const MAX_RUNE_LEVEL = 3;

/**
 * COST AND TIER ARE BOTH DERIVED FROM MEASURED POWER, not chosen by feel.
 * `tools/rune-bench.js` scores every rune on three axes -- crowd damage, crowd
 * kill rate, and single-target damage -- and a rune's power is its BEST axis,
 * because specialising is meant to be viable.
 *
 * Ranked by that score: the top five are epic and cost 3, the next seven cost
 * 2, and so on down. Anything that scores below the bench's resolution costs
 * NOTHING, because charging attunement for a rune that cannot be shown to do
 * anything is a trap rather than a decision.
 *
 * Before this pass the two were uncorrelated with power and with each other:
 * sixteen of twenty-two modifiers were free, the two epics were the weakest
 * damage runes in the game, and a common costing 3 sat beside a rare costing 0.
 * Re-measure and re-derive after any change to the runtime -- the last pass
 * moved twenty-six of thirty-three runes.
 */
export const TIERS = {
  common: { name: 'Common', color: 0x9fb4d4, weight: 1.00 },
  rare:   { name: 'Rare',   color: 0x6fb4ff, weight: 0.45 },
  epic:   { name: 'Epic',   color: 0xc98bff, weight: 0.16 },
};

/** Picks the value for a level from a 3-entry table. */
export const lv = (v, level) => (Array.isArray(v) ? v[Math.min(level, v.length) - 1] : v);

const pct = (n) => `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`;

// ---------------------------------------------------------------------------
// triggers
// ---------------------------------------------------------------------------
//
// `effect` describes what the trigger casts. `kind` reuses the three Focus
// shapes so the runtime needs no new entity types; everything else is
// parameters on top.

export const TRIGGERS = {
  furiousOutburst: {
    name: 'Furious Outburst', icon: '✹', color: 0xff7a3c,
    tier: 'rare', cost: 2, when: 'hit',
    effect: {
      kind: 'projectile', count: [3, 4, 5], scatter: true, look: 'flame',
      dmgPct: [0.20, 0.35, 0.60], speed: 330, range: 220, size: 9,
      status: { idx: BURN, stacks: [1, 2, 3] },
    },
    desc: (l) => `On hit, casts ${lv([3, 4, 5], l)} fireballs in random directions. ` +
                 `Damage ${Math.round(lv([0.20, 0.35, 0.60], l) * 100)}% · Apply ${lv([1, 2, 3], l)} Burn.`,
  },

  cruelThorns: {
    name: 'Cruel Thorns', icon: '❄', color: 0x86c8ff,
    tier: 'rare', cost: 2, when: 'hit',
    effect: {
      kind: 'projectile', count: [3, 4, 5], ring: true, look: 'ice',
      dmgPct: [0.60, 0.65, 0.70], speed: 260, range: 150, size: 8,
      status: { idx: CHILL, stacks: [6, 8, 10] },
    },
    desc: (l) => `On hit, casts ${lv([3, 4, 5], l)} ice fragments around the target. ` +
                 `Damage ${Math.round(lv([0.60, 0.65, 0.70], l) * 100)}% · Apply ${lv([6, 8, 10], l)} Chill.`,
  },

  firstSnow: {
    name: 'First Snow', icon: '❅', color: 0x9fe4ff,
    tier: 'common', cost: 0, when: 'hit',
    effect: {
      kind: 'projectile', count: 1, homing: 3.5, look: 'ice',
      dmgPct: [0.10, 0.15, 0.25], speed: 700, range: 380, size: 7,
      status: { idx: CHILL, stacks: [4, 6, 9] },
    },
    desc: (l) => `On hit, casts a speedy ice shard. ` +
                 `Damage ${Math.round(lv([0.10, 0.15, 0.25], l) * 100)}% · Apply ${lv([4, 6, 9], l)} Chill.`,
  },

  spiralingRage: {
    name: 'Spiraling Rage', icon: '@', color: 0xff9a5c,
    tier: 'common', cost: 1, when: 'spawn',
    effect: {
      kind: 'projectile', count: [1, 1, 2], spiral: 3.2, look: 'flame',
      dmgPct: [0.45, 0.80, 1.50], speed: 200, range: 520, size: 11,
      status: { idx: BURN, stacks: [1, 1, 2] },
    },
    desc: (l) => `On spawn, casts a fire projectile that spirals outward. ` +
                 `Damage ${Math.round(lv([0.45, 0.80, 1.50], l) * 100)}% · ` +
                 `Apply ${lv([1, 1, 2], l)} Burn.`,
  },

  solidDefense: {
    name: 'Solid Defense', icon: '◆', color: 0x9aa4b2,
    tier: 'common', cost: 1, when: 'spawn',
    effect: {
      kind: 'field', count: [2, 2, 3], orbit: true, look: 'stone', blocks: true,
      dmgPct: [0.60, 0.60, 0.60], range: 90, life: 5.5, tick: 0.3, size: 26,
    },
    desc: (l) => `On spawn, sets ${lv([2, 2, 3], l)} stones orbiting you. Damage 60%.`,
  },

  gustOfWind: {
    name: 'Gust of Wind', icon: '≋', color: 0x8fe3c4,
    tier: 'common', cost: 1, when: 'distance',
    effect: {
      kind: 'projectile', count: 1, look: 'wind',
      dmgPct: [0.30, 0.45, 0.70], speed: 400, range: 300, size: 14,
    },
    desc: (l) => `After 60% of its travel, expansion or duration, casts a wind ball. ` +
                 `Damage ${Math.round(lv([0.30, 0.45, 0.70], l) * 100)}%.`,
  },

  flashOfSwords: {
    name: 'Flash of Swords', icon: '⚔', color: 0xffe066,
    tier: 'rare', cost: 2, when: 'spawn',
    effect: {
      kind: 'field', count: [2, 3, 4], orbit: true, look: 'blade',
      dmgPct: [0.20, 0.35, 0.60], range: 130, life: 3.2, tick: 0.22, size: 20,
      crit: [0.05, 0.10, 0.20],
    },
    desc: (l) => `On spawn, spins ${lv([2, 3, 4], l)} blades around you. ` +
                 `Damage ${Math.round(lv([0.20, 0.35, 0.60], l) * 100)}% · ` +
                 `Critical ${pct(lv([0.05, 0.10, 0.20], l))}.`,
  },

  perfectStorm: {
    name: 'Perfect Storm', icon: '⦰', color: 0x7fe3c4,
    tier: 'epic', cost: 3, when: 'kill',
    effect: {
      // Cut hard. On kill, in a crowd, every tornado drags bodies together and
      // kills more, spawning more tornados -- measured at twenty-seven times
      // the bare spell's kill rate, five times the next best rune in the game.
      // Capping concurrent fields slowed the loop; these numbers stop it being
      // the only rune worth taking.
      //
      // `pull` is a SPEED in px/s. It used to be fed raw into the knockback
      // channel, which bleeds off at 9/s, so 130 produced 14px/s of real drift
      // -- against a zombie's 74px/s walk, which is why the vortex visibly did
      // nothing. Measured on a crowd walking past it over four seconds, the
      // old behaviour held them 11px closer than no tornado at all.
      //
      // 70 is chosen to roughly cancel a zombie's walk: the crowd settles
      // around 85px from the eye, well inside the 150px radius so they keep
      // taking ticks, and can still be walked out of. 130 is a singularity --
      // everything collapses to within 10px and stays there.
      // NO CHILL. It used to apply 3-5 stacks per 0.35s tick, back when Chill
      // froze at 20 -- so a crowd the vortex had already gathered was frozen
      // solid inside about two seconds. Holding a pack in place and then
      // removing its ability to leave are the same effect bought twice, on a
      // rune that was already the strongest in the game. The gather is the
      // effect; the air cluster around it is the rest of the idea.
      kind: 'field', count: 1, pull: 70, look: 'vortex',
      dmgPct: [0.18, 0.24, 0.38], range: 150, life: [3, 3.5, 4.5], tick: 0.35, size: 0,
    },
    desc: (l) => `On kill, spawns a tornado that drags foes inward. ` +
                 `Damage ${Math.round(lv([0.18, 0.24, 0.38], l) * 100)}%.`,
  },

  shatteringEnd: {
    name: 'Shattering End', icon: '❈', color: 0xff6ad5,
    tier: 'rare', cost: 2, when: 'kill',
    effect: {
      kind: 'burst', count: 1, look: 'shatter',
      dmgPct: [0.35, 0.55, 0.95], range: [90, 120, 160], expand: 0.26,
      status: { idx: BRITTLE, stacks: [1, 2, 2] },
    },
    desc: (l) => `On kill, detonates the corpse. ` +
                 `Damage ${Math.round(lv([0.35, 0.55, 0.95], l) * 100)}% · Apply Brittle.`,
  },

  // The mirror of Perfect Storm: a NEGATIVE pull pushes instead of gathering,
  // which falls out of the same line of maths and needs no new runtime.
};

// ---------------------------------------------------------------------------
// modifiers
// ---------------------------------------------------------------------------

export const MODIFIERS = {
  heavyBurden: {
    name: 'Heavy Burden', icon: '⚒', color: 0xb0a48c,
    tier: 'common', cost: 0,
    apply: (c, l) => {
      c.stats.dmg *= 1 + lv([0.15, 0.25, 0.40], l);
      c.flags.size *= 1 + lv([0.20, 0.35, 0.60], l);
    },
    desc: (l) => `Damage ${pct(lv([0.15, 0.25, 0.40], l))} · Size ${pct(lv([0.20, 0.35, 0.60], l))}.`,
  },

  heavyHitter: {
    name: 'Heavy Hitter', icon: '⛏', color: 0xff9c60,
    tier: 'epic', cost: 3,
    apply: (c, l) => {
      c.stats.dmg *= 1 + lv([0.50, 0.90, 1.55], l);
      c.stats.speed *= 1 - lv([0.25, 0.50, 0.80], l);
    },
    desc: (l) => `Damage ${pct(lv([0.50, 0.90, 1.55], l))} · Speed ${pct(-lv([0.25, 0.50, 0.80], l))}.`,
  },

  piercingEyes: {
    name: 'Piercing Eyes', icon: '⇢', color: 0xffe066,
    tier: 'common', cost: 0,
    apply: (c, l) => { c.flags.pierce += lv([3, 6, 10], l); },
    desc: (l) => `Pierce +${lv([3, 6, 10], l)}.`,
  },

  messengerOfPeace: {
    name: 'Messenger of Peace', icon: '↻', color: 0xfff2b0,
    tier: 'common', cost: 0,
    apply: (c, l) => { c.flags.homing += lv([2.0, 4.0, 7.0], l); },
    desc: (l) => `Homing ${lv(['60°', '120°', '180°'], l)}.`,
  },

  speedUp: {
    name: 'Speed Up', icon: '»', color: 0x8fd6ff,
    tier: 'common', cost: 0,
    apply: (c, l) => { c.stats.speed *= 1 + lv([0.25, 0.45, 0.80], l); },
    desc: (l) => `Speed ${pct(lv([0.25, 0.45, 0.80], l))}.`,
  },

  shortFuse: {
    name: 'Short Fuse', icon: '⏱', color: 0xc9a0ff,
    tier: 'common', cost: 1,
    apply: (c, l) => {
      // Projectiles only. On a Field, `range` is the RADIUS, so this cut the
      // spell to nothing for no upside -- measured at -100% damage, a free rune
      // that was pure downside on a third of the game's builds.
      if (c.focusId === 'projectile') c.stats.range *= 0.6;
      c.stats.speed *= 1 + lv([0.50, 0.75, 1.25], l);
      c.stats.dmg *= 1 + lv([0.20, 0.35, 0.55], l);
    },
    desc: (l) => `Damage ${pct(lv([0.20, 0.35, 0.55], l))} · ` +
                 `Speed ${pct(lv([0.50, 0.75, 1.25], l))} · Projectile Range ×0.6.`,
  },

  freneticEnergy: {
    name: 'Frenetic Energy', icon: '⑂', color: 0xffd36e,
    tier: 'epic', cost: 3,
    apply: (c, l) => {
      c.flags.split += lv([2, 3, 4], l);
      c.flags.cone = lv([1.05, 0.79, 0.61], l);
    },
    desc: (l) => `Spawn count +${lv([2, 3, 4], l)} within a ` +
                 `${lv([120, 90, 70], l)}° cone.`,
  },

  starsAligned: {
    name: 'Stars Aligned', icon: '✵', color: 0xbcd9ff,
    tier: 'epic', cost: 3,
    apply: (c, l) => {
      c.flags.split += lv([2, 3, 4], l);
      c.flags.line = 1;
      c.stats.speed *= 1.3;
      c.flags.size *= 0.7;
    },
    desc: (l) => `Spawn count +${lv([2, 3, 4], l)} in a line · Speed ×1.3.`,
  },

  backAndForth: {
    name: 'Back-and-Forth', icon: '⇄', color: 0x8fe3c4,
    tier: 'rare', cost: 1,
    apply: (c, l) => {
      c.flags.split += lv([1, 2, 3], l);
      c.flags.scatter = 1;
      c.stats.speed *= 0.7;
    },
    desc: (l) => `Spawn count +${lv([1, 2, 3], l)} around the origin · Speed −30%.`,
  },

  selfCentered: {
    name: 'Self-Centered', icon: '◌', color: 0xb0a48c,
    tier: 'epic', cost: 3,
    apply: (c, l) => {
      c.flags.orbit = Math.max(1, c.flags.orbit);
      c.flags.split += lv([1, 2, 3], l);
      c.stats.life = (c.stats.life || 2) * (1 + lv([0.8, 1.5, 2.7], l));
    },
    // The size reduction is stated because it used to be silent: socketing this
    // on a Field shrank it and players read that as their size runes failing.
    desc: (l) => `Adds orbiting movement · Spawn count +${lv([1, 2, 3], l)} · ` +
                 `Duration ${pct(lv([0.8, 1.5, 2.7], l))} · ` +
                 `An orbiting area is smaller than a still one.`,
  },

  firewalking: {
    name: 'Firewalking', icon: '♨', color: 0xff8a4c,
    tier: 'common', cost: 0,
    apply: (c, l) => {
      c.statuses.push({ idx: BURN, stacks: lv([1, 2, 4], l), magFrac: 0.22 });
      c.stats.range *= 1 + lv([0.10, 0.15, 0.20], l);
    },
    desc: (l) => `Add ${lv([1, 2, 4], l)} Burn · Range ${pct(lv([0.10, 0.15, 0.20], l))}.`,
  },

  icyWind: {
    name: 'Icy Wind', icon: '☃', color: 0x86c8ff,
    tier: 'common', cost: 0,
    apply: (c, l) => {
      c.stats.speed *= 1 + lv([0.25, 0.35, 0.55], l);
      c.statuses.push({ idx: CHILL, stacks: lv([5, 7, 10], l) });
    },
    desc: (l) => `Speed ${pct(lv([0.25, 0.35, 0.55], l))} · Add ${lv([5, 7, 10], l)} Chill.`,
  },

  // --- air: runes that MOVE the crowd rather than damage it ----------------
  //
  // The cluster exists because position is the only resource a movement-only
  // game really has. Everything else in the table makes the player's damage
  // bigger; these make the crowd be somewhere else, which is the same thing
  // from the other end. Perfect Storm was already this rune and had no family.
  //
  // Knockback is the cheap end and the engine already carried it -- `knock`
  // has been a flag since the first commit with no rune granting it.
  gale: {
    name: 'Gale', icon: '≈', color: 0x9fe3ff,
    tier: 'common', cost: 0,
    apply: (c, l) => { c.flags.knock += lv([170, 300, 520], l); },
    desc: (l) => `Hits shove foes back (${lv(['weakly', 'hard', 'very hard'], l)}).`,
  },

  burnedToDeath: {
    name: 'Burned to Death', icon: '☠', color: 0xff7a3c,
    tier: 'rare', cost: 1,
    apply: (c, l) => { c.flags.critVsBurn += lv([0.20, 0.35, 0.60], l); },
    desc: (l) => `Critical chance ${pct(lv([0.20, 0.35, 0.60], l))} against burning foes.`,
  },

  silentGrudge: {
    name: 'Silent Grudge', icon: '◯', color: 0xb6a6ff,
    tier: 'common', cost: 1,
    apply: (c, l) => {
      c.flags.grow += lv([0.90, 1.50, 2.60], l);
      // Pierce, because growth alone did nothing on a projectile: a wider body
      // still stopped after three enemies, so the extra reach found no targets.
      c.flags.pierce += lv([1, 2, 3], l);
    },
    desc: (l) => `Size ${pct(lv([0.90, 1.50, 2.60], l))} over its lifetime · ` +
                 `Pierce +${lv([1, 2, 3], l)}.`,
  },

  // --- positional: these read the graph, which is what makes layout matter ---
  pressureBuildup: {
    name: 'Pressure Buildup', icon: '▲', color: 0xffb36e,
    tier: 'common', cost: 0,
    positional: 'above',
    apply: (c, l, ctx) => { c.stats.dmg *= 1 + lv([0.10, 0.15, 0.25], l) * ctx.above; },
    desc: (l) => `For each rune above it in the chain, Damage ${pct(lv([0.10, 0.15, 0.25], l))}.`,
  },

  emptyStomach: {
    name: 'Empty Stomach', icon: '▽', color: 0x8fe3c4,
    tier: 'common', cost: 1,
    positional: 'empty',
    apply: (c, l, ctx) => { c.stats.dmg *= 1 + lv([0.10, 0.15, 0.25], l) * ctx.empty; },
    desc: (l) => `For each empty socket in this spell, Damage ${pct(lv([0.10, 0.15, 0.25], l))}.`,
  },

  // A PURE payoff now. It used to apply the Chill it then paid out on, which
  // made it the only rune in a cluster that needed nothing else -- and at
  // common/free, the obvious first pick every time. The chill has to come from
  // somewhere else, and this is what makes it worth having come.
  deepFreeze: {
    name: 'Deep Freeze', icon: '❊', color: 0x9fe4ff,
    tier: 'rare', cost: 1,
    apply: (c, l) => { c.flags.vsChilled += lv([0.35, 0.60, 1.00], l); },
    desc: (l) => `Damage ${pct(lv([0.35, 0.60, 1.00], l))} against chilled foes.`,
  },

  potentBurn: {
    name: 'Potent Burn', icon: '⛯', color: 0xff7a3c,
    tier: 'rare', cost: 2,
    apply: (c, l) => {
      c.statuses.push({ idx: BURN, stacks: lv([1, 2, 3], l), magFrac: lv([0.30, 0.40, 0.55], l) });
    },
    desc: (l) => `Add ${lv([1, 2, 3], l)} Burn, and your Burn ticks far harder.`,
  },

  destructivePath: {
    name: 'Destructive Path', icon: '░', color: 0xff9a5c,
    tier: 'epic', cost: 3,
    apply: (c, l) => { c.flags.trail += l; },
    desc: (l) => `Leaves a burning trail behind it (tier ${l}).`,
  },

  // --- ice ------------------------------------------------------------------
  hoarfrost: {
    name: 'Hoarfrost', icon: '❅', color: 0x9fe4ff,
    tier: 'rare', cost: 2,
    apply: (c, l) => {
      c.statuses.push({ idx: CHILL, stacks: lv([8, 11, 15], l) });
      c.stats.speed *= 1 - lv([0.20, 0.28, 0.38], l);
    },
    desc: (l) => `Add ${lv([8, 11, 15], l)} Chill · Speed −${Math.round(lv([0.20, 0.28, 0.38], l) * 100)}%.`,
  },

  // The ice epic, and the reason to stack Chill rather than just touch it.
  // Deep Freeze pays a flat bonus for any chill at all; this one pays per
  // stack, so it is worth nothing on a glancing application and a great deal
  // at the cap.
  absoluteZero: {
    name: 'Absolute Zero', icon: '✸', color: 0x7fd4ff,
    tier: 'epic', cost: 3,
    apply: (c, l) => { c.flags.vsChillStack += lv([0.04, 0.06, 0.09], l); },
    desc: (l) => `Damage +${Math.round(lv([0.04, 0.06, 0.09], l) * 100)}% for each ` +
                 `Chill stack on the target (up to ` +
                 `${Math.round(lv([0.04, 0.06, 0.09], l) * 20 * 100)}%).`,
  },

  // --- air ------------------------------------------------------------------
  squall: {
    name: 'Squall', icon: '⌁', color: 0xbcd9ff,
    tier: 'common', cost: 1,
    apply: (c, l) => {
      c.flags.knock += lv([120, 200, 320], l);
      c.flags.split += lv([1, 1, 2], l);
    },
    desc: (l) => `Spawn count +${lv([1, 1, 2], l)} · hits shove foes back.`,
  },

  // Knockback with the sign flipped. `damageEnemy` pushes along the vector
  // away from the hit, so a negative value drags the body toward it instead --
  // the same line of maths, and no new runtime.
  riptide: {
    name: 'Riptide', icon: '⥁', color: 0x8fe3c4,
    tier: 'rare', cost: 1,
    apply: (c, l) => { c.flags.knock -= lv([200, 340, 540], l); },
    desc: (l) => `Hits drag foes inward instead of shoving them away.`,
  },

  windshear: {
    name: 'Windshear', icon: '⋙', color: 0x9fe3ff,
    tier: 'rare', cost: 2,
    apply: (c, l) => {
      c.flags.knock += lv([280, 460, 720], l);
      c.flags.pierce += lv([2, 3, 5], l);
    },
    desc: (l) => `Pierce +${lv([2, 3, 5], l)} · hits shove foes back hard.`,
  },

  // --- stone ----------------------------------------------------------------
  fracture: {
    name: 'Fracture', icon: '◈', color: 0xff6ad5,
    tier: 'rare', cost: 1,
    apply: (c, l) => { c.statuses.push({ idx: BRITTLE, stacks: lv([1, 2, 3], l) }); },
    desc: (l) => `Add ${lv([1, 2, 3], l)} Brittle. Everything hurts them more.`,
  },

  // The stone epic: size is the element's other half, and this is the most of
  // it the table offers. Slow and enormous, which is the trade stone makes.
  monolith: {
    name: 'Monolith', icon: '⬣', color: 0xb0a48c,
    tier: 'epic', cost: 3,
    apply: (c, l) => {
      c.flags.size *= 1 + lv([0.70, 1.10, 1.70], l);
      c.stats.dmg *= 1 + lv([0.40, 0.65, 1.00], l);
      c.stats.speed *= 1 - lv([0.25, 0.35, 0.45], l);
    },
    desc: (l) => `Size ${pct(lv([0.70, 1.10, 1.70], l))} · Damage ${pct(lv([0.40, 0.65, 1.00], l))} · ` +
                 `Speed −${Math.round(lv([0.25, 0.35, 0.45], l) * 100)}%.`,
  },

  ret: {
    name: 'Return', icon: '↩', color: 0x7fe3c4,
    tier: 'rare', cost: 1,
    apply: (c) => { c.flags.returns = 1; },
    desc: () => 'Comes back to you at max Range instead of expiring.',
  },
};

// ---------------------------------------------------------------------------

/**
 * The elements.
 *
 * Held here rather than on each rune so the SHAPE of the table is visible in
 * one place: every element is six runes, exactly two of them triggers and
 * exactly one of them epic. That is a real constraint on the design -- it is
 * what stops an element becoming four cheap modifiers and a pile of triggers --
 * and `npm run test:elements` enforces it, so the rule cannot rot quietly as
 * runes are added.
 *
 * Fire is Burn, Ice is Chill, Stone is Brittle AND projectile size, Air is the
 * one with no debuff at all: it moves the crowd instead, which is the same
 * thing from the other end in a game whose only input is movement.
 *
 * Runes outside this map belong to no element. They are the plumbing of the
 * table -- damage, pierce, spawn shape, the positional pair -- and deliberately
 * stay neutral so an elemental build still has somewhere to spend sockets.
 */
export const ELEMENTS = {
  fire:  ['spiralingRage', 'furiousOutburst', 'firewalking', 'burnedToDeath',
          'potentBurn', 'destructivePath'],
  ice:   ['firstSnow', 'cruelThorns', 'icyWind', 'deepFreeze',
          'hoarfrost', 'absoluteZero'],
  air:   ['gustOfWind', 'perfectStorm', 'gale', 'squall', 'riptide', 'windshear'],
  stone: ['solidDefense', 'shatteringEnd', 'heavyBurden', 'silentGrudge',
          'fracture', 'monolith'],
};

export const ELEMENT_IDS = Object.keys(ELEMENTS);

/** id -> element, built from the table above so the two cannot disagree. */
const ELEMENT_OF = Object.create(null);
for (const el of ELEMENT_IDS) for (const id of ELEMENTS[el]) ELEMENT_OF[id] = el;

export const RUNES = Object.create(null);
for (const id in TRIGGERS) RUNES[id] = Object.assign({ id, kind: 'trigger' }, TRIGGERS[id]);
for (const id in MODIFIERS) RUNES[id] = Object.assign({ id, kind: 'modifier' }, MODIFIERS[id]);
for (const id in RUNES) RUNES[id].element = ELEMENT_OF[id] || null;

export const RUNE_IDS = Object.keys(RUNES);
export const TRIGGER_IDS = Object.keys(TRIGGERS);
export const MODIFIER_IDS = Object.keys(MODIFIERS);

export const runeMaxLevel = () => MAX_RUNE_LEVEL;

/** Focus points, plus one per level past the first. */
export const runeCost = (id, level) => RUNES[id].cost + (level - 1);

/**
 * THE DAMAGE PENALTY: what a TRIGGER costs its own effect.
 *
 * Triggers alone pay it, and they pay it out of their own damage -- the trigger
 * and everything nested beneath it, never the spell it hangs on. Socketing a
 * trigger adds an effect; it does not make the Focus above it weaker.
 *
 * Nested triggers inherit it for free, because a trigger's damage is a
 * percentage of its parent's: once the outer trigger has paid, everything below
 * is already computing from the reduced figure, and pays its own cost on top.
 *
 * MODIFIERS PAY NOTHING HERE. They are priced in attunement only. A modifier
 * exists to reshape the spell it is attached to, so charging it against the
 * damage of that same spell just claws back what the player bought.
 *
 * Derived from attunement cost rather than stored per rune, so the two can
 * never drift apart -- re-costing a rune automatically re-prices it.
 */
const COST_DMG = [1.00, 0.94, 0.86, 0.76];

export const runeDamageMul = (id) => {
  const r = RUNES[id];
  return r.kind === 'trigger' ? (COST_DMG[r.cost] || 1) : 1;
};

/** For the editor: the penalty as a percentage, or 0 when there is none. */
export const runePenaltyPct = (id) => Math.round((1 - runeDamageMul(id)) * 100);

/**
 * Everything fits everywhere now. Focus-locked runes forced the offer pool to
 * be filtered and still produced dead cards; making the whole vocabulary
 * universal removes a rule and widens the build space.
 */
export const acceptsFocus = () => true;
