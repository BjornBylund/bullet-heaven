import { G } from './state.js';
import { CFG } from './config.js';
import { formatTime } from './util.js';
import { FOCUSES, FOCUS_IDS } from './focuses.js';
import { countNodes } from './spell.js';
import { rollChoices, applyChoice } from './upgrades.js';
import { onPress } from './input.js';
import { loadScores, clearScores, MAX_SCORES } from './scores.js';
import { getVolume, setVolume, setMusicEnabled, isMusicEnabled } from './audio.js';

/**
 * HUD and menus, as plain DOM over the canvas: text stays crisp at any DPI,
 * layout is free, and none of it costs a draw call.
 */

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

let el = {};
let pendingChoices = null;
let onChoiceMade = null;

export function initUI(handlers) {
  el = {
    xpfill: $('xpfill'), level: $('level'), timer: $('timer'), kills: $('kills'),
    hpfill: $('hpfill'), hptext: $('hptext'),
    wslots: $('wslots'), pslots: $('pslots'),
    start: $('start'), chars: $('chars'),
    levelup: $('levelup'), lvtitle: $('lvtitle'), cards: $('cards'),
    paused: $('paused'), gameover: $('gameover'),
    gotitle: $('gotitle'), results: $('results'),
    mutebtn: $('mutebtn'), vol: $('vol'),
    scores: $('scores'), scorebanner: $('scorebanner'),
    clearscores: $('clearscores'), beststrip: $('beststrip'),
    bosswrap: $('bosswrap'), bossname: $('bossname'), bossfill: $('bossfill'),
    bosswarn: $('bosswarn'), bosswarnname: $('bosswarnname'),
    bosswarntitle: $('bosswarntitle'),
  };

  // Character select is the starting Focus and nothing else. A bare Focus is
  // already a working spell, so there is no empty canvas to face at 00:00.
  el.chars.innerHTML = '';
  for (const id of FOCUS_IDS) {
    const f = FOCUSES[id];
    const c = document.createElement('div');
    c.className = 'chr';
    c.innerHTML =
      `<div class="ico" style="color:${hex(f.color)}">${f.icon}</div>` +
      `<div class="nm">${f.name}</div>` +
      `<div class="ds">${f.desc}</div>`;
    c.addEventListener('click', () => handlers.onStart(id));
    el.chars.appendChild(c);
  }

  $('againbtn').addEventListener('click', handlers.onRestart);

  // Destructive and unrecoverable, so it asks. The button is deliberately the
  // quietest thing on the panel -- it exists for the person handing the laptop
  // to someone else, not for the person who just finished a run.
  el.clearscores.addEventListener('click', () => {
    if (!confirm('Delete all high scores on this browser?')) return;
    clearScores();
    renderScores([], 0);
    refreshBest();
  });

  // Volume persists across runs (audio.js writes it to localStorage), so the
  // slider is seeded from the stored value rather than the markup default.
  el.vol.value = String(Math.round(getVolume() * 100));
  el.vol.addEventListener('input', () => setVolume(el.vol.value / 100));
  el.mutebtn.addEventListener('click', toggleMusic);

  onPress((code) => {
    if (!pendingChoices) return;
    const m = /^Digit([1-9])$/.exec(code);
    if (!m) return;
    const i = parseInt(m[1], 10) - 1;
    if (i < pendingChoices.length) choose(pendingChoices[i]);
  });
}

const show = (panel, on) => panel.classList.toggle('show', on);

export function toggleMusic() {
  const on = !isMusicEnabled();
  setMusicEnabled(on);
  el.mutebtn.classList.toggle('off', !on);
}

export function showStart(on) {
  if (on) refreshBest();
  show(el.start, on);
}

/** The one line of history the player sees before choosing a spell. */
function refreshBest() {
  const best = loadScores()[0];
  el.beststrip.innerHTML = best
    ? `BEST <b>${formatTime(best.seconds)}</b>` +
      `${best.focus ? ` as <b>${esc(best.focus.toUpperCase())}</b>` : ''}` +
      ` &nbsp;&bull;&nbsp; <b>${best.kills.toLocaleString()}</b> KILLS`
    : '';
}

