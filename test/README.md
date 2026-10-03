# Rune compatibility suite

Answers one question, repeatably: **does every rune actually do something on
every spell it can be socketed into?**

```bash
npm test                 # drift guard, then the full matrix
npm run matrix           # full matrix, every pair printed
npm run test:matrix -- --rune=selfCentered     # one rune
npm run test:matrix -- --axis=focus            # skip the modifier-under-trigger axis
```

374 pairs, about eight seconds, no browser and no build step.

## How it runs the game without a browser

`src/pixi.js` re-exports PixiJS from a CDN. `test/hooks.mjs` is a Node
resolution hook that rewrites that one specifier to `test/stub/pixi.js`, a set
of inert property bags. Everything else — the spellbook, the compiler, the spell
runtime, damage, status — is **the shipping code, unmodified**. When a test says
a rune does nothing, it is `src/cast.js` that did nothing.

`test/world.mjs` boots the real pools and steps them at a fixed 60Hz. Two
departures from a live run, both so a measurement means one thing:

- **The crowd does not move.** `updateEnemies` is never called. A chasing crowd
  converges from every angle and hides any change in *where* a spell puts its
  damage.
- **`Math.random` is seeded.** Scatter, cone jitter and crit rolls are all
  random; unseeded, every comparison is noise against noise.

## What it measures

Each pair is run twice — bare, and with the rune socketed — and the two runs are
diffed on ~20 channels: damage, kills, entity counts, lifetime, distance from
the player, angular sweep, hits per entity, status stacks, and a positional
digest. Three seeds; a difference on any one counts.

A second diff compares the **compiled spell**. That is what makes the verdicts
explainable rather than a bare pass/fail:

| verdict | meaning |
|---|---|
| `works` | behaviour changed, and any channel the rune promises moved too |
| `partial` | behaviour changed, but not the channel it advertises |
| `inert` | the compiled spell changed, the world did not, **and this kind reads those keys** — a defect |
| `n/a` | same, but this kind never reads them (pierce on a burst) |
| `unseen` | the trigger's entities die inside the frame they spawn, so nothing could be watched |
| `no-op` | the rune compiles to an identical spell |

`expect.mjs` holds the judgement calls: which keys each kind reads
(`CONSUMES`), what each rune promises (`CLAIMS`), the worlds some runes need to
be measurable at all (`WORLD`), and the short list of verified exceptions
(`EXPECT`, each with a reason).

## Why the fixtures look the way they do

Most of the work in building this was discovering that a careless harness
reports confident nonsense. Each of these was a wrong answer first:

- **The crowd is a band, 55px to 430px.** A Field reaches 100px, a Burst 170, a
  Projectile 460. A crowd at one radius sits outside a Burst entirely, it deals
  no damage, and *every damage rune measures as inert on it*.
- **Health is a flat 25.** At natural scaled health, Burst and Field scored zero
  kills in the window, so every on-kill trigger looked broken on them.
- **Damage is read from an invulnerable crowd, kills from a killable one.** A
  killable crowd quantises damage to whole corpses: a real damage increase that
  does not move the kill count reads as exactly zero.
- **Triggers are detected by `trigFired`, not by looking for their entities.**
  An on-hit trigger casts into the body it just struck, so its projectiles are
  born and die inside one frame and frame-boundary sampling never sees them.
- **Positional runes get a chain above them.** Pressure Buildup multiplies by
  the number of runes above it, which is zero when it is the only child.
- **Conditional runes get their condition.** Frostbite pays out on Frozen
  targets; a bare spell applies none, so it measures as dead.

## Keeping it honest

`npm run test:consumes` greps `src/cast.js` for every flag the table claims is
read, and checks every flag the compiler can produce is classified. It has
already caught one unclassified flag. It runs first in `npm test`, because the
matrix's verdicts are only as good as that table.
