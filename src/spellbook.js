import { G } from './state.js';
import { CFG } from './config.js';
import { RUNES } from './runes.js';
import {
  makeSpell, compile, resolve, place, remove, move,
  canPlace, canLevel, canMove, countNodes, countAttunement,
} from './spell.js';
import { castSpell } from './cast.js';

/**
 * The player's spellbook: owned spells, the rune inventory, and the shared caps.
 *
 * Caps are global -- raising one raises it for every spell, including ones not
 * yet acquired. That guarantees equal capacity across the loadout by
 * construction, and means a spell picked up at 12:00 arrives at current cap
 * rather than three upgrades behind.
 *
 * The inventory is a count per rune id. Placing consumes one copy; levelling a
 * placed rune consumes another; removing returns every copy in the removed
 * subtree. So "do I have this rune" and "how far can I level it" are the same
 * scarcity.
 */

export function initBook() {
  G.player.book = {
    spells: [],                 // { spell, compiled, cd }
    inventory: Object.create(null),
    caps: { nodes: CFG.spell.startNodes, attunement: CFG.spell.startAttunement },
  };
}

export function resetBook(startingFocus) {
  const b = G.player.book;
  b.spells.length = 0;
  b.inventory = Object.create(null);
  b.caps.nodes = CFG.spell.startNodes;
  b.caps.attunement = CFG.spell.startAttunement;
  addSpell(startingFocus);
}

export const book = () => G.player.book;
export const caps = () => G.player.book.caps;

// ---------------------------------------------------------------------------
// spells
// ---------------------------------------------------------------------------

export function canAddSpell() {
  return G.player.book.spells.length < CFG.spell.maxSpells;
}

export function addSpell(focusId) {
  const b = G.player.book;
  if (!canAddSpell()) return null;
  const entry = { spell: makeSpell(focusId), compiled: null, cd: 0 };
  b.spells.push(entry);
  recompileAll();
  return entry;
}

export function recompileAll() {
  const b = G.player.book;
  // caps are passed through because positional runes read the free-socket count
  for (const e of b.spells) e.compiled = compile(e.spell, b.caps);
}

// ---------------------------------------------------------------------------
// inventory
// ---------------------------------------------------------------------------

export function grantRune(id, n = 1) {
  const inv = G.player.book.inventory;
  inv[id] = (inv[id] || 0) + n;
}

export const runeCount = (id) => G.player.book.inventory[id] || 0;

export function unplacedCount() {
  const inv = G.player.book.inventory;
  let n = 0;
  for (const k in inv) n += inv[k];
  return n;
}

function consume(id) {
  const inv = G.player.book.inventory;
  inv[id] = (inv[id] || 0) - 1;
  if (inv[id] <= 0) delete inv[id];
}

/** Returns every rune in a removed subtree to the inventory, levels included. */
function reclaim(entry) {
  grantRune(entry.id, entry.level);
  for (const c of entry.children) reclaim(c);
}

// ---------------------------------------------------------------------------
// editing
// ---------------------------------------------------------------------------

export function tryPlace(spellIndex, path, runeId) {
  const b = G.player.book;
  const entry = b.spells[spellIndex];
  if (!entry) return { ok: false, reason: 'No such spell' };
  if (runeCount(runeId) <= 0) return { ok: false, reason: 'None in inventory' };

  const check = canPlace(entry.spell, path, runeId, b.caps);
  if (!check.ok) return check;

  place(entry.spell, path, runeId);
  consume(runeId);
  recompileAll();
  return { ok: true, reason: '' };
}

/** `path` addresses the rune itself, not its parent. */
export function tryLevel(spellIndex, path) {
  const b = G.player.book;
  const entry = b.spells[spellIndex];
  if (!entry) return { ok: false, reason: 'No such spell' };
  const rune = resolve(entry.spell, path);
  if (!rune || path.length === 0) return { ok: false, reason: 'No such rune' };
  if (runeCount(rune.id) <= 0) {
    return { ok: false, reason: `Need another ${RUNES[rune.id].name}` };
  }

  const check = canLevel(entry.spell, rune, b.caps);
  if (!check.ok) return check;

  rune.level++;
  consume(rune.id);
  recompileAll();
  return { ok: true, reason: '' };
}

export function tryRemove(spellIndex, path) {
  const b = G.player.book;
  const entry = b.spells[spellIndex];
  if (!entry || path.length === 0) return { ok: false, reason: 'No such rune' };
  const removed = remove(entry.spell, path);
  if (!removed) return { ok: false, reason: 'No such rune' };
  reclaim(removed);
  recompileAll();
  return { ok: true, reason: '' };
}

/** Relinks a subtree under a different parent. Used by drag-and-drop. */
export function tryMove(spellIndex, fromPath, toPath) {
  const b = G.player.book;
  const entry = b.spells[spellIndex];
  if (!entry) return { ok: false, reason: 'No such spell' };

  const check = canMove(entry.spell, fromPath, toPath);
  if (!check.ok) return check;

  move(entry.spell, fromPath, toPath);
  recompileAll();
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------------------
// caps
// ---------------------------------------------------------------------------

export function addNodeCap(n = 1) {
  G.player.book.caps.nodes += n;
  recompileAll();     // positional runes count free sockets
}

export function addAttunementCap(n = 1) {
  G.player.book.caps.attunement += n;
}

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

export function updateSpellbook(dt) {
  const p = G.player;
  for (const entry of p.book.spells) {
    const c = entry.compiled;
    if (!c) continue;
    entry.cd -= dt;
    if (entry.cd > 0) continue;
    // floor the cooldown so stacked Rapid can never reach zero
    entry.cd += Math.max(0.1, c.stats.cooldown * p.stats.cd);
    castSpell(c, p.x, p.y, p.facing);
  }
}

/** Totals for the HUD and for debugging. */
export function bookSummary() {
  const b = G.player.book;
  return b.spells.map((e) => ({
    focus: e.spell.focus,
    nodes: countNodes(e.spell),
    attunement: countAttunement(e.spell),
    dmg: e.compiled ? Math.round(e.compiled.stats.dmg) : 0,
    cooldown: e.compiled ? +e.compiled.stats.cooldown.toFixed(2) : 0,
    triggers: e.compiled ? e.compiled.triggers.length : 0,
  }));
}
