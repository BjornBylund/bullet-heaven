# Spell System — Design Spec

Status: **built**. This replaced the hardcoded weapon table (`src/weapons.js`,
now deleted) with a player-assembled spell system, modelled on the graph
spellcrafting of *Mages of Mystralia* (2017).

Implementation map: `focuses.js` `runes.js` `spell.js` (model + compiler)
`cast.js` (runtime) `spellbook.js` (ownership) `status.js` (debuffs)
`editor.js` (graph UI).

**Revision 2** reworked three things after the first playable build, guided by
the Memory cards of *Echoes of Mystralia*:

1. **Triggers became complete effects** rather than empty sockets hosting a
   nested Focus. See §3.
2. **Passive upgrade cards were cut** entirely. See §5.
3. **The editor became a node graph**, and modifiers can now read graph
   position. See §6.

**Revision 3** added link slots and drag-and-drop:

4. **Every node has a fixed number of links** — a Focus takes 3 children, a rune
   takes 2 — which turns the chain into a branching tree. See §2.2.
5. **Ownership separated from structure**: a modifier applies to the nearest
   Focus or Trigger *above* it, not to whatever it is physically linked to.
6. **The editor is drag-and-drop**, on pointer events rather than HTML5 DnD.

The centrepiece is **triggers**: a spell can fire another whole spell at a moment
in its own lifecycle. Everything else here exists to make that affordable and
legible.

---

## 1. Anatomy of a spell

A spell is a **tree of nodes** with exactly one root. Every node has the same
shape, so the structure is uniform:

```
Spell = { focus, children: [entry, ...] }      3 links
entry = { id, level, children: [...] }         2 links
```

```
              Projectile          Focus, 2/3 links used
             /              Piercing Eyes    Furious Outburst          trigger, 1/2 links
                          |
                     Heavy Hitter              tunes the TRIGGER, not the bolt
```

### Focus

The root. Decides **what kind of entity appears in the world**. Three of them:

| Focus | Behaviour | `Range` means |
|---|---|---|
| **Projectile** | spawns at caster, travels a vector | travel distance |
| **Burst** | resolves at a point, expanding outward | radius |
| **Field** | persists, ticks damage in a radius, follows caster | radius |

- Every spell has exactly one Focus.
- **Chosen on acquisition, never changed.** Runes come and go; the Focus is the
  commitment.
- Carries base stats: damage, cooldown, Range, projectile speed.

### Runes

Everything that is not the root, in two kinds:

- **Modifier** — changes the Focus or Trigger that owns it.
- **Trigger** — a complete effect with a condition, dealing a percentage of the
  damage of its owner. See §3.

Entities are created by the Focus and by triggers. A modifier never spawns
anything on its own, which is what keeps the worst-case entity count countable
from the tree alone.

## 2. Budgets

Two caps per spell, on deliberately different axes:

| Budget | Bounds | Starting value |
|---|---|---|
| **Nodes** | how many different things a spell does | 4 |
| **Attunement** | how hard it does them | 6 |

- Both apply to the **whole tree**, not just top-level nodes. Nesting therefore
  costs breadth automatically, with no extra rule.
- Rune costs are **0–3 Attunement**. A Focus costs 0.
- Runes additionally carry a **damage modifier** — see §2.1.
- **Attunement is a build-time budget, not a live resource.** Nothing is consumed
  at runtime; the spell fires on its cooldown forever. (A live mana pool was
  rejected: in a genre where the only input is movement, an invisible resource
  that silently gates your spells makes failure illegible.)
- **Both caps are global** — raising a cap raises it for *every* spell, including
  ones not yet acquired. This guarantees equal capacity across the loadout by
  construction, and means a spell acquired at 12:00 arrives at current cap rather
  than three upgrades behind. It also avoids dead level-up cards
  (`+1 Node on Spell 3` is worthless if Spell 3 is a throwaway).

### Spell slots

- Start with **1**, hard cap of **4**.
- `New Spell Slot` is a level-up card; taking it means **choosing a Focus**, so
  you immediately have a working spell rather than an empty canvas.
- New spells arrive as a **bare Focus** — no starter runes. Building it up is the
  point, and a starter kit would push every player toward the same builds.

**Worst-case envelope: 4 spells × 6 nodes.** This is the number entity pools are
designed against.

### 2.2 Link slots

Structure is constrained separately from budget. **A Focus accepts 3 children;
every rune accepts 2.** That is what makes the editor a graph rather than a list,
and it is a different axis from the socket and focus budgets:

