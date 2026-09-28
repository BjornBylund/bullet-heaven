import * as PIXI from './pixi.js';
import { TAU } from './util.js';

/**
 * Procedural art.
 *
 * Everything is drawn once into an offscreen 2D canvas and uploaded as a GPU
 * texture, so it batches exactly like a real spritesheet. Masters are drawn
 * WHITE and coloured at runtime via sprite.tint, which is what keeps the whole
 * game inside a handful of draw calls no matter how many entities are up.
 *
 * SILHOUETTE IS THE WHOLE JOB. These render between 14px and 100px across, in
 * crowds of hundreds, so interior detail is wasted pixels -- what makes a bat
 * read as a bat at 18px is its outline. Every creature is therefore a distinct
 * closed path, shaded with one volume gradient and a rim light, and nothing
 * relies on detail that survives only at full size.
 */

function cvs(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

const tex = (canvas) => {
  const t = PIXI.Texture.from(canvas);
  t.source.scaleMode = 'linear';
  return t;
};

// ---------------------------------------------------------------------------
// creatures
// ---------------------------------------------------------------------------

const CREATURE = 112;   // drawn large, downscaled per enemy radius at runtime

/**
 * Shared creature rendering. `draw(g, r)` lays down a closed silhouette in
 * centred coordinates; everything else -- volume, rim light, eyes -- is common
 * so the roster reads as one family of things rather than a pile of styles.
 */
function creature(draw, opts) {
  const o = opts || {};
  const S = CREATURE;
  const [c, g] = cvs(S, S);
  g.translate(S / 2, S / 2);
  const r = S / 2 - 5;

  g.beginPath();
  draw(g, r);
  g.closePath();

  // light from upper-left, so a crowd of these reads as lit from one direction
  const grd = g.createRadialGradient(-r * 0.34, -r * 0.40, r * 0.06, 0, 0, r * 1.18);
  grd.addColorStop(0.00, 'rgba(255,255,255,1)');
  grd.addColorStop(0.40, 'rgba(228,228,228,1)');
  grd.addColorStop(0.78, 'rgba(132,132,132,1)');
  grd.addColorStop(1.00, 'rgba(72,72,72,1)');
  g.fillStyle = grd;
  g.fill();

  g.lineJoin = 'round';
  g.lineWidth = o.line || 3.5;
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.stroke();

  if (o.eyes) drawEyes(g, r, o.eyes);
  return c;
}

/**
 * Dark eyes survive tinting (multiply keeps near-black near-black), so they
 * stay legible whatever colour the archetype is. `glow` inverts that for the
 * things that should look lit from within.
 */
function drawEyes(g, r, e) {
  const x = e.x === undefined ? 0.30 : e.x;
  const y = e.y === undefined ? -0.14 : e.y;
  const rad = e.rad === undefined ? 0.13 : e.rad;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(side * r * x, r * y, r * rad, 0, TAU);
    g.fillStyle = e.glow ? 'rgba(255,255,255,0.95)' : 'rgba(22,22,26,0.88)';
    g.fill();
    if (!e.glow) {
      g.beginPath();
      g.arc(side * r * x - r * 0.035, r * y - r * 0.04, r * rad * 0.34, 0, TAU);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fill();
    }
  }
}

// --- silhouettes -----------------------------------------------------------

/** Winged, swept back. The chaff of the roster. */
const batShape = (g, r) => {
  g.moveTo(-r * 0.14, -r * 0.08);
  g.quadraticCurveTo(-r * 0.78, -r * 0.82, -r * 0.99, r * 0.02);
  g.quadraticCurveTo(-r * 0.62, -r * 0.06, -r * 0.44, r * 0.30);
  g.quadraticCurveTo(-r * 0.30, r * 0.08, -r * 0.17, r * 0.38);
  g.quadraticCurveTo(0, r * 0.74, r * 0.17, r * 0.38);
  g.quadraticCurveTo(r * 0.30, r * 0.08, r * 0.44, r * 0.30);
  g.quadraticCurveTo(r * 0.62, -r * 0.06, r * 0.99, r * 0.02);
  g.quadraticCurveTo(r * 0.78, -r * 0.82, r * 0.14, -r * 0.08);
  g.quadraticCurveTo(r * 0.20, -r * 0.66, 0, -r * 0.70);
  g.quadraticCurveTo(-r * 0.20, -r * 0.66, -r * 0.14, -r * 0.08);
};

