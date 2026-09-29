// Focus balance bench. Load it into the running page and call __bench():
//
//   const s = document.createElement('script');
//   s.src = './tools/focus-bench.js';
//   document.head.appendChild(s);
//   await __bench({ crowd: true, seconds: 8 });
//
// Not imported by the game.
//
// Measures each Focus against an unkillable target set, bare versus carrying an
// identical On Hit trigger, so the difference isolates how much each Focus gets
// out of the same trigger.
//
// The harness MUST suppress progression: a level-up card screen pauses the sim,
// and a paused sim silently reports zero damage rather than failing. An earlier
// version of this file had no guard and produced a completely fabricated
// "Field does 0 single-target damage" result.
window.__bench = async function bench(opts) {
  const seconds = opts.seconds || 8;
  const crowd = opts.crowd !== false;
  const G = window.BH.state;
  const app = G.app;
  const en = await import('../src/enemy.js');

  app.ticker.stop();
  let clock = performance.now();

  const quiesce = () => {
    // clear any pending card screen, then stop new ones arriving
    const lv = document.getElementById('levelup');
    for (let i = 0; i < 60 && lv.classList.contains('show'); i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
    }
    G.pendingLevels = 0;
    G.player.stats.xpMul = 0;
    G.player.stats.maxHp = 1e9;
    G.player.hp = 1e9;
    G.player.stats.armor = 1e6;
    G.paused = false;
    G.over = false;
  };

  const plant = () => {
    G.enemies.clear((e) => {
      e.s.visible = false; e.hpBg.visible = false; e.hpFill.visible = false;
    });
    const out = [];
    const n = crowd ? 130 : 1;
    for (let i = 0; i < n; i++) {
      let x, y;
      if (crowd) {
        const a = Math.random() * Math.PI * 2;
        const d = 55 + Math.sqrt(Math.random()) * 205;   // dense disc, r 55..260
        x = G.player.x + Math.cos(a) * d;
        y = G.player.y + Math.sin(a) * d;
      } else {
        x = G.player.x + 70; y = G.player.y;
      }
      const e = en.spawnEnemy('golem', x, y);
      if (e) { e.hp = e.maxHp = 1e9; e.speed = 0; out.push(e); }
    }
    return out;
  };

  const run = (focus, children) => {
    while (G.player.book.spells.length > 1) G.player.book.spells.pop();
    window.BH.setSpell(0, { focus, children });
    G.player.book.spells[0].cd = 0;
    G.spellEntities.clear((e) => { e.s.visible = false; });
    G.shots.clear((p) => { p.s.visible = false; p.glow.visible = false; });
    quiesce();

    const planted = plant();
    const t0 = G.t;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      clock += 1000 / 60;
      app.ticker.update(clock);
      if (i % 30 === 0) quiesce();      // keep it unpaused for the whole window
    }
    const advanced = G.t - t0;
    let dmg = 0;
    for (const e of planted) dmg += 1e9 - e.hp;
    return {
      dps: Math.round(dmg / seconds),
      // if this is not close to `seconds`, the sim stalled and the number is junk
      simAdvanced: +advanced.toFixed(2),
    };
  };

  const TRIGGER = [{ id: 'cruelThorns', level: 1, children: [] }];
  const out = { mode: crowd ? 'crowd (130 targets)' : 'single target' };
  // Field is no longer a playable Focus -- it survives only as the entity kind
  // that trigger effects and the fire trail compile from.
  for (const focus of ['projectile', 'cone', 'burst']) {
    const bare = run(focus, []);
    const withTrig = run(focus, TRIGGER);
    out[focus] = {
      bareDps: bare.dps,
      withTriggerDps: withTrig.dps,
      triggerMultiplier: +(withTrig.dps / Math.max(1, bare.dps)).toFixed(2),
      simAdvanced: withTrig.simAdvanced,
      valid: withTrig.simAdvanced > seconds * 0.9,
    };
  }
  app.ticker.start();
  return out;
};
'bench loaded';
