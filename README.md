# Bullet Heaven

A survivors-like (Vampire Survivors genre) with a graph-based spell-crafting
system modelled on *Mages of Mystralia*. Built on PixiJS v8 — no build step, no
npm install, native ES modules and one CDN import.

## Running it

ES modules will not load over `file://`, so it needs a static server:

```bash
python serve.py 5174
```

Then open <http://localhost:5174>.

Use `serve.py` rather than `python -m http.server`: the built-in server sends no
cache headers, so browsers reuse ES modules across reloads. With a module graph
this size that means an edit to one file can silently fail to load while its
neighbours update — which looks exactly like a bug in the game. `serve.py` sends
`no-store` on everything.

Controls: **WASD / arrows** to move, **1-4** or click to take an upgrade,
**E** for the spell editor, **Esc** to pause. Spells cast themselves — movement
is the only input, which is the genre's defining constraint.

## The spell system

You don't pick weapons. You **build** them.

A spell is a tree with one **Focus** at the root, which is the only thing that
creates entities in the world:

| Focus | What it does | `Range` means |
|---|---|---|
| **Projectile** | travels a vector from you | travel distance |
| **Cone** | three bolts in a fan | travel distance |
| **Burst** | expands outward from a point | radius |

`On Spawn` fires once per **entity** the parent creates, not once per cast, so
Cone fires it three times — once per bolt, each from that bolt's own position
and heading. Measured: Cone + Rolling Stone spawns 3 boulders where Projectile
spawns 1. Orbiting field triggers are unaffected, because they refresh rather
than restack: Cone + Solid Defense still yields 2 stones, not 6.

The cost is that on-spawn nests multiply. The worst case the editor allows — a
three-deep nest on Cone, in a 250-enemy crowd — peaks at **189 live entities and
3.32 ms/frame**, about 5x headroom, against 0.39 ms for a bare Cone. The entity
pool does not grow.

`Partway through` (the condition Gust of Wind uses) fires once, three fifths of
the way through an entity's life, and each kind measures that in the only units
it has: a projectile in travel, a burst in how far its shockwave has expanded, a
field in elapsed time. Only the projectile reading existed at first, so the rune
could be socketed on a Burst or a Field, charge attunement, and never fire at
all — one of the holes the rune matrix found.

`Orbiting` works the same way: it is a property of a spell, not of fields.
Setting it routes any focus's output through the field emitter, which is the one
path that gives each body a slot on the circle and refreshes the set instead of
restacking it. A converted spell needs geometry it was never compiled with — a
projectile's `range` is a travel distance, so read as an orbit radius it would
fling the bodies 460px out and inflate each into a 200px blob — so
`CFG.spell.orbit` supplies the missing numbers: 120px out, 30px across, in line
with the trigger fields that already orbit. Fields keep their own reading of
`range`, which several trigger effects depend on.

**Field is no longer a playable Focus**, but it is still an entity *kind*:
Solid Defense, Flash of Swords, Perfect Storm and the fire trail all spawn field
entities and compile from `FOCUSES.field`. That is why the entry survives in the
table while being absent from `FOCUS_IDS` — the table doubles as the base-stat
block for every kind, not just the ones a player may choose.

Cone is the middle ground it replaced. At runtime it *is* a Projectile — same
entity, same update path — differing only in the flags it is born with:
`split: 3` and a wide `cone`. Range does its balancing for free: at point blank
all three bolts strike one body, and by full range they have fanned far enough
that only the centre one does.

Runes hang off it, in two kinds. **Modifiers** change the node they hang under.
**Triggers** are complete effects with a condition — they cast something of
their own for a *percentage of the damage of the node above them*:

```
Furious Outburst        Rare Trigger        3 focus
  Triggered on hit
  Casts 3/4/5 fireballs in random directions
  Damage 20% / 35% / 60%  ·  Apply 1/2/3 Burn
```

So a trigger under a heavily-modified Spell inherits that investment, and a
trigger under another trigger compounds off it. Nobody designed "piercing
fireball scatter that detonates corpses" — it falls out.

Every rune has a **tier** (Common / Rare / Epic) and **three levels** whose
numbers step hard. Tier weighting ramps with elapsed time, so Epics are scarce
early and routine late. That is the power curve.

**22 modifiers to 11 triggers**, and triggers are weighted *down* in the offer
pool once you own a couple (~24% of cards). A trigger is a whole extra effect;
offering them as often as a stat rune made every spell a pile of triggers and
left the modifier pool — where builds actually differentiate — barely visible.

The modifier set is deliberately narrow. Modifiers change **stats**
(`Heavy Hitter`, `Piercing Eyes`), **spawn shape** (`Frenetic Energy`,
`Stars Aligned`, `Self-Centered`, `Destructive Path`, `Return`), **applied
debuffs** (`Firewalking`, `Icy Wind`, `Deep Freeze`, `Potent Burn`), or read the
**graph** itself (`Pressure Buildup`, `Empty Stomach`).

**Conditional damage only ever keys off a debuff** — `Frostbite` (vs frozen),
`Deep Freeze` (vs chilled), `Burned to Death` (crit vs burning). Conditionals
based on health thresholds, target size or distance travelled were cut, along
with on-kill payoffs, to keep the number of rules a player has to hold in their
head small. A damage bonus should always trace back to a status you chose to
apply, not to a hidden state check.