/** Swept dart. Reads as speed even at 20px. */
const dartShape = (g, r) => {
  g.moveTo(0, -r * 1.0);
  g.lineTo(r * 0.60, r * 0.30);
  g.lineTo(r * 0.24, r * 0.16);
  g.lineTo(0, r * 0.80);
  g.lineTo(-r * 0.24, r * 0.16);
  g.lineTo(-r * 0.60, r * 0.30);
};

/**
 * Smooth closed blob through points at varying radius. A first pass used a
 * gentle sine wobble and read as a plain circle at every size -- the lobes have
 * to swing between roughly 0.65 and 1.0 before the eye registers them at all.
 */
function lobes(g, r, radii) {
  const n = radii.length;
  const pt = (i) => {
    const a = ((i % n) / n) * TAU - Math.PI / 2;
    return [Math.cos(a) * r * radii[i % n], Math.sin(a) * r * radii[i % n]];
  };
  const mid = (i) => {
    const [x1, y1] = pt(i), [x2, y2] = pt(i + 1);
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  };
  const [sx, sy] = mid(n - 1);
  g.moveTo(sx, sy);
  for (let i = 0; i < n; i++) {
    const [cx, cy] = pt(i);
    const [nx, ny] = mid(i);
    g.quadraticCurveTo(cx, cy, nx, ny);
  }
}

/** Lumpy sack of a thing. Pronounced lobes, never a circle. */
const lumpShape = (g, r) => lobes(g, r, [1.0, 0.68, 0.94, 0.66, 1.02, 0.72, 0.9, 0.64]);

/** Hooded wisp with a tattered hem. */
const wispShape = (g, r) => {
  g.moveTo(-r * 0.80, r * 0.06);
  g.quadraticCurveTo(-r * 0.88, -r * 0.98, 0, -r * 0.95);
  g.quadraticCurveTo(r * 0.88, -r * 0.98, r * 0.80, r * 0.06);
  g.lineTo(r * 0.62, r * 0.60);
  g.lineTo(r * 0.40, r * 0.20);
  g.lineTo(r * 0.19, r * 0.68);
  g.lineTo(0, r * 0.24);
  g.lineTo(-r * 0.19, r * 0.68);
  g.lineTo(-r * 0.40, r * 0.20);
  g.lineTo(-r * 0.62, r * 0.60);
};

/** Three fused pods -- visibly something that is going to come apart. */
const clusterShape = (g, r) => {
  g.moveTo(0 + r * 0.52, -r * 0.34);
  g.arc(0, -r * 0.34, r * 0.52, 0, TAU);
  g.moveTo(-r * 0.38 + r * 0.54, r * 0.36);
  g.arc(-r * 0.38, r * 0.36, r * 0.54, 0, TAU);
  g.moveTo(r * 0.38 + r * 0.54, r * 0.36);
  g.arc(r * 0.38, r * 0.36, r * 0.54, 0, TAU);
};

/** Bulb with a spout. Reads as something that spits. */
const sacShape = (g, r) => {
  g.moveTo(-r * 0.19, -r * 0.52);
  g.lineTo(-r * 0.13, -r * 0.98);
  g.lineTo(r * 0.13, -r * 0.98);
  g.lineTo(r * 0.19, -r * 0.52);
  g.quadraticCurveTo(r * 0.96, -r * 0.30, r * 0.80, r * 0.34);
  g.quadraticCurveTo(r * 0.48, r * 0.98, 0, r * 0.94);
  g.quadraticCurveTo(-r * 0.48, r * 0.98, -r * 0.80, r * 0.34);
  g.quadraticCurveTo(-r * 0.96, -r * 0.30, -r * 0.19, -r * 0.52);
};

