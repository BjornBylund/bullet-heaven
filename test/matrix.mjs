/**
 * The compatibility matrix: every rune against every spell.
 *
 * Three axes, because "a rune works" means three different things:
 *
 *   MODIFIER x FOCUS     socket a modifier on a bare spell and watch what
 *                        changes in the world.
 *   TRIGGER x FOCUS      socket a trigger; its condition must actually fire.
 *   MODIFIER x TRIGGER   socket a modifier UNDER a trigger; the trigger's own
 *                        output must change. Catches a modifier that applies to
 *                        the host spell and is dropped on the way down.
 *
 * VERDICTS. "Nothing happened" is not a useful answer on its own, so each pair
 * resolves to one of:
 *
 *   works      behaviour changed, and any channel the rune explicitly promises
 *              moved too
 *   partial    behaviour changed, but the promised channel did not -- the rune
 *              does something, just not the thing it advertises. This is where
 *              Self-Centered's orbiting lands
 *   inert      the compiled spell changed and the world did not, and the keys
 *              it changed ARE read by this kind. A real defect
 *   n/a        same, except the keys are NOT read by this kind -- pierce on a
 *              burst. Expected, and not counted against anything
 *   no-op      compiling with the rune produced an identical spell
 */
import { createWorld } from './world.mjs';
import { fingerprint, diff } from './observe.mjs';
import { compiledDiff } from './inspect.mjs';
import { MODIFIER_IDS, TRIGGER_IDS, RUNES } from '../src/runes.js';
import { FOCUS_IDS } from '../src/focuses.js';
import { consumes, WORLD, TREE, CLAIMS, EXPECT, reason } from './expect.mjs';

// `field` is not player-selectable but is still a compile target: triggers host
// one, and so does the fire trail. A rune broken on fields is broken in play.
export const FOCUSES_UNDER_TEST = [...FOCUS_IDS, 'field'];

const LEVEL = 3;        // max level: the largest signal a rune can produce
// Long enough that the SLOWEST focus gets several casts: Burst is on a 3.2s
// cooldown, so a short window measures it at one cast and calls every
// cadence-sensitive rune inert on it.
const SECONDS = 7;
const SEED = 12345;
const SEEDS = [SEED, SEED + 7, SEED + 19];

// The crowd is killable and replaced in place. On-kill triggers cannot fire
// against invulnerable bodies, and a suite that cannot exercise a third of the
// trigger table is not measuring the thing it claims to.
const node = (id, children = []) => ({ id, level: LEVEL, children });

/**
 * Two worlds per measurement, because no single crowd answers both questions.
 *
 * An INVULNERABLE crowd gives continuous damage: nothing dies, so a damage rune
 * resolves to the percent it actually added. A KILLABLE crowd is the only place
 * on-kill triggers fire -- but its damage channel is quantised to whole
 * corpses, and with a small health pool a real damage increase that does not
 * move the kill count reads as exactly zero. Measured that way, several runes
 * under Spiraling Rage and Gust of Wind reported as inert while plainly working.
 *
 * So: damage, movement and statuses come from the invulnerable run; kills and
 * anything downstream of a kill come from the killable one.
 */
function measure(opts, seed) {
  const tough = fingerprint(createWorld({ ...opts, seed, invulnerable: true }), { seconds: SECONDS });
  const soft = fingerprint(createWorld({ ...opts, seed, invulnerable: false }), { seconds: SECONDS });
  return {
    ...tough,
    kills: soft.kills,
    killDamage: soft.damage,
    killEntities: soft.entities,
    killStacks: soft.statusStacks,
    triggerFires: Math.max(tough.triggerFires, soft.triggerFires),
  };
}

/**
 * Averaged over several seeds. One seed is not enough: a rune that only
 * reshapes where copies go can, on an unlucky seed, land them close enough to
 * bare that a single run looks identical. Any channel differing on ANY seed
 * counts as a difference.
 */
function fingerprintOf(opts) {
  return SEEDS.map((seed) => measure(opts, seed));
}

function channelsBetween(as, bs) {
  const out = new Set();
  for (let i = 0; i < as.length; i++) for (const c of diff(as[i], bs[i])) out.add(c);
  return [...out];
}

/** Turns the two diffs into one explained verdict. */
/**
 * The channel a claim should be read on depends on WHERE the rune sits. A rune
 * socketed on the spell moves the spell's own entities; the same rune under a
 * trigger moves the trigger's. `remap` picks the matching channel.
 */
/**
 * An ON-KILL trigger can only fire where things die, which is the killable run.
 * Its damage and statuses therefore land in that run's channels, and asking for
 * them in the invulnerable one -- where the trigger never fires at all -- fails
 * every modifier socketed beneath it.
 */
const KILL_SIDE = { damage: 'killDamage', statusStacks: 'killStacks' };

const TRIGGER_SIDE = {
  avgSweep: 'tAvgSweep', avgHits: 'tAvgHits', maxDist: 'tMaxDist',
  minDist: 'tMinDist', avgDist: 'tAvgDist', avgRadius: 'tAvgRadius',
  avgLifeFrames: 'tAvgLifeFrames', ownEntities: 'triggerEntities',
};

/**
 * Can the trigger's own entities be watched at all?
 *
 * An on-hit trigger casts INTO the body it just struck, so its projectiles
 * spawn on top of a crowd, hit something, and die inside the same frame they
 * were born. Sampling at frame boundaries never sees them: `triggerEntities`
 * reads zero while the trigger is plainly working and dealing damage. Any claim
 * that rests on watching those entities is unmeasurable here, and saying so is
 * the honest result -- calling it a failure would be a statement about the
 * sampler, not the rune.
 */
