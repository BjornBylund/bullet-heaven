/**
 * The shape of the elemental table.
 *
 * Six runes per element, exactly two of them triggers, exactly one epic. These
 * are design constraints rather than mechanics, which is precisely why they
 * need a test: nothing breaks when an element quietly grows a seventh rune or
 * a second epic, the game just stops being the thing it was designed as, and
 * nobody notices for a month.
 *
 * Run: node --import ./test/register.mjs test/elements.mjs
 */
import { RUNES, RUNE_IDS, ELEMENTS, ELEMENT_IDS, TRIGGER_IDS } from '../src/runes.js';

let failures = 0;
const check = (name, pass, detail) => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures++;
};

const PER_ELEMENT = 6;
const TRIGGERS_PER = 2;
const EPICS_PER = 1;

console.log(`${ELEMENT_IDS.length} elements, ${PER_ELEMENT} runes each`);

for (const el of ELEMENT_IDS) {
  const ids = ELEMENTS[el];
  const triggers = ids.filter((i) => TRIGGER_IDS.includes(i));
  const epics = ids.filter((i) => RUNES[i].tier === 'epic');
  const tiers = new Set(ids.map((i) => RUNES[i].tier));

  console.log(`\n  ${el}`);
  check(`${el}: every id is a real rune`, ids.every((i) => !!RUNES[i]),
    ids.filter((i) => !RUNES[i]).join(', ') || 'all present');
  check(`${el}: ${PER_ELEMENT} runes`, ids.length === PER_ELEMENT, `${ids.length}`);
  check(`${el}: ${TRIGGERS_PER} triggers`, triggers.length === TRIGGERS_PER,
    triggers.join(', ') || 'none');
  check(`${el}: ${EPICS_PER} epic`, epics.length === EPICS_PER, epics.join(', ') || 'none');
  check(`${el}: rarity actually varies`, tiers.size >= 3, [...tiers].join('/'));
}

// ---------------------------------------------------------------------------
console.log('\nthe map and the table agree');
{
  const seen = new Map();
  let dupes = 0;
  for (const el of ELEMENT_IDS) {
    for (const id of ELEMENTS[el]) {
      if (seen.has(id)) { dupes++; console.log(`    ${id} is in both ${seen.get(id)} and ${el}`); }
      seen.set(id, el);
    }
  }
  check('no rune belongs to two elements', dupes === 0, `${seen.size} assigned`);
  check('every assigned rune carries its element',
    [...seen].every(([id, el]) => RUNES[id].element === el));
  check('unassigned runes carry none',
    RUNE_IDS.filter((i) => !seen.has(i)).every((i) => RUNES[i].element === null),
    `${RUNE_IDS.length - seen.size} non-elemental`);
}

console.log(failures ? `\n${failures} failing` : '\nall element checks pass');
process.exit(failures ? 1 : 0);