/** Flared cauldron: wide mouth, narrow base. Artillery. */
const mortarShape = (g, r) => {
  g.moveTo(-r * 0.98, -r * 0.58);
  g.lineTo(-r * 0.74, -r * 0.30);
  g.lineTo(r * 0.74, -r * 0.30);
  g.lineTo(r * 0.98, -r * 0.58);
  g.lineTo(r * 0.78, r * 0.18);
  g.quadraticCurveTo(r * 0.56, r * 0.92, 0, r * 0.94);
  g.quadraticCurveTo(-r * 0.56, r * 0.92, -r * 0.78, r * 0.18);
};

/** Plated hexagon. Armour. */
const shieldShape = (g, r) => {
  g.moveTo(0, -r);
  g.lineTo(r * 0.90, -r * 0.50);
  g.lineTo(r * 0.90, r * 0.44);
  g.lineTo(0, r * 0.98);
  g.lineTo(-r * 0.90, r * 0.44);
  g.lineTo(-r * 0.90, -r * 0.50);
};

/**
 * Horned ram: two forward horns on a rounded body. Deliberately top-heavy and
 * asymmetric, because a radially symmetric spiked shape reads as the boss.
 */
const hornShape = (g, r) => {
  g.moveTo(0, -r * 0.26);
  g.lineTo(-r * 0.40, -r * 0.98);
  g.lineTo(-r * 0.64, -r * 0.26);
  g.quadraticCurveTo(-r * 0.98, r * 0.14, -r * 0.54, r * 0.76);
  g.quadraticCurveTo(0, r * 1.02, r * 0.54, r * 0.76);
  g.quadraticCurveTo(r * 0.98, r * 0.14, r * 0.64, -r * 0.26);
  g.lineTo(r * 0.40, -r * 0.98);
};

/** Broad shouldered slab of muscle: small head, wide deltoids. */
const bruteShape = (g, r) => {
  g.moveTo(-r * 0.30, -r * 0.56);
  g.quadraticCurveTo(0, -r * 1.04, r * 0.30, -r * 0.56);
  g.lineTo(r * 0.68, -r * 0.74);
  g.quadraticCurveTo(r * 1.04, -r * 0.26, r * 0.84, r * 0.26);
  g.quadraticCurveTo(r * 0.60, r * 0.94, 0, r * 0.88);
  g.quadraticCurveTo(-r * 0.60, r * 0.94, -r * 0.84, r * 0.26);
  g.quadraticCurveTo(-r * 1.04, -r * 0.26, -r * 0.68, -r * 0.74);
};

/**
 * Chipped stone. Radii swing from 0.5 to 1.0 so the outline has genuine corners
 * and notches -- a polygon whose points all sit near radius 1 is just a circle
 * with extra steps, which is exactly how the first version read.
 */
const rockShape = (g, r) => {
  const pts = [
    [0.06, -1.0], [0.70, -0.66], [0.52, -0.16], [1.0, 0.18], [0.50, 0.78],
    [-0.08, 0.58], [-0.42, 0.98], [-0.84, 0.32], [-0.56, -0.12], [-0.94, -0.56],
    [-0.32, -0.70],
  ];
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r)));
};

/** Massive boulder: fewer, larger faces than `rock`, so the two read apart. */
const boulderShape = (g, r) => {
  const pts = [
    [0.0, -1.0], [0.88, -0.48], [0.62, 0.12], [0.96, 0.40],
    [0.26, 0.98], [-0.52, 0.88], [-0.34, 0.24], [-1.0, 0.16], [-0.74, -0.62],
  ];
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r)));
};

/**
 * BOSS SILHOUETTES.
 *
 * Each boss gets a shape no ordinary enemy uses. A boss wearing the same
 * outline as chaff is just a big chaff, and in a field of three hundred bodies
 * outline is the only channel left -- colour is already spoken for by status
 * effects and the white wind-up flash.
 *
 * These three are built on different primitives on purpose: radial spikes,
 * bilateral armour plating, and a broken ring. No two read alike at a glance.
 */