- **Sockets** cap how many runes a spell holds in total.
- **Links** cap how they may be arranged.
- **Focus points** cap how heavy they are.

**Ownership is not structure.** A modifier applies to the nearest Focus or
Trigger *above* it — so a modifier hung under another modifier still tunes the
same Spell, while a Trigger claims its own subtree. This is the reference's
wording made literal: "relies on the base damage of the Spell or first Trigger
above."

The consequence is that where you hang a rune changes what it does. Moving
`Piercing Eyes` from under a trigger to under the Focus moves the pierce from
the trigger's fireballs to the bolt itself. That is the whole reason the graph
deserves screen space.

> Side effect worth noting: link slots made focus points bind. Before them a
> balance run filled every socket while focus sat slack at 2-5 of 6; with links
> limiting breadth, spells now hit 6/6 focus. The open question in §2.1 is
> weaker than it was.

### 2.1 Damage cost

Most runes **reduce the damage of the Focus they are attached to**, declared
per-rune alongside Attunement cost. This is a third cost axis, and it does a job
the other two cannot: nodes and Attunement are *capacity* costs, so once you have
room, filling it is strictly correct. A damage penalty is a *performance* cost,
which makes leaving a socket deliberately empty a legitimate play.

Two rules:

- **Multiplicative, not additive.** Six runes at −15% is ×0.38, not −90%.
- **Scoped to the Focus it attaches to.** Penalties do **not** compound down the
  tree. A nested Focus under a trigger starts at full damage and is reduced only
  by its own direct children.

That second rule exists because compounding penalties would make depth-3 trigger
chains do nothing, and elaborate trigger chains are the entire point of the
system. Deep trees stay viable; stacking five modifiers on a single Focus is what
gets taxed.

> Side effect to watch: this makes nesting the damage-efficient choice, which
> pushes players toward the entity-heavy direction we deliberately left uncapped
> (§3). Re-evaluate once playable.

> Open question: three simultaneous costs per rune (node, Attunement, damage) is
> a lot of tooltip. There is a real chance Attunement stops earning its place —
> if playtesting shows spells always fill to cap, **cut Attunement** and let the
> damage modifier be the sole price. It is the more legible of the two.

---

## 3. Triggers

A trigger is **a complete effect with a condition**, not a socket you have to
fill. Socketing one immediately does something.

```
Furious Outburst        Rare Trigger        3 focus
  Triggered on hit
  Casts 3/4/5 fireballs in random directions
  Damage 20% / 35% / 60%  -  Apply 1/2/3 Burn
```

**A trigger deals a percentage of the damage of the node above it.** That single
rule is what makes chains interesting: a trigger under a heavily-modified Spell
inherits that investment, and a trigger under another trigger compounds off it.

The original design had triggers as bare conditions hosting a nested Focus. It
worked, but placing one produced nothing until you also built out its interior,
which made the centrepiece mechanic feel like plumbing. Folding the effect into
the trigger removed a whole placement step and gave every trigger a name and a
character.

Modifiers socketed **beneath** a trigger shape that trigger's cast, not the
parent's.

| Condition | Fires when |
|---|---|
| **On Cast** | the parent is created |
| **On Hit** | the parent damages anything |
| **On Kill** | the parent's damage kills |
| **On Distance** | the parent has travelled 60% of Range |

Individual triggers are defined in `runes.js`; that table is the source of
truth, not this document.

### Rules

- **Depth cap 3.** A hard structural rule, not a budget. It is the only
  structural limit on cascade size.
- **Triggers never consume the parent.**
- **No cast cap** - On Hit fires on every pierce hit, On Kill on every kill in an
  AoE. `CFG.spell.triggerCap` turns a per-activation cap on (0 = off).
- **Sub-spells inherit transform, not runes.**
- **A trigger costs one node**, since it no longer brings a nested Focus.

### Deferred

`On Expire`, `On Proximity`, `On Interval`.

## 4. Range

**Range is a universal Focus stat** meaning *reach*, interpreted per Focus (see
table in §1). It **replaces lifetime** for projectiles.

Why: a player can *see* where their spell dies and reason about it. Nobody can
see `life: 2.2`. It also collapses four unrelated stats (`life`, and three
different `radius` fields in the current `weapons.js`) into one, which makes
`Reach` a rune that helps every build.