**Three costs** keep it honest: each rune takes a **socket**, some **focus**
(0–3 points), and some reduce the **damage** of the node they attach to. Damage
penalties are scoped per-node and deliberately do *not* compound down the chain
— otherwise deep trigger chains would do nothing, and deep chains are the point.

**Link slots** shape it: a Focus accepts **3** children, every rune accepts
**2**. And ownership is not the same as structure — a modifier applies to the
*nearest Focus or Trigger above it*. So moving `Piercing Eyes` from under a
trigger to under the Focus moves the pierce from the trigger's fireballs to the
bolt itself. Where you hang a rune changes what it does.

Nesting depth is hard-capped at 3. That cap is currently the only structural
limit on cascade size — see *Known risks*.

**There are no passive stat cards.** Every card on the level-up screen is spell
content; health and a baseline damage ramp are granted automatically per level.

The editor (press **E**) is a **drag-and-drop node graph**. Drag a rune from the
inventory onto a node to link it there, drag a placed node onto another to
relink its whole subtree, or drag it back to the inventory to take it off. Valid
targets light up as soon as you start dragging. Position is mechanical, not
decorative: `Pressure Buildup` scales with how many runes sit above it,
`Empty Stomach` with how many sockets you left free.

## Focus balance

The three Focuses are meant to split along crowd-versus-single-target, and that
split is measured rather than assumed — `tools/focus-bench.js` plants an
unkillable target set and times each Focus bare and carrying an identical
`On Hit` trigger.

Damage per second, bare, measured on the hardened rune-bench harness:

| Focus | crowd damage | kills/sec | single target |
|---|---|---|---|
| **Projectile** | 192 | 2.2 | **48** |
| **Cone** | 312 | **3.2** | 35 |
| **Burst** | **403** | 0.4 | 10 |

Each owns a lane: Projectile the single target (bosses), Burst raw crowd
damage, Cone the kill throughput between them. Both the crowd and
single-target columns are monotonic with Cone in the middle, which is what
"middle ground" has to mean to be worth picking.

Cone took two passes to get there. At 15 damage a bolt it measured **the same
crowd damage as Projectile, a worse kill rate (0.8/s against 2.2) and better
single-target damage** — a worse Projectile that was better at bosses, which is
backwards on both counts. Splitting a similar total across more, weaker bolts
spread damage so thinly that nothing died: a zombie needed four hits instead of
three. Per-bolt damage is now kept near Projectile's, and the fan was widened
from 0.38 to 0.52 because at the narrow angle all three bolts still converged on
one body at normal range.

Getting there took a structural fix, not a tuning pass. Projectile originally
measured **15 dps against Burst's 738 — a 50× gap**, because a cast with no
pierce touches exactly one enemy, which divides both its damage *and its trigger
delivery* by the size of the crowd. A Burst hitting 40 enemies fires `On Hit`
forty times per cast; a Projectile fired it once. Raising fire rate alone would
have needed an 0.018s cooldown to compensate.

The fix was three-sided: **base pierce 3** on the Projectile focus (the
structural half — it multiplies damage and trigger firings together), a
**cooldown of 0.42s** down from 0.90 (cadence is worth double here, since every
cast is also an `On Spawn` trigger), and **Burst slowed to 3.2s**.

> Harness note: the bench asserts `simAdvanced` matches its window. An earlier
> version did not, and a level-up card screen silently paused the sim
> mid-measurement — which reported "Field does 0 single-target damage" as
> though it were a bug in the game.

## Enemies

Variety runs along four axes at once — speed, size, health and **behaviour** —
because a roster that only varies numbers reads as one enemy wearing hats.

| Behaviour | What it does |
|---|---|
| **chase** | walks straight at you; the baseline the rest are read against |
| **ranged** | holds its preferred distance and fires slow, dodgeable orbs |
| **charger** | stalks, winds up visibly in place, then dashes in a straight line |
| **splitter** | bursts into smaller enemies when killed |

Fourteen types, from `swarmling` (7px, 5hp, very fast, arrives in crowds) to
`hulk` (42px, 640hp, barely moves).

**Health bars** appear only once an enemy has actually been damaged, so chaff
that dies to one hit never shows one and the screen stays readable. Bar width
tracks body size and the fill runs green → amber → red.

**Enemy projectiles** are the one threat that asks something of a
movement-only game. They are deliberately slow — fast bullets among 800 enemies
are unreadable, slow ones you weave through — and drawn as a bright core inside
a pulsing **halo ring**, a silhouette nothing else uses, so incoming fire never
disappears into a crowd of solid circles. Shooters only fire while on screen;
being shot from beyond the viewport is arbitrary rather than hard.

### Density is a target, not a rate

The director aims at a live **population**, and tops up toward it every 0.3s by
closing half the shortfall:

| minute | 0 | 5 | 10 | 15 | 20 |
|---|---|---|---|---|---|
| target alive | 15 | 122 | 285 | 502 | 775 |

Deliberately below what a pure density target would suggest, and paired with a
**1.25x base HP multiplier** plus a steeper HP curve. Enemies were dying on
contact, which meant `On Hit` chains had nothing to chain through and no enemy
ever survived long enough to read. Fewer, tougher bodies give each hit somewhere
to land.

A rate-based spawner silently depends on how fast the player kills. When the HP
curve came down (see §5 of the spec) kill rate went up and the field emptied out
— 35–75 enemies at minute 5 — even though no spawn number had changed. Targeting
a population makes density a decision instead of a side effect: if the player is
deleting the screen, more arrives to replace it.