const observable = (fps) => fps.some((f) => f.triggerEntities > 0);

function judge({ id, focus, channels, compiled, fired, isTrigger, underTrigger, canSeeTrigger = true, onKill = false }) {
  if (isTrigger) {
    return fired
      ? { verdict: 'works', why: '' }
      : { verdict: 'inert', why: 'condition never fired' };
  }
  if (!compiled.length) return { verdict: 'no-op', why: 'compiles to an identical spell' };

  if (!channels.length) {
    if (underTrigger && !canSeeTrigger) {
      return { verdict: 'unseen', why: "the trigger's entities die within the frame they spawn" };
    }
    const live = compiled.filter((d) => consumes(d.kind, d.key));
    if (!live.length) {
      const keys = [...new Set(compiled.map((d) => d.key))].join(', ');
      return { verdict: 'n/a', why: `${keys} is not read by a ${compiled[0].kind}` };
    }
    const keys = [...new Set(live.map((d) => d.key))].join(', ');
    return { verdict: 'inert', why: `sets ${keys}, which a ${live[0].kind} reads, yet nothing changed` };
  }

  let claim = CLAIMS[id];
  // A claim scoped to kinds says nothing about the others.
  if (claim && claim.kinds && !compiled.some((d) => claim.kinds.includes(d.kind))) claim = null;
  let wanted = claim && (underTrigger ? (TRIGGER_SIDE[claim.channel] || claim.channel) : claim.channel);
  if (claim && onKill) wanted = KILL_SIDE[wanted] || wanted;
  // The claim rests on entities this run could not watch, so it is not asked.
  if (claim && underTrigger && !canSeeTrigger && wanted !== claim.channel) claim = null;
  if (claim && !channels.includes(wanted)) {
    // Only a failure where the claim COULD have been honoured. A rune promising
    // homing has nothing to curve on a field that never moves.
    const relevant = compiled.some((d) => consumes(d.kind, d.key));
    if (relevant) {
      return {
        verdict: 'partial',
        why: `says "${claim.says}" but ${wanted} never moved (changed: ${channels.join(' ')})`,
      };
    }
  }
  return { verdict: 'works', why: '' };
}

const PASS = new Set(['works', 'n/a', 'unseen']);

/** Axis 1 + 2: every rune socketed directly on every focus. */
export function runFocusAxis() {
  const rows = [];
  for (const focus of FOCUSES_UNDER_TEST) {
    const bareCache = new Map();
    for (const id of [...MODIFIER_IDS, ...TRIGGER_IDS]) {
      const world = WORLD[id] || {};
      const wk = JSON.stringify(world);
      const bk = wk + (TREE[id] ? '|' + id : '');
      if (!bareCache.has(bk)) {
        const w = TREE[id] ? TREE[id](null).filter(Boolean) : [];
        bareCache.set(bk, fingerprintOf({ focus, tree: w, ...world }));
      }
      const bare = bareCache.get(bk);

      // Positional runes read their own place in the graph, so a rune sitting
      // alone under the focus has nothing above it and multiplies by zero.
      // TREE wraps those in a chain deep enough for them to read.
      const wrap = TREE[id] || ((n) => [n]);
      const socketed = wrap(node(id));
      const got = fingerprintOf({ focus, tree: socketed, ...world });
      const bareTree = TREE[id] ? wrap(null).filter(Boolean) : [];
      const isTrigger = TRIGGER_IDS.includes(id);
      const j = judge({
        id, focus,
        channels: channelsBetween(bare, got),
        compiled: compiledDiff(focus, bareTree, socketed),
        fired: got.some((f) => f.triggerFires > 0),
        isTrigger,
      });
      rows.push({
        axis: 'focus', rune: id, name: RUNES[id].name, isTrigger, target: focus,
        ...j,
        ok: PASS.has(j.verdict) === (EXPECT[`${id}@${focus}`] !== false),
        note: reason(id, focus),
      });
    }
  }
  return rows;
}

/**
 * Axis 3: every modifier socketed beneath every trigger.
 *
 * The host focus is fixed to Projectile so the only variable is the trigger.
 * The bare row is the trigger ALONE, so a difference means the modifier changed
 * what the trigger produced.
 */
export function runTriggerAxis() {
  const rows = [];
  const focus = 'projectile';
  for (const trig of TRIGGER_IDS) {
    const bareCache = new Map();
    for (const id of MODIFIER_IDS) {
      const world = WORLD[id] || {};
      const wk = JSON.stringify(world);
      const bk = wk + (TREE[id] ? '|' + id : '');
      if (!bareCache.has(bk)) {
        const kids = TREE[id] ? TREE[id](null).filter(Boolean) : [];
        bareCache.set(bk, fingerprintOf({ focus, tree: [node(trig, kids)], ...world }));
      }
      const bare = bareCache.get(bk);

      const wrap = TREE[id] || ((n) => [n]);
      const bareKids = wrap(null).filter(Boolean);
      const socketed = [node(trig, wrap(node(id)))];
      const bareTree = [node(trig, bareKids)];
      const got = fingerprintOf({ focus, tree: socketed, ...world });
      const j = judge({
        id, focus,
        channels: channelsBetween(bare, got),
        compiled: compiledDiff(focus, bareTree, socketed),
        fired: true,
        isTrigger: false,
        underTrigger: true,
        canSeeTrigger: observable(bare),
        onKill: RUNES[trig].when === 'kill',
      });
      rows.push({
        axis: 'trigger', rune: id, name: RUNES[id].name, target: trig,
        ...j,
        ok: PASS.has(j.verdict) === (EXPECT[`${id}>${trig}`] !== false),
        note: reason(id, trig),
      });
    }
  }
  return rows;
}
