import { FOCUSES } from './focuses.js';
import { CFG } from './config.js';
import { RUNES, runeCost, runeDamageMul, lv, MAX_RUNE_LEVEL } from './runes.js';
import { BURN } from './status.js';

/**
 * The spell graph: model, budgeting, and the compiler.
 *
 * Authoring shape -- every node has the same shape, so the tree is uniform:
 *
 *   Spell = { focus: 'projectile', children: [entry, ...] }   max 3 links
 *   entry = { id, level, children: [entry, ...] }             max 2 links
 *
 * LINKS are the structural constraint: a Focus accepts three children, every
 * rune accepts two. That is what makes the layout a graph rather than a list,
 * and what makes where you attach something matter.
 *
 * OWNERSHIP is separate from structure. A modifier applies to the nearest Focus
 * or Trigger *above* it, not to whatever it is physically linked to. So a
 * modifier hung under another modifier still tunes the same Spell, while a
 * Trigger claims its own subtree. This mirrors the reference wording: "relies
 * on the base damage of the Spell or first Trigger above."
 *
 * Runtime shape is produced by compile() once per edit, never per frame.
 */

export const MAX_DEPTH = 3;          // trigger nesting, not tree depth
const MAX_GATES = 48;

export const makeSpell = (focusId) => ({ focus: focusId, children: [] });
export const makeEntry = (id) => ({ id, level: 1, children: [] });

export const isFocusNode = (node) => node.focus !== undefined;
export const slotsOf = (node) =>
  (isFocusNode(node) ? CFG.spell.focusSlots : CFG.spell.runeSlots);
export const freeSlots = (node) => slotsOf(node) - node.children.length;

const isTrigger = (entry) => RUNES[entry.id] && RUNES[entry.id].kind === 'trigger';

const newFlags = () => ({
  pierce: 0, homing: 0, split: 1, knock: 0,
  scatter: 0, ring: 0, line: 0, cone: 0, spiral: 0,
  orbit: 0, pull: 0, anchor: 0,
  size: 1, baseSize: 0, grow: 0, returns: 0,
  // Conditional damage is deliberately limited to flags that key off a DEBUFF.
  // Health-threshold, target-size and distance-travelled conditionals were cut
  // to keep the number of things a player has to hold in their head down.
  crit: 0, vsFrozen: 0, vsChilled: 0, critVsBurn: 0,
  trail: 0,
});

// ---------------------------------------------------------------------------
// budgets
// ---------------------------------------------------------------------------

export function countNodes(spell) {
  const walk = (kids) => {
    let n = 0;
    for (const k of kids) n += 1 + walk(k.children);
    return n;
  };
  return 1 + walk(spell.children);        // the Focus counts as a node
}

export function countAttunement(spell) {
  const walk = (kids) => {
    let a = 0;
    for (const k of kids) a += runeCost(k.id, k.level) + walk(k.children);
    return a;
  };
  return walk(spell.children);
}

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------

/** A path is a list of child indices from the root; [] is the Focus itself. */
export function resolve(spell, path) {
  let s = spell;
  for (const i of path) {
    if (!s.children || !s.children[i]) return null;
    s = s.children[i];
  }
  return s;
}

/** Every node in the graph, as { node, path }. */
export function walkNodes(spell, path = [], out = []) {
  out.push({ node: spell, path: path.slice() });
  spell.children.forEach((c, i) => walkNodes(c, path.concat(i), out));
  return out;
}

/** How deeply nested in triggers a path already sits. The Focus is depth 1. */
export function triggerDepthAt(spell, path) {
  let d = 1;
  let node = spell;
  for (const i of path) {
    node = node.children[i];
    if (!node) break;
    if (isTrigger(node)) d++;
  }
  return d;
}

/** Deepest trigger nesting contained inside a subtree, counting the root. */
function subtreeTriggerDepth(entry) {
  let deepest = 0;
  for (const c of entry.children) deepest = Math.max(deepest, subtreeTriggerDepth(c));
  return (isTrigger(entry) ? 1 : 0) + deepest;
}