/** Armoured tower: flared pauldrons over a heavy tapering base. */
const warlordShape = (g, r) => {
  const pts = [
    [0.0, -1.0], [0.22, -0.72], [0.82, -0.66], [1.0, -0.20], [0.66, -0.06],
    [0.50, 0.34], [0.74, 0.92], [-0.74, 0.92], [-0.50, 0.34],
    [-0.66, -0.06], [-1.0, -0.20], [-0.82, -0.66], [-0.22, -0.72],
  ];
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r)));
};

/**
 * A gaping maw: a heavy body with a toothed wedge bitten out of the leading
 * edge. The broken outline is what distinguishes it -- every other creature in
 * the game is a closed convex-ish blob.
 */
const mawShape = (g, r) => {
  const pts = [
    [1.0, -0.42],                                                  // upper jaw tip
    [0.80, -0.34], [0.86, -0.22], [0.55, -0.20], [0.62, -0.10],    // upper teeth
    [0.20, -0.05],                                                 // throat
    [0.62, 0.10], [0.55, 0.20], [0.86, 0.22], [0.80, 0.34],        // lower teeth
    [1.0, 0.42],                                                   // lower jaw tip
    [0.72, 0.72], [0.10, 0.98], [-0.60, 0.80], [-0.98, 0.20],      // body
    [-0.86, -0.46], [-0.30, -0.96], [0.44, -0.84],
  ];
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r)));
};

/** Spiked crown. Boss only. */
const crownShape = (g, r) => {
  const spikes = 8;
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
    const rad = i % 2 ? r * 0.60 : r;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
};

function buildCreatures() {
  return {
    bat:     tex(creature(batShape, { eyes: { x: 0.14, y: -0.40, rad: 0.09 } })),
    dart:    tex(creature(dartShape, { eyes: { x: 0.16, y: -0.28, rad: 0.10 }, line: 3 })),
    lump:    tex(creature(lumpShape, { eyes: { x: 0.30, y: -0.16, rad: 0.14 } })),
    wisp:    tex(creature(wispShape, { eyes: { x: 0.26, y: -0.34, rad: 0.13, glow: true } })),
    cluster: tex(creature(clusterShape, { eyes: { x: 0.20, y: -0.38, rad: 0.10 } })),
    sac:     tex(creature(sacShape, { eyes: { x: 0.28, y: 0.12, rad: 0.13 } })),
    mortar:  tex(creature(mortarShape, { eyes: { x: 0.30, y: 0.22, rad: 0.12 } })),
    shield:  tex(creature(shieldShape, { eyes: { x: 0.30, y: -0.04, rad: 0.12, glow: true }, line: 4 })),
    horn:    tex(creature(hornShape, { eyes: { x: 0.24, y: 0.16, rad: 0.11 } })),
    brute:   tex(creature(bruteShape, { eyes: { x: 0.32, y: -0.10, rad: 0.14 } })),
    rock:    tex(creature(rockShape, { line: 4 })),
    boulder: tex(creature(boulderShape, { line: 4.5 })),
    crown:   tex(creature(crownShape, { eyes: { x: 0.26, y: -0.06, rad: 0.13, glow: true }, line: 4 })),
    // boss-only outlines. Takes the enemy layer to 15 textures, still inside
    // Pixi's 16-per-batch limit -- anything more needs a second layer.
    // eyes need a non-zero x: drawEyes mirrors across +/-x, so x:0 stacks both
    // pupils in one spot and the thing comes out cyclopean
    warlord: tex(creature(warlordShape, { eyes: { x: 0.26, y: -0.34, rad: 0.13 }, line: 5 })),
    maw:     tex(creature(mawShape, { eyes: { x: -0.34, y: -0.40, rad: 0.14, glow: true }, line: 5 })),
  };
}

// ---------------------------------------------------------------------------
// player, pickups, projectiles
// ---------------------------------------------------------------------------