// Scores come back from localStorage, which anyone can edit by hand, so every
// stored string is escaped before it reaches innerHTML. `focus` is the only one
// that is not a number, and it is the only one that could carry markup.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * Draws the table, highlighting the run just played.
 *
 * `mine` is a 1-based rank, or 0 when the run did not place -- which is why the
 * row is found by rank rather than by matching values: two runs can tie on
 * every number shown, and only one of them is the one that just happened.
 */
function renderScores(scores, mine) {
  if (!scores.length) {
    el.scores.innerHTML = `<div class="row"><div></div><div>no runs recorded yet</div></div>`;
    return;
  }
  const head = `<div class="row head"><div></div><div>TIME</div><div>KILLS</div><div>LV</div></div>`;
  el.scores.innerHTML = head + scores.map((s, i) => {
    const cls = `row${i + 1 === mine ? ' me' : ''}`;
    return `<div class="${cls}">` +
      `<div class="n">${i + 1}</div>` +
      `<div class="t">${formatTime(s.seconds)}` +
        `${s.focus ? ` <span class="f">${esc(s.focus)}</span>` : ''}</div>` +
      `<div class="k">${s.kills.toLocaleString()}</div>` +
      `<div class="k">${s.level}</div>` +
    `</div>`;
  }).join('');
}
export function showPaused(on) { show(el.paused, on); }

export function updateHud() {
  const p = G.player;
  const st = p.stats;

  el.timer.textContent = formatTime(G.t);
  el.level.textContent = p.level;
  el.kills.textContent = G.kills;
  el.xpfill.style.width = `${Math.min(100, (p.xp / p.xpNeed) * 100)}%`;

  el.hpfill.style.width = `${Math.max(0, (p.hp / st.maxHp) * 100)}%`;
  el.hptext.textContent = `${Math.ceil(Math.max(0, p.hp))} / ${Math.round(st.maxHp)}`;

  updateBossHud();
}

let shownBoss = null;
let shownWarn = null;

/**
 * The boss bar and the arrival banner. Text and colour are only written when
 * the boss actually changes -- the fill width is the one thing that moves per
 * frame, and reassigning identical strings forces needless style recalcs.
 */
function updateBossHud() {
  const b = G.boss;
  // The Ruin gets no health bar. An invulnerable boss with a full bar reads as
  // a boss you are failing to damage, which is a worse lie than no bar at all.
  const live = !!(b && b.alive && !(b.bossDef && b.bossDef.final));
  el.bosswrap.classList.toggle('show', live);
  if (live) {
    if (shownBoss !== b) {
      shownBoss = b;
      el.bossname.textContent = b.bossDef.name.toUpperCase();
      el.bossfill.style.background =
        `linear-gradient(180deg, ${hex(b.bossDef.tint)}, rgba(0,0,0,0.45))`;
    }
    el.bossfill.style.width = `${Math.max(0, (b.hp / b.maxHp) * 100)}%`;
  } else if (shownBoss) {
    shownBoss = null;
  }

  const w = G.bossWarnDef;
  el.bosswarn.classList.toggle('show', !!w && G.bossWarn > 0);
  if (w && w !== shownWarn) {
    shownWarn = w;
    el.bosswarnname.textContent = w.name.toUpperCase();
    el.bosswarntitle.textContent = w.title.toUpperCase();
  } else if (!w) {
    shownWarn = null;
  }
}

/** Rebuilt on change, not per frame: the loadout only moves on pick or edit. */
export function refreshSlots() {
  const p = G.player;
  if (!p || !p.book) return;

  el.wslots.innerHTML = '';
  for (const entry of p.book.spells) {
    const f = FOCUSES[entry.spell.focus];
    el.wslots.appendChild(
      slotEl(f.icon, f.color, '', `${countNodes(entry.spell)}/${p.book.caps.nodes}`)
    );
  }
  for (let i = p.book.spells.length; i < CFG.spell.maxSpells; i++) {
    el.wslots.appendChild(slotEl('', 0x223049, '', ''));
  }

  // passive slots are gone: the whole loadout is spells now
  el.pslots.innerHTML = '';
}

