/**
 * What a rune changed in the COMPILED SPELL, as opposed to what it changed in
 * the world.
 *
 * This is the second half of the verdict. Behaviour alone says whether a rune
 * did anything; it cannot say why not. Pairing it with the compiled descriptor
 * separates the two failures that look identical from the outside:
 *
 *   the rune's `apply` never touched anything      -> nothing to read
 *   it set a flag that this focus's code never reads -> INERT
 *
 * The second is the interesting one. It is a rune that costs attunement, prints
 * a description, shows up in the editor, and is discarded at runtime -- which
 * is exactly the shape of the Self-Centered orbit bug.
 */
import { compile } from '../src/spell.js';
import { CFG } from '../src/config.js';

// The same caps `resetBook` gives a fresh run. Compiling with different caps
// would make this disagree with the spell the world actually ran: the
// positional runes read the free-socket count straight off them.
const CAPS = { nodes: CFG.spell.startNodes, attunement: CFG.spell.startAttunement };

/**
 * Flat, comparable view of a compiled node.
 *
 * Every entry carries the KIND of the node it came from, because whether a flag
 * is ever read depends on which update function owns it: `pierce` is live on a
 * projectile and dead on a burst. A change buried under a trigger is judged
 * against the TRIGGER's kind, not the host spell's -- a modifier that reaches a
 * trigger hosting a field has to be read by the field code to count.
 */
function flatten(c, prefix = '', out = {}) {
  const put = (k, v) => { out[prefix + k] = { v, kind: c.focusId }; };
  for (const k of Object.keys(c.stats)) put(`stats.${k}`, c.stats[k]);
  for (const k of Object.keys(c.flags)) put(`flags.${k}`, c.flags[k]);
  put('look', c.look);
  put('cap', c.cap);
  put('alpha', c.alpha);
  put('spacing', c.spacing);
  put('statuses', JSON.stringify(c.statuses));
  put('triggerCount', c.triggers.length);
  c.triggers.forEach((t, i) => {
    put(`trigger${i}.when`, t.when);
    if (t.spell) flatten(t.spell, `${prefix}t${i}.`, out);
  });
  return out;
}

export function compiledOf(focus, tree) {
  return flatten(compile({ focus, children: structuredClone(tree) }, CAPS));
}

/**
 * Keys whose compiled value the rune changed, each tagged with the kind of
 * entity that would have to read it. Returns [{ key, kind }].
 */
export function compiledDiff(focus, bareTree, runeTree) {
  const a = compiledOf(focus, bareTree);
  const b = compiledOf(focus, runeTree);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed = [];
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (x && y && x.v === y.v) continue;
    // A key present on one side only is itself a change (a new trigger subtree).
    changed.push({ key: k.replace(/^(t\d+\.)+/, ''), kind: (y || x).kind, path: k });
  }
  return changed.sort((p, q) => p.path.localeCompare(q.path));
}
