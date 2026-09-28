// Boss time-to-kill bench.
//
// Measures how long each Focus needs to bring down each boss, using the BARE
// starting spell and nothing else. That is deliberately a floor, not a
// prediction: a real player reaches the first boss with eight or ten levels of
// runes placed. The number is useful precisely because it is upgrade-free --
// it is comparable across bosses and across balance passes, and it does not
// drift every time the rune table changes.
//
// Read it as: a geared player will be roughly three to five times faster.
//
// Usage (served page, console):   await __bossBench()
//                                 await __bossBench({ maxSeconds: 400 })
//
// The player is pinned invulnerable and levelling is suppressed, because BOTH
// death and a level-up card screen pause the sim -- and a paused sim reports
// whatever was on screen when it stopped, which has produced confidently wrong
// readings from this harness before.
window.__bossBench = async function bossBench(opts) {
  const o = opts || {};
  // A WINDOW, not a full fight. Every step drives a real render, so simulating
  // three full time-to-kills per boss cost more wall clock than the whole rest
  // of the bench. Damage per second is flat across a fight -- the boss has no
  // damage reduction and no defensive phase -- so a short window projects the
  // kill time accurately at a fraction of the cost. If the boss happens to die
  // inside the window, the exact figure is reported instead.
  const window_ = o.seconds || 30;
  // Each boss is fought at the elapsed time it actually arrives at in a run, so
  // a row reflects the encounter as played. Pass atSeconds to override and put
  // every boss on the same clock instead, which isolates their base health.
  // (Reads CFG, which is imported below -- only ever called after that runs.)
  const arrivalOf = (i) => o.atSeconds || (i + 1) * CFG.spawn.bossEvery;

  const G = window.BH.state;
  const app = G.app;
  const en = await import('../src/enemy.js');
  const boss = await import('../src/boss.js');
  const { CFG } = await import('../src/config.js');

  // Switch the wave director off for the duration. Clearing the arena every
  // frame while the spawner refills it to the minute-2.5 population target
  // burned most of the bench's time on enemies that were deleted microseconds
  // later, and left a few alive at cast time to steal auto-aim and soak pierce.
  const savedPop = { base: CFG.spawn.popBase, lin: CFG.spawn.popLin, quad: CFG.spawn.popQuad };
  CFG.spawn.popBase = CFG.spawn.popLin = CFG.spawn.popQuad = 0;

  app.ticker.stop();
  let clock = performance.now();
  const STEP = 1 / 60;

  // Yield via MessageChannel rather than setTimeout: a hidden or backgrounded
  // tab clamps timers to roughly one tick a second, which stretched a two
  // minute bench past any reasonable wait. Message tasks are not clamped.
  const chan = new MessageChannel();
  let resume = null;
  chan.port1.onmessage = () => { const r = resume; resume = null; if (r) r(); };
  const breathe = () => new Promise((r) => { resume = r; chan.port2.postMessage(0); });

  // Chunked and async: an unbroken 160k-step loop locks the tab hard enough
  // that the page has to be killed, which has happened twice on this harness.
  const run = async (focusId, bossId, atSec) => {
    // one spell, no extras, so nothing else contributes damage
    while (G.player.book.spells.length > 1) G.player.book.spells.pop();
    window.BH.setSpell(0, { focus: focusId, children: [] });
    G.player.book.spells[0].cd = 0;

    // empty arena: the boss is the only target, so auto-aim cannot be
    // distracted and the measurement is pure single-target
    G.enemies.clear((e) => { e.s.visible = false; e.hpBg.visible = false; e.hpFill.visible = false; });
    G.shots.clear((p) => { p.s.visible = false; p.glow.visible = false; });
    G.spellEntities.clear((e) => { e.s.visible = false; });

    const def = boss.BOSSES[bossId];
    G.t = atSec;                         // fix difficulty before the boss rolls its HP
    const b = en.spawnEnemy('boss_' + bossId, G.player.x + 240, G.player.y);
    if (!b) return { error: 'spawn failed' };
    const maxHp = b.maxHp;

    const startT = G.t;
    let simAdvanced = false;
    const phasesSeen = new Set();
    const patternsSeen = new Set();
    let cleared = 0;

    const steps = Math.round(window_ / STEP);
    for (let i = 0; i < steps; i++) {
      clock += 1000 / 60;
      const before = G.t;
      app.ticker.update(clock);
      if (G.t > before) simAdvanced = true;

      // Neither death nor a card screen may stall the measurement. Zeroing
      // pendingLevels is NOT enough on its own: once the panel has opened, ui.js
      // holds the choice and main.js keeps pausing until a card is picked. A
      // boss kill grants enough XP to trigger exactly that, which silently
      // invalidated every row after the first.
      G.player.hp = 1e9;
      G.player.xp = 0;
      G.player.xpNeed = 1e9;
      G.pendingLevels = 0;
      if (document.getElementById('levelup').classList.contains('show')) {
        const card = document.querySelector('#cards .card');
        if (card) card.click();
      }

      if (!b.alive) break;
      phasesSeen.add(b.bossPhase);
      if (b.patName) patternsSeen.add(b.patName);
      // Everything except the boss is removed every frame, so the measurement
      // stays pure single-target: adds and ordinary wave spawns would otherwise
      // soak pierce and steal auto-aim. The count therefore mixes boss summons
      // with normal spawns and is only a liveness check, not a summon tally.
      if (G.enemies.count > 1) {
        cleared += G.enemies.count - 1;
        for (const e of G.enemies.active) if (e !== b) e.alive = false;
        G.enemies.sweep((e) => { e.s.visible = false; e.hpBg.visible = false; e.hpFill.visible = false; });
      }

      if ((i & 4095) === 4095) await breathe();
    }

    const elapsed = G.t - startT;
    const dealt = maxHp - Math.max(0, b.hp);
    const dps = dealt / Math.max(0.001, elapsed);
    return {
      maxHp: Math.round(maxHp),
      dps: Math.round(dps),
      // measured when the boss died inside the window, projected otherwise
      ttk: +(b.alive ? maxHp / Math.max(0.001, dps) : elapsed).toFixed(1),
      ttkMeasured: !b.alive,
      phases: [...phasesSeen].join(','),
      patterns: [...patternsSeen].join(','),
      cleared,
      // If this is ever false the whole row is meaningless: the sim was paused
      // and every number above is a snapshot of a frozen frame.
      valid: simAdvanced,
      name: def.name,
    };
  };

  const out = {};
  for (let i = 0; i < boss.BOSS_IDS.length; i++) {
    const bossId = boss.BOSS_IDS[i];
    const atSec = arrivalOf(i);
    for (const focusId of ['projectile', 'burst', 'field']) {
      const row = await run(focusId, bossId, atSec);
      row.atMinute = +(atSec / 60).toFixed(1);
      out[bossId + '/' + focusId] = row;
    }
  }

  CFG.spawn.popBase = savedPop.base;
  CFG.spawn.popLin = savedPop.lin;
  CFG.spawn.popQuad = savedPop.quad;
  app.ticker.start();
  return out;
};
'boss bench loaded';
