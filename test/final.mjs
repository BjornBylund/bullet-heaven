/**
 * The run's ending.
 *
 * Three bosses, then THE RUIN, then the run is over one way or the other. The
 * properties worth holding onto are that it ARRIVES (on the third kill, not on
 * a timer), that nothing else is scheduled once it has, that killing it wins,
 * and that it escalates so the fight cannot be stalled forever.
 *
 * Run: node --import ./test/register.mjs test/final.mjs
 */
import { createWorld } from './world.mjs';
import { G } from '../src/state.js';
import { CFG } from '../src/config.js';
import { updateSpawner, damageEnemy, spawnEnemy } from '../src/enemy.js';
import { FINAL_BOSS, FINAL_AFTER } from '../src/boss.js';

const STEP = 1 / 60;
let failures = 0;
const check = (name, pass, detail) => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures++;
};
const sweep = () => G.enemies.sweep((e) => {
  e.s.visible = false; e.hpBg.visible = false; e.hpFill.visible = false;
});

/** Plays forward, killing each boss on sight, until `stop` says so. */
function play(stop, maxSeconds = 60 * 30) {
  const killed = [];
  for (let i = 0; i < 60 * maxSeconds; i++) {
    G.t += STEP;
    updateSpawner(STEP);
    if (G.boss && G.boss.alive) {
      killed.push(G.boss.bossDef.id);
      damageEnemy(G.boss, 1e12, {});
    }
    sweep();
    if (stop()) return killed;
  }
  return killed;
}

// ---------------------------------------------------------------------------
console.log('the Ruin arrives on the third boss kill');
{
  createWorld({ crowd: 0, atSeconds: 0 });
  G.t = 0;
  const killed = play(() => G.finalBoss);

  check('three scheduled bosses came first', killed.length === FINAL_AFTER, `killed ${killed.length}`);
  check('and they were the three normal ones',
    !killed.includes(FINAL_BOSS.id), killed.join(', '));
  check('the Ruin is now live', !!G.boss && G.boss.bossDef.id === FINAL_BOSS.id,
    G.boss ? G.boss.bossDef.id : 'none');
  check('it is announced', G.bossWarnDef === FINAL_BOSS && G.bossWarn > 0);
  check('the run is not over yet', !G.over);
}

// ---------------------------------------------------------------------------
console.log('\nnothing else is scheduled once it has begun');
{
  createWorld({ crowd: 0, atSeconds: 0 });
  G.t = 0;
  play(() => G.finalBoss);
  const ruin = G.boss;
  const indexAtStart = G.bossIndex;

  // Ten minutes, well past several scheduled boss slots, without killing it.
  for (let i = 0; i < 60 * 600; i++) {
    G.t += STEP;
    updateSpawner(STEP);
    ruin.hp = ruin.maxHp;            // hold the fight open
    sweep();
  }
  check('no further bosses were scheduled', G.bossIndex === indexAtStart,
    `index ${G.bossIndex}, was ${indexAtStart}`);
  check('the Ruin is still the live boss', G.boss === ruin);
  const otherBosses = G.enemies.active.filter((e) => e.alive && e.boss && e !== ruin).length;
  check('and it is the only boss on the field', otherBosses === 0, `${otherBosses} others`);
}

// ---------------------------------------------------------------------------
console.log('\nit cannot be killed');
{
  createWorld({ crowd: 0, atSeconds: 0 });
  G.t = 0;
  play(() => G.finalBoss);
  const ruin = G.boss;
  const hpBefore = ruin.hp;

  for (let i = 0; i < 50; i++) damageEnemy(ruin, 1e12, {});
  check('absorbs everything thrown at it', ruin.hp === hpBefore, `${ruin.hp} / ${ruin.maxHp}`);
  check('still alive', ruin.alive && G.boss === ruin);
  check('damageEnemy reports no kill', damageEnemy(ruin, 1e12, {}) === false);
  check('shooting it does not end the run', !G.over);
  check('there is no won state at all', G.won === undefined, `G.won is ${G.won}`);

  // Every other boss changes pattern pool as its health drops. This one has no
  // health to drop, so the phases run on rage -- without that it would stay in
  // its opening pool forever and never escalate at all.
  check('starts in its first phase', ruin.bossPhase === 0, `phase ${ruin.bossPhase}`);
  const { updateBossBehavior } = await import('../src/boss.js');
  for (let i = 0; i < 60 * 80; i++) updateBossBehavior(ruin, STEP, 1, 0, 200, ruin.speed);
  check('and reaches its last phase on time alone',
    ruin.bossPhase === FINAL_BOSS.phases.length - 1,
    `phase ${ruin.bossPhase} of ${FINAL_BOSS.phases.length - 1}`);
}

