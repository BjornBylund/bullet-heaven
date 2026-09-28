import { G } from './state.js';
import { CFG } from './config.js';
import { FOCUSES, FOCUS_IDS } from './focuses.js';
import { RUNES, RUNE_IDS, TRIGGER_IDS, TIERS } from './runes.js';
import { heal, addGold } from './progress.js';
import {
  book, caps, canAddSpell, addSpell, grantRune, runeCount,
  addNodeCap, addAttunementCap,
} from './spellbook.js';

/**
 * The level-up offer.
 *
 * Cards grant runes to the inventory in one click; placement happens later in
 * the editor. The card screen stays as fast as it was, which is what the genre
 * needs -- a graph editor every twenty seconds would wreck the pacing.
 *
 * Passive stat cards were cut. Progression that used to come from them is now
 * granted automatically per level (see `CFG.levelGrowth`), so every card on
 * this screen is about spells.
 *
 * Rune tier is the power curve: Epics stay rare early and become common late,
 * which is what makes minute fifteen feel different from minute three.
 */

let offersMade = 0;
export function resetOffers() { offersMade = 0; }

/** Tier weight, ramped by elapsed time so late runs see stronger runes. */
function tierWeight(tier) {
  const m = G.t / 60;
  const base = TIERS[tier].weight;
  if (tier === 'epic') return base * (0.25 + m * 0.11);
  if (tier === 'rare') return base * (0.55 + m * 0.06);
  return base;
}

function runeCard(id, weight) {
  const def = RUNES[id];
  const held = runeCount(id);
  return {
    kind: 'rune', id, weight,
    icon: def.icon, name: def.name, color: def.color,
    tier: def.tier,
    tag: `${TIERS[def.tier].name} ${def.kind === 'trigger' ? 'Trigger' : 'Modifier'}`,
    isNew: held === 0,
    sub: def.cost > 0 ? `${def.cost} focus` : 'free',
    desc: def.desc(1),
  };
}

function candidates() {
  const out = [];
  const b = book();

  // --- runes ---------------------------------------------------------------
  // Triggers get one early push so the mechanic is met, then fall well below
  // modifiers. A trigger is a whole extra effect; seeing them as often as a
  // stat rune made every spell a pile of triggers and left the modifier pool
  // -- which is where builds actually differentiate -- barely visible.
  //
  // The multiplier is re-tuned whenever the modifier pool changes size: cutting
  // seven modifiers shrank the denominator and pushed the trigger share back up
  // on its own.
  let triggersOwned = 0;
  for (const id of TRIGGER_IDS) triggersOwned += runeCount(id);

  for (const id of RUNE_IDS) {
    const def = RUNES[id];
    let w = tierWeight(def.tier);
    if (def.kind === 'trigger') w *= triggersOwned < 2 ? 1.25 : 0.35;
    if (runeCount(id) > 0) w *= 0.75;        // prefer breadth over duplicates
    out.push(runeCard(id, w));
  }

  // --- new spell -----------------------------------------------------------
  if (canAddSpell()) {
    for (const fid of FOCUS_IDS) {
      const f = FOCUSES[fid];
      out.push({
        kind: 'spell', id: fid, weight: b.spells.length < 3 ? 2.0 : 1.1,
        icon: f.icon, name: `New Spell: ${f.name}`, color: f.color,
        tier: 'rare', tag: 'Spell', isNew: true, sub: 'new chain',
        desc: f.desc,
      });
    }
  }

  // --- caps ----------------------------------------------------------------
  out.push({
    kind: 'nodes', id: 'nodes', weight: 1.5,
    icon: '⬡', name: 'Expand', color: 0x9fc4ff,
    tier: 'common', tag: 'Capacity', isNew: false,
    sub: `${caps().nodes} → ${caps().nodes + 1} sockets`,
    desc: 'Every spell gains a socket. More runes fit in each chain.',
  });
  out.push({
    kind: 'attunement', id: 'attunement', weight: 1.5,
    icon: '◈', name: 'Attune', color: 0xb6a6ff,
    tier: 'common', tag: 'Capacity', isNew: false,
    sub: `${caps().attunement} → ${caps().attunement + 2} focus`,
    desc: 'Every spell gains 2 focus. Heavier runes become affordable.',
  });

  return out;
}

function fallback(i) {
  return i === 0
    // green, matching the heart pickup: healing reads as one colour everywhere
    ? { kind: 'heal', id: 'heal', icon: '❤', name: 'Mend', color: 0x4ce87a,
        tier: 'common', tag: '', isNew: false, sub: '', desc: 'Restore 40% of your health.' }
    : { kind: 'gold', id: 'gold', icon: '◆', name: 'Coin Cache', color: 0xffd36e,
        tier: 'common', tag: '', isNew: false, sub: '', desc: 'Gain 120 gold.' };
}

export function rollChoices(n = 4) {
  const pool = candidates();
  const picked = [];

  // The first offer always contains a trigger. Otherwise a player can reach
  // minute five without meeting the mechanic the whole design is built on.
  if (offersMade === 0) {
    const id = TRIGGER_IDS[(Math.random() * TRIGGER_IDS.length) | 0];
    picked.push(runeCard(id, 1));
    const at = pool.findIndex((c) => c.kind === 'rune' && c.id === id);
    if (at >= 0) pool.splice(at, 1);
  }

  while (picked.length < n && pool.length > 0) {
    let total = 0;
    for (const c of pool) total += c.weight;
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) { idx = i; break; }
    }
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }

  while (picked.length < Math.min(n, 2)) picked.push(fallback(picked.length));
  offersMade++;
  return picked;
}

export function applyChoice(c) {
  switch (c.kind) {
    case 'rune': grantRune(c.id); break;
    case 'spell': addSpell(c.id); break;
    case 'nodes': addNodeCap(1); break;
    case 'attunement': addAttunementCap(2); break;
    case 'heal': heal(G.player.stats.maxHp * 0.4); break;
    case 'gold': addGold(120); break;
  }
}
