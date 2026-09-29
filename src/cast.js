import * as PIXI from './pixi.js';
import { G, offscreen } from './state.js';
import { CFG } from './config.js';
import { Pool, TAU, rand } from './util.js';
import { damageEnemy } from './enemy.js';
import { applyStatus, damageTakenMul, BURN, CHILL } from './status.js';
import { burst } from './fx.js';

/**
 * Spell runtime.
 *
 * One pool serves every effect, discriminated by `kind`, so a trigger can cast
 * anything without the runtime caring what it is.
 *
 * ON SPAWN is per entity rather than per cast. A spell that throws three bolts
 * fires it three times, each from the bolt that caused it, so the condition
 * scales with Split the way the other conditions already do.
 *
 * HIT DEDUP lives on the entity: each projectile keeps the ids of the bodies it
 * has already passed through, and checks that list before landing a hit.
 *
 * It used to live on the enemy, as `hitBy[gate] = eid` -- one slot per compiled
 * node, holding the last entity from that node to touch it. That is O(1) and
 * allocation-free, but it only remembers ONE entity per node, so two projectiles
 * from the same spell overlapping the same body overwrote each other's slot and
 * re-armed each other. Measured: one cast landed 1 hit on a single target
 * correctly, two overlapping casts landed 5, and four landed 12. Return made it
 * severe by doubling projectile lifetime, which guarantees overlap -- 920 damage
 * against 260 for the bare spell on a close target.
 *
 * The list is a fixed Int32Array, so this is still allocation-free; the scan is
 * bounded by how many bodies a projectile may pierce, and only runs on an actual
 * overlap rather than on every candidate the grid returns.
 */


/**
 * How each named look is drawn.
 *
 * `aspect > 1` means the sprite is elongated and points along its heading (a
 * bolt, a flame, a lightning arc). `aspect === 1` means it is round-ish and
 * TUMBLES instead -- a boulder or ice shard that stayed axis-aligned would read
 * as a sprite rather than a thing moving through the world.
 *
 * `from: 'tex'` pulls the shared shapes (ring, arc, glow) rather than the
 * dedicated spell art.
 */
const LOOKS = {
  bolt:      { tex: 'bolt',      aspect: 3.2, spin: 0,   blend: 'add',    alpha: 1 },
  flame:     { tex: 'flame',     aspect: 1.5, spin: 0,   blend: 'add',    alpha: 1 },
  lightning: { tex: 'lightning', aspect: 2.1, spin: 0,   blend: 'add',    alpha: 1 },
  ice:       { tex: 'ice',       aspect: 1,   spin: 7.0, blend: 'normal', alpha: 1 },
  stone:     { tex: 'stone',     aspect: 1,   spin: 1.8, blend: 'normal', alpha: 1 },
  blade:     { tex: 'blade',     aspect: 1,   spin: 5.0, blend: 'normal', alpha: 1 },
  wind:      { tex: 'wind',      aspect: 1,   spin: 6.0, blend: 'add',    alpha: 0.85 },
  // a persistent, screen-filling field: dim, or overlapping ones white out
  vortex:    { tex: 'vortex',    aspect: 1,   spin: 4.5, blend: 'add',    alpha: 0.42 },
  shatter:   { tex: 'shatter',   aspect: 1,   spin: 2.5, blend: 'add',    alpha: 1 },
  shock:     { tex: 'ring', from: 'tex', aspect: 1, spin: 0,   blend: 'add', alpha: 1 },
  cone:      { tex: 'arc',  from: 'tex', aspect: 1, spin: 0,   blend: 'add', alpha: 1 },
  aura:      { tex: 'glow', from: 'tex', aspect: 1, spin: 0.6, blend: 'add', alpha: 0.24 },
};

const lookTexture = (lk) => (lk.from === 'tex' ? G.tex[lk.tex] : G.tex.spell[lk.tex]);

let nextEid = 1;

export function initCasting() {
  G.spellEntities = new Pool(() => {
    const s = new PIXI.Sprite(G.tex.capsule);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.visible = false;
    G.layers.proj.addChild(s);
    return {
      alive: false, s,
      kind: 'projectile', c: null, eid: 0,
      x: 0, y: 0, vx: 0, vy: 0, angle: 0,
      dmg: 0, radius: 0, baseRadius: 0, prevRadius: 0,
      range: 0, travelled: 0, age: 0, life: 0,
      hits: 0, distFired: false, returning: false, trailAcc: 0, look: null,
      // Bodies already hit. Grows on demand (see claim) because a Burst has no
      // pierce limit -- it touches everything inside its radius, which in a
      // late-run crowd is several hundred. The array lives on the pooled entity
      // and is reused, so growth happens a handful of times and then never
      // again; resetting is just hitCount = 0.
      hitIds: new Int32Array(32), hitCount: 0,
      tickT: 0, trigFired: 0,
      orbitIndex: 0, orbitCount: 1, spin: 0,
    };
  }, 420);
}