export function contains(node, candidate) {
  if (node === candidate) return true;
  for (const c of node.children) if (contains(c, candidate)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// editing
// ---------------------------------------------------------------------------

export function canPlace(spell, path, runeId, caps) {
  const target = resolve(spell, path);
  if (!target) return { ok: false, reason: 'No such node' };

  if (freeSlots(target) <= 0) {
    return { ok: false, reason: `No free links (${slotsOf(target)} max)` };
  }
  const def = RUNES[runeId];
  if (def.kind === 'trigger' && triggerDepthAt(spell, path) >= MAX_DEPTH) {
    return { ok: false, reason: `Max trigger depth is ${MAX_DEPTH}` };
  }
  if (countNodes(spell) + 1 > caps.nodes) {
    return { ok: false, reason: 'No free sockets' };
  }
  if (countAttunement(spell) + runeCost(runeId, 1) > caps.attunement) {
    return { ok: false, reason: 'Not enough focus' };
  }
  return { ok: true, reason: '' };
}

export function place(spell, path, runeId) {
  const target = resolve(spell, path);
  const entry = makeEntry(runeId);
  target.children.push(entry);
  return entry;
}

/** Removes the node at `path` and everything linked beneath it. */
export function remove(spell, path) {
  if (path.length === 0) return null;
  const parent = resolve(spell, path.slice(0, -1));
  if (!parent) return null;
  return parent.children.splice(path[path.length - 1], 1)[0] || null;
}

/** Whether a subtree can be relinked under `toPath`, with the reason if not. */
export function canMove(spell, fromPath, toPath) {
  if (fromPath.length === 0) return { ok: false, reason: 'The Focus is fixed' };
  const moving = resolve(spell, fromPath);
  const target = resolve(spell, toPath);
  if (!moving || !target) return { ok: false, reason: 'No such node' };
  if (moving === target) return { ok: false, reason: '' };

  // dropping a node inside its own subtree would detach the graph from itself
  if (contains(moving, target)) return { ok: false, reason: 'Cannot link into itself' };

  const sameParent = fromPath.slice(0, -1).join(',') === toPath.join(',');
  if (sameParent) return { ok: false, reason: '' };
  if (freeSlots(target) <= 0) {
    return { ok: false, reason: `No free links (${slotsOf(target)} max)` };
  }
  if (triggerDepthAt(spell, toPath) + subtreeTriggerDepth(moving) > MAX_DEPTH) {
    return { ok: false, reason: `Max trigger depth is ${MAX_DEPTH}` };
  }
  return { ok: true, reason: '' };
}

/**
 * Relinks a subtree. The target is resolved to an object *before* detaching,
 * so the splice cannot invalidate it the way a stale index would.
 */
export function move(spell, fromPath, toPath) {
  const target = resolve(spell, toPath);
  const moving = remove(spell, fromPath);
  if (!moving || !target) return null;
  target.children.push(moving);
  return moving;
}

export function canLevel(spell, entry, caps) {
  if (entry.level >= MAX_RUNE_LEVEL) return { ok: false, reason: 'Already at level 3' };
  if (countAttunement(spell) + 1 > caps.attunement) {
    return { ok: false, reason: 'Not enough focus' };
  }
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------------------
// compiler
// ---------------------------------------------------------------------------

let gateCounter = 0;
export function resetGates() { gateCounter = 0; }

/** Default look per Focus; a trigger effect overrides it with its own. */
const DEFAULT_LOOK = { projectile: 'bolt', burst: 'shock', field: 'aura' };

/**
 * `baseFlags` seeds flags a Focus is born with (Projectile's innate pierce).
 * Applied ONLY by compile(), never by compileTrigger: a trigger effect that
 * happens to be a projectile should use the numbers its own rune declares
 * rather than inherit the player's Focus perks.
 */
function descriptor(kind, color, depth, base, baseFlags) {
  return {
    focusId: kind,
    look: DEFAULT_LOOK[kind],
    def: { color },
    depth,
    gate: gateCounter++ % MAX_GATES,
    stats: Object.assign({}, base),
    flags: Object.assign(newFlags(), baseFlags || null),
    statuses: [],
    triggers: [],
  };
}

/**
 * Gathers everything a Focus or Trigger owns.
 *
 * Descends through modifiers (they belong to the same owner) but stops at
 * triggers, which own their own subtree. `above` is the number of runes
 * physically above a modifier in the graph, which is what the positional runes
 * read.
 */
function collectOwned(children, mods, trigs, above) {
  for (const c of children) {
    const rd = RUNES[c.id];
    if (!rd) continue;
    if (rd.kind === 'trigger') {
      trigs.push({ entry: c, rd });
    } else {
      mods.push({ entry: c, rd, above });
      collectOwned(c.children, mods, trigs, above + 1);
    }
  }
}

/** The trigger entries a node owns, in the exact order the compiler emits them. */
export function ownedTriggerEntries(node) {
  const mods = [], trigs = [];
  collectOwned(node.children, mods, trigs, 0);
  return trigs.map((t) => t.entry);
}

/**
 * Fills one owner in two passes: modifiers first so its damage is final, then
 * triggers, whose damage is a percentage of it.
 */
function fill(c, node, depth, ctx) {
  const mods = [], trigs = [];
  collectOwned(node.children, mods, trigs, 0);

  // Modifiers cost attunement and nothing else -- they do not touch damage.
  for (const m of mods) {
    if (m.rd.apply) m.rd.apply(c, m.entry.level, { above: m.above, empty: ctx.empty });
  }

  if (depth >= MAX_DEPTH) return;
  for (const t of trigs) {
    c.triggers.push({
      when: t.rd.when,
      spell: compileTrigger(t.rd, t.entry, c.stats.dmg, depth + 1, ctx),
    });
  }
}

function compileTrigger(rd, entry, parentDmg, depth, ctx) {
  const eff = rd.effect;
  const l = entry.level;
  const c = descriptor(eff.kind, rd.color, depth, FOCUSES[eff.kind].base);

  // The trigger's damage cost lands HERE, on its own output. Everything nested
  // below inherits it automatically, since a nested trigger takes a percentage
  // of this already-reduced figure.
  c.stats.dmg = parentDmg * lv(eff.dmgPct, l) * runeDamageMul(rd.id);
  if (eff.speed) c.stats.speed = eff.speed;
  if (eff.range) c.stats.range = lv(eff.range, l);
  if (eff.life) c.stats.life = lv(eff.life, l);
  if (eff.tick) c.stats.tick = eff.tick;
  if (eff.expand) c.stats.expand = eff.expand;

  c.flags.split = lv(eff.count, l);
  if (eff.scatter) c.flags.scatter = 1;
  if (eff.ring) c.flags.ring = 1;
  if (eff.homing) c.flags.homing = eff.homing;
  if (eff.pierce) c.flags.pierce = eff.pierce;
  if (eff.spiral) c.flags.spiral = eff.spiral;
  if (eff.look) c.look = eff.look;
  if (eff.orbit) c.flags.orbit = 1;
  // a trigger field marks the spot it was cast on; only orbiting ones follow you
  if (eff.kind === 'field' && !eff.orbit) c.flags.anchor = 1;
  if (eff.pull) c.flags.pull = eff.pull;
  if (eff.size) c.flags.baseSize = eff.size;
  if (eff.crit) c.flags.crit = lv(eff.crit, l);
  if (eff.status) {
    c.statuses.push({
      idx: eff.status.idx,
      stacks: lv(eff.status.stacks, l),
      magFrac: eff.status.idx === BURN ? 0.22 : 0,
    });
  }

  fill(c, entry, depth, ctx);
  finalise(c);
  return c;
}

function finalise(c) {
  for (const s of c.statuses) if (s.magFrac) s.mag = c.stats.dmg * s.magFrac;
  // A trail is a tiny anchored field the projectile drips behind itself. Built
  // here rather than at runtime so the hot loop still never walks the tree.
  if (c.flags.trail > 0 && c.focusId === 'projectile') c.trail = makeTrail(c);
}

function makeTrail(parent) {
  const strength = parent.flags.trail;
  const c = descriptor('field', parent.def.color, parent.depth, FOCUSES.field.base);
  c.stats.dmg = parent.stats.dmg * 0.16 * strength;
  c.stats.range = 22 + 6 * strength;
  c.stats.life = 1.1 + 0.6 * strength;
  c.stats.tick = 0.25;
  c.flags.anchor = 1;
  c.statuses.push({ idx: BURN, stacks: 1, magFrac: 0.22 });
  for (const s of c.statuses) if (s.magFrac) s.mag = c.stats.dmg * s.magFrac;
  return c;
}

export function compile(spell, caps) {
  const def = FOCUSES[spell.focus];
  const empty = caps ? Math.max(0, caps.nodes - countNodes(spell)) : 0;
  const c = descriptor(spell.focus, def.color, 1, def.base, def.baseFlags);
  fill(c, spell, 1, { empty });
  finalise(c);
  return c;
}