function slotEl(icon, color, level, nodes) {
  const d = document.createElement('div');
  d.className = 'slot';
  if (icon) {
    d.textContent = icon;
    d.style.color = hex(color);
    d.style.borderColor = hex(color) + '66';
    if (level !== '') {
      const lv = document.createElement('span');
      lv.className = 'lv';
      lv.textContent = level;
      d.appendChild(lv);
    }
    if (nodes) {
      const n = document.createElement('span');
      n.className = 'nodes';
      n.textContent = nodes;
      d.appendChild(n);
    }
  }
  return d;
}

export function showLevelUp(done) {
  pendingChoices = rollChoices(4);
  onChoiceMade = done;

  el.lvtitle.textContent = G.pendingLevels > 1
    ? `LEVEL UP  (${G.pendingLevels} pending)`
    : 'LEVEL UP';

  el.cards.innerHTML = '';
  pendingChoices.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.borderColor = hex(c.color) + '55';
    if (c.tier) card.classList.add(`tier-${c.tier}`);
    card.innerHTML =
      `<div class="ico" style="color:${hex(c.color)}">${c.icon}</div>` +
      `<div class="nm">${c.name}</div>` +
      `<div class="pill ${c.isNew ? 'new' : ''}">${c.tag || '&nbsp;'}</div>` +
      `<div class="ds">${c.desc}</div>` +
      (c.sub ? `<div class="csub">${c.sub}</div>` : '') +
      `<kbd>${i + 1}</kbd>`;
    card.addEventListener('click', () => choose(c));
    el.cards.appendChild(card);
  });

  show(el.levelup, true);
}

function choose(c) {
  if (!pendingChoices) return;
  const cb = onChoiceMade;
  pendingChoices = null;
  onChoiceMade = null;
  show(el.levelup, false);
  applyChoice(c);
  refreshSlots();
  if (cb) cb();
}

/**
 * `result` is what `recordRun` returned for this run, or null when the run was
 * not filed. The panel is drawn from it rather than from storage, so the table
 * is still correct when saving failed -- a full quota or a private window
 * should not make the screen lie about the run that just finished.
 *
 * There is no won state. Every run ends in death, because THE RUIN cannot be
 * killed and cannot be outlasted -- the only question a run answers is how
 * long, which is what the score table ranks.
 */
export function showGameOver(result) {
  // Two deaths, not two outcomes: reaching the ending and being taken by it is
  // worth naming differently from dying to the crowd on the way there.
  el.gotitle.textContent = G.finalBoss ? 'THE RUIN TAKES YOU' : 'YOU DIED';
  el.results.innerHTML =
    `<div class="k">SURVIVED</div><div class="v">${formatTime(G.t)}</div>` +
    `<div class="k">LEVEL</div><div class="v">${G.player.level}</div>` +
    `<div class="k">KILLS</div><div class="v">${G.kills}</div>` +
    `<div class="k">GOLD</div><div class="v">${G.gold}</div>`;

  const r = result || { rank: 0, isBest: false, scores: loadScores(), saved: true };
  el.scorebanner.className = r.isBest ? 'best' : '';
  el.scorebanner.textContent =
    !r.saved ? 'HIGH SCORES UNAVAILABLE IN THIS BROWSER'
    : r.isBest ? 'NEW PERSONAL BEST'
    : r.rank ? `#${r.rank} OF YOUR BEST ${MAX_SCORES}`
    : '';
  renderScores(r.scores, r.rank);

  show(el.gameover, true);
}

export function hideGameOver() { show(el.gameover, false); }
export function isChoosing() { return pendingChoices !== null; }
