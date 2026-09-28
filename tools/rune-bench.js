// Rune balance bench.
//
// For every rune in the table, measures the damage a Projectile spell deals
// with that rune socketed versus bare, in a packed crowd and against a single
// target. The gap is the rune's contribution; divided by its attunement cost it
// is the number that actually decides whether the rune is worth a socket.
//
// Usage (served page, console):
//   await __runeBench()
//   await __runeBench({ focus: 'burst', seconds: 6 })
//
// THREE MEASUREMENTS, because no single one of them is honest on its own:
//
//   DMG     an invulnerable crowd. Damage is continuous, so this resolves small
//           effects cleanly. It is the only metric fine-grained enough to
//           separate the many runes that alter damage by a few tens of percent.
//
//   KILLS   a live crowd of killable enemies, replaced as they die so the
//           population holds steady. ON-KILL TRIGGERS ONLY FIRE HERE, and this
//           is also the only metric that charges a rune for overkill.
//
//   BOSS    one invulnerable target. Damage is not shared and nothing dies to
//           feed a trigger.
//
// Both crowd metrics are needed because each is blind where the other sees.
// Damage-against-invulnerable cannot fire an on-kill trigger. Kill rate
// quantises to whole corpses, which silently hides anything that does not move
// a breakpoint -- measured directly, nine different runes returned byte
// identical kill counts because a +60% damage rune still needed three hits to
// drop a 59 HP zombie. Reported alone, either one would have been wrong.
//
// WHAT THIS STILL CANNOT SEE. It is a damage bench, so it scores defensive and
// utility runes at or near zero. That is a limitation of the measurement, NOT a
// verdict on the rune:
//   - numbingCold applies Weaken, which only reduces damage the player takes.
//   - speedUp / shortFuse / messengerOfPeace / ret change how a projectile
//     travels; they convert to damage only through hit rate, which a stationary
//     player barely exercises.
//   - frostbite and burnedToDeath are conditional on Frozen and Burn. A bare
//     Projectile applies neither, so they score zero ALONE and have to be read
//     as combo pieces. Scoring zero here is itself the finding.
//   - icyWind's Chill slows enemies, which is worth little against a crowd that
//     is already walking into the spell.
//
// The player is pinned invulnerable, levelling is suppressed and the wave
// director is switched off, because a level-up card screen pauses the sim and a
// paused sim reports whatever was frozen on screen. Check `valid` on every row.
window.__runeBench = async function runeBench(opts) {
  const o = opts || {};
  const seconds = o.seconds || 5;
  const focusId = o.focus || 'projectile';
  const crowdSize = o.crowd || 80;
  // Line infantry, not golems. An earlier version churned golems (312 effective
  // HP) and a bare spell killed exactly zero of them in the window, so on-kill
  // triggers still never fired -- the same blind spot the churn was added to
  // remove, just hidden one level deeper. A zombie dies to two bare hits, which
  // is what the crowd actually looks like when the player meets it.
  const crowdType = o.type || 'zombie';
  // Every row is measured at the same elapsed time. Without this, G.t advances
  // across rows, difficulty scaling gives each successive crowd more health,
  // and damage-dealt drifts upward for reasons that have nothing to do with the
  // rune -- measured at +48% from first row to last, which is larger than most
  // runes' actual effect.
  const atSeconds = o.atSeconds || 150;   // minute 2.5, same clock as the boss bench

  const G = window.BH.state;
  const app = G.app;
  const en = await import('../src/enemy.js');
  const { RUNES } = await import('../src/runes.js');
  const { CFG } = await import('../src/config.js');
  const { clearFx } = await import('../src/fx.js');
  const { clearPickups } = await import('../src/pickups.js');

  const savedPop = { b: CFG.spawn.popBase, l: CFG.spawn.popLin, q: CFG.spawn.popQuad };
  CFG.spawn.popBase = CFG.spawn.popLin = CFG.spawn.popQuad = 0;

  app.ticker.stop();
  let clock = performance.now();
  const STEP = 1 / 60;

  // Not setTimeout: a hidden tab clamps timers to ~1/s and stretches this past
  // any reasonable wait. Message tasks are not clamped.
  const chan = new MessageChannel();
  let resume = null;
  chan.port1.onmessage = () => { const r = resume; resume = null; if (r) r(); };
  const breathe = () => new Promise((r) => { resume = r; chan.port2.postMessage(0); });

  const HUGE = 1e9;

  // Deterministic placement. With a stationary player and a directional spell,
  // WHERE the crowd happens to stand dominates the result, so a random layout
  // made identical configurations differ by up to 48%. The golden angle gives an
  // even, repeatable disc; `seq` advances so replacements land in fresh gaps
  // rather than stacking on the spot that just cleared.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  let seq = 0;
  // `single` is the boss stand-in: one target at a fixed distance. Everything
  // else is a DISC, spread from 55 to 260. This used to key off `churn`, which
  // meant the damage scenario stacked all 80 enemies on one ring at exactly
  // 120px -- so any rune that changed reach hit a cliff instead of a gradient,
  // and Silent Grudge measured +1% where a real crowd gives +203%.
  const spawnOne = (single, mode) => {
    const i = seq++;
    const a = i * GOLDEN;
    const d = single ? 120 : 55 + Math.sqrt((i % crowdSize) / crowdSize) * 205;
    const type = mode === 'kill' ? crowdType : 'golem';
    const e = en.spawnEnemy(type, G.player.x + Math.cos(a) * d, G.player.y + Math.sin(a) * d);
    if (!e) return null;
    e.speed = 0;                       // held still so the layout is repeatable
    if (mode !== 'kill') { e.hp = e.maxHp = HUGE; }
    return e;
  };

  const plant = (n, single, mode) => {
    G.enemies.clear((e) => { e.s.visible = false; e.hpBg.visible = false; e.hpFill.visible = false; });
    const out = [];
    for (let i = 0; i < n; i++) { const e = spawnOne(single, mode); if (e) out.push(e); }
    return out;
  };

  // mode: 'dmg' invulnerable crowd | 'kill' churning crowd | 'boss' single target
  const run = async (children, mode) => {
    const n = mode === 'boss' ? 1 : crowdSize;
    // Fail loudly rather than returning zeros. Between bench calls the ticker
    // runs normally with a live crowd standing on the player, so the run can
    // end -- and a finished run reports 0 damage for every rune, which looks
    // like data. Calling the bench twice in a row used to do exactly this.
    if (G.over || !G.running) {
      throw new Error('bench aborted: the run has ended (G.over) -- reload and start a fresh run');
    }
    while (G.player.book.spells.length > 1) G.player.book.spells.pop();
    window.BH.setSpell(0, { focus: focusId, children });
    G.player.book.spells[0].cd = 0;
    G.spellEntities.clear((e) => { e.s.visible = false; });
    G.shots.clear((p) => { p.s.visible = false; p.glow.visible = false; });
    // Every kill drops a gem and sprays particles. Left alone these accumulate
    // across rows, so each rune is measured against a fuller world than the
    // last -- later rows get slower and noisier for reasons that have nothing
    // to do with the rune being tested. The game's own reset helpers know the
    // right fields (gems carry a glow sprite, floaters a container).
    clearPickups();
    clearFx();

    const churn = mode === 'kill';
    G.t = atSeconds;                   // fix difficulty before anything is spawned
    seq = 0;                           // identical layout for every row
    let planted = plant(n, mode === 'boss', mode);
    let simAdvanced = false;
    let kills = 0;
    let banked = 0;                    // damage already dealt to enemies that died
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i++) {
      clock += 1000 / 60;
      const before = G.t;
      app.ticker.update(clock);
      if (G.t > before) simAdvanced = true;
      // Hold difficulty still for the whole window too: a five second row would
      // otherwise end against slightly tougher enemies than it started.
      G.t = atSeconds;
      G.player.hp = HUGE;
      G.player.xp = 0;
      G.player.xpNeed = HUGE;
      G.pendingLevels = 0;
      if (document.getElementById('levelup').classList.contains('show')) {
        const card = document.querySelector('#cards .card');
        if (card) card.click();
      }
      // Breathe often. At 4096 the harness blocked the main thread for about
      // seven seconds at a stretch, which froze the page hard enough that
      // nothing else could run -- including a console call asking whether it
      // had finished.
      // Hold the population steady: bank what a corpse absorbed and replace it,
      // so the crowd the spell is shooting into does not thin over the window.
      if (churn) {
        const alive = [];
        for (const e of planted) {
          if (e.alive) { alive.push(e); continue; }
          banked += e.maxHp;
          kills++;
          const rep = spawnOne(false, mode);
          if (rep) alive.push(rep);
        }
        planted = alive;
      }

      if ((i & 255) === 255) await breathe();
    }
    let dmg = banked;
    for (const e of planted) dmg += (churn ? e.maxHp : HUGE) - e.hp;
    return { dps: Math.round(dmg / seconds), kps: +(kills / seconds).toFixed(1), valid: simAdvanced };
  };

  const socket = (id, level) => [{ id, level, children: [] }];

  // WARM-UP. The very first run pays for JIT, texture upload and pool growth,
  // and comes in measurably low. Used as the baseline it inflates every rune
  // that follows by roughly a quarter -- which is how nine runes with no real
  // effect came to read as "+23%". Discarded.
  await run([], 'dmg');

  // Noise floor: the same configuration measured repeatedly. Any rune whose
  // effect is smaller than this spread is unmeasured, not weak.
  const repeat = o.repeatBase || 1;
  const baseRuns = [];
  for (let i = 0; i < repeat; i++) baseRuns.push(await run([], 'dmg'));
  const baseCrowd = baseRuns[baseRuns.length - 1];
  const baseKill = await run([], 'kill');
  const baseDpsAll = baseRuns.map((r) => r.dps);
  const noise = repeat > 1
    ? { runs: baseDpsAll, min: Math.min(...baseDpsAll), max: Math.max(...baseDpsAll),
        spreadPct: Math.round(((Math.max(...baseDpsAll) - Math.min(...baseDpsAll))
                               / Math.max(1, Math.min(...baseDpsAll))) * 100) }
    : null;
  const baseSingle = await run([], 'boss');
  const pct = (v, base) => Math.round(((v - base) / Math.max(1, base)) * 100);

  const rows = [];
  const ids = o.only && o.only.length ? o.only : Object.keys(RUNES);
  for (const id of ids) {
    const r = RUNES[id];
    const d1 = await run(socket(id, 1), 'dmg');
    const d3 = await run(socket(id, 3), 'dmg');
    const k3 = await run(socket(id, 3), 'kill');
    const s3 = await run(socket(id, 3), 'boss');
    rows.push({
      id,
      name: r.name,
      kind: r.kind,
      tier: r.tier,
      cost: r.cost,
      dmgL1: d1.dps,
      dmgL3: d3.dps,
      dmgPctL1: pct(d1.dps, baseCrowd.dps),
      dmgPctL3: pct(d3.dps, baseCrowd.dps),
      killsL3: k3.kps,
      killPctL3: pct(k3.kps, baseKill.kps),
      singleL3: s3.dps,
      gainL3: d3.dps - baseCrowd.dps,
      // the number that decides whether a socket is worth spending. Free runes
      // divide by 1, so this reads as "gain per point, or raw gain if free".
      perCost: Math.round(pct(d3.dps, baseCrowd.dps) / Math.max(1, r.cost)),
      singleGainL3: s3.dps - baseSingle.dps,
      valid: d1.valid && d3.valid && k3.valid && s3.valid,
    });
  }

  CFG.spawn.popBase = savedPop.b;
  CFG.spawn.popLin = savedPop.l;
  CFG.spawn.popQuad = savedPop.q;
  app.ticker.start();

  rows.sort((a, b) => b.gainL3 - a.gainL3);
  return { focus: focusId, crowdType, crowdSize, seconds, atSeconds,
           baseCrowd, baseKill, baseSingle, noise, rows };
};
'rune bench loaded';
