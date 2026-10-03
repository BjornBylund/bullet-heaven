/**
 * Runs the rune compatibility matrix and prints a report.
 *
 *   node --import ./test/register.mjs test/run.mjs
 *   node --import ./test/register.mjs test/run.mjs --axis=focus --verbose
 *   node --import ./test/register.mjs test/run.mjs --rune=selfCentered
 *
 * Exits non-zero when any pair disagrees with expect.mjs.
 */
import { runFocusAxis, runTriggerAxis } from './matrix.mjs';
import { restoreRandom } from './world.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=')[1] : (argv.includes(`--${n}`) ? true : d);
};
const only = flag('rune');
const axis = flag('axis', 'all');
const verbose = !!flag('verbose');

const C = process.stdout.isTTY
  ? { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { r: '', g: '', y: '', c: '', d: '', b: '', x: '' };

const t0 = Date.now();
let rows = [];
if (axis === 'all' || axis === 'focus') rows = rows.concat(runFocusAxis());
if (axis === 'all' || axis === 'trigger') rows = rows.concat(runTriggerAxis());
restoreRandom();
if (only) rows = rows.filter((r) => r.rune === only || r.target === only);

const pad = (s, n) => String(s).padEnd(n);
const MARK = {
  works: `${C.g}ok   ${C.x}`, 'n/a': `${C.d}n/a  ${C.x}`,
  partial: `${C.y}part ${C.x}`, inert: `${C.r}INERT${C.x}`, 'no-op': `${C.r}no-op${C.x}`,
  unseen: `${C.d}unseen${C.x}`,
};

if (verbose) {
  console.log(`${C.b}full matrix${C.x}`);
  let target = null;
  for (const r of rows) {
    if (r.target !== target) { target = r.target; console.log(`  ${C.b}${target}${C.x}`); }
    const why = r.why ? ` ${C.d}${r.why}${C.x}` : '';
    console.log(`    ${MARK[r.verdict]} ${pad(r.name, 22)}${why}`);
  }
}

function section(title, list, colour) {
  if (!list.length) return;
  console.log(`\n${colour}${C.b}${title}${C.x}`);
  let target = null;
  for (const r of list) {
    if (r.target !== target) { target = r.target; console.log(`  ${C.b}${target}${C.x}`); }
    const tag = r.isTrigger ? `${C.d}[trigger] ${C.x}` : '';
    console.log(`    ${pad(r.name, 22)} ${tag}${C.d}${r.why || r.note}${C.x}`);
  }
}

const failed = rows.filter((r) => !r.ok);
section('INERT -- the flag is read by this kind, yet nothing happened', failed.filter((r) => r.verdict === 'inert'), C.r);
section('PARTIAL -- does something, but not what it advertises', failed.filter((r) => r.verdict === 'partial'), C.y);
section('NO-OP -- compiles to an identical spell', failed.filter((r) => r.verdict === 'no-op'), C.r);
section('UNEXPECTED -- listed as inert in expect.mjs, but works', rows.filter((r) => !r.ok && ['works', 'n/a'].includes(r.verdict)), C.y);

const count = (v) => rows.filter((r) => r.verdict === v).length;
const focusRows = rows.filter((r) => r.axis === 'focus').length;
console.log(
  `\n${C.b}${rows.length}${C.x} pairs in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
  `${C.d}(${focusRows} rune x focus, ${rows.length - focusRows} modifier x trigger)${C.x}`
);
console.log(
  `  ${C.g}${count('works')} work${C.x} · ${C.d}${count('n/a')} n/a${C.x} · ` +
  `${C.d}${count('unseen')} unseen${C.x} · ` +
  `${C.y}${count('partial')} partial${C.x} · ${C.r}${count('inert')} inert${C.x} · ` +
  `${C.r}${count('no-op')} no-op${C.x}`
);
console.log(failed.length ? `  ${C.r}${C.b}${failed.length} need attention${C.x}` : `  ${C.g}${C.b}all as expected${C.x}`);

process.exit(failed.length ? 1 : 0);
