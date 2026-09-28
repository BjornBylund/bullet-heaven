import * as PIXI from './pixi.js';
import { G } from './state.js';
import { CFG } from './config.js';
import { buildTextures } from './textures.js';
import { initInput, onPress } from './input.js';
import { initFx, clearFx, updateFx } from './fx.js';
import { initPickups, clearPickups, updatePickups } from './pickups.js';
import {
  initEnemies, resetEnemies, updateEnemies, updateSpawner, targetPopulation,
} from './enemy.js';
import { initCasting, clearCasting, updateSpellEntities } from './cast.js';
import { initShots, clearShots, updateShots } from './shots.js';
import {
  initBook, resetBook, updateSpellbook, bookSummary, grantRune, recompileAll,
  tryPlace, book,
} from './spellbook.js';
import { walkNodes } from './spell.js';
import { initPlayer, resetPlayer, updatePlayer, recomputeStats } from './player.js';
import { resetOffers } from './upgrades.js';
import {
  initEditor, openEditor, closeEditor, isEditorOpen, refreshNag,
} from './editor.js';
import {
  initUI, updateHud, refreshSlots, showStart, showPaused,
  showLevelUp, showGameOver, hideGameOver, isChoosing,
} from './ui.js';

/**
 * Bootstrap and the main loop.
 *
 * Logic runs on a fixed 60Hz timestep while rendering runs at display rate, so
 * cooldowns, spawn pacing and movement are identical on a 60Hz laptop and a
 * 165Hz monitor. The step budget caps how much one frame may catch up on, so a
 * stall drops time instead of spiralling.
 */

const STEP = 1 / 60;
const MAX_STEPS = 5;
let acc = 0;

let ground;
let world;

