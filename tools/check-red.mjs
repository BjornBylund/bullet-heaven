// Enforces the reserved-colour rule: red belongs to enemy projectiles alone.
//
// Scans every colour literal in src/ and index.html and fails on any that lands
// in the reserved band outside the allowlist below. The rule is easy to state
// and easy to break by accident -- a new enemy given a "nice warm red" costs the
// player the one signal they have to read instantly -- so it is checked rather
// than remembered.
//
//   node tools/check-red.mjs
//
// Exits non-zero on a violation, so it can gate a commit.

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The reserved band: saturated crimson through red-orange. Orange (burn, fire,
// the charger) sits above hue 19 and is deliberately still available.
const HUE_FROM = 338;
const HUE_TO = 19;
const MIN_SAT = 0.35;

// Fixed-position UI chrome. None of it can be mistaken for a projectile: it
// never moves, never appears on the play field, and is always present.
const ALLOW = [
  ['index.html', '#hpfill'],          // the player's own health bar
  ['index.html', '#gameover'],        // results screen title
  ['index.html', '#edstats'],         // editor, over budget
  ['index.html', '#edmsg'],           // editor, error text
  ['src/ui.js', 'gotitle'],           // sets the results title colour
];

function hueSat(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

const isReserved = (hex) => {
  const { h, s, l } = hueSat(hex);
  // very dark and very light shades are structural (shadows, highlights) and
  // carry no hue signal at gameplay size
  return s > MIN_SAT && l > 0.12 && l < 0.92 && (h >= HUE_FROM || h < HUE_TO);
};

const files = [
  ...readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => join('src', f)),
  'index.html',
];

const violations = [];
for (const rel of files) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  // The reserved palette is declared as a block, so its members sit on lines
  // that never name it -- track the block rather than matching line by line.
  let inPalette = false;
  text.split('\n').forEach((line, i) => {
    if (/export const HOSTILE\s*=/.test(line)) inPalette = true;
    else if (inPalette && /^\};/.test(line)) inPalette = false;

    for (const m of line.matchAll(/0x([0-9a-fA-F]{6})\b|#([0-9a-fA-F]{6})\b/g)) {
      const hex = parseInt(m[1] || m[2], 16);
      if (!isReserved(hex)) continue;
      if (inPalette) continue;
      const allowed = ALLOW.some(([f, marker]) => rel.endsWith(basename(f)) && line.includes(marker));
      if (allowed) continue;
      violations.push({ rel, line: i + 1, token: m[0], hue: Math.round(hueSat(hex).h), src: line.trim() });
    }
  });
}

if (violations.length === 0) {
  console.log('OK - red is reserved for enemy projectiles');
  process.exit(0);
}

console.error(`${violations.length} colour(s) in the reserved red band:\n`);
for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}  ${v.token} (hue ${v.hue})`);
  console.error(`      ${v.src.slice(0, 90)}`);
}
console.error('\nRed belongs to enemy projectiles (HOSTILE in src/shots.js).');
console.error('Move this to another hue, or add it to ALLOW in tools/check-red.mjs');
console.error('if it is fixed-position UI that cannot be mistaken for a projectile.');
process.exit(1);
