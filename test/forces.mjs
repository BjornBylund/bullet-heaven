/**
 * Forces applied to enemies: knockback, and a field's pull.
 *
 * These live apart from the rune matrix because the matrix cannot see them.
 * Its world deliberately never calls `updateEnemies` -- a chasing crowd
 * converges from every angle and hides where a spell puts its damage -- but
 * enemy POSITION is integrated there, so nothing that moves an enemy shows up
 * in a matrix fingerprint at all.
 *
 * That blind spot is why Perfect Storm passed the matrix while its headline
 * promise, dragging foes inward, did nothing: it changed damage and kills, so
 * "something happened" was true, and the vortex was inert.
 *
 * Run: node --import ./test/register.mjs test/forces.mjs
 */
import { createWorld } from './world.mjs';
import { G } from '../src/state.js';
import { CFG } from '../src/config.js';
import { RUNES } from '../src/runes.js';
import { spawnEnemy, updateEnemies, damageEnemy, KNOCK_DECAY } from '../src/enemy.js';
import { castSpell, updateSpellEntities } from '../src/cast.js';
import { compile } from '../src/spell.js';

const STEP = 1 / 60;
const CAPS = { nodes: CFG.spell.startNodes, attunement: CFG.spell.startAttunement };

let failures = 0;
const check = (name, pass, detail) => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures++;
};

const step = () => {
  G.grid.clear();
  for (const q of G.enemies.active) if (q.alive) G.grid.insert(q);
  updateSpellEntities(STEP);
  updateEnemies(STEP);
  G.enemies.sweep(() => {});
};

/**
 * The tornado Perfect Storm's trigger casts, on its own.
 *
 * `pull` is overridden on the COMPILED descriptor rather than on the rune
 * table. Writing to RUNES leaks into every later test in the file -- the first
 * version of this did exactly that, and the grip test below silently ran at
 * the unit test's value instead of the rune's own.
 */
function tornado(pull, life) {
  const host = compile(
    { focus: 'projectile', children: [{ id: 'perfectStorm', level: 3, children: [] }] }, CAPS);
  const t = host.triggers[0].spell;
  if (pull !== undefined) t.flags.pull = pull;
  if (life) t.stats.life = life;
  return t;
}

// ---------------------------------------------------------------------------
console.log('pull is a speed, in px/s');
{
  // A sustained push into the knockback channel settles at input/KNOCK_DECAY,
  // so a `pull` meant as px/s has to cancel that. Before it did, a tornado
  // configured at 130 dragged bodies at 14px/s and looked completely inert.
  const WANT = 60;
  createWorld({ crowd: 0, atSeconds: 300 });
  // The player stays at the origin and the bodies get speed 0 instead. Parking
  // the player far away would push them past the DESPAWN RADIUS, and a
  // recycled enemy integrates nothing -- which reads exactly like a force that
  // does not work.
  G.player.x = 0; G.player.y = 0;
  const marks = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const e = spawnEnemy('zombie', Math.cos(a) * 260, Math.sin(a) * 260);
    e.maxHp = e.hp = 1e12;
    e.speed = 0;                                  // only the pull moves them
    marks.push({ e, d0: Math.hypot(e.x, e.y) });
  }
  castSpell(tornado(WANT, 60), 0, 0, 0);
  for (let i = 0; i < 60; i++) step();            // exactly one second

  const drift = marks.map((m) => m.d0 - Math.hypot(m.e.x, m.e.y));
  const avg = drift.reduce((a, b) => a + b, 0) / drift.length;
  check(`a pull of ${WANT} moves bodies about ${WANT}px in one second`,
    Math.abs(avg - WANT) < WANT * 0.2, `${avg.toFixed(0)}px`);
  check('KNOCK_DECAY is what makes that true', KNOCK_DECAY === 9, String(KNOCK_DECAY));
}

// ---------------------------------------------------------------------------
console.log('\nPerfect Storm grips a crowd that is walking past it');
{
  // The player's own question: does the vortex hold anything. Measured against
  // the identical crowd with no tornado at all, which is the only honest
  // baseline -- enemies walk toward the player either way.
  function spread(withTornado) {
    createWorld({ crowd: 0, atSeconds: 300 });
    G.player.x = 0; G.player.y = 0;
    const bodies = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const e = spawnEnemy('zombie', Math.cos(a) * 320, Math.sin(a) * 320 - 260);
      e.maxHp = e.hp = 1e12;
      bodies.push(e);
    }
    // Undefined pull: use whatever the rune is actually configured at, so this
    // tracks balance changes instead of asserting against a stale literal.
    if (withTornado) castSpell(tornado(undefined, 60), 0, -260, 0);
    for (let i = 0; i < 60 * 4; i++) step();
    const d = bodies.filter((e) => e.alive).map((e) => Math.hypot(e.x, e.y + 260));
    return d.reduce((a, b) => a + b, 0) / d.length;
  }

  const free = spread(false);
  const held = spread(true);
  check(`Perfect Storm is configured at pull ${RUNES.perfectStorm.effect.pull}`,
    RUNES.perfectStorm.effect.pull > 0, String(RUNES.perfectStorm.effect.pull));
  check('the crowd ends up meaningfully closer to the vortex', held < free - 50,
    `${free.toFixed(0)}px free -> ${held.toFixed(0)}px held`);
  check('but is not collapsed to a single point', held > 25,
    `${held.toFixed(0)}px from the eye`);
  check('and is held inside the tornado, where it keeps taking ticks', held < 150,
    `${held.toFixed(0)}px of a 150px radius`);
}

// ---------------------------------------------------------------------------
console.log('\nknockback is still a shove, not a launch');
{
  createWorld({ crowd: 0, atSeconds: 300 });
  G.player.x = 0; G.player.y = 0;           // see the despawn note above
  const e = spawnEnemy('zombie', 0, 0);
  e.maxHp = e.hp = 1e12;
  e.speed = 0;
  damageEnemy(e, 1, { knockback: 420, fromX: -40, fromY: 0 });
  for (let i = 0; i < 60; i++) step();
  const d = Math.hypot(e.x, e.y);
  check('a hit shoves a body a short way', d > 5 && d < 120, `${d.toFixed(0)}px`);
  check('and it comes to rest', Math.abs(e.kx) < 1, `residual ${e.kx.toFixed(2)}`);
}

console.log(failures ? `\n${failures} failing` : '\nall force checks pass');
process.exit(failures ? 1 : 0);
