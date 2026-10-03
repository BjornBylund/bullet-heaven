/**
 * Spawn director regression tests.
 *
 * These exist because of one bug with an unusually nasty signature: a field
 * pinned at the population cap swallowed every boss from roughly minute 30
 * onward. The banner played, the screen shook, the schedule advanced -- and no
 * boss arrived. It was invisible in every short run, and permanent once it
 * started, because the skipped boss's slot was consumed rather than retried.
 *
 * Run: node --import ./test/register.mjs test/spawn.mjs
 */
import { createWorld } from './world.mjs';
import { G } from '../src/state.js';
import { CFG } from '../src/config.js';
import { updateSpawner, spawnEnemy, targetPopulation, damageEnemy } from '../src/enemy.js';

const STEP = 1 / 60;
let failures = 0;

function check(name, pass, detail) {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures++;
}

/** Fills the field to `n` bodies, far enough out that nothing interferes. */
function fill(n) {
  for (let i = 0; i < n; i++) spawnEnemy('zombie', Math.cos(i) * 900, Math.sin(i) * 900);
}

function sweep() {
  G.enemies.sweep((e) => { e.s.visible = false; e.hpBg.visible = false; e.hpFill.visible = false; });
}

// ---------------------------------------------------------------------------
console.log('a boss arrives even with the field at the cap');

{
  createWorld({ crowd: 0, atSeconds: 0 });
  G.t = CFG.spawn.bossEvery - 6;
  fill(CFG.spawn.maxEnemies);
  const atCap = G.enemies.count;
  const indexBefore = G.bossIndex;
  for (let i = 0; i < 60 * 10; i++) { G.t += STEP; updateSpawner(STEP); }

  check('field really is at the cap', atCap >= CFG.spawn.maxEnemies, `${atCap}`);
  check('boss spawned', !!G.boss && G.boss.alive);
  check('schedule advanced exactly once', G.bossIndex === indexBefore + 1, `index ${G.bossIndex}`);
}

// ---------------------------------------------------------------------------
console.log('\nthe cap still binds the swarm');

{
  createWorld({ crowd: 0, atSeconds: 0 });
  // Late enough that the director wants far more bodies than the cap allows.
  // Bosses are killed on arrival, or `bossPopMul` holds the target at 30% for
  // the whole test and the cap is never actually pressed -- the assertion would
  // pass without measuring anything.
  G.t = 60 * 45;
  for (let i = 0; i < 60 * 120; i++) {
    G.t += STEP;
    updateSpawner(STEP);
    if (G.boss && G.boss.alive) damageEnemy(G.boss, 1e12, {});
    sweep();
  }
  const nonBoss = G.enemies.active.filter((e) => e.alive && !e.boss).length;
  check('the swarm actually reached the cap, so this was a real test',
    nonBoss >= CFG.spawn.maxEnemies - 2, `${nonBoss}`);
  check('ordinary enemies never exceed maxEnemies', nonBoss <= CFG.spawn.maxEnemies, `${nonBoss}`);
  check('the exemption did not leak to the swarm',
    G.enemies.count <= CFG.spawn.maxEnemies + 4, `${G.enemies.count} alive`);
}

// ---------------------------------------------------------------------------
console.log('\nno boss is skipped over a long run');

{
  createWorld({ crowd: 0, atSeconds: 0 });
  G.t = 0;
  const skipped = [];
  let lastIndex = 0, aliveFor = 0;

  for (let i = 0; i < 60 * 60 * 40; i++) {        // 40 minutes
    G.t += STEP;
    updateSpawner(STEP);
    if (G.bossIndex > lastIndex) {
      lastIndex = G.bossIndex;
      aliveFor = 0;
      if (!G.boss || !G.boss.alive) skipped.push((G.t / 60).toFixed(1));
    }
    // A player who kills each boss in twenty seconds and nothing else, which is
    // the worst case for population: the target runs at full between fights.
    if (G.boss && G.boss.alive) {
      aliveFor += STEP;
      if (aliveFor > 20) damageEnemy(G.boss, 1e12, {});
    }
    sweep();
  }

  check('the run reached the cap, so this was a real test',
    G.enemies.count >= CFG.spawn.maxEnemies, `${G.enemies.count} alive`);
  check('every scheduled boss spawned', skipped.length === 0,
    skipped.length ? `missing at minutes ${skipped.join(', ')}` : `${lastIndex} bosses`);
  check('bosses kept arriving on schedule', lastIndex >= 15, `${lastIndex} in 40 minutes`);
}

console.log(failures ? `\n${failures} failing` : '\nall spawn checks pass');
process.exit(failures ? 1 : 0);