export function clearCasting() {
  G.spellEntities.clear((e) => { e.s.visible = false; });
}

// ---------------------------------------------------------------------------
// casting
// ---------------------------------------------------------------------------

export function castSpell(c, x, y, inAngle) {
  const f = c.flags;
  const copies = Math.max(1, f.split);

  // Directional effects acquire a target on cast, falling back to the inherited
  // angle. Without this a stationary player fires at whatever they last walked
  // toward and hits nothing.
  let angle = inAngle;
  if (c.focusId === 'projectile' || (c.focusId === 'burst' && f.cone)) {
    const t = nearestTo(x, y, 700, null);
    if (t) angle = Math.atan2(t.y - y, t.x - x);
  }

  if (c.focusId === 'field') {
    emitField(c, x, y, angle, copies);
  } else {
    for (let i = 0; i < copies; i++) {
      let a = angle, ox = 0, oy = 0;
      if (f.scatter) {
        a = rand(0, TAU);                                   // random directions
      } else if (f.ring) {
        a = angle + (i / copies) * TAU;                     // evenly around
      } else if (f.line) {
        const off = (i - (copies - 1) / 2) * 26;            // abreast, same heading
        ox = Math.cos(angle + Math.PI / 2) * off;
        oy = Math.sin(angle + Math.PI / 2) * off;
      } else if (copies > 1) {
        const spread = f.cone || 0.44;
        a = angle + (i - (copies - 1) / 2) * (spread * 2 / copies);
      }
      spawn(c, x + ox, y + oy, a, 0, 1);
    }
  }

}

/** Live entities belonging to one compiled node. */
function liveOf(c) {
  let n = 0;
  for (const e of G.spellEntities.active) if (e.c === c) n++;
  return n;
}

/**
 * Persistent fields must not pile up.
 *
 * A field lives for a fixed time, but the spell that spawns it fires on its own
 * cooldown, and nothing tied the two together. A Projectile casting every 0.42s
 * with a trigger whose blades live 3.2s accumulated EIGHT overlapping sets --
 * measured at 33 concurrent blades for Flash of Swords and 43 stones for Solid
 * Defense, against 1 entity for the bare spell. Both runes came out roughly
 * fifty times stronger than anything else in the table, and the effect scaled
 * with fire rate, so speeding a Focus up silently buffed them again.
 *
 * Two shapes, two rules:
 *
 *   ORBIT   refreshes. "Four blades circle you" is the intended fantasy, not
 *           "blades accumulate". Recasting renews their life and tops up to the
 *           current count, so more Split still means more blades.
 *
 *   PLACED  capped. These are dropped at a position and cannot be refreshed in
 *           place, so they get a hard ceiling instead.
 */
function emitField(c, x, y, angle, copies) {
  const want = Math.max(1, copies);

  if (c.flags.orbit) {
    let found = 0;
    for (const e of G.spellEntities.active) {
      if (e.c !== c) continue;
      e.life = c.stats.life;          // renew, but keep age so it does not jump
      e.orbitIndex = found++;
      e.orbitCount = want;
    }
    // top up only; the loop above cannot see entities spawned below it
    for (let i = found; i < want; i++) spawn(c, x, y, angle, i, want);
    return;
  }

  // A descriptor may raise its own ceiling; the trail is the one that does.
  const cap = c.cap || CFG.spell.fieldCap;
  let live = liveOf(c);

  // At the ceiling, a TRAIL evicts its oldest patch rather than refusing the
  // new one. Refusing drops the patch nearest the projectile, so the trail
  // visibly stops right where the player is looking while a stale tail lingers
  // behind them -- exactly backwards. Dropped fields keep refusing: one vortex
  // should not delete another.
  if (c.evictOldest) {
    while (live >= cap) {
      let oldest = null;
      for (const e of G.spellEntities.active) {
        if (e.c === c && (oldest === null || e.age > oldest.age)) oldest = e;
      }
      if (oldest === null) break;
      oldest.alive = false;
      live--;
    }
  }

  for (let i = 0; i < want && live < cap; i++, live++) spawn(c, x, y, angle, i, want);
}

// How much of its own radius a Field keeps when it is made to orbit. Several
// smaller patches that sweep the field, rather than one big stationary one.
const ORBIT_FIELD_SCALE = 0.45;