The `fill` fraction matters more than it looks. At equilibrium the shortfall
settles at `killRate ÷ (fill ÷ pulse)`, so a timid fill leaves a permanent gap.
At 0.5 the field tracks **89–99% of target** in practice.

Two things are capped directly rather than hoped for:

- **Ranged count** — a *fraction* of the target population (4.5%, floor 6, ceiling
  40), because ranged enemies hold their distance instead of pressing in and so
  do not die at the rate they spawn. Left alone they pile into an ever-growing
  outer ring until they *are* the field (a test run hit 601 of them). Past the
  cap the director substitutes a chase type, so total pressure is unchanged and
  only composition shifts. Measured in play they hold at 4.6–5% of the field.
  Rare, and they hit hard to compensate: a lobber shot is ~29% of max HP.
- **`maxShots` (70)** — a safety net so a wave of shooters cannot flood the
  screen. Boss patterns are exempt and draw from `bossShotHeadroom` instead.

**Debuffs** stack with per-status rules and drain-based decay. Chill slows, and
at 20 stacks it converts to a Freeze. No debuff applies hard crowd control
directly; hard CC is only ever reached through a stack threshold, which is what
stops a single rune from locking the whole screen permanently.

Full design rationale, including rejected alternatives, is in
[docs/spell-system.md](docs/spell-system.md).

## Bosses

A boss is a scripted encounter, not a large enemy. Every boss runs the same
four-beat loop, and that loop *is* the design:

| Beat | What happens |
|---|---|
| **APPROACH** | strides in from the spawn ring at 2.2x speed, attacking nothing |
| **WINDUP** | stops dead and flashes white, faster as it completes. The tell. |
| **EXECUTE** | runs one attack pattern |
| **RECOVER** | walks at you, vulnerable, then picks the next pattern |

**A boss is exempt from the population cap, and its slot in the rotation is not
consumed until it is standing in the world.** Both halves matter. `spawnEnemy`
refuses to spawn once `maxEnemies` bodies are alive, which is right for the
swarm and wrong for the one entity the schedule exists to deliver -- and the
boss call ignored the refusal, having already advanced `nextBoss` and
`bossIndex`. So a full field did not delay a boss, it deleted it: the banner
played, the screen shook, nothing arrived, and the next boss in the rotation
took the missing one's place.

It is reachable in ordinary play. Simulated against the real director, a run
where the player clears bosses but not the swarm pins at the 1500 cap by minute
30, and from minute 32.5 **every remaining boss in the run was lost**. Covered
now by `npm run test:spawn`, which asserts a boss still arrives with the field
at the cap, that the exemption does not leak to the swarm, and that a
forty-minute run skips none of its sixteen bosses.

In a genre whose only input is movement, a threat is fair only if you can see it
coming, and interesting only if reacting costs you position. The windup is what
turns "you took damage" into "you were standing in the wrong place". APPROACH
exists for the same reason ordinary shooters hold fire off screen: a pattern
whose origin you cannot see is not a fight, it is weather.

**Phases** swap the pattern pool at 66% and 33% health, so one boss asks
different questions early and late. Crossing a threshold is its own event — a
shockwave, a screen punch, and a beat of nothing — and the thresholds are drawn
on the health bar so the next escalation is visible before it lands.

### The roster

Bosses rotate in order and repeat, escalating with the run's difficulty curve.

| Boss | Arrives | Identity | Gains at 66% / 33% |
|---|---|---|---|
| **The Iron Warden** | 2:30 | rings and aimed spreads | summons, then double rings |
| **The Devourer** | 5:00 | commits to charges | rings, then charges twice a cycle |
| **The Storm Crown** | 7:30 | rotating spirals | double rings, then charges too |

