/**
 * Drift guard for the consumption table.
 *
 * `expect.mjs` claims which flags each entity kind reads. That claim is what
 * separates "pierce on a burst is fine" from "orbit on a projectile is a bug",
 * so if it drifts away from cast.js the whole suite starts lying confidently.
 *
 * Two directions are checked:
 *
 *   every flag listed as consumed must appear in cast.js at all -- catches a
 *   flag that was renamed or deleted while the table kept the old name
 *
 *   every flag the compiler can produce must be either listed as consumed by
 *   some kind, or named here as deliberately unread -- catches a NEW flag that
 *   nobody added to the table, which would otherwise default to being judged
 *   against the projectile list
 */
import { readFileSync } from 'node:fs';
import { CONSUMES } from './expect.mjs';

const src = readFileSync(new URL('../src/cast.js', import.meta.url), 'utf8');

// Flags the compiler sets that no update function is expected to read.
const UNREAD = new Set([
  'flags.baseSize',    // read in spawn(), via a different spelling
  // Read by the COMPILER, not the runtime: spell.js turns `flags.trail` into a
  // `c.trail` descriptor and updateProjectile reads that. The descriptor's own
  // fields (spacing, cap, alpha) are the ones listed as consumed.
  'flags.trail',
]);

const problems = [];
const all = new Set();
for (const list of Object.values(CONSUMES)) for (const k of list) all.add(k);

for (const key of all) {
  if (!key.startsWith('flags.')) continue;
  const name = key.slice('flags.'.length);
  // `f.name`, `flags.name`, or destructured -- any mention at all is enough;
  // this is a spelling check, not a reachability proof.
  const mention = new RegExp(String.raw`\b(?:f|flags)\.` + name + String.raw`\b`);
  if (!mention.test(src) && !UNREAD.has(key)) {
    problems.push(`${key} is listed as consumed but never appears in cast.js`);
  }
}

// The reverse direction: flags that exist but nobody classified.
const { newFlags } = await import('../src/spell.js');
if (typeof newFlags !== 'function') {
  // Loud on purpose. Silently skipping this half would leave the guard
  // reporting success while checking only one direction.
  problems.push('spell.js no longer exports newFlags -- the new-flag check cannot run');
} else {
  for (const name of Object.keys(newFlags())) {
    const key = `flags.${name}`;
    if (all.has(key) || UNREAD.has(key)) continue;
    problems.push(`${key} exists in the compiler but no kind lists it -- add it to CONSUMES, or to UNREAD here`);
  }
}

if (problems.length) {
  console.error('consumption table is out of step with the source:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`consumption table agrees with cast.js (${all.size} keys checked)`);