`On Distance` fires at a **fraction** of max Range (60%), not an absolute number.
This keeps runes parameterless — no sliders, no per-rune settings — while still
giving full control, since you tune the detonation point by changing Range.

Supersedes the existing `p.stats.area` multiplier in `player.js`.

---

## 5. Progression

**There are no passive upgrade cards.** They were cut because the level-up
screen was cluttered and half of it was stat filler.

That removed the thing carrying the damage curve, so two changes were needed:

1. **Enemy scaling came down.** The old curve was `1 + 0.5m + 0.035m²`, about
   **25x** by minute 20 - tuned for six weapons plus stacking passive
   multipliers. It is now `1 + 0.32m + 0.016m²`, about **11x**, which a
   spell-only build can actually meet.

2. **Levels grant stats automatically**, with no card
   (`CFG.levelGrowth`): max health, a small damage ramp, and a little crit per
   level. Without this the player never gains health while enemy contact damage
   keeps scaling, and gets one-shot in the back half of a run.

The build's power then comes from three places, all of them spell content:

- **Rune tier** - Common / Rare / Epic. Tier weighting ramps with elapsed time
  in `upgrades.js`, so Epics are scarce early and routine late. This is the main
  power curve.
- **Rune level** - 1 to 3, with numbers that step hard (20% -> 35% -> 60%)
  rather than creeping. Levelling consumes another copy of the same rune and
  costs +1 focus, no extra socket.
- **Capacity** - `Expand` (+1 socket for every spell) and `Attune` (+2 focus for
  every spell) remain as cards.

> Measured after the change: a hands-off run reached level 29 by minute 10 with
> all four spells full at 6 sockets and six triggers across the book, holding the
> swarm at 200-280 enemies. Sockets were the binding constraint in every spell
> (6/6 used) while focus sat slack at 2-5 of 6 - see the open question in §2.1.

## 6. Acquisition and editing

- **Level-up cards grant runes to an inventory** in one click. The card screen
  is unchanged and stays fast; a graph editor every ~20s would wreck the pacing.
- **The editor opens on demand** (E) and pauses the game.
- **Freely re-editable while paused.** Scarcity is which runes you own, not
  where you put them.
- **Nag indicator** on the HUD when runes are unplaced.
- **The first level-up offer guarantees a trigger.**

### The graph

The editor draws the spell as a tidy tree: the Focus at the top, children fanned
out beneath it, each parent centred over the span of its children. Free link
slots are drawn as dashed empty sockets, so spare capacity is visible in the
shape itself. Selecting a node shows a card with its tier, trigger condition,
live computed stats, and which Focus or Trigger it actually acts on.

### Drag-and-drop

- **Inventory → node** links the rune under that node.
- **Node → node** relinks a subtree, carrying its children with it.
- **Node → inventory** takes it off and reclaims the whole subtree.

Dropping onto a *node* links beneath it, so the target is a full-size hexagon
rather than a small socket. Valid targets light up the instant a drag begins,
and refusals name their reason ("No free links (2 max)").

Built on **pointer events, not HTML5 drag-and-drop**. Native DnD brings an OS
drag image, inconsistent cursors, and a drop pipeline that is hard to drive or
test; pointer events give a ghost we control, behave identically everywhere, and
work with touch. Click-to-select remains as a fallback.

**Position is mechanical, not decorative.** Positional modifiers read the graph:

- `Pressure Buildup` - damage per rune **above** it in its chain.
- `Empty Stomach` - damage per **empty socket** left in the spell.

These are why the graph earns its screen space. Without them the layout would be
a rendering choice; with them, where you put a rune is part of the build.

## 7. Debuffs

No element system. Status effects instead, applied by runes.

**Every status defines its own stacking semantics.** There is no global model.

| Status | Stacks | Effect |
|---|---|---|
| **Chill** | to 20 | slows, scaling with stacks; **at 20 → Freeze**, consuming all stacks |
| **Burn** | yes | damage over time, scaling with stacks |
| **Weaken** | TBD | reduces enemy contact damage |
| **Brittle** | tight cap | increases damage taken (multiplies everything — needs a short leash) |

### Rules

- **Decay is drain-based**: stacks fall off one at a time at a fixed rate once
  application stops. Stored per enemy per status as `stacks` (int) +
  `nextDecay` (float). 1,500 enemies × 5 statuses ≈ 15k values — negligible
  next to the separation pass.
  - *Cliff decay* (all stacks vanish at once) was rejected: 19 → 0 in one frame
    feels terrible and makes thresholds feel arbitrary.
  - *Per-stack timers* are unaffordable (1,500 × 20 = 30k live timers).
  - Drain creates a **race** between your application rate and the drain rate, so
    "can I reach freeze?" is a real question about your build.