Six patterns, each asking a different movement question: `radial` (a full ring
with a gap to walk), `doubleRing` (the second ring closes the first's gap),
`spiral` (a rotating stream you walk rather than dodge), `volley` (the only
aimed one), `charge` (commits to a line, then slams), `summon` (refills the
arena you just cleared).

### Fighting one

Two things change while a boss is alive:

- **The swarm stops being topped up** (`bossPopMul`, 0.30). Nothing despawns —
  the field drains as you fight it.
- **Boss fire draws from its own budget** (`bossShotHeadroom`, +130 over the
  ambient `maxShots`). A ring that loses half its shots to a cap shared with the
  swarm is no longer a readable shape.

The first of those is load-bearing for a reason that is not obvious. Measured
mid-fight, a bare Projectile landed **13 dps on the boss against 48 in a clear
arena**: auto-aim takes the nearest target, and pierce is spent on adds long
before a shot reaches the thing with the health bar. Thinning the field is what
makes the boss hittable at all.

### Balance

`tools/boss-bench.js` measures single-target damage against each boss with the
**bare** starting spell, at the elapsed time that boss actually arrives:

```js
await __bossBench()                    // each boss at its own arrival time
await __bossBench({ atSeconds: 150 })  // all on one clock, isolating base health
```

| Boss (at arrival) | Health | Projectile | Field* | Burst |
|---|---|---|---|---|
| Iron Warden (2:30) | 2,777 | 49 dps → 56s | 13 → 209s | 7 → 386s |
| Devourer (5:00) | 5,188 | 50 dps → 104s | 7 → 741s | 6 → 811s |
| Storm Crown (7:30) | 9,039 | 50 dps → 181s | 12 → 745s | 7 → 1255s |

\* Measured when Field was still playable; Cone has since replaced it and these
rows have not been re-run.

Read these as a **floor, not a prediction** — they are upgrade-free, and a real
player arrives with eight or ten levels of runes placed. Health is tuned so a
geared Projectile build gets a fight of roughly 20-30 seconds.

The spread across Focuses is the honest headline, and it is the exact inverse of
the crowd table in [Focus balance](#focus-balance), where Burst leads Projectile
about three to one. Against a single target Projectile leads by **seven to one**.
That inversion is what makes a boss worth having in a game otherwise entirely
about crowds — it is the one fight where the single-target Focus is king — but it
also means an AOE build cannot clear a boss on its Focus alone and has to lean on
its runes and on killing the adds. Bosses also scale on **half** the swarm's
health curve (`scaling.bossHpScale`), because the swarm curve is quadratic to
match AOE damage growing as damage x targets, and only the first half of that
applies to one body.

Worst case measured — Storm Crown mid-spiral, 107 enemies, 187 live shots —
costs **0.82 ms/frame**, about 20x headroom against the 60 Hz budget.

## Rune balance

Measured with `tools/rune-bench.js`, which sockets each rune alone under a bare
Projectile and reports three numbers, because no one of them is honest by
itself:

```js
await __runeBench()                          // all 33 runes
await __runeBench({ repeatBase: 8 })         // report the noise floor too
```

| Metric | Crowd | Why it is needed |
|---|---|---|
| **dmg** | 80 invulnerable | continuous, so it resolves small effects |
| **kills** | 80 killable, replaced as they die | the only metric that fires on-kill triggers, and the only one that charges for overkill |
| **boss** | 1 invulnerable | damage is not shared and nothing dies |

Noise floor is **±2%**. Reference point is minute 2.5, the same clock as the
boss bench. Getting there took four harness fixes, each of which had produced a
confident wrong answer first: an invulnerable crowd meant no on-kill trigger
could fire (three runes read as dead), unpinned `G.t` let difficulty drift
upward across rows (+48% bias toward whatever ran last), the un-discarded
warm-up run inflated every rune by ~23%, and a random crowd layout swamped real
effects. Check `valid` on every row; the bench aborts outright if the run ended.

### Persistent fields no longer stack

A field lives for a fixed time, but the spell spawning it fires on its own
cooldown, and nothing tied the two together. A Projectile casting every 0.42s
with a trigger whose blades live 3.2s accumulated eight overlapping sets:

| Spell | Peak concurrent entities | | dmg vs bare | |
|---|---|---|---|---|
| | **before** | **after** | **before** | **after** |
| bare Projectile | 1 | 1 | — | — |
| + Flash of Swords | 33 | **5** | +7,570% | **+1,254%** |
| + Solid Defense | 43 | **4** | +4,772% | **+654%** |

The effect scaled with fire rate, so the Focus rebalance that cut Projectile's
cooldown from 0.90 to 0.42 had silently doubled it again.

Two shapes, two rules, both in `emitField` in [cast.js](src/cast.js):

- **Orbiting fields refresh.** "Four blades circle you" is the fantasy, not
  "blades accumulate". Recasting renews their life and tops up to the current
  count, so Split still adds blades (verified: +Self-Centered gives 8, not 4).
- **Placed fields are capped** at `CFG.spell.fieldCap` (6). They are dropped at
  a position and cannot be refreshed in place, so an On Kill field trigger would
  otherwise spawn one per corpse.

### Cost and rarity are now derived, not chosen

Both come from measured power, where a rune's power is its **best** axis —
specialising is meant to be viable. Ranked by that score, the top five are epic
and cost 3, the next seven cost 2, and so on. Anything scoring below the bench's
resolution costs **nothing**: charging attunement for a rune that cannot be
shown to do anything is a trap, not a decision.

| | Before | After |
|---|---|---|
| Cost spread (0/1/2/3) | 20 / 4 / 2 / 7 | **14 / 7 / 7 / 5** |
| Tier spread (c/r/e) | 20 / 11 / 2 | **18 / 10 / 5** |
| Free modifiers | 16 of 22 | 9 of 22 |

The largest corrections were the ones the old table had exactly backwards:
`fulgorsSparks` was Epic at cost 3 while scoring zero on every axis, and
`destructivePath` was Common at cost 1 while ranking near the top. With a budget
of 6, two epics fill a spell exactly.

### Triggers pay for their effect in their own damage

A trigger's attunement cost also reduces its damage — **its own, and everything
nested under it**. The spell it hangs on is untouched, and modifiers pay nothing
at all.

| Cost | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Trigger damage | ×1.00 | ×0.94 | ×0.86 | ×0.76 |

Derived from attunement cost rather than stored per rune, so the two can never
drift apart — re-costing a rune automatically re-prices it.

The split is deliberate. A **modifier** exists to reshape the spell it is
attached to, so charging it against that same spell's damage just claws back
what the player bought. A **trigger** adds a whole new effect, and the natural
place to price that is the effect itself — socketing one should never make the
Focus above it weaker.

Nesting inherits for free. A trigger's damage is a percentage of its parent's,
so once the outer trigger has paid, everything below is already computing from
the reduced figure and pays its own cost on top of that:

```
bare Projectile                              20.00
  On Hit: Cruel Thorns  (cost 2, 70%)        12.04   = 20 × 0.70 × 0.86
    On Hit: First Snow  (cost 0, 25%)         3.01   = 12.04 × 0.25
```

A cost-3 **modifier** leaves the spell at 20.00, as does a cost-2 trigger — only
the trigger's own output moves. It is applied in `compileTrigger`
([spell.js](src/spell.js)), which is the single place a trigger's damage is
established.

**This is a gentle mechanic by design, and worth knowing how gentle.** A cost-2
trigger dealing 70% loses 14% of that, which is about a tenth of the parent
spell's damage worth of output. If the intent is for the trade to be felt
rather than noticed, the curve in `COST_DMG` is the dial.

### Seven bugs found while rebalancing

**Homing steered at targets it had already hit.** Hit dedup means a projectile
can never damage the same enemy twice, but `nearestTo` had no filter, so a
homing shot locked onto the body it had just passed through and circled a target
it could not hurt. Both homing runes measured at nothing because of it. Fixing
the filter took Fulgor's Sparks from +14% kill rate to +64%.

**AOE hit dedup overflowed, and On Hit fired repeatedly.** The per-entity hit
list introduced above was a fixed `Int32Array(128)`, sized for the largest
pierce in the game. That reasoning only holds for projectiles -- a **Burst has
no pierce limit**, it touches everything inside its radius, which in a late-run
crowd is several hundred. Past 128 distinct targets `claim()` let the hit
through without recording it, so the same body was struck on every frame of the
expansion and fired its On Hit trigger again each time. Measured at a crowd of
200: 352 hits instead of 200, with individual enemies hit four times. The cliff
sat exactly at the array size. The list now grows on demand and lives on the
pooled entity, so growth happens a handful of times and never again; resetting
is still `hitCount = 0`. Exact from a crowd of 80 to 300.

**Boss chests discounted the next level.** `grantLevels` raised the level but
left `xpNeed` at its pre-chest value, where `gainXp` recomputes it. Three levels
from level five left the next level costing 145 instead of 312 -- more than half
off, on every boss chest in a run. It self-corrected after one more normal
level-up, so it was one heavily discounted level per chest.

**Screen shake never settled on any pause screen.** `render()` applies shake on
every frame, but `updateFx` -- the only thing that decayed it -- runs inside the
simulation, behind the pause check. A shake landing just before a pause (a boss
dying is worth 14 on its own) stayed at full strength for as long as the
level-up, editor or game-over screen was up. Decay now runs from the frame loop
on real time, which is also more correct: shake is perceived in wall-clock time,
not simulation steps.

**Making a Field orbit collapsed its size.** An orbiting field takes its radius
from `baseSize`, which is only ever set by a *trigger* effect (Solid Defense's
stones, Flash of Swords' blades). A player's own Field has no `baseSize`, so it
fell through to a hardcoded `30` — socketing Self-Centered cut a radius-100 field
to 30 and left size runes scaling 30 instead of 100, so Heavy Burden at x1.60
reached only 48, still less than half the bare field. Reported as "size
adjustment isn't working". An orbiting field is now sized from the spell's own
range (`ORBIT_FIELD_SCALE`, 0.45), so investment carries: 45 bare, 72 at x1.60.
Trigger effects that declare their own size are untouched. Self-Centered's
description now states the reduction rather than hiding it.

**The field cap silently clipped the fire trail.** `fieldCap` was added to stop
on-kill vortexes running away, but a trail is a *placed* field too, so it fell
under the same ceiling: it wanted about forty patches and got six, roughly a
sixth of its length, and then stopped drawing until they expired. Trails now
carry their own `cap` and, at that ceiling, **evict their oldest patch instead
of refusing the new one** — refusing drops the patch nearest the projectile, so
the trail visibly stops exactly where the player is looking while a stale tail
lingers behind them. Measured after: the patch behind the projectile is present
on 99% of frames.

**Short Fuse deleted Field builds.** It cut `range`, which on a Field *is* the
radius — measured at **−100% damage**, a free rune that was pure downside on a
third of the game's builds. The cut is now projectile-only, and it carries a
damage bonus so the tradeoff is real in both directions.

### The pass

| Rune | Was | Now | Why |
|---|---|---|---|
| Perfect Storm | +2,757% kills | **+1,107%** | on-kill tornados dragged bodies together and spawned more tornados; still the strongest rune, no longer three times the field |
| Fulgor's Sparks | power 4 | **71** | four sparks at 40% of a 20 damage spell is 8 damage against a 59 HP enemy — it could not function at any level |
| Silent Grudge | power 14 | **78** | growth worked, but base pierce capped a projectile at three hits so the extra reach found no targets |
| Short Fuse | power 4 (−100% on Field) | **58** | see above |
| Gust of Wind | power 38 | **65** | the weakest free trigger |
| Piercing Eyes | power 29 | 17, now free | measured at crowd 80, where a projectile finds only ~5 bodies however much it may pierce. At 200+ it finds ~13, so this is a late-game scaling rune the bench under-rates — see below |

Cost and tier were then re-derived from the final numbers, moving 15 more runes.

### Still outstanding

- **Ten runes still measure at or below the noise floor**, and all of them now
  cost nothing. Several legitimately cannot be seen by a damage bench and were
  verified working by other means: **Icy Wind** reaches Freeze (chill peaks at 19
  then converts; enemies were frozen for 487 frame-samples), **Numbing Cold** is
  purely defensive, **Frostbite** and **Burned to Death** are conditional on
  statuses a bare Projectile never applies, and **Messenger of Peace** is homing,
  which is worth nothing when the crowd is dense enough that auto-aim always has
  a target. They are situational rather than broken — but the bench cannot prove
  that, so treat the zero as "unmeasured", not "fine".
- **The bench is Projectile-only by default.** Pass `{ focus: 'field' }` before
  trusting any single number; Silent Grudge reads +4% on a Projectile and +203%
  on a Field.
- **The bench runs at crowd 80, which is minute-2.5 density, and that
  under-rates anything whose value scales with how many bodies are in reach.**
  Measured average hits per projectile: bare finds 3.0; pierce 13 finds 5.0 at
  crowd 80 but **12.8 at crowd 200 and 12.9 at 300**. So pierce is not weak, it
  is density-gated — at minute 8 it delivers four times the bare projectile,
  and the harness never sees that. Re-run with `{ crowd: 250 }` before pricing
  any reach, size or pierce rune.

## Why PixiJS

The genre stresses sprite count: 1,000-2,000 entities drawn and collision-checked
every frame. Pixi is a WebGL renderer with sprite batching, which solves exactly
that and stays out of the way on everything else. The game loop, entity pools,
collision, spawn pacing and the whole spell runtime are hand-rolled, because
those are the parts that *are* the game.

Measured at 15:00 with a depth-3 `On Hit → On Kill` cascade running off a Field:
**60fps, 16.6ms average, 17.4ms worst frame**, with 862 enemies, 113 peak
simultaneous spell entities and ~108 kills/sec.

Simulation cost alone, measured headlessly at ~270 enemies with six triggers
live across four spells: **2.5ms per frame**, roughly 7× headroom inside a 60fps
budget.

## Architecture

```
index.html        canvas host + the whole HUD/menu/editor layer as DOM
src/
  pixi.js         single pinned PixiJS version, re-exported
  config.js       every tuning number worth touching
  util.js         math helpers + the object Pool
  spatial.js      uniform spatial hash (collision broadphase)
  textures.js     procedural placeholder art -> GPU textures
  state.js        G: shared mutable state, difficulty curve, cull test
  input.js        keyboard

  focuses.js      the three spell roots
  runes.js        the rune table: triggers, modifiers, tiers, level scaling
  spell.js        chain model, budgets, and the compiler
  cast.js         spell runtime: entity pool, trigger dispatch, hit resolution
  spellbook.js    owned spells, rune inventory, global caps
  status.js       debuffs: stacks, drain, thresholds
  editor.js       node-graph editor

  fx.js           damage numbers, particles, shockwaves, screen shake
  progress.js     XP, levels, healing, gold
  pickups.js      XP gems, hearts, chests, magnets
  enemy.js        archetypes, behaviours, spawn director, swarm update
  shots.js        enemy projectiles (tests against the player only)
  player.js       movement, derived stats, contact damage
  upgrades.js     weighted level-up offers
  ui.js           HUD, character select, menus
  main.js         bootstrap, camera, fixed-timestep loop
```

Module dependencies are acyclic apart from one deliberate pair: `enemy.js` and
`status.js` reference each other (a burn tick deals damage; damage applies
status). ESM resolves it because both sides are hoisted function declarations
called at runtime. `progress.js` exists to break the larger cycle that would
otherwise form between enemy death, XP, the player and spells.

### The decisions that carry the performance

**Compile once, run many.** A spell tree is flattened into a flat descriptor by
`compile()` on every *edit*, never per frame. The hot loop reads plain numbers
and never walks a tree.

**Pooling.** Every entity type lives in a `Pool` with a dense active array.
Freeing swap-removes, so iteration stays contiguous and steady-state frames
allocate nothing.

**Spatial hashing.** `Grid` buckets everything into 52px cells, rebuilt from
scratch each frame (cheaper than incremental maintenance when everything moves).

**Hit dedup without allocation.** Each projectile keeps the ids of the bodies it
has already passed through in a fixed `Int32Array`, checked before a hit lands.
The scan is bounded by how far the projectile may pierce and only runs on an
actual overlap, so it stays allocation-free.

This used to live on the enemy instead — one slot per compiled node holding the
last entity to touch it — which is O(1) but remembers only ONE entity per node.
Two projectiles from the same spell overlapping one body overwrote each other's
slot and re-armed each other. Measured: one cast landed 1 hit correctly, two
overlapping landed 5, four landed 12. `Return` made it severe by doubling
projectile lifetime, which guarantees overlap — 920 damage against 260 for the
bare spell. Now exact from 1 to 10 overlapping casts.

**Culling.** Enemy separation — what makes the horde read as a crowd rather than
a queue — only runs for enemies on screen.

### Fixed timestep

Logic runs at a fixed 60Hz, rendering at display rate, so cooldowns and spawn
pacing are identical on a 60Hz laptop and a 165Hz monitor. Catch-up is capped at
5 steps, so a stall drops time rather than spiralling.

## Known risks

- **Level pacing is tuned against a MOVING player.** A stationary harness
  collects almost no XP gems, so any pacing measured from a parked player reads
  far too slow. Current curve lands ~23-29s per level (level 24 by minute nine);
  the pre-tuning curve produced level 83 by minute ten.
- **Trigger cascades are uncapped.** `On Hit` fires on every pierce hit and
  `On Kill` on every kill in an AoE, by choice, to find out what is fun before
  constraining it. The depth-3 cap is the only structural limit. A per-activation
  cast cap exists as `CFG.spell.triggerCap` (0 = off); setting it to 4 is a
  one-line change. Load-tested fine so far, but the ceiling has not been found.
- **Focus points now bind, but only just.** Before link slots, balance runs
  filled every socket while focus sat slack at 2–5 of 6. With links capping
  breadth, spells reach 6/6 focus — so the third cost is doing work again. Worth
  re-checking once socket caps get larger.
- **Crowd separation is the frame budget, and density now drives it directly.**
  Simulation cost, measured headlessly: **2.1ms at minute 6.6** (241 enemies,
  8× headroom), **5.2ms at minute 10.7** (499 enemies, 3× headroom), and ~8.4ms
  at a saturated 1,500. Rendering adds roughly another 8ms at the top end, so
  the minute-15+ targets (851→1298) sit close to the 16.67ms budget. 60fps was
  confirmed in real time at 1,500 enemies earlier in development, but *not*
  re-confirmed at these targets — the preview pane auto-hides, which throttles
  `requestAnimationFrame` and makes live FPS unmeasurable. If the late game
  stutters, lower `popQuad` first.
- **Nesting is the damage-efficient play**, since penalties don't compound down
  the tree. That points players at the entity-heavy direction that is uncapped.

## Tuning hooks

`window.BH` is exposed for balancing:

```js
BH.skipTo(900)        // jump the clock to 15:00
BH.levels(10)         // queue ten level-ups
BH.give('furiousOutburst', 2)  // grant runes to the inventory
BH.autoPlace()        // socket everything held, for balance runs
BH.spells()           // compiled summary of every spell
BH.setSpell(0, tree)  // inject a spell tree wholesale
BH.counts()           // live entity counts per pool
```

And for balance work, load `tools/focus-bench.js` in the page and run:

```js
await __bench({ crowd: true,  seconds: 8 })   // dps vs 130 packed targets
await __bench({ crowd: false, seconds: 8 })   // dps vs a single target
```

## Art

### Red is reserved

**Red means one thing: a projectile that is about to hit you.** Nothing else on
the play field may use it. The three shades live in `HOSTILE` in
[shots.js](src/shots.js) and every shooter in the game references them, so the
rule has a single source of truth rather than a convention people remember.

Shooters are told apart by **size and by the silhouette that fired them**, never
by hue — splitting the reds further would reintroduce exactly the ambiguity the
rule exists to remove.

Everything that used to be red was moved off it:

| Was red | Now | Why it had to move |
|---|---|---|
| brute body | indigo | a large moving red mass outshouts actual incoming fire |
| charger body | orange | sat at hue 18, close enough to crimson to blur |
| The Devourer | acid green | the biggest body on the field, and it fires red |
| heart pickup | green | small, round, bright — the exact profile of a shot |
| player hurt particles | white | sprayed outward and read as incoming shots |
| enemy health bars (critical) | orange | tiny, but they sit in the world |
| `Mend` upgrade | green | healing now reads as one colour everywhere |

**Deliberate exceptions, all fixed-position UI chrome that can never be mistaken
for a projectile:** the player's own health bar, the game-over title, and the
editor's error and over-budget text. If you want the rule applied literally
everywhere, the player health bar is `#hpfill` in `index.html` and is a one-line
change.

Orange is *not* reserved and stays available for fire and burn — the rule covers
saturated crimson through red-orange (hue 338-19 at >35% saturation).

```bash
node tools/check-red.mjs
```

scans every colour literal in `src/` and `index.html` and exits non-zero on
anything in that band outside the allowlist, so the rule is enforced rather than
remembered.

### How it is drawn

All procedural, generated in [textures.js](src/textures.js) by drawing into
offscreen canvases at startup. Masters are drawn **white** and coloured at
runtime via `sprite.tint`, which is what keeps the whole game inside a handful
of draw calls.

**Silhouette is the whole job.** These render between 15px and 100px across in
crowds of hundreds, so interior detail is wasted pixels — what makes a bat read
as a bat at 19px is its outline. Every archetype therefore gets its own closed
path, shaded with one shared volume gradient and rim light so the roster reads
as a family rather than a pile of styles:

| Silhouette | Used by |
|---|---|
| `bat` winged | swarmling, bat |
| `dart` swept arrow | runner |
| `lump` lobed sack | zombie |
| `wisp` hooded, tattered hem | ghost |
| `cluster` three fused pods | splitter |
| `sac` bulb with a spout | spitter |
| `mortar` flared cauldron | lobber |
| `shield` plated hexagon | warden |
| `horn` two forward horns | charger |
| `brute` small head, wide shoulders | brute |
| `rock` chipped, notched stone | golem |
| `boulder` fewer, larger faces | hulk |
| `crown` spiked star | boss |

Dark eyes survive tinting (multiply keeps near-black near-black), so they stay
legible whatever colour an archetype is; `glow` eyes invert that for the things
that should look lit from within.

Two lessons worth keeping:

- **A polygon whose points all sit near radius 1 is a circle with extra steps.**
  The first `rock` and `lump` passes read as plain circles at every size. Lobes
  have to swing between roughly 0.65 and 1.0 before the eye registers them.
- **Ground texture has to sit below the threshold where the eye can latch onto
  any single feature.** A first pass at the mottled tile was *worse* than flat —
  every blob became a landmark, so the tile repeat read as a grid of lighter
  squares scrolling past.

Sprite sizes derive from the hitbox (`r * 2.15`) rather than a per-type scale
factor, so art can be redrawn at any resolution without the sprite and the thing
you actually collide with drifting apart.

**Batching still holds**, and it is worth watching. Pixi's
`maxBatchableTextures` is 16, and each render layer batches independently.
Worst case per layer: **13** creature textures in `enemies`, **12** spell looks
in `proj`. Both fit, but neither has much room — four more silhouettes, or four
more spell looks, would split that layer into two draw calls. The fix at that
point is packing each set into one atlas rather than N separate textures.

### Spell effects

Spells got the same treatment, for the same reason: a fireball, an ice shard and
a boulder that are all the same capsule in three tints read as one spell you
recoloured. Each effect names a **look**, and a `LOOKS` table in `cast.js` says
how to draw it.

| Look | Form | Used by |
|---|---|---|
| `bolt` | chevron head, fading tail | the Projectile focus |
| `flame` | teardrop nose, trailing licks | Furious Outburst, Spiraling Rage |
| `ice` | hard-edged crystal splinter | Cruel Thorns, First Snow |
| `stone` | tumbling chunk of rock | Rolling Stone, Solid Defense |
| `lightning` | jagged forked arc | Fulgor's Sparks |
| `blade` | crescent, pointed at both tips | Flash of Swords |
| `wind` | tapering comma of air | Gust of Wind |
| `vortex` | drawn-in spiral | Perfect Storm |
| `shatter` | ring of outward shards | Shattering End |
| `shock` / `cone` / `aura` | ring, wedge, soft field | the Burst and Field focuses |

Orientation follows from the form. `aspect > 1` means the sprite is elongated
and **points along its heading** — a bolt, a flame, a lightning arc. `aspect === 1`
means it is round-ish and **tumbles** instead; a boulder or ice shard that stayed
axis-aligned would read as a sprite rather than a thing moving through the world.

Each look also carries its own alpha. That is not cosmetic: the vortex is a
persistent, screen-sized field, and at full brightness three overlapping
tornados whited out the entire play area.

The player is a slowly rotating faceted crystal, deliberately unlike anything in
the roster. XP gems are cut stones with real facets, and enemy fire is a bright
core inside a pulsing halo ring — a shape nothing else uses.

## Audio

Synthesised, not loaded. Every texture in this game is drawn into a canvas at
startup and the sound follows the same rule: no asset files, nothing to license,
and the static host stays a static host. Swapping a track for a real recording
means replacing its entry in `TRACKS` with a buffer source and leaving the rest
alone.

**Two tracks**, both electro: four-on-the-floor, an offbeat open hat, and a
sixteenth-note saw bass doing most of the work. The chords are held pads —
with a bassline that busy, anything more from the keys turns to mud.

| | main | boss |
|---|---|---|
| tempo | 124 | 142 |
| progression | i–VI–III–VII in A minor | i–VI–iv–V in D minor |
| kick | four on the floor | syncopated, so it never settles |
| lead | none | a repeating figure over the chord |

The boss track is the same machine wound tighter. It is driven from the boss's
**liveness**, checked once a frame, rather than hooked at each spawn and death
site — so a boss that dies, despawns off-screen, or is cleared by a restart all
land in the same place. Switching waits for the next bar, because cutting a
four-on-the-floor kick mid-bar is instantly audible as a mistake; at 124 BPM
that is under two seconds.

**Scheduling uses two clocks.** A coarse `setInterval` wakes often enough to
queue notes a little ahead, and the notes themselves are placed on the
AudioContext's own sample clock. Driving audio from the game loop would tie the
tempo to the frame rate and jitter audibly.

**Silence when the window is not in use.** `visibilitychange` alone is not
enough, and that was a real bug: it fires for tab switches, but alt-tabbing to
another application leaves the tab *visible*, so the music kept playing out of a
window nobody was looking at. Window `blur`/`focus` catches that, and `pagehide`
covers navigating away and mobile backgrounding, where an unload handler is not
guaranteed to run.

**Eight effects**: cast, hurt, pickup, level-up, chest, boss warning, boss
death, game over. Every one declares the closest together it may be heard, and
the frequent ones drift pitch a little per shot so repeats do not comb.

There is deliberately **no sound for a hit, a kill, or a freeze landing**. Those
are the three most frequent events in the game — a late run lands hundreds of
hits a second — and even gated they amounted to a constant tick under everything
that told the player nothing the damage numbers and the freeze burst had not
already shown. Removing them was a taste decision, not a performance one: node
creation barely moved (23 oscillators and 11 buffer sources a second, against 19
and 12 before), because the gating had already bounded them and the music is
what dominates.

Frame cost is 0.40 ms against 0.39 ms with no audio at all — the synthesis runs
off the main thread, and node creation is what the gating bounds.

Volume and a music toggle live top-right, persisted to `localStorage`; **M**
mutes. Audio starts on the character-select click, because a browser will not
open an AudioContext outside a user gesture.

**`?silent=1` opens no audio context at all** — no music, no effects, nothing to
clean up. Load the game that way when playtesting or capturing footage. Muting
through `setVolume` would be worse than useless for this, because it persists to
`localStorage` and would leave the player's own game muted the next time they
opened it.

## Not built yet

- Meta-progression: gold is tracked and shown on the results screen, but there is
  no persistent shop between runs.
- Gamepad and touch input.
- `On Expire`, `On Proximity`, `On Interval` trigger conditions.
- Boss-specific rewards. A boss currently drops the same chest any elite does,
  so beating one is worth no more than surviving one.
- Elements (statuses are the payload they would carry, so nothing is wasted).
- Blocking halos — the one Memory shape from the reference still needing new
  entity behaviour rather than new parameters. Trails, its pair, now exist as
  Destructive Path.
