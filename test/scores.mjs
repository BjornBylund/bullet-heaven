/**
 * High score tests.
 *
 * The interesting cases are all about storage being hostile. `localStorage` is
 * editable by anyone who opens devtools, can be absent, and can throw on every
 * access -- and none of that is worth breaking a run over. Most of this file is
 * feeding the module garbage and checking the game survives it.
 *
 * Run: node --import ./test/register.mjs test/scores.mjs
 */
import { CFG } from '../src/config.js';

let failures = 0;
const check = (name, pass, detail) => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures++;
};

/** A localStorage stand-in that can be told to misbehave. */
function fakeStorage({ throwOn = null } = {}) {
  const map = new Map();
  return {
    getItem(k) { if (throwOn === 'get') throw new Error('blocked'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (throwOn === 'set') throw new Error('quota'); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _raw: map,
  };
}

// The module reads globalThis.localStorage on every call, so swapping it
// between cases is enough -- no reimport, no module cache games.
let store = fakeStorage();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() {
    if (store === 'throws') throw new Error('storage disabled');
    return store;
  },
});

const { loadScores, recordRun, clearScores, MAX_SCORES } = await import('../src/scores.js');

const run = (seconds, kills = 0, extra = {}) =>
  ({ seconds, level: 5, kills, gold: 10, focus: 'projectile', ...extra });

// ---------------------------------------------------------------------------
console.log('ranking');
{
  store = fakeStorage();
  recordRun(run(100, 50));
  recordRun(run(300, 10));
  recordRun(run(200, 99));
  const s = loadScores();
  check('longest run first', s.map((r) => r.seconds).join(',') === '300,200,100', s.map((r) => r.seconds).join(','));

  store = fakeStorage();
  recordRun(run(200, 10));
  const tie = recordRun(run(200, 900));
  check('kills break a tie on time', loadScores()[0].kills === 900);
  check('the better tied run reports rank 1', tie.rank === 1, `rank ${tie.rank}`);

  store = fakeStorage();
  const first = recordRun(run(60));
  check('first run is a personal best', first.isBest && first.rank === 1);
  const worse = recordRun(run(30));
  check('a worse run is not a best', !worse.isBest && worse.rank === 2, `rank ${worse.rank}`);
}

// ---------------------------------------------------------------------------
console.log('\nthe table is bounded');
{
  store = fakeStorage();
  for (let i = 1; i <= MAX_SCORES + 15; i++) recordRun(run(i * 10));
  const s = loadScores();
  check(`keeps at most ${MAX_SCORES}`, s.length === MAX_SCORES, `${s.length}`);
  check('keeps the BEST, not the latest', s[0].seconds === (MAX_SCORES + 15) * 10, `${s[0].seconds}s`);

  const tooSlow = recordRun(run(1));
  check('a run that does not place reports rank 0', tooSlow.rank === 0, `rank ${tooSlow.rank}`);
  check('and does not displace anything', loadScores().length === MAX_SCORES);
}

// ---------------------------------------------------------------------------
console.log('\nhostile storage');
{
  store = fakeStorage();
  store.setItem('bh.scores', 'not json at all {{{');
  check('unparseable table reads as empty', loadScores().length === 0);
  check('and a new run still files', recordRun(run(50)).rank === 1);

  store = fakeStorage();
  store.setItem('bh.scores', JSON.stringify({ v: 1, scores: [
    { seconds: 120, level: 3, kills: 7, gold: 0, focus: 'burst', at: 1 },
    null,
    'nonsense',
    { nothing: 'useful' },
    { seconds: 'abc' },
  ] }));
  const s = loadScores();
  check('malformed rows are dropped, good ones kept', s.length === 1 && s[0].seconds === 120, `${s.length} kept`);

  store = fakeStorage();
  store.setItem('bh.scores', JSON.stringify([{ seconds: 90, level: 2, kills: 4, gold: 0, focus: 'cone', at: 1 }]));
  check('a bare array is still read', loadScores().length === 1);

  store = fakeStorage();
  const cheated = recordRun(run(99999, 1e30, { level: -5 }));
  const c = loadScores()[0];
  check('time is clamped to a possible run', c.seconds === CFG.maxRunSeconds, `${c.seconds}`);
  check('level cannot go below 1', c.level >= 1, `${c.level}`);
  check('the clamped run is still filed', cheated.rank === 1);

  store = fakeStorage();
  const longFocus = recordRun(run(50, 0, { focus: 'x'.repeat(500) }));
  check('focus is truncated', longFocus.entry.focus.length <= 24, `${longFocus.entry.focus.length} chars`);
}

// ---------------------------------------------------------------------------
console.log('\nstorage that is missing or refuses');
{
  store = 'throws';
  check('a throwing localStorage does not throw out', loadScores().length === 0);
  const r = recordRun(run(100));
  check('recordRun survives it', r && r.rank >= 0);
  check('and reports that it did not save', r.saved === false);
  clearScores();     // must not throw

  store = fakeStorage({ throwOn: 'set' });
  const full = recordRun(run(100));
  check('a full quota is reported, not thrown', full.saved === false);
  check('but the panel still gets the run', full.scores.length === 1 && full.rank === 1);

  store = fakeStorage({ throwOn: 'get' });
  check('a throwing read reads as empty', loadScores().length === 0);
}

// ---------------------------------------------------------------------------
console.log('\nclearing');
{
  store = fakeStorage();
  recordRun(run(100));
  recordRun(run(200));
  check('table has rows before clearing', loadScores().length === 2);
  clearScores();
  check('clearScores empties it', loadScores().length === 0);
}

console.log(failures ? `\n${failures} failing` : '\nall score checks pass');
process.exit(failures ? 1 : 0);
