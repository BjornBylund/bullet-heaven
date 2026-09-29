import { CHILL, BURN, WEAKEN, BRITTLE } from './status.js';

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
                 `Damage ${Math.round(lv([0.45, 0.80, 1.50], l) * 100)}%.`,
  },

  rollingStone: {
    name: 'Rolling Stone', icon: '●', color: 0xb0a48c,
    tier: 'rare', cost: 2, when: 'spawn',
    effect: {
      kind: 'projectile', count: 1, pierce: 99, look: 'stone',
      dmgPct: [0.25, 0.40, 0.70], speed: 190, range: 700, size: 22,
    },
    desc: (l) => `On spawn, rolls a boulder that ploughs through everything. ` +
                 `Damage ${Math.round(lv([0.25, 0.40, 0.70], l) * 100)}%.`,
  },

  solidDefense: {
    name: 'Solid Defense', icon: '◆', color: 0x9aa4b2,
    tier: 'common', cost: 1, when: 'spawn',
    effect: {
      kind: 'field', count: [2, 2, 3], orbit: true, look: 'stone',
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
    desc: (l) => `After travelling 60% of Range, casts a wind ball. ` +
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
      kind: 'field', count: 1, pull: 130, look: 'vortex',
      dmgPct: [0.18, 0.24, 0.38], range: 150, life: [3, 3.5, 4.5], tick: 0.35, size: 0,
      status: { idx: CHILL, stacks: [3, 4, 5] },
    },
    desc: (l) => `On kill, spawns a tornado that drags foes inward. ` +
                 `Damage ${Math.round(lv([0.18, 0.24, 0.38], l) * 100)}% · Apply ${lv([3, 4, 5], l)} Chill.`,
  },

  fulgorsSparks: {
    name: "Fulgor's Sparks", icon: '⚡', color: 0xc9a0ff,
    tier: 'common', cost: 0, when: 'kill',
    effect: {
      kind: 'projectile', count: [3, 4, 6], scatter: true, homing: 6, look: 'lightning',
      dmgPct: [0.35, 0.55, 0.90], speed: 520, range: 420, size: 8,
      status: { idx: BRITTLE, stacks: [1, 1, 2] },
    },
    desc: (l) => `On kill, looses ${lv([3, 4, 6], l)} seeking sparks. ` +
                 `Damage ${Math.round(lv([0.35, 0.55, 0.90], l) * 100)}% · Apply Brittle.`,
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
    tier: 'rare', cost: 1,
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

  numbingCold: {
    name: 'Numbing Cold', icon: '▼', color: 0xa8b4c6,
    tier: 'common', cost: 0,
    apply: (c, l) => { c.statuses.push({ idx: WEAKEN, stacks: lv([1, 2, 3], l) }); },
    desc: (l) => `Add ${lv([1, 2, 3], l)} Weaken. Enemies hit you for less.`,
  },

  frostbite: {
    name: 'Frostbite', icon: '❆', color: 0x9fe4ff,
    tier: 'common', cost: 0,
    apply: (c, l) => { c.flags.vsFrozen += lv([0.30, 0.50, 0.90], l); },
    desc: (l) => `Damage ${pct(lv([0.30, 0.50, 0.90], l))} against frozen foes.`,
  },

  burnedToDeath: {
    name: 'Burned to Death', icon: '☠', color: 0xff7a3c,
    tier: 'common', cost: 0,
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

  deepFreeze: {
    name: 'Deep Freeze', icon: '❊', color: 0x9fe4ff,
    tier: 'common', cost: 0,
    apply: (c, l) => {
      c.statuses.push({ idx: CHILL, stacks: lv([3, 5, 8], l) });
      c.flags.vsChilled += lv([0.20, 0.35, 0.60], l);
    },
    desc: (l) => `Add ${lv([3, 5, 8], l)} Chill · Damage ${pct(lv([0.20, 0.35, 0.60], l))} against chilled foes.`,
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
    tier: 'rare', cost: 2,
    apply: (c, l) => { c.flags.trail += l; },
    desc: (l) => `Leaves a burning trail behind it (tier ${l}).`,
  },

  ret: {
    name: 'Return', icon: '↩', color: 0x7fe3c4,
    tier: 'rare', cost: 1,
    apply: (c) => { c.flags.returns = 1; },
    desc: () => 'Comes back to you at max Range instead of expiring.',
  },
};

// ---------------------------------------------------------------------------

export const RUNES = Object.create(null);
for (const id in TRIGGERS) RUNES[id] = Object.assign({ id, kind: 'trigger' }, TRIGGERS[id]);
for (const id in MODIFIERS) RUNES[id] = Object.assign({ id, kind: 'modifier' }, MODIFIERS[id]);

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
