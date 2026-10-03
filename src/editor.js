import { G } from './state.js';
import { CFG } from './config.js';
import { FOCUSES } from './focuses.js';
import { RUNES, TIERS, runeCost, MAX_RUNE_LEVEL, runePenaltyPct } from './runes.js';
import {
  countNodes, countAttunement, freeSlots, slotsOf,
  canPlace, canMove, ownedTriggerEntries,
} from './spell.js';
import {
  book, tryPlace, tryLevel, tryRemove, tryMove, unplacedCount,
} from './spellbook.js';
import { refreshSlots } from './ui.js';

/**
 * The spell editor, drawn as a node graph with drag-and-drop.
 *
 * Structure is link slots: a Focus takes three children, every rune takes two.
 * Ownership is separate -- a modifier tunes the nearest Focus or Trigger above
 * it -- so where you hang something genuinely matters, and the positional runes
 * read the shape directly.
 *
 * Dragging is the primary interaction, built on pointer events rather than
 * HTML5 drag-and-drop. Native DnD gives you an OS drag image, inconsistent
 * cursors, and a drop pipeline that is awkward to drive or test; pointer events
 * give a ghost we control and behave the same everywhere, touch included.
 *
 * Valid targets light up the moment a drag begins, so the affordance is visible
 * rather than discovered by trial. Click-to-select still works as a fallback.
 */

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

const COL_W = 96;
const ROW_H = 86;
const NODE_W = 52;
const NODE_H = 58;
const PAD = 46;

const WHEN_LABEL = {
  spawn: 'Triggered on spawn',
  hit: 'Triggered on hit',
  kill: 'Triggered on kill',
  distance: 'Triggered partway through',
};

let el = {};
let open = false;
let sel = 0;
let pick = null;        // inventory rune selected by clicking
let focused = null;     // inspected graph node key
let drag = null;        // { kind:'inv', id } | { kind:'node', path }
let msg = '';
let msgErr = false;
let graph = null;

export function initEditor() {
  el = {
    panel: $('editor'), tabs: $('edtabs'), stats: $('edstats'),
    left: $('edleft'), right: $('edright'), inv: $('edinv'),
    canvas: $('edcanvas'), links: $('edlinks'), nodes: $('ednodes'),
    msg: $('edmsg'), close: $('edclose'), nag: $('nag'),
  };
  el.close.addEventListener('click', closeEditor);
  el.nag.addEventListener('click', openEditor);

  // Pointer listeners live on window so a re-render mid-drag cannot orphan them.
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', cancelDrag);
}

// ---------------------------------------------------------------------------
// dragging
// ---------------------------------------------------------------------------

let press = null;       // pending or active gesture
let ghost = null;       // floating element under the cursor
let hovered = null;     // element currently highlighted as a drop target
let justDragged = false;
const DRAG_SLOP = 5;    // px before a press becomes a drag rather than a click

function beginPress(e, payload) {
  if (e.button !== undefined && e.button !== 0) return;
  press = { payload, x: e.clientX, y: e.clientY, moved: false };
}

function onPointerMove(e) {
  if (!press) return;
  if (!press.moved) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_SLOP) return;
    press.moved = true;
    drag = press.payload;
    pick = null;
    makeGhost();
    render();                       // marks every valid target at once
  }
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
  setHover(dropTargetAt(e.clientX, e.clientY));
}

function onPointerUp(e) {
  if (!press) return;
  const gesture = press;
  press = null;
  if (!gesture.moved) return;       // a plain click; the click handler deals with it

  justDragged = true;
  const target = dropTargetAt(e.clientX, e.clientY);
  const payload = drag;
  cancelDrag();

  if (!target || !payload) { render(); return; }

  if (target.kind === 'inventory') {
    if (payload.kind === 'node') { focused = 'focus'; act(tryRemove(sel, payload.path)); }
    else render();
    return;
  }

  const check = dropCheck(target.path, payload);
  if (!check.ok) { say(check.reason, !!check.reason); render(); return; }
  act(payload.kind === 'inv'
    ? tryPlace(sel, target.path, payload.id)
    : tryMove(sel, payload.path, target.path));
}

function cancelDrag() {
  press = null;
  drag = null;
  setHover(null);
  if (ghost) { ghost.remove(); ghost = null; }
}

