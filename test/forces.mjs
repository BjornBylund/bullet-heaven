/**
 * Physical interactions the rune matrix cannot see: forces applied to enemies,
 * and stones blocking enemy fire.
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
    // Inside the tornado. Its reach is tied to the SPRITE now -- half of
    // `radius * 2.3`, so about 172px for a 150px field -- and a body outside
    // that is not pulled at all, by design.
    const e = spawnEnemy('zombie', Math.cos(a) * 120, Math.sin(a) * 120);
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
console.log('\nPerfect Storm holds what it catches');
{
  // The player's own question: does the vortex hold anything. Measured against
  // the identical crowd with no tornado at all, which is the only honest
  // baseline -- enemies walk toward the player either way.
  // The crowd starts INSIDE the vortex and walks for the player. The question
  // is whether the tornado holds what it has caught -- not whether it reaches
  // out past itself, which it deliberately no longer does.
  function spread(withTornado) {
    createWorld({ crowd: 0, atSeconds: 300 });
    G.player.x = 0; G.player.y = 0;
    const bodies = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = 60 + (i % 4) * 30;
      const e = spawnEnemy('zombie', Math.cos(a) * r, Math.sin(a) * r - 260);
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
  check('a caught crowd is held near the eye instead of walking off', held < free - 60,
    `${free.toFixed(0)}px without -> ${held.toFixed(0)}px with`);
  check('but is not collapsed to a single point', held > 10,
    `${held.toFixed(0)}px from the eye`);
  check('and stays inside the tornado, where it keeps taking ticks', held < 150,
    `${held.toFixed(0)}px of a 150px radius`);
}

// ---------------------------------------------------------------------------
console.log('\nthe pull reaches exactly as far as the sprite is drawn');
{
  createWorld({ crowd: 0, atSeconds: 300 });
  G.player.x = 0; G.player.y = 0;
  const t = tornado(70, 60);
  castSpell(t, 0, 0, 0);
  const field = G.spellEntities.active.find((q) => q.alive);

  // ONE FRAME FIRST. `spawn` does not size the sprite -- `updateField` does --
  // so reading width straight after casting returns whatever the pooled sprite
  // last held. This assertion passed against exactly that stale value before,
  // which is the worst kind of green.
  step();
  const edge = field.s.width / 2;           // what the player can see
  check('the sprite is drawn at radius x 2.3',
    Math.abs(edge - field.radius * 1.15) < 1, `${edge.toFixed(0)}px edge, radius ${field.radius}`);

  // One body a little inside the visible edge, one a little outside.
  const inside = spawnEnemy('zombie', edge * 0.85, 0);
  const outside = spawnEnemy('zombie', edge * 1.15, 0);
  for (const e of [inside, outside]) { e.maxHp = e.hp = 1e12; e.speed = 0; }
  const d0 = { inside: inside.x, outside: outside.x };
  for (let i = 0; i < 60; i++) step();

  check('a body inside the sprite is pulled', inside.x < d0.inside - 20,
    `${d0.inside.toFixed(0)} -> ${inside.x.toFixed(0)}`);
  check('a body outside it is not touched at all', Math.abs(outside.x - d0.outside) < 0.5,
    `${d0.outside.toFixed(0)} -> ${outside.x.toFixed(0)}`);
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

// ---------------------------------------------------------------------------
console.log('\nGale shoves what it hits');
{
  const { updateSpellbook } = await import('../src/spellbook.js');
  const { compile } = await import('../src/spell.js');

  check('the rune grants knockback at all',
    compile({ focus: 'projectile', children: [{ id: 'gale', level: 3, children: [] }] }, CAPS)
      .flags.knock > 0);

  // `knock` had been a flag with no rune granting it since the first commit.
  // The rune matrix cannot see this one: shoving is enemy MOVEMENT, and that
  // world never integrates it.
  const shove = (rune) => {
    createWorld({
      focus: 'projectile',
      tree: rune ? [{ id: rune, level: 3, children: [] }] : [],
      crowd: 0, atSeconds: 120, seed: 3,
    });
    G.player.x = 0; G.player.y = 0;
    const marks = [];
    for (let i = 0; i < 10; i++) {
      const e = spawnEnemy('zombie', 150 + i * 12, 0);
      e.maxHp = e.hp = 1e12;                // survive, so the shove is visible
      e.speed = 0;                          // and nothing but the shove moves them
      marks.push({ e, x0: e.x });
    }
    for (let i = 0; i < 60 * 3; i++) { updateSpellbook(STEP); step(); }
    const moved = marks.filter((m) => m.e.alive).map((m) => m.e.x - m.x0);
    return moved.reduce((a, b) => a + b, 0) / moved.length;
  };

  const bare = shove(false);
  const gale = shove('gale');
  const riptide = shove('riptide');
  check('bare hits do not move anything', Math.abs(bare) < 1, `${bare.toFixed(1)}px`);
  check('Gale pushes them away from the player', gale > 50, `${gale.toFixed(1)}px`);
  // Riptide is Gale with the sign flipped: `damageEnemy` pushes along the
  // vector away from the hit, so a negative knock drags the body toward it.
  check('Riptide drags them the other way', riptide < -50, `${riptide.toFixed(1)}px`);
}

// ---------------------------------------------------------------------------
console.log('\na stone stops one shot and is spent doing it');
{
  const { fireShot, HOSTILE } = await import('../src/shots.js');
  const { updateShots } = await import('../src/shots.js');
  const { compile } = await import('../src/spell.js');

  const shot = () => ({ speed: 200, dmg: 10, r: 9, life: 9, tint: HOSTILE.mid });

  const eff = compile({ focus: 'projectile', children: [{ id: 'solidDefense', level: 3, children: [] }] }, CAPS)
    .triggers[0].spell;
  check('Solid Defense is flagged as a blocker', !!eff.flags.blocks);

  const run = (shots) => {
    createWorld({ crowd: 0, atSeconds: 120 });
    G.player.x = 0; G.player.y = 0;
    const hp0 = G.player.hp;
    castSpell(eff, 0, 0, 0);
    const stones = G.spellEntities.active.filter((e) => e.alive);
    // Spacing and window both kept well inside the stones' 5.5s lifetime. An
    // earlier version ran six seconds and watched them EXPIRE, which reads
    // exactly like three stones spent on one shot.
    for (let i = 0; i < shots; i++) fireShot(300 + i * 90, 0, Math.PI, shot(), true);
    for (let i = 0; i < 60 * 4; i++) {
      G.grid.clear();
      for (const q of G.enemies.active) if (q.alive) G.grid.insert(q);
      updateSpellEntities(STEP);
      updateShots(STEP);
      G.shots.sweep((q) => { q.s.visible = false; q.glow.visible = false; });
    }
    return { out: stones.length, left: stones.filter((e) => e.alive).length, hurt: hp0 - G.player.hp };
  };

  // One stone per shot -- three stones really do stop three shots, which an
  // earlier version of this test got wrong by firing two and expecting one to
  // be spent.
  const one = run(1);
  check('one shot spends exactly one stone', one.out - one.left === 1, `${one.out} -> ${one.left}`);
  check('and the player is untouched', one.hurt === 0, `took ${Math.round(one.hurt)}`);

  // Under sustained fire more stones go, and shots start getting through.
  //
  // NOT all of them: the stones ORBIT, so a shield made of three moving bodies
  // is a probabilistic one and fire can slip between them. That is the real
  // behaviour, and an earlier version of this test asserted a wall instead.
  const over = run(4);
  check('heavier fire spends more stones', over.out - over.left > one.out - one.left,
    `${over.out} -> ${over.left} under four shots`);
  check('and some of it gets through', over.hurt > 0, `took ${Math.round(over.hurt)} damage`);
}

console.log(failures ? `\n${failures} failing` : '\nall force checks pass');
process.exit(failures ? 1 : 0);