/** The player: a faceted crystal, so it never reads as one of the enemies. */
function mageCanvas(size = 96) {
  const [c, g] = cvs(size, size);
  const r = size / 2 - 4;
  g.translate(size / 2, size / 2);

  const facets = (rad) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad * 1.08;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  };

  facets(r);
  const grd = g.createLinearGradient(-r, -r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(206,206,206,1)');
  grd.addColorStop(1, 'rgba(250,250,250,1)');
  g.fillStyle = grd;
  g.fill();
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.stroke();

  // inner facet, bright, so the core reads as lit
  facets(r * 0.46);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill();

  // facet seams
  g.lineWidth = 1.6;
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46 * 1.08);
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 1.08);
    g.stroke();
  }
  return c;
}

/** Cut gem for XP. Proper facets rather than a flat diamond. */
function gemCanvas(w = 44, h = 58) {
  const [c, g] = cvs(w, h);
  const cx = w / 2;
  const topY = h * 0.03, girdle = h * 0.36, botY = h * 0.97;
  const halfW = w * 0.47;

  const face = (pts, fill) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };

  // crown
  face([[cx, topY], [cx + halfW, girdle], [cx, girdle * 0.82], [cx - halfW, girdle]],
       'rgba(255,255,255,1)');
  // pavilion, split so the two halves catch light differently
  face([[cx - halfW, girdle], [cx, girdle * 0.82], [cx, botY]], 'rgba(198,198,198,1)');
  face([[cx + halfW, girdle], [cx, girdle * 0.82], [cx, botY]], 'rgba(238,238,238,1)');
  // table highlight
  face([[cx, topY], [cx + halfW * 0.42, girdle * 0.72], [cx, girdle * 0.62],
        [cx - halfW * 0.42, girdle * 0.72]], 'rgba(255,255,255,0.95)');

  g.lineJoin = 'round';
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.moveTo(cx, topY);
  g.lineTo(cx + halfW, girdle);
  g.lineTo(cx, botY);
  g.lineTo(cx - halfW, girdle);
  g.closePath();
  g.stroke();
  return c;
}

/** Projectile body: sharp head, soft tail, drawn pointing +X. */
function boltCanvas(w = 72, h = 22) {
  const [c, g] = cvs(w, h);
  const mid = h / 2;
  g.beginPath();
  g.moveTo(w, mid);                                   // nose
  g.quadraticCurveTo(w * 0.62, 0, w * 0.34, mid * 0.42);
  g.lineTo(0, mid * 0.92);
  g.lineTo(0, mid * 1.08);
  g.lineTo(w * 0.34, mid * 1.58);
  g.quadraticCurveTo(w * 0.62, h, w, mid);
  g.closePath();

  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0.00, 'rgba(255,255,255,0)');
  grd.addColorStop(0.40, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.86, 'rgba(255,255,255,1)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0.9)');
  g.fillStyle = grd;
  g.fill();
  return c;
}