async function boot() {
  const app = new PIXI.Application();
  await app.init({
    resizeTo: window,
    background: 0x05070c,
    antialias: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  document.getElementById('app').appendChild(app.canvas);

  G.app = app;
  G.tex = buildTextures();
  syncScreen();

  // Screen-space tiling sprite whose tile offset tracks the camera: an
  // unbounded scrolling field for the cost of one sprite.
  ground = new PIXI.TilingSprite({
    texture: G.tex.ground,
    width: G.screen.w,
    height: G.screen.h,
  });
  app.stage.addChild(ground);

  world = new PIXI.Container();
  app.stage.addChild(world);

  G.layers = {
    gems: new PIXI.Container(),
    enemies: new PIXI.Container(),
    // health bars sit above the crowd so a wounded heavy is never buried
    bars: new PIXI.Container(),
    player: new PIXI.Container(),
    // enemy fire sits above the player so incoming threats are never occluded
    shots: new PIXI.Container(),
    proj: new PIXI.Container(),
    fx: new PIXI.Container(),
  };
  for (const k of ['gems', 'enemies', 'bars', 'player', 'shots', 'proj', 'fx']) {
    world.addChild(G.layers[k]);
  }

  initInput();
  initFx();
  initPickups();
  initEnemies();
  initCasting();
  initShots();
  initPlayer();
  initBook();
  initEditor();
  initUI({ onStart: startRun, onRestart: restart });

  app.renderer.on('resize', () => {
    syncScreen();
    ground.width = G.screen.w;
    ground.height = G.screen.h;
  });

  onPress((code) => {
    if (!G.running || G.over || isChoosing()) return;
    if (code === 'KeyE') {
      isEditorOpen() ? closeEditor() : openEditor();
      refreshNag();
    } else if (code === 'Escape') {
      if (isEditorOpen()) { closeEditor(); refreshNag(); return; }
      G.paused = !G.paused;
      showPaused(G.paused);
    }
  });

  app.ticker.add(tick);

  // Tuning hooks. Jumping the clock is the only practical way to look at a
  // fifteen-minute swarm while balancing, and the counts tell you which pool is
  // actually under pressure.
  window.BH = {
    state: G,
    skipTo: (s) => { G.t = s; },
    levels: (n = 1) => { G.pendingLevels += n; },
    give: (id, n = 1) => { grantRune(id, n); refreshNag(); },
    // assign a spell tree wholesale, for balance and load testing
    setSpell: (i, tree) => {
      const e = G.player.book.spells[i];
      if (e) { e.spell = tree; recompileAll(); refreshSlots(); }
    },
    spells: () => bookSummary(),
    // greedily socket everything held, for balance runs without the editor
    autoPlace: () => {
      let placed = 0;
      for (let pass = 0; pass < 40; pass++) {
        const inv = Object.keys(book().inventory).filter((k) => book().inventory[k] > 0);
        if (!inv.length) break;
        let any = false;
        for (const id of inv) {
          for (let i = 0; i < book().spells.length && !any; i++) {
            for (const ch of walkNodes(book().spells[i].spell)) {
              if (tryPlace(i, ch.path, id).ok) { placed++; any = true; break; }
            }
          }
          if (any) break;
        }
        if (!any) break;
      }
      refreshSlots();
      refreshNag();
      return placed;
    },
    // how full the field should be right now, for density tuning
    target: () => targetPopulation(G.t / 60),
    counts: () => ({
      enemies: G.enemies.count,
      targetEnemies: targetPopulation(G.t / 60),
      spellEntities: G.spellEntities.count,
      enemyShots: G.shots.count,
      gems: G.gems.count,
      particles: G.particles.count,
      effects: G.effects.count,
    }),
  };
}

function syncScreen() {
  G.screen.w = G.app.renderer.width / G.app.renderer.resolution;
  G.screen.h = G.app.renderer.height / G.app.renderer.resolution;
}

let lastFocus = 'projectile';

function startRun(focusId) {
  lastFocus = focusId || lastFocus;

  clearCasting();
  clearShots();
  resetEnemies();
  clearPickups();
  clearFx();
  resetPlayer();
  resetBook(lastFocus);
  resetOffers();

  G.t = 0;
  G.kills = 0;
  G.gold = 0;
  G.pendingLevels = 0;
  G.over = false;
  G.won = false;
  G.cam.x = 0;
  G.cam.y = 0;
  acc = 0;

  refreshSlots();
  updateHud();
  refreshNag();

  showStart(false);
  hideGameOver();
  showPaused(false);
  closeEditor();
  G.paused = false;
  G.running = true;
}

/** Back to character select, so a new run can pick a different starting Focus. */
function restart() {
  G.running = false;
  hideGameOver();
  showStart(true);
}

function step(dt) {
  G.t += dt;

  // Levels grant stats implicitly now that passive cards are gone. Rebuilding
  // here rather than inside progress.js keeps that module free of a player
  // import, which would close a cycle.
  if (G.statsDirty) { recomputeStats(); G.statsDirty = false; }

  updateSpawner(dt);
  updateEnemies(dt);        // rebuilds the spatial hash; everything below queries it
  updatePlayer(dt);
  if (G.over) return;
  updateSpellbook(dt);      // casts spells whose cooldown elapsed
  updateSpellEntities(dt);  // moves them, resolves hits, fires triggers
  updateShots(dt);          // enemy fire; only tests against the player
  if (G.over) return;
  updatePickups(dt);
  updateFx(dt);

  if (G.t >= CFG.runSeconds) {
    G.won = true;
    G.over = true;
  }
}

function endRun() {
  G.running = false;
  G.paused = false;
  closeEditor();
  showGameOver(G.won);
}

/** One card screen per pending level, so a chest can grant several. */
function maybeLevelUp() {
  if (G.over || G.pendingLevels <= 0 || isChoosing() || isEditorOpen()) return;
  G.paused = true;
  showLevelUp(() => {
    G.pendingLevels--;
    if (G.pendingLevels > 0) maybeLevelUp();
    else { G.paused = false; refreshNag(); }
  });
}

function tick(ticker) {
  const dtReal = Math.min(ticker.deltaMS / 1000, 0.25);
  const blocked = G.paused || G.over || isEditorOpen();

  if (G.running && !blocked) {
    acc += dtReal;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS) {
      step(STEP);
      acc -= STEP;
      steps++;
      if (G.over) break;
    }
    // Drop the backlog rather than trying to catch up forever after a stall.
    if (steps >= MAX_STEPS) acc = 0;

    if (G.over) endRun();
    else maybeLevelUp();

    updateHud();
  }

  render();
}

function render() {
  const p = G.player;
  if (!p) return;

  G.cam.x = p.x;
  G.cam.y = p.y;

  let sx = 0, sy = 0;
  if (G.shake > 0.05) {
    sx = (Math.random() * 2 - 1) * G.shake;
    sy = (Math.random() * 2 - 1) * G.shake;
  }

  world.x = Math.round(G.screen.w / 2 - G.cam.x + sx);
  world.y = Math.round(G.screen.h / 2 - G.cam.y + sy);
  ground.tilePosition.set(world.x, world.y);
}

boot();
