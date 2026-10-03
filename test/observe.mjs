/**
 * Behavioural fingerprint of a spell.
 *
 * The question these tests exist to answer is "does socketing this rune change
 * anything at all". That is only answerable by watching what the spell DOES,
 * because the failure mode being hunted is a flag that is set correctly, costs
 * attunement, prints a description -- and is then never read on the code path
 * that focus takes. Comparing compiled flags would call such a rune working.
 *
 * So: run the spell, record everything observable, and diff. A rune whose
 * fingerprint is byte-identical to bare did nothing.
 *
 * Channels are deliberately broad. A rune that only moves entities (Spiral) and
 * one that only adds damage (Heavy Hitter) must each light up somewhere, or the
 * suite would quietly pass them both as inert.
 */
import { G } from '../src/state.js';

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Runs the world and records a fingerprint.
 *
 * Positions are sampled relative to the PLAYER, not in world space, because
 * that is the frame the player experiences and the one in which "orbits me"
 * versus "flies away from me" is a difference.
 */
export function fingerprint(world, { seconds = 2.5 } = {}) {
  const seen = new Map();          // eid -> accumulated per-entity record
  const pathHash = [];
  let frames = 0;
  // Counted from the entity that DID the firing, not by looking for the
  // entities it produced. A trigger that casts into a crowd often spawns bodies
  // that hit something and die inside the same frame, so sampling the entity
  // list at frame boundaries misses them entirely and reports a working trigger
  // as dead. `trigFired` is incremented at the moment of firing and survives on
  // the pooled entity, so it cannot be missed this way.
  const firedBy = new Map();

  const steps = Math.round(seconds / (1 / 60));
  for (let i = 0; i < steps; i++) {
    world.step();
    frames++;
    const p = G.player;
    for (const e of G.spellEntities.active) {
      if (!e.alive) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const dist = Math.hypot(dx, dy);
      let rec = seen.get(e.eid);
      if (!rec) {
        rec = {
          kind: e.kind, depth: e.c ? e.c.depth : 0, frames: 0,
          minDist: Infinity, maxDist: 0, sumDist: 0,
          sumRadius: 0, turn: 0, lastAngle: Math.atan2(dy, dx), sweep: 0,
          hits: 0,
        };
        seen.set(e.eid, rec);
      }
      rec.frames++;
      rec.minDist = Math.min(rec.minDist, dist);
      rec.maxDist = Math.max(rec.maxDist, dist);
      rec.sumDist += dist;
      rec.sumRadius += e.radius;
      // Peak, not final: the entity is pooled and reset on reuse, and a pierce
      // rune's whole effect is how far this number gets before the entity dies.
      rec.hits = Math.max(rec.hits, e.hits);

      // Angular sweep around the player is what separates an orbit from a
      // straight line: a bolt flying outward holds its bearing, an orbiting
      // body walks all the way around.
      const a = Math.atan2(dy, dx);
      let d = a - rec.lastAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      rec.sweep += Math.abs(d);
      rec.lastAngle = a;

      if (e.trigFired > 0) firedBy.set(e.eid, Math.max(firedBy.get(e.eid) || 0, e.trigFired));
    }
    // A coarse positional digest. Catches shape changes (fan width, ring
    // layout, scatter) that the per-entity aggregates would average away.
    if (i % 5 === 0) {
      let h = 0;
      for (const e of G.spellEntities.active) {
        if (!e.alive) continue;
        h = (h * 31 + Math.round(e.x - p.x) * 7 + Math.round(e.y - p.y) * 13 + Math.round(e.radius)) | 0;
      }
      pathHash.push(h);
    }
  }

  const recs = [...seen.values()];
  const own = recs.filter((r) => r.depth === 1);       // the spell's own entities
  const spawned = recs.filter((r) => r.depth > 1);     // anything a trigger made
  const sum = (a, f) => a.reduce((n, r) => n + f(r), 0);
  const avg = (a, f) => (a.length ? sum(a, f) / a.length : 0);

  let stacks = [0, 0, 0, 0];
  let frozen = 0;
  for (const e of world.planted) {
    if (!e.st) continue;
    for (let i = 0; i < 4; i++) stacks[i] += e.st[i];
    if (e.frozen > 0) frozen++;
  }

  let fires = 0;
  for (const n of firedBy.values()) fires += n;

  // The same shape measured twice: once over the spell's OWN entities and once
  // over everything its triggers produced. A modifier socketed under a trigger
  // changes the second set and leaves the first alone, so judging it by the
  // `own` numbers would call every one of them broken.
  const shape = (set) => ({
    count: set.length,
    avgLifeFrames: r2(avg(set, (r) => r.frames)),
    avgDist: r2(avg(set, (r) => r.sumDist / r.frames)),
    maxDist: r2(Math.max(0, ...set.map((r) => r.maxDist), 0)),
    minDist: r2(set.length ? Math.min(...set.map((r) => r.minDist)) : 0),
    avgRadius: r2(avg(set, (r) => r.sumRadius / r.frames)),
    avgSweep: r2(avg(set, (r) => r.sweep)),
    avgHits: r2(avg(set, (r) => r.hits)),
  });
  const o = shape(own);
  const s = shape(spawned);

  return {
    entities: recs.length,
    ownEntities: o.count,
    triggerEntities: s.count,
    triggerFires: fires,
    kinds: [...new Set(recs.map((r) => r.kind))].sort().join('+'),
    damage: Math.round(world.damageDealt()),
    kills: G.kills,
    avgLifeFrames: r2(avg(recs, (r) => r.frames)),
    avgDist: o.avgDist, maxDist: o.maxDist, minDist: o.minDist,
    avgRadius: o.avgRadius, avgSweep: o.avgSweep, avgHits: o.avgHits,
    tAvgLifeFrames: s.avgLifeFrames, tAvgDist: s.avgDist, tMaxDist: s.maxDist,
    tMinDist: s.minDist, tAvgRadius: s.avgRadius, tAvgSweep: s.avgSweep,
    tAvgHits: s.avgHits,
    statusStacks: stacks.map(r2).join('/'),
    frozenBodies: frozen,
    pathHash: pathHash.join(','),
  };
}

/** Field-by-field diff of two fingerprints; empty means nothing changed. */
export function diff(a, b) {
  const out = [];
  for (const k of Object.keys(a)) {
    if (a[k] === b[k]) continue;
    out.push(k === 'pathHash' ? 'path' : k);
  }
  return out;
}