/** Shaded sphere. Still needed for orbs, drops and round spell effects. */
function blobCanvas(size = 96) {
  const [c, g] = cvs(size, size);
  const r = size / 2;
  const grd = g.createRadialGradient(r * 0.70, r * 0.62, r * 0.06, r, r, r);
  grd.addColorStop(0.00, 'rgba(255,255,255,1)');
  grd.addColorStop(0.44, 'rgba(220,220,220,1)');
  grd.addColorStop(0.86, 'rgba(122,122,122,1)');
  grd.addColorStop(1.00, 'rgba(68,68,68,1)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(r, r, r - 2, 0, TAU); g.fill();
  g.lineWidth = 2.6;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.beginPath(); g.arc(r, r, r - 2.5, 0, TAU); g.stroke();
  return c;
}

function glowCanvas(size = 64) {
  const [c, g] = cvs(size, size);
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Shockwave ring, soft on both edges so scaling never looks hard. */
function ringCanvas(size = 160) {
  const [c, g] = cvs(size, size);
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, r * 0.58, r, r, r);
  grd.addColorStop(0.00, 'rgba(255,255,255,0)');
  grd.addColorStop(0.52, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.80, 'rgba(255,255,255,1)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(r, r, r, 0, TAU); g.fill();
  return c;
}

/** Melee sweep: a crescent centred on +X, fading toward both tips. */
function arcCanvas(size = 192, spread = 1.15) {
  const [c, g] = cvs(size, size);
  const r = size / 2;
  const steps = 56;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const a0 = -spread + t0 * spread * 2;
    const a1 = -spread + t1 * spread * 2;
    const fade = Math.sin(t0 * Math.PI);
    g.beginPath();
    g.arc(r, r, r - 2, a0, a1);
    g.arc(r, r, r * 0.50, a1, a0, true);
    g.closePath();
    g.fillStyle = `rgba(255,255,255,${(0.24 + 0.76 * fade).toFixed(3)})`;
    g.fill();
  }
  return c;
}

/** Four-point star for impact sparks. */
function sparkCanvas(size = 24) {
  const [c, g] = cvs(size, size);
  const r = size / 2;
  g.translate(r, r);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const rad = i % 2 === 0 ? r - 1 : r * 0.24;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.closePath(); g.fill();
  return c;
}

/** Flat bar with softened ends, scaled into enemy health bars. */
function barCanvas(w = 64, h = 8) {
  const [c, g] = cvs(w, h);
  const r = h / 2;
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  g.moveTo(r, 0);
  g.lineTo(w - r, 0);
  g.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(r, h);
  g.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
  g.closePath();
  g.fill();
  return c;
}

/**
 * Seamless ground tile: grid, speckles, and a very faint mottle so large empty
 * stretches are not flat. Deterministic, so it is stable across reloads.
 *
 * The mottle is kept near-invisible on purpose. A first pass used larger, more
 * opaque blobs and the result was worse than flat: every blob became a landmark,
 * which made the tile repeat read as a grid of lighter squares scrolling past.
 * Texture on a tiling ground has to sit below the threshold where the eye can
 * latch onto any individual feature.
 */
function groundCanvas(size = 192) {
  const [c, g] = cvs(size, size);
  g.fillStyle = '#0a0e16';
  g.fillRect(0, 0, size, size);

  let seed = 1337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  // soft mottling, wrapped so the tile still repeats cleanly
  for (let i = 0; i < 46; i++) {
    const x = rnd() * size, y = rnd() * size, rad = 8 + rnd() * 16;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      grd.addColorStop(0, `rgba(96,126,176,${(0.007 + rnd() * 0.006).toFixed(3)})`);
      grd.addColorStop(1, 'rgba(96,126,176,0)');
      g.fillStyle = grd;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }

  g.strokeStyle = 'rgba(88,120,170,0.065)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0.5, 0); g.lineTo(0.5, size);
  g.moveTo(0, 0.5); g.lineTo(size, 0.5);
  g.stroke();

  for (let i = 0; i < 52; i++) {
    const x = rnd() * size, y = rnd() * size, a = 0.018 + rnd() * 0.04;
    g.fillStyle = `rgba(140,170,220,${a.toFixed(3)})`;
    g.fillRect(x | 0, y | 0, rnd() < 0.3 ? 2 : 1, rnd() < 0.3 ? 2 : 1);
  }
  return c;
}

/** 0-9 glyphs as individual textures, composed into floating damage numbers. */
function digitTextures() {
  const out = [];
  for (let d = 0; d < 10; d++) {
    const [c, g] = cvs(22, 30);
    g.font = 'bold 24px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.9)';
    g.strokeText(String(d), 11, 16);
    g.fillStyle = '#ffffff';
    g.fillText(String(d), 11, 16);
    out.push(tex(c));
  }
  return out;
}


// ---------------------------------------------------------------------------
// spell effects
// ---------------------------------------------------------------------------
//
// Same reasoning as the creatures: a fireball, an ice shard and a boulder that
// are all the same capsule in three tints read as one spell you recoloured.
// Each effect gets its own form; LOOKS in cast.js says how to orient it.

/** Arcane bolt: chevron head, bright core, fading tail. Points +X. */
function arcaneCanvas(w = 96, h = 30) {
  const [c, g] = cvs(w, h);
  const mid = h / 2;
  g.beginPath();
  g.moveTo(w, mid);
  g.lineTo(w * 0.64, 0);
  g.lineTo(w * 0.58, mid * 0.72);
  g.lineTo(0, mid * 0.88);
  g.lineTo(0, mid * 1.12);
  g.lineTo(w * 0.58, mid * 1.28);
  g.lineTo(w * 0.64, h);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0.00, 'rgba(255,255,255,0)');
  grd.addColorStop(0.42, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.88, 'rgba(255,255,255,1)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0.85)');
  g.fillStyle = grd;
  g.fill();
  return c;
}