function spawn(c, x, y, angle, orbitIndex, orbitCount) {
  const e = G.spellEntities.spawn();
  const st = c.stats;
  const f = c.flags;
  const range = st.range * G.player.stats.area;

  e.kind = c.focusId;
  e.c = c;
  e.eid = nextEid++;
  e.x = x; e.y = y;
  e.angle = angle;
  e.dmg = st.dmg;
  e.hits = 0;
  e.hitCount = 0;
  e.trigFired = 0;
  e.distFired = false;
  e.returning = false;
  e.trailAcc = 0;
  e.age = 0;
  e.travelled = 0;
  e.orbitIndex = orbitIndex;
  e.orbitCount = orbitCount;

  const s = e.s;
  s.tint = c.def.color;
  s.rotation = angle;
  s.visible = true;

  // a Cone modifier reshapes a Burst, so it overrides the compiled look
  const lk = LOOKS[e.kind === 'burst' && f.cone ? 'cone' : c.look] || LOOKS.bolt;
  e.look = lk;
  s.texture = lookTexture(lk);
  s.blendMode = lk.blend;
  s.alpha = lk.alpha;

  if (e.kind === 'projectile') {
    e.range = range;
    e.baseRadius = (f.baseSize || st.radius) * f.size;
    e.radius = e.baseRadius;
    e.vx = Math.cos(angle) * st.speed;
    e.vy = Math.sin(angle) * st.speed;
  } else if (e.kind === 'burst') {
    e.range = range * f.size;
    e.radius = 0;
    e.prevRadius = 0;
    e.life = st.expand;
  } else {
    // An orbiting field is deliberately smaller than the single stationary one
    // it replaces, but it must still be sized FROM THE SPELL. `baseSize` is only
    // ever set by a trigger effect (Solid Defense's stones, Flash of Swords'
    // blades), so a player's own Field reaching this branch had no baseSize and
    // fell through to a hardcoded 30 -- collapsing a radius-100 field to 30 the
    // moment Self-Centered was socketed, and leaving size runes scaling 30
    // instead of 100. Reported as "size adjustment isn't working".
    e.range = f.orbit ? (f.baseSize || range * ORBIT_FIELD_SCALE) * f.size
                      : range * f.size;
    e.baseRadius = e.range;
    e.radius = e.range;
    e.life = st.life;
    e.tickT = 0;
    e.spin = 2.1;
    s.rotation = 0;
  }

  // ON SPAWN fires here, per ENTITY, not once per cast. A Cone throws three
  // bolts, so it fires three times, each from its own bolt's position and
  // heading -- which is the whole point of the condition. Fired last, once the
  // entity is fully built, because the trigger's own effect may spawn more
  // entities and those must not see a half-initialised parent.
  fireTriggers(e, c, 'spawn', x, y, angle);
  return e;
}

function fireTriggers(source, c, when, x, y, angle) {
  const trig = c.triggers;
  if (trig.length === 0) return;

  const cap = CFG.spell.triggerCap;
  if (cap > 0 && source && source.trigFired >= cap) return;

  for (let i = 0; i < trig.length; i++) {
    const t = trig[i];
    if (t.when !== when || t.spell === null) continue;
    if (source) source.trigFired++;
    castSpell(t.spell, x, y, angle);
  }
}

// ---------------------------------------------------------------------------
// damage
// ---------------------------------------------------------------------------

function dealDamage(ent, target) {
  const c = ent.c;
  const f = c.flags;
  const p = G.player;
  const ps = p.stats;

  let critChance = ps.crit + f.crit;
  if (f.critVsBurn && target.st[BURN] > 0) critChance += f.critVsBurn;

  // Only debuff-keyed conditionals remain, so a damage bonus always traces back
  // to a status the player chose to apply.
  let mul = ps.dmg * damageTakenMul(target);
  if (f.vsFrozen && target.frozen > 0) mul *= 1 + f.vsFrozen;
  if (f.vsChilled && target.st[CHILL] > 0) mul *= 1 + f.vsChilled;

  const crit = Math.random() < critChance;
  const amount = ent.dmg * mul * (crit ? 2 : 1);

  const killed = damageEnemy(target, amount, {
    color: crit ? 0xffe066 : c.def.color,
    big: crit,
    knockback: f.knock,
    fromX: ent.x,
    fromY: ent.y,
  });

  for (let i = 0; i < c.statuses.length; i++) {
    const st = c.statuses[i];
    applyStatus(target, st.idx, st.stacks, st.mag || 0);
  }

  fireTriggers(ent, c, 'hit', target.x, target.y, ent.angle);
  if (killed) fireTriggers(ent, c, 'kill', target.x, target.y, ent.angle);
  return killed;
}

