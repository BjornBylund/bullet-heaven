import { G } from './state.js';
import { CFG } from './config.js';
import { formatTime } from './util.js';
import { FOCUSES, FOCUS_IDS } from './focuses.js';
import { countNodes } from './spell.js';
import { rollChoices, applyChoice } from './upgrades.js';
import { onPress } from './input.js';
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

export function showStart(on) { show(el.start, on); }
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
  const live = !!(b && b.alive);
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

export function showGameOver(won) {
  el.gotitle.textContent = won ? 'YOU SURVIVED' : 'YOU DIED';
  el.gotitle.style.color = won ? '#6ee7a0' : '#ff7a6b';
  el.results.innerHTML =
    `<div class="k">SURVIVED</div><div class="v">${formatTime(G.t)}</div>` +
    `<div class="k">LEVEL</div><div class="v">${G.player.level}</div>` +
    `<div class="k">KILLS</div><div class="v">${G.kills}</div>` +
    `<div class="k">GOLD</div><div class="v">${G.gold}</div>`;
  show(el.gameover, true);
}

export function hideGameOver() { show(el.gameover, false); }
export function isChoosing() { return pendingChoices !== null; }