/** Flame: teardrop nose with licks trailing behind. Points +X. */
function flameCanvas(w = 104, h = 72) {
  const [c, g] = cvs(w, h);
  const m = h / 2;
  g.beginPath();
  g.moveTo(w, m);
  g.quadraticCurveTo(w * 0.64, m - h * 0.44, w * 0.36, m - h * 0.17);
  g.quadraticCurveTo(w * 0.22, m - h * 0.44, w * 0.05, m - h * 0.09);
  g.quadraticCurveTo(w * 0.20, m, w * 0.03, m + h * 0.11);
  g.quadraticCurveTo(w * 0.24, m + h * 0.40, w * 0.36, m + h * 0.17);
  g.quadraticCurveTo(w * 0.64, m + h * 0.44, w, m);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0.00, 'rgba(255,255,255,0.08)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.86, 'rgba(255,255,255,1)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0.9)');
  g.fillStyle = grd;
  g.fill();
  return c;
}

/** Ice splinter: hard-edged crystal with a bright central facet. */
function iceCanvas(size = 84) {
  const [c, g] = cvs(size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 3;
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.lineTo(cx + r * 0.44, cy - r * 0.34);
  g.lineTo(cx + r * 0.30, cy + r * 0.54);
  g.lineTo(cx, cy + r);
  g.lineTo(cx - r * 0.30, cy + r * 0.54);
  g.lineTo(cx - r * 0.44, cy - r * 0.34);
  g.closePath();
  const grd = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(198,198,198,1)');
  grd.addColorStop(1, 'rgba(248,248,248,1)');
  g.fillStyle = grd;
  g.fill();
  g.lineWidth = 2.4;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.stroke();
  g.beginPath();
  g.moveTo(cx, cy - r * 0.86);
  g.lineTo(cx + r * 0.16, cy + r * 0.1);
  g.lineTo(cx, cy + r * 0.84);
  g.lineTo(cx - r * 0.16, cy + r * 0.1);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fill();
  return c;
}

/** Tumbling chunk of rock. Straight edges, so it never reads as a bolt. */
function stoneCanvas(size = 88) {
  const [c, g] = cvs(size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 3;
  const pts = [
    [0.08, -1.0], [0.82, -0.52], [0.62, 0.06], [0.98, 0.42],
    [0.22, 0.96], [-0.54, 0.82], [-0.96, 0.18], [-0.66, -0.34], [-0.86, -0.7],
  ];
  g.beginPath();
  pts.forEach(([x, y], i) => (i
    ? g.lineTo(cx + x * r, cy + y * r)
    : g.moveTo(cx + x * r, cy + y * r)));
  g.closePath();
  const grd = g.createRadialGradient(cx - r * 0.34, cy - r * 0.4, r * 0.06, cx, cy, r * 1.15);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(216,216,216,1)');
  grd.addColorStop(1, 'rgba(96,96,96,1)');
  g.fillStyle = grd;
  g.fill();
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.stroke();
  return c;
}

/** Jagged lightning, stroked so the branches keep their width. Points +X. */
function lightningCanvas(w = 116, h = 58) {
  const [c, g] = cvs(w, h);
  const m = h / 2;
  const spine = [
    [0, m], [w * 0.20, m - h * 0.30], [w * 0.34, m - h * 0.04],
    [w * 0.56, m - h * 0.36], [w * 0.70, m - h * 0.02], [w, m - h * 0.12],
  ];
  const draw = (width, alpha) => {
    g.beginPath();
    spine.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
    g.stroke();
  };
  draw(13, 0.35);
  draw(6, 0.8);
  draw(2.4, 1);
  g.beginPath();
  g.moveTo(w * 0.56, m - h * 0.36);
  g.lineTo(w * 0.66, m + h * 0.34);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.stroke();
  return c;
}

/**
 * Curved blade: a crescent that tapers to a point at BOTH ends. An earlier
 * version closed with a single curve and read as a leaf -- the two sharp tips
 * are what make it a weapon.
 */
function bladeCanvas(size = 96) {
  const [c, g] = cvs(size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 3;
  const a = 1.32;
  const tipA = [cx + r * Math.cos(-a), cy + r * Math.sin(-a)];
  const tipB = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  g.beginPath();
  g.moveTo(tipA[0], tipA[1]);
  g.quadraticCurveTo(cx + r * 1.12, cy, tipB[0], tipB[1]);   // outer edge
  g.quadraticCurveTo(cx + r * 0.30, cy, tipA[0], tipA[1]);   // inner edge
  g.closePath();
  const grd = g.createLinearGradient(cx, cy - r, cx + r, cy + r);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(226,226,226,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0.95)');
  g.fillStyle = grd;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.stroke();
  return c;
}

/** Wind: a tapering comma of air. */
function windCanvas(size = 92) {
  const [c, g] = cvs(size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 3;
  g.beginPath();
  g.arc(cx, cy, r * 0.92, -2.5, 1.1);
  g.quadraticCurveTo(cx + r * 0.5, cy + r * 0.95, cx + r * 0.12, cy + r * 0.34);
  g.arc(cx, cy, r * 0.42, 1.1, -2.5, true);
  g.closePath();
  const grd = g.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
  grd.addColorStop(0, 'rgba(255,255,255,0.25)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0.15)');
  g.fillStyle = grd;
  g.fill();
  return c;
}

/** Vortex: a drawn-in spiral, for the tornado. */
function vortexCanvas(size = 176) {
  const [c, g] = cvs(size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  for (let arm = 0; arm < 3; arm++) {
    g.beginPath();
    const off = (arm / 3) * TAU;
    for (let t = 0; t <= 1; t += 0.02) {
      const a = off + t * TAU * 1.5;
      const rad = r * (0.14 + t * 0.86);
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      t === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    // kept deliberately thin and dim: several tornados overlap in practice, and
    // at full brightness they whited out the whole screen
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.stroke();
    g.lineWidth = 1.8;
    g.strokeStyle = 'rgba(255,255,255,0.62)';
    g.stroke();
  }
  return c;
}

/** Shatter: a ring of outward shards, for a corpse detonation. */
function shatterCanvas(size = 168) {
  const [c, g] = cvs(size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 3;
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const spread = 0.13;
    g.beginPath();
    g.moveTo(cx + Math.cos(a - spread) * r * 0.42, cy + Math.sin(a - spread) * r * 0.42);
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.lineTo(cx + Math.cos(a + spread) * r * 0.42, cy + Math.sin(a + spread) * r * 0.42);
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,' + (i % 2 ? 0.75 : 1) + ')';
    g.fill();
  }
  return c;
}

function buildSpellArt() {
  return {
    bolt: tex(arcaneCanvas()),
    flame: tex(flameCanvas()),
    ice: tex(iceCanvas()),
    stone: tex(stoneCanvas()),
    lightning: tex(lightningCanvas()),
    blade: tex(bladeCanvas()),
    wind: tex(windCanvas()),
    vortex: tex(vortexCanvas()),
    shatter: tex(shatterCanvas()),
  };
}

export function buildTextures() {
  return {
    enemy: buildCreatures(),
    spell: buildSpellArt(),
    mage: tex(mageCanvas()),
    blob: tex(blobCanvas()),
    glow: tex(glowCanvas()),
    shard: tex(gemCanvas()),
    capsule: tex(boltCanvas()),
    ring: tex(ringCanvas()),
    arc: tex(arcCanvas()),
    spark: tex(sparkCanvas()),
    bar: tex(barCanvas()),
    ground: tex(groundCanvas()),
    digits: digitTextures(),
  };
}