- **Effects scale linearly with stacks; thresholds are a bonus on top.** 10 chill
  stacks slow more than 1. Every status is useful from stack one.
- **Stack caps are per-status**, and are the primary tuning lever.

### Rule: no directly-applied hard CC

**Hard crowd control is only ever reached through a stack threshold.** A directly
applicable Stun rune is degenerate in this genre — one `Field + Stun` re-stuns
everything faster than the duration expires and the screen locks permanently.
Freeze-via-chill-accumulation is self-regulating: reaching 20 takes sustained
output, and consuming the stacks resets the clock.

### Notes

- `enemy.js` already has `slow` and `damageEnemy` already accepts a `slow`
  option — Chill is nearly free.
- **Burn must not spawn a damage number per tick.** A DoT on 400 burning enemies
  would blow past the 40-floater cap in `fx.js` and turn the screen to noise.
  Tick on a fixed interval (~0.5s) and suppress numbers, or show only the
  killing tick.
- Bosses and elites should be immune to Freeze.

---

## 8. Runes

Two kinds only: **Trigger** and **Modifier**. Every rune has a tier
(Common/Rare/Epic), 0-3 focus points, and three levels.

`runes.js` is the source of truth. It currently holds 11 triggers and 22
modifiers, adapted from the Memory cards of *Echoes of Mystralia*.

Modifier shapes worth noting, because they are what makes chains differ:

- **Spawn patterns** - `Frenetic Energy` (cone), `Stars Aligned` (line),
  `Back-and-Forth` (scattered), `Self-Centered` (orbiting), `Destructive Path`
  (burning trail), `Return`.
- **Debuff conditionals** - `Frostbite` (vs frozen), `Deep Freeze` (vs chilled),
  `Burned to Death` (crit vs burning).
- **Positional** - `Pressure Buildup`, `Empty Stomach` (see §6).

### Rule: conditional damage keys off a debuff, nothing else

Health-threshold conditionals (`Executioner`, `Fury of Despair`), target-size
scaling (`Giant Slayer`), distance-travelled scaling (`Momentum`) and the
on-kill payoffs (`Vampiric`, `Overkill`, `Cull`) were all built and then cut.

They worked, but each one was a separate hidden rule the player had to hold in
their head while reading a damage number. Restricting conditionals to statuses
means every bonus traces back to something the player deliberately applied and
can see on the enemy.

### Compatibility

**Every rune fits every Focus.** Focus-locking was tried and removed: it forced
the offer pool to be filtered, still produced dead cards, and narrowed the build
space for no gain.

## 9. Character select

Three characters, one per Focus. **Starting Focus only** — no starter runes, no
stat tilt. A bare Focus is already a working spell.

---

## 10. Migration from the current code

The six weapons in `weapons.js` dissolve into Focus + rune combinations:

| Today | Becomes |
|---|---|
| Arcane Bolt | `Projectile` |
| Storm Coil | `Projectile` + Chain |
| Frost Nova | `Burst` + Chill |
| Crescent | `Burst` + Cone |
| Ember Aura | `Field` |
| Orbit Blades | `Field` + Orbit |

> Known cost: the current weapons' feel is bespoke — hand-tuned knockback, sweep
> timing, the lightning polyline. Rebuilt as generic combinations they will be
> mechanically equivalent and may feel flat. Recovering that means giving runes
> their own visual and audio identity, not just a stat delta.

What survives unchanged:
- `Pool`, `Grid`, the fixed-timestep loop, camera, culling — all of it.
- `enemy.cds[]` already does per-source hit cooldowns, which nested persistent
  spells need.
- `passives.js` survives as the quantitative curve (with the two changes in §5).
- The four-card level-up screen in `ui.js`.

---

## 11. Deferred

- Per-activation trigger cast cap (single number, no redesign).
- Global per-frame spawn ceiling.
- `On Expire`, `On Proximity`, `On Interval`.
- Intensity-stacking refinements; `Brittle`/`Weaken` numbers.
- Elements. Statuses are exactly the payload they would carry, so nothing is
  wasted if they return.
- An `Echo` rune that casts another equipped spell (needs cycle detection).
- Meta-progression between runs.