function makeGhost() {
  const p = drag;
  const rd = p.kind === 'inv'
    ? RUNES[p.id]
    : RUNES[resolvePath(p.path).id];
  ghost = document.createElement('div');
  ghost.id = 'edghost';
  ghost.innerHTML = `<span style="color:${hex(rd.color)}">${rd.icon}</span>`;
  document.body.appendChild(ghost);
}

function resolvePath(path) {
  let n = book().spells[sel].spell;
  for (const i of path) n = n.children[i];
  return n;
}

/** What sits under the cursor: a graph node, the inventory panel, or nothing. */
function dropTargetAt(x, y) {
  const under = document.elementFromPoint(x, y);
  if (!under) return null;
  const node = under.closest('.gnode');
  if (node && node.dataset.path !== undefined) {
    return {
      kind: 'node',
      el: node,
      path: node.dataset.path === '' ? [] : node.dataset.path.split(',').map(Number),
    };
  }
  if (under.closest('#edright')) return { kind: 'inventory', el: el.right };
  return null;
}

function setHover(target) {
  const next = target ? target.el : null;
  if (hovered === next) return;
  if (hovered) hovered.classList.remove('drop-hot');
  hovered = next;
  if (!hovered) return;
  // only light it up if the drop would actually be accepted
  const ok = target.kind === 'inventory'
    ? drag && drag.kind === 'node'
    : dropCheck(target.path, drag).ok;
  if (ok) hovered.classList.add('drop-hot');
}

export const isEditorOpen = () => open;

export function openEditor() {
  if (!G.player || !G.player.book || G.player.book.spells.length === 0) return;
  open = true;
  sel = Math.min(sel, G.player.book.spells.length - 1);
  focused = 'focus';
  el.panel.classList.add('show');
  render();
}

export function closeEditor() {
  open = false;
  pick = null;
  cancelDrag();
  msg = '';
  el.panel.classList.remove('show');
  refreshSlots();
  refreshNag();
}

function say(text, isErr) { msg = text; msgErr = !!isErr; }

function act(result) {
  if (!result) return;
  say(result.ok ? '' : result.reason, !result.ok);
  render();
  refreshSlots();
}