// ---------------------------------------------------------------------------
console.log('\nit escalates, so the fight cannot be stalled');
{
  createWorld({ crowd: 0, atSeconds: 480 });
  const e = spawnEnemy('boss_' + FINAL_BOSS.id, 200, 0);
  const startDmg = e.dmg, startShot = e.shotDef.dmg;
  check('rage starts at zero', e.rage === 0);

  for (let i = 0; i < 60 * 90; i++) {
    G.t += STEP;
    e.hp = e.maxHp;                  // never let it die, only let it rage
    updateSpawner(STEP);
    // drive the boss's own loop the way updateEnemies would
    const { updateBossBehavior } = await import('../src/boss.js');
    updateBossBehavior(e, STEP, 1, 0, 200, e.speed);
  }
  check('rage reaches maximum', e.rage === 1, `${e.rage.toFixed(2)}`);
  check('it ends up faster than the player',
    e.speed > CFG.player.moveSpeed, `${Math.round(e.speed)} vs ${CFG.player.moveSpeed}`);
  check('its shots outrun the player too',
    e.shotDef.speed > CFG.player.moveSpeed, `${Math.round(e.shotDef.speed)}`);
  check('contact damage roughly doubles', e.dmg > startDmg * 1.9,
    `${Math.round(startDmg)} -> ${Math.round(e.dmg)}`);
  check('shot damage more than doubles', e.shotDef.dmg > startShot * 2.1,
    `${startShot} -> ${Math.round(e.shotDef.dmg)}`);
}

// ---------------------------------------------------------------------------
console.log('\nthe tell survives the escalation');
{
  const { FINAL_BOSS: FB } = await import('../src/boss.js');
  createWorld({ crowd: 0, atSeconds: 480 });
  const e = spawnEnemy('boss_' + FB.id, 200, 0);
  const { updateBossBehavior } = await import('../src/boss.js');

  // Longest windup in the table, at full rage, is still something a player can
  // read. An unreadable tell is noise, not difficulty.
  e.rage = 1;
  let shortest = Infinity;
  for (let i = 0; i < 60 * 120; i++) {
    e.hp = e.maxHp;
    e.rage = 1; e.rageT = 1e6;
    updateBossBehavior(e, STEP, 1, 0, 200, e.speed);
    if (e.patState === 0 && e.pat) shortest = Math.min(shortest, e.pat.windup * 0.8);
  }
  check('windup never drops below 0.4s', shortest >= 0.4, `${shortest.toFixed(2)}s`);
}

// ---------------------------------------------------------------------------
console.log('\nrunning away does not opt out of the fight');
{
  const { updateEnemies } = await import('../src/enemy.js');
  const { updateShots } = await import('../src/shots.js');
  const { updatePlayer, recomputeStats } = await import('../src/player.js');

  createWorld({ crowd: 0, atSeconds: 450 });
  const p = G.player;
  p.level = 30; recomputeStats(); p.hp = p.stats.maxHp; p.x = 0; p.y = 0;
  const ruin = spawnEnemy('boss_' + FINAL_BOSS.id, 520, 0);
  ruin.maxHp = ruin.hp = 1e12;              // measuring the boss, not a build

  let died = 0, maxDist = 0;
  for (let i = 0; i < 60 * 150; i++) {
    G.t += STEP;
    G.grid.clear();
    for (const q of G.enemies.active) if (q.alive) G.grid.insert(q);
    // The best a movement-only game allows: run directly away, forever.
    const dx = p.x - ruin.x, dy = p.y - ruin.y, d = Math.hypot(dx, dy) || 1;
    maxDist = Math.max(maxDist, d);
    p.x += (dx / d) * p.stats.moveSpeed * STEP;
    p.y += (dy / d) * p.stats.moveSpeed * STEP;
    updateEnemies(STEP);
    updateShots(STEP);
    updatePlayer(STEP);
    sweep();
    if (p.hp <= 0) { died = i / 60; break; }
  }

  // Both halves of this were real bugs. The boss crossed the despawn radius and
  // the encounter stopped existing -- and since nothing else is scheduled once
  // the ending has begun, the run could then never finish at all. With despawn
  // fixed it stood still, firing patterns at a player 13,000px away.
  check('the boss is never left behind', maxDist < 2000, `reached ${Math.round(maxDist)}px`);
  check('the boss still exists', ruin.alive && G.boss === ruin);
  check('a fleeing player still dies', died > 0, died ? `${died.toFixed(1)}s` : 'survived 150s');
  check('and not instantly -- running still buys time', died > 12, `${died.toFixed(1)}s`);
}