/** Has this entity already passed through this body? */
function hasHit(ent, target) {
  const ids = ent.hitIds;
  const n = ent.hitCount;
  const id = target.eid;
  for (let i = 0; i < n; i++) if (ids[i] === id) return true;
  return false;
}

function claim(ent, target) {
  if (hasHit(ent, target)) return false;
  if (ent.hitCount === ent.hitIds.length) {
    // Grow rather than allow an unrecorded hit. A fixed ceiling sized for the
    // largest pierce was far too small for a Burst: past it, claim() let the
    // hit through without remembering it, so the same body was struck on every
    // frame of the expansion and fired On Hit again each time. Measured at a
    // crowd of 200, a single burst landed 352 hits instead of 200.
    const bigger = new Int32Array(ent.hitIds.length * 2);
    bigger.set(ent.hitIds);
    ent.hitIds = bigger;
  }
  ent.hitIds[ent.hitCount++] = target.eid;
  return true;
}

function nearestTo(x, y, radius, reject) {
  const near = G.scratch2;
  G.grid.query(x, y, radius, near);
  let best = null, bestD = radius * radius;
  for (let i = 0; i < near.length; i++) {
    const e = near[i];
    if (!e.alive || (reject && reject(e))) continue;
    const dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export function updateSpellEntities(dt) {
  const near = G.scratch;
  const p = G.player;

  for (const ent of G.spellEntities.active) {
    if (ent.kind === 'projectile') updateProjectile(ent, dt, near);
    else if (ent.kind === 'burst') updateBurst(ent, dt, near);
    else updateField(ent, dt, near, p);
    if (!ent.alive) continue;

    const vis = !offscreen(ent.x, ent.y, ent.radius + 40);
    ent.s.visible = vis;
    if (vis) { ent.s.x = ent.x; ent.s.y = ent.y; }
  }

  G.spellEntities.sweep((e) => { e.s.visible = false; e.c = null; });
}

function updateProjectile(ent, dt, near) {
  const c = ent.c;
  const f = c.flags;
  const sp = c.stats.speed;

  if (f.spiral) {
    ent.angle += f.spiral * dt;
  } else if (f.homing > 0) {
    // Skip anything this projectile has ALREADY hit. Hit dedup means it can
    // never damage the same enemy twice, so without this filter a homing shot
    // locks onto the body it just passed through and circles a target it
    // cannot hurt -- which is why both homing runes measured at nothing.
    const t = nearestTo(ent.x, ent.y, 420, (e) => hasHit(ent, e));
    if (t) {
      const want = Math.atan2(t.y - ent.y, t.x - ent.x);
      let d = want - ent.angle;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      ent.angle += Math.max(-f.homing * dt, Math.min(f.homing * dt, d));
    }
  }
  if (f.spiral || f.homing > 0) {
    ent.vx = Math.cos(ent.angle) * sp;
    ent.vy = Math.sin(ent.angle) * sp;
  }

  if (ent.returning) {
    const a = Math.atan2(G.player.y - ent.y, G.player.x - ent.x);
    ent.angle = a;
    ent.vx = Math.cos(a) * sp;
    ent.vy = Math.sin(a) * sp;
    const hx = G.player.x - ent.x, hy = G.player.y - ent.y;
    if (hx * hx + hy * hy < 420) { ent.alive = false; return; }
  }

  ent.x += ent.vx * dt;
  ent.y += ent.vy * dt;
  ent.travelled += sp * dt;

  // drip anchored patches behind it at a fixed spacing, so trail density does
  // not depend on projectile speed
  if (c.trail) {
    const gap = c.trail.spacing || 44;
    ent.trailAcc += sp * dt;
    if (ent.trailAcc >= gap) { ent.trailAcc -= gap; castSpell(c.trail, ent.x, ent.y, 0); }
  }

  if (f.grow) {
    const k = Math.min(1, ent.travelled / Math.max(1, ent.range));
    ent.radius = ent.baseRadius * (1 + f.grow * k);
  }

  const s = ent.s;
  const lk = ent.look;
  if (lk.aspect > 1) {
    s.rotation = ent.angle;
    // proportional to radius, so a size-boosted bolt stays bolt-shaped instead
    // of creeping toward square
    s.width = Math.max(24, ent.radius * 2 * lk.aspect);
    s.height = ent.radius * 2;
  } else {
    s.rotation += lk.spin * dt;
    s.width = s.height = ent.radius * 2.5;
  }

  if (!ent.distFired && ent.travelled >= ent.range * 0.6) {
    ent.distFired = true;
    fireTriggers(ent, c, 'distance', ent.x, ent.y, ent.angle);
  }
  if (!ent.returning && ent.travelled >= ent.range) {
    if (f.returns) ent.returning = true;
    else { ent.alive = false; return; }
  }

  G.grid.query(ent.x, ent.y, ent.radius + 40, near);
  for (let i = 0; i < near.length; i++) {
    const t = near[i];
    if (!t.alive) continue;
    const dx = t.x - ent.x, dy = t.y - ent.y;
    const rr = t.r + ent.radius;
    if (dx * dx + dy * dy > rr * rr) continue;
    if (!claim(ent, t)) continue;

    dealDamage(ent, t);
    burst(ent.x, ent.y, c.def.color, 3, 110, 0.35);
    ent.hits++;
    if (ent.hits > f.pierce) { ent.alive = false; return; }
  }
}

function updateBurst(ent, dt, near) {
  const c = ent.c;
  const f = c.flags;

  ent.age += dt;
  ent.prevRadius = ent.radius;
  ent.radius = ent.range * Math.min(1, ent.age / c.stats.expand);

  const s = ent.s;
  s.width = s.height = ent.radius * 2;
  s.alpha = ent.look.alpha * 0.85 * (1 - ent.age / c.stats.expand);
  if (f.cone) s.rotation = ent.angle;
  else s.rotation += ent.look.spin * dt;

  G.grid.query(ent.x, ent.y, ent.radius + 30, near);
  for (let i = 0; i < near.length; i++) {
    const t = near[i];
    if (!t.alive) continue;
    const dx = t.x - ent.x, dy = t.y - ent.y;
    const d = Math.hypot(dx, dy);
    if (d > ent.radius + t.r || d < ent.prevRadius - t.r) continue;
    if (f.cone) {
      let da = Math.atan2(dy, dx) - ent.angle;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > f.cone) continue;
    }
    if (!claim(ent, t)) continue;
    dealDamage(ent, t);
  }

  if (ent.age >= c.stats.expand) ent.alive = false;
}

function updateField(ent, dt, near, p) {
  const c = ent.c;
  const f = c.flags;

  ent.life -= dt;
  if (ent.life <= 0) { ent.alive = false; return; }
  ent.age += dt;

  if (f.orbit) {
    const a = ent.age * ent.spin + (ent.orbitIndex / ent.orbitCount) * TAU;
    const r = c.stats.range * G.player.stats.area;
    ent.x = p.x + Math.cos(a) * r;
    ent.y = p.y + Math.sin(a) * r;
  } else if (!f.anchor) {
    ent.x = p.x;
    ent.y = p.y;
  }

  if (f.grow) {
    const k = 1 - ent.life / Math.max(0.01, c.stats.life);
    ent.radius = ent.baseRadius * (1 + f.grow * k);
  }

  const s = ent.s;
  s.width = s.height = ent.radius * 2.3;
  s.rotation += ent.look.spin * dt;
  // Each look states its own weight, but a descriptor may override it -- the
  // trail lays flame sprites dozens deep and needs far less than flame's own.
  const base = c.alpha || ent.look.alpha;
  s.alpha = base < 0.6 ? base + Math.sin(G.t * 5 + ent.orbitIndex) * 0.05 : base;

  // A tornado drags the swarm inward, which is what makes it feel different
  // from a field that merely sits there.
  if (f.pull) {
    G.grid.query(ent.x, ent.y, ent.radius * 2, near);
    for (let i = 0; i < near.length; i++) {
      const t = near[i];
      if (!t.alive || t.boss) continue;
      const dx = ent.x - t.x, dy = ent.y - t.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > ent.radius * 2) continue;
      t.kx += (dx / d) * f.pull * dt;
      t.ky += (dy / d) * f.pull * dt;
    }
  }

  ent.tickT -= dt;
  if (ent.tickT > 0) return;
  ent.tickT = c.stats.tick;

  // The tick interval is the rate limit, so no per-enemy dedup is needed.
  G.grid.query(ent.x, ent.y, ent.radius + 20, near);
  for (let i = 0; i < near.length; i++) {
    const t = near[i];
    if (!t.alive) continue;
    const dx = t.x - ent.x, dy = t.y - ent.y;
    const rr = ent.radius + t.r;
    if (dx * dx + dy * dy > rr * rr) continue;
    dealDamage(ent, t);
  }
}