export function refreshNag() {
  if (!el.nag) return;
  const n = G.running && !G.over ? unplacedCount() : 0;
  el.nag.classList.toggle('on', n > 0 && !open);
  if (n > 0) el.nag.innerHTML = `${n} RUNE${n === 1 ? '' : 'S'} UNPLACED &mdash; PRESS E`;
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/**
 * Tidy tree layout: children are laid out left to right, and a parent centres
 * itself over the span of its children. Empty link slots are laid out as
 * children too, so free capacity is visible in the shape of the graph.
 */
function buildGraph(spell) {
  const nodes = [];
  const links = [];
  let cursor = 0;

  function place(node, path, depth, parentKey) {
    const key = path.length ? 'n' + path.join('_') : 'focus';
    const spans = [];

    node.children.forEach((c, i) => {
      spans.push(place(c, path.concat(i), depth + 1, key));
    });

    for (let i = 0; i < freeSlots(node); i++) {
      const ek = `e${path.join('_')}_${i}`;
      const ex = cursor++;
      nodes.push({ key: ek, type: 'empty', path, col: ex, row: depth + 1 });
      links.push([key, ek]);
      spans.push(ex);
    }

    const col = spans.length ? (spans[0] + spans[spans.length - 1]) / 2 : cursor++;
    nodes.push({
      key,
      type: path.length ? 'rune' : 'focus',
      node, path, col, row: depth,
    });
    if (parentKey) links.push([parentKey, key]);
    return col;
  }

  place(spell, [], 0, null);

  let maxCol = 0, maxRow = 0;
  for (const n of nodes) { maxCol = Math.max(maxCol, n.col); maxRow = Math.max(maxRow, n.row); }
  return {
    nodes, links,
    w: (maxCol + 1) * COL_W + PAD * 2,
    h: (maxRow + 1) * ROW_H + PAD,
  };
}

const nodeX = (n) => PAD + n.col * COL_W;
const nodeY = (n) => n.row * ROW_H;

/**
 * Where a drop on this node attaches. An empty socket carries its parent's
 * path, and dropping onto a real node links underneath it -- so both cases are
 * simply the stored path, and a big node is an easier target than a small socket.
 */
const targetPathOf = (n) => n.path;

function dropCheck(targetPath, payload) {
  const p = payload || drag;
  if (!p) return { ok: false, reason: '' };
  const spell = book().spells[sel].spell;
  if (p.kind === 'inv') return canPlace(spell, targetPath, p.id, book().caps);
  return canMove(spell, p.path, targetPath);
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

function render() {
  if (!open) return;
  const b = book();
  renderTabs(b);
  renderStats(b);
  renderGraph(b);
  renderDetail(b);
  renderInventory(b);
  el.msg.textContent = msg || (
    drag ? 'Drop on a node to link it there, or on the inventory to take it off.'
      : pick ? 'Click a node or an empty link to place it.'
        : 'Drag a rune onto the graph. A Focus takes 3 links, a rune takes 2.');
  el.msg.classList.toggle('err', msgErr);
}

function renderTabs(b) {
  el.tabs.innerHTML = '';
  b.spells.forEach((entry, i) => {
    const f = FOCUSES[entry.spell.focus];
    const t = document.createElement('div');
    t.className = 'edtab' + (i === sel ? ' sel' : '');
    t.innerHTML =
      `<span style="color:${hex(f.color)}">${f.icon}</span><span>${f.name}</span>` +
      `<span class="tn">${countNodes(entry.spell)}/${b.caps.nodes}</span>`;
    t.addEventListener('click', () => { sel = i; focused = 'focus'; msg = ''; render(); });
    el.tabs.appendChild(t);
  });
}

function renderStats(b) {
  const entry = b.spells[sel];
  if (!entry) return;
  const n = countNodes(entry.spell);
  const a = countAttunement(entry.spell);
  const c = entry.compiled;
  el.stats.innerHTML =
    `<span${n >= b.caps.nodes ? ' class="over"' : ''}>SOCKETS <b>${n}/${b.caps.nodes}</b></span>` +
    `<span${a >= b.caps.attunement ? ' class="over"' : ''}>FOCUS <b>${a}/${b.caps.attunement}</b></span>` +
    `<span>DAMAGE <b>${c ? Math.round(c.stats.dmg) : 0}</b></span>` +
    `<span>COOLDOWN <b>${c ? c.stats.cooldown.toFixed(2) : 0}s</b></span>`;
}

function renderGraph(b) {
  const entry = b.spells[sel];
  if (!entry) return;
  graph = buildGraph(entry.spell);

  el.canvas.style.width = `${graph.w}px`;
  el.canvas.style.height = `${graph.h}px`;
  el.links.setAttribute('width', graph.w);
  el.links.setAttribute('height', graph.h);

  const byKey = Object.create(null);
  for (const n of graph.nodes) byKey[n.key] = n;

  let svg = '';
  for (const [a, z] of graph.links) {
    const na = byKey[a], nz = byKey[z];
    if (!na || !nz) continue;
    const x1 = nodeX(na) + NODE_W / 2, y1 = nodeY(na) + NODE_H;
    const x2 = nodeX(nz) + NODE_W / 2, y2 = nodeY(nz);
    const mid = (y1 + y2) / 2;
    const dim = nz.type === 'empty' ? ' stroke-dasharray="4 5" opacity="0.55"' : '';
    svg += `<path d="M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}" ` +
           `fill="none" stroke="#2b4a70" stroke-width="2.5"${dim} />`;
  }
  el.links.innerHTML = svg;

  el.nodes.innerHTML = '';
  for (const n of graph.nodes) {
    el.nodes.appendChild(nodeEl(entry, n));
  }
}

function nodeEl(entry, n) {
  const d = document.createElement('div');
  d.style.left = `${nodeX(n)}px`;
  d.style.top = `${nodeY(n)}px`;

  const targetPath = targetPathOf(n);
  const valid = drag ? dropCheck(targetPath).ok : false;

  if (n.type === 'focus') {
    const f = FOCUSES[entry.spell.focus];
    d.className = 'gnode root';
    d.innerHTML =
      `<div class="hexo" style="background:${hex(f.color)}"></div><div class="inner"></div>` +
      `<span class="glyph" style="color:${hex(f.color)}">${f.icon}</span>` +
      `<span class="links">${entry.spell.children.length}/${slotsOf(entry.spell)}</span>`;
  } else if (n.type === 'rune') {
    const rd = RUNES[n.node.id];
    d.className = 'gnode' + (rd.kind === 'trigger' ? ' trig' : '');
    d.innerHTML =
      `<div class="hexo" style="background:${hex(rd.color)}"></div><div class="inner"></div>` +
      `<span class="glyph" style="color:${hex(rd.color)}">${rd.icon}</span>` +
      (n.node.level > 1 ? `<span class="lvl">${n.node.level}</span>` : '') +
      `<span class="links">${n.node.children.length}/${slotsOf(n.node)}</span>`;
    d.addEventListener('pointerdown', (e) => beginPress(e, { kind: 'node', path: n.path }));
  } else {
    const full = countNodes(entry.spell) >= book().caps.nodes;
    d.className = 'gnode empty' + (full && !drag ? ' full' : '');
    d.innerHTML = `<div class="hexo"></div><div class="inner"></div><span class="glyph">+</span>`;
  }

  if (focused === n.key) d.classList.add('sel');
  if (drag && drag.kind === 'node' && drag.path.join(',') === n.path.join(',') && n.type === 'rune') {
    d.classList.add('dragging');
  }
  if (drag && valid) d.classList.add('drop-ok');

  d.dataset.path = targetPath.join(',');
  d.addEventListener('click', () => {
    if (justDragged) { justDragged = false; return; }
    onNodeClick(n, targetPath);
  });
  return d;
}

function onNodeClick(n, targetPath) {
  if (pick) {
    const check = canPlace(book().spells[sel].spell, targetPath, pick, book().caps);
    if (check.ok) {
      const id = pick;
      act(tryPlace(sel, targetPath, id));
      if ((book().inventory[id] || 0) === 0) pick = null;
      render();
      return;
    }
    say(check.reason, true);
  }
  if (n.type !== 'empty') focused = n.key;
  render();
}

// ---------------------------------------------------------------------------
// detail panel
// ---------------------------------------------------------------------------

function renderDetail(b) {
  const entry = b.spells[sel];
  el.left.innerHTML = '<h3>SELECTED</h3>';
  if (!entry || !graph) return;

  const n = graph.nodes.find((x) => x.key === focused);
  if (!n) return;

  if (n.type === 'focus') {
    const f = FOCUSES[entry.spell.focus];
    const c = entry.compiled;
    el.left.appendChild(card({
      tier: 'common', kindLabel: 'Spell', name: f.name, color: f.color,
      desc: f.desc,
      stats: c ? [
        ['Damage', Math.round(c.stats.dmg)],
        ['Cooldown', `${c.stats.cooldown.toFixed(2)}s`],
        ['Range', Math.round(c.stats.range)],
        ['Pierce', c.flags.pierce],
        ['Casts', c.flags.split],
        ['Links', `${entry.spell.children.length} / ${CFG.spell.focusSlots}`],
      ] : [],
    }));
    return;
  }

  if (n.type === 'empty') return;

  const rd = RUNES[n.node.id];
  const lvl = n.node.level;
  const c = compiledFor(entry, n.path);
  const stats = [];
  if (rd.kind === 'trigger' && c) {
    stats.push(['Damage', Math.round(c.stats.dmg)]);
    stats.push(['Casts', c.flags.split]);
    if (c.stats.life) stats.push(['Duration', `${c.stats.life.toFixed(1)}s`]);
  }
  stats.push(['Focus cost', runeCost(n.node.id, lvl)]);
  stats.push(['Level', `${lvl} / ${MAX_RUNE_LEVEL}`]);
  stats.push(['Links', `${n.node.children.length} / ${CFG.spell.runeSlots}`]);

  const owner = ownerLabel(entry, n.path);
  const box = card({
    tier: rd.tier,
    kindLabel: `${TIERS[rd.tier].name} ${rd.kind === 'trigger' ? 'Trigger' : 'Modifier'}`,
    name: rd.name, color: rd.color,
    when: rd.kind === 'trigger' ? WHEN_LABEL[rd.when] : null,
    desc: rd.desc(lvl) +
      (runePenaltyPct(n.node.id)
        ? ` <b class="pen">Its own damage is reduced ` +
          `${runePenaltyPct(n.node.id)}%, and everything under it.</b>`
        : ''),
    stats,
    foot: rd.kind === 'modifier' ? `Applies to: ${owner}` : `Scales off: ${owner}`,
  });

  const acts = document.createElement('div');
  acts.className = 'edacts';
  const held = book().inventory[n.node.id] || 0;
  const up = document.createElement('button');
  up.className = 'nbtn';
  up.textContent = lvl >= MAX_RUNE_LEVEL ? 'MAX' : `LEVEL UP (${held})`;
  up.disabled = lvl >= MAX_RUNE_LEVEL || held <= 0;
  up.addEventListener('click', () => act(tryLevel(sel, n.path)));
  const rm = document.createElement('button');
  rm.className = 'nbtn';
  rm.textContent = 'REMOVE';
  rm.addEventListener('click', () => { focused = 'focus'; act(tryRemove(sel, n.path)); });
  acts.appendChild(up);
  acts.appendChild(rm);
  box.appendChild(acts);
  el.left.appendChild(box);
}

/** Names the nearest Focus or Trigger above a node -- the thing it acts on. */
function ownerLabel(entry, path) {
  let node = entry.spell;
  let label = FOCUSES[entry.spell.focus].name;
  for (let k = 0; k < path.length - 1; k++) {
    node = node.children[path[k]];
    if (!node) break;
    const rd = RUNES[node.id];
    if (rd && rd.kind === 'trigger') label = rd.name;
  }
  return label;
}

/**
 * Walks the authoring path and the compiled tree together to find a trigger's
 * compiled descriptor. Triggers are emitted in `ownedTriggerEntries` order, so
 * the index is recoverable rather than guessed.
 */
function compiledFor(entry, path) {
  let compiled = entry.compiled;
  let owner = entry.spell;
  let node = entry.spell;
  if (!compiled) return null;

  for (const idx of path) {
    node = node.children[idx];
    if (!node) return null;
    const rd = RUNES[node.id];
    if (!rd || rd.kind !== 'trigger') continue;

    const list = ownedTriggerEntries(owner);
    const at = list.indexOf(node);
    if (at < 0 || !compiled.triggers[at]) return null;
    compiled = compiled.triggers[at].spell;
    owner = node;
  }
  const last = RUNES[node.id];
  return last && last.kind === 'trigger' ? compiled : null;
}

function card({ tier, kindLabel, name, color, when, desc, stats, foot }) {
  const d = document.createElement('div');
  d.className = `edcard tier-${tier}`;
  d.innerHTML =
    `<div class="ct" style="color:${hex(color)}">${kindLabel}</div>` +
    `<div class="cn">${name}</div>` +
    (when ? `<div class="when">${when}</div>` : '') +
    `<div class="cd">${desc}</div>` +
    (stats && stats.length
      ? `<div class="cs">${stats.map(([k, v]) => `◆ ${k}: <b>${v}</b>`).join('<br>')}</div>`
      : '') +
    (foot ? `<div class="cf">${foot}</div>` : '');
  return d;
}

// ---------------------------------------------------------------------------
// inventory
// ---------------------------------------------------------------------------

function renderInventory(b) {
  el.inv.innerHTML = '';
  const ids = Object.keys(b.inventory).filter((k) => b.inventory[k] > 0);

  if (ids.length === 0) {
    const p = document.createElement('div');
    p.id = 'edempty';
    p.textContent = 'No runes yet. Take a rune card on level-up, then drag it onto the graph.';
    el.inv.appendChild(p);
    return;
  }

  const order = { trigger: 0, modifier: 1 };
  const tierOrder = { epic: 0, rare: 1, common: 2 };
  ids.sort((a, z) =>
    (order[RUNES[a].kind] - order[RUNES[z].kind]) ||
    (tierOrder[RUNES[a].tier] - tierOrder[RUNES[z].tier]) ||
    RUNES[a].name.localeCompare(RUNES[z].name));

  for (const id of ids) {
    const rd = RUNES[id];
    const d = document.createElement('div');
    d.className = `inv tier-${rd.tier}` + (pick === id ? ' sel' : '');
    d.innerHTML =
      `<span class="ii" style="color:${hex(rd.color)}">${rd.icon}</span>` +
      `<span><span class="nn">${rd.name}</span><br>` +
      `<span class="ik">${TIERS[rd.tier].name} · ${rd.kind} · ${rd.cost} focus</span></span>` +
      `<span class="ic">×${b.inventory[id]}</span>`;

    d.addEventListener('pointerdown', (e) => beginPress(e, { kind: 'inv', id }));
    d.addEventListener('click', () => {
      if (justDragged) { justDragged = false; return; }
      pick = pick === id ? null : id;
      say('');
      render();
    });
    el.inv.appendChild(d);
  }
}