// ---------------------------------------------------------------------------
console.log('\nthe screen fills as it rages');
{
  const { updateShots } = await import('../src/shots.js');
  const { updateBossBehavior } = await import('../src/boss.js');
  createWorld({ crowd: 0, atSeconds: 450 });
  const e = spawnEnemy('boss_' + FINAL_BOSS.id, 260, 0);

  // Projectile counts scale continuously with rage on top of the phase steps,
  // so the gap a player walks through keeps narrowing. Sampled rather than
  // asserted at one instant, because the count depends which pattern is live.
  const sample = (untilSeconds) => {
    let peak = 0;
    for (let i = 0; i < 60 * untilSeconds; i++) {
      e.hp = e.maxHp;
      updateBossBehavior(e, STEP, -1, 0, 260, e.speed);
      updateShots(STEP);
      G.shots.sweep((q) => { q.s.visible = false; q.glow.visible = false; });
      peak = Math.max(peak, G.shots.count);
    }
    return peak;
  };

  const early = sample(20);
  const late = sample(60);
  check('fire thickens as the fight goes on', late > early * 1.5, `${early} -> ${late} shots`);
  check('and reaches the ceiling', late >= CFG.spawn.maxShots + CFG.spawn.bossShotHeadroom - 20,
    `${late} of ${CFG.spawn.maxShots + CFG.spawn.bossShotHeadroom}`);
}

// ---------------------------------------------------------------------------
console.log('\nit gets its own music');
{
  const { pendingTrack, currentTrack, trackNames } = await import('../src/audio.js');
  const { updateEnemies } = await import('../src/enemy.js');

  // Driven from updateEnemies rather than asserted on setTrack directly, so
  // this covers the selection the running game actually makes.
  const trackFor = (bossId) => {
    createWorld({ crowd: 0, atSeconds: 450 });
    if (bossId) spawnEnemy('boss_' + bossId, 300, 0);
    G.grid.clear();
    for (const q of G.enemies.active) if (q.alive) G.grid.insert(q);
    updateEnemies(STEP);
    sweep();
    return pendingTrack() || currentTrack();
  };

  check('there are three tracks', trackNames().length === 3, trackNames().join(', '));
  check('no boss plays the main theme', trackFor(null) === 'main');
  check('an ordinary boss plays the boss theme', trackFor('stormCrown') === 'boss');
  check('THE RUIN gets its own', trackFor(FINAL_BOSS.id) === 'ruin');
}

// ---------------------------------------------------------------------------
console.log('\nit is never buried by the swarm');
{
  const { updateEnemies } = await import('../src/enemy.js');
  createWorld({ crowd: 0, atSeconds: 450 });
  const ruin = spawnEnemy('boss_' + FINAL_BOSS.id, 200, 0);

  // Spawned AFTER the boss, which is exactly the case that broke: draw order
  // inside a layer is pool-creation order, so anything created later lands on
  // top. Measured in the real game mid-fight: the boss at child index 686 of
  // 900, with 60 of the 61 live enemies on screen drawn over it. It was
  // rendering perfectly and was simply underneath, which looks identical to
  // invisible -- especially for the one boss with no health bar.
  for (let i = 0; i < 300; i++) {
    spawnEnemy('zombie', Math.cos(i) * 140, Math.sin(i) * 140);
  }
  const layer = G.layers.enemies;
  // Bury it deliberately rather than hoping the pool hands out sprites in an
  // unlucky order: re-adding a child moves it to the end, so this puts every
  // live enemy above the boss and reproduces the reported state exactly.
  for (const q of G.enemies.active) if (q.alive && q !== ruin) layer.addChild(q.s);
  check('the swarm really did land on top first',
    layer.children.indexOf(ruin.s) < layer.children.length - 1,
    `boss at ${layer.children.indexOf(ruin.s)} of ${layer.children.length - 1}`);

  G.grid.clear();
  for (const q of G.enemies.active) if (q.alive) G.grid.insert(q);
  updateEnemies(STEP);

  const kids = layer.children;
  const bossAt = kids.indexOf(ruin.s);
  let above = 0;
  for (const q of G.enemies.active) {
    if (!q.alive || q === ruin) continue;
    if (kids.indexOf(q.s) > bossAt) above++;
  }
  check('one frame later the boss is drawn last', bossAt === kids.length - 1,
    `index ${bossAt} of ${kids.length - 1}`);
  check('nothing is drawn over it', above === 0, `${above} sprites above`);
}

console.log(failures ? `\n${failures} failing` : '\nall ending checks pass');
process.exit(failures ? 1 : 0);
