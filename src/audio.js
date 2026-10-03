/**
 * Audio: two synthesised music tracks and the game's sound effects.
 *
 * Nothing here loads a file. Every texture in this game is drawn into a canvas
 * at startup, and the sound follows the same rule -- the repo stays asset-free,
 * the static host stays a static host, and there is no licensing to think
 * about. Swapping a track for a real recording later means replacing its entry
 * in TRACKS with a buffer source and leaving everything else alone.
 *
 * SCHEDULING uses the standard two-clock approach: a coarse timer wakes up
 * often enough to queue notes a little way ahead, and the notes themselves are
 * placed on the AudioContext's own sample clock. Driving audio from the game
 * loop would tie the tempo to the frame rate and jitter audibly.
 */

const A = {
  ctx: null,
  master: null,
  musicBus: null,
  sfxBus: null,
  musicGain: null,
  started: false,
  musicOn: true,
  timer: null,
  step: 0,
  nextTime: 0,
  noise: null,
  track: 'main',
  pending: null,
};

const LOOKAHEAD = 0.30;   // seconds of music queued in advance
const TICK_MS = 60;
const BARS = 4;
const STEPS = BARS * 16;
const VOL_KEY = 'bh.audio';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ---------------------------------------------------------------------------
// the tracks
// ---------------------------------------------------------------------------
//
// Electro rather than downtempo: four-on-the-floor, an offbeat open hat, and a
// sixteenth-note bass doing most of the work. The chords are held pads -- with
// a bassline this busy, anything more from the keys turns to mud.
//
// `boss` is the same machine wound tighter: faster, a semitone-darker key, a
// syncopated kick so it stops feeling like a groove you can settle into, and a
// saw lead that the main track deliberately does not have.

const TRACKS = {
  main: {
    bpm: 124,
    swing: 0.05,              // barely there; straight is what drives
    lowpass: 5200,            // open, not the lofi blanket
    noiseFloor: 0.006,
    // i - VI - III - VII in A minor. Endlessly loopable, and it lifts.
    chords: [
      { keys: [69, 72, 76], bass: 45 },   // Am
      { keys: [65, 69, 72], bass: 41 },   // F
      { keys: [64, 67, 72], bass: 36 },   // C
      { keys: [62, 67, 71], bass: 43 },   // G
    ],
    kick: (s) => s % 4 === 0,                       // four on the floor
    clap: (s) => s % 16 === 4 || s % 16 === 12,
    openHat: (s) => s % 4 === 2,                    // offbeat: the electro tell
    bassPattern: [0, 0, 12, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12, 0],
    lead: null,
  },

  boss: {
    bpm: 142,
    swing: 0,
    lowpass: 6400,
    noiseFloor: 0.004,
    // i - VI - iv - V in D minor, sitting lower and leaning on the fifth.
    chords: [
      { keys: [62, 65, 69], bass: 38 },   // Dm
      { keys: [58, 62, 65], bass: 34 },   // Bb
      { keys: [55, 58, 62], bass: 31 },   // Gm
      { keys: [57, 61, 64], bass: 33 },   // A
    ],
    kick: (s) => s % 8 === 0 || s % 16 === 6 || s % 16 === 11,
    clap: (s) => s % 8 === 4,
    openHat: (s) => s % 4 === 2,
    bassPattern: [0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12, 0, 12, 12],
    // a repeating figure over the chord, so the fight has a melody to track
    lead: [0, 7, 12, 7, 15, 12, 7, 0],
  },

  // THE RUIN. Not the boss theme wound tighter -- the opposite of it.
  //
  // The other two tracks escalate by speeding up, which is the obvious move and
  // the wrong one here. Dread is weight and space, not tempo: at 72bpm every
  // hit has room to decay, and the silence between them is doing as much work
  // as the notes. A fast track would say "hurry"; this one says "it does not
  // matter how fast you are".
  //
  // The progression is the whole idea. i - bVI - bVII - i in C minor, which
  // climbs for three chords and then lands back exactly where it started. It
  // sounds like it is building to something and it resolves to nothing, over
  // and over, for as long as the player is still alive.
  ruin: {
    bpm: 164,                 // the fastest thing in the game, by a margin
    swing: 0,
    lowpass: 4200,            // darker than the boss theme, but not muffled
    noiseFloor: 0.009,
    chords: [
      { keys: [60, 63, 67], bass: 36 },   // Cm
      { keys: [56, 60, 63], bass: 32 },   // Ab
      { keys: [58, 62, 65], bass: 34 },   // Bb
      { keys: [60, 63, 67], bass: 36 },   // Cm -- back to the start
    ],
    heavy: true,              // the kick still sits an octave below the others
    drone: true,              // sub pedal under the panic
    // Four on the floor at 164 is not a groove, it is a countdown.
    kick: (s) => s % 4 === 0,
    clap: (s) => s % 8 === 4,                       // hard backbeat
    openHat: (s) => s % 4 === 2,
    toll: (s) => s % 16 === 0,                      // a bell every bar, 1.5s apart
    // Driving sixteenths on the root with the octave pushing between them, and
    // the fifth leaning into the back half of the bar.
    bassPattern: [0, null, 12, 0, 0, 12, null, 0, 0, null, 12, 0, 7, 12, 0, 12],
    // Rises a minor third, a fifth, an octave -- and stops. It never gets the
    // note above, however fast it runs at it.
    lead: [0, 3, 7, 12, 10, 7, 12, 15],
    leadStyle: {
      type: 'sawtooth', gain: 0.075, filter: 2600, attack: 0.012,
      octave: 0, hold: 1.1, every: 2, detune: 6, fifth: true,
    },
  },
};

const trk = () => TRACKS[A.track];
const stepDur = () => 60 / trk().bpm / 4;

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

/** Must be called from a user gesture -- browsers refuse to start audio otherwise. */
export function initAudio() {
  if (A.ctx) return true;
  // `?silent=1` never opens an audio context at all, so no music, no effects,
  // and nothing to clean up afterwards. The test harness loads the game this
  // way -- playtesting should not blast sound at whoever happens to be
  // watching, and muting through setVolume would be worse than useless because
  // it persists to localStorage and would leave the player's own game muted.
  try {
    if (new URLSearchParams(location.search).has('silent')) return false;
  } catch { /* no URL to read: carry on and make noise */ }

  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return false;                    // no Web Audio: stay silent, never throw
  A.ctx = new Ctor();

  A.master = A.ctx.createGain();
  A.master.gain.value = loadVolume();
  A.master.connect(A.ctx.destination);

  A.musicBus = A.ctx.createBiquadFilter();
  A.musicBus.type = 'lowpass';
  A.musicBus.frequency.value = TRACKS.main.lowpass;
  A.musicBus.Q.value = 0.7;
  A.musicGain = A.ctx.createGain();
  A.musicGain.gain.value = 0.5;
  A.musicBus.connect(A.musicGain);
  A.musicGain.connect(A.master);

  A.sfxBus = A.ctx.createGain();
  A.sfxBus.gain.value = 0.9;
  A.sfxBus.connect(A.master);

  A.noise = makeNoise();
  installSilenceWhenAway();
  return true;
}

/**
 * Stop making noise whenever this window is not the one being used.
 *
 * `visibilitychange` alone is not enough, and that was the original bug: it
 * fires for tab switches, but alt-tabbing to another application leaves the tab
 * "visible", so the music kept playing out of a window nobody was looking at.
 * Window focus catches that case. `pagehide` covers navigating away and mobile
 * backgrounding, where an unload handler is not guaranteed to run.
 */
function installSilenceWhenAway() {
  const away = () => { if (A.ctx && A.ctx.state === 'running') A.ctx.suspend(); };
  const back = () => {
    if (A.ctx && A.started && !document.hidden && A.ctx.state === 'suspended') A.ctx.resume();
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? away() : back()));
  window.addEventListener('blur', away);
  window.addEventListener('focus', back);
  window.addEventListener('pagehide', () => { stopMusic(); away(); });
}

function makeNoise() {
  const n = Math.floor(A.ctx.sampleRate * 2);
  const buf = A.ctx.createBuffer(1, n, A.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function isReady() { return !!A.ctx; }
export function currentTrack() { return A.track; }
/** The track queued for the next bar boundary, or null. Exposed for tests. */
export function pendingTrack() { return A.pending; }
/** Track names, so a test can assert the roster rather than hard-code it. */
export function trackNames() { return Object.keys(TRACKS); }

// ---------------------------------------------------------------------------
// volume
// ---------------------------------------------------------------------------

function loadVolume() {
  try {
    const v = localStorage.getItem(VOL_KEY);
    return v === null ? 0.7 : Math.max(0, Math.min(1, parseFloat(v)));
  } catch { return 0.7; }          // private mode, blocked storage: just default
}

export function getVolume() { return A.master ? A.master.gain.value : loadVolume(); }

export function setVolume(v) {
  const c = Math.max(0, Math.min(1, v));
  if (A.master) A.master.gain.setTargetAtTime(c, A.ctx.currentTime, 0.02);
  try { localStorage.setItem(VOL_KEY, String(c)); } catch { /* not important */ }
}

export function setMusicEnabled(on) {
  A.musicOn = on;
  if (A.musicGain) A.musicGain.gain.setTargetAtTime(on ? 0.5 : 0, A.ctx.currentTime, 0.15);
}

export function isMusicEnabled() { return A.musicOn; }

// ---------------------------------------------------------------------------
// voices
// ---------------------------------------------------------------------------

function tone(t, freq, dur, { type = 'sine', gain = 0.2, dest = null, glide = 0,
                             filter = 0, detune = 0, attack = 0.012 } = {}) {
  const ctx = A.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur);
  if (detune) o.detune.setValueAtTime(detune, t);

  // Attack has to be non-zero or every note clicks; exponential release keeps
  // the tail natural without a second ramp.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  let node = g;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    g.connect(f);
    node = f;
  }
  o.connect(g);
  node.connect(dest || A.sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noiseHit(t, dur, { gain = 0.2, hp = 0, lp = 8000, dest = null } = {}) {
  const ctx = A.ctx;
  const src = ctx.createBufferSource();
  src.buffer = A.noise;
  src.loop = true;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  let head = g;
  if (hp) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hp;
    g.connect(f); head = f;
  }
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = lp;
  head.connect(lpf);
  src.connect(g);
  lpf.connect(dest || A.sfxBus);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ---------------------------------------------------------------------------
// the loop
// ---------------------------------------------------------------------------

export function startMusic() {
  if (!A.ctx || A.started) return;
  // A context built outside a gesture starts suspended; resuming here is
  // harmless when it is already running.
  if (A.ctx.state === 'suspended') A.ctx.resume();
  A.started = true;
  A.step = 0;
  A.nextTime = A.ctx.currentTime + 0.1;
  startFloor();
  A.timer = setInterval(schedule, TICK_MS);
}

export function stopMusic() {
  A.started = false;
  if (A.timer) { clearInterval(A.timer); A.timer = null; }
}

/**
 * Switch tracks. Takes effect at the next bar rather than immediately, because
 * cutting a four-on-the-floor kick mid-bar is instantly audible as a mistake.
 * At 124 BPM the wait is under two seconds.
 */
export function setTrack(name) {
  if (!TRACKS[name]) return;
  // Asking for the track already playing CANCELS a queued change rather than
  // doing nothing. A change only lands on a bar boundary, so a boss that dies
  // inside the bar it spawned in used to leave its own theme queued behind it:
  // the fight was over, and the boss music started afterwards and stayed until
  // something else triggered a switch.
  if (name === A.track) { A.pending = null; return; }
  if (A.pending === name) return;
  A.pending = name;
}

/** Continuous hiss under everything -- much lighter than the lofi version. */
function startFloor() {
  const ctx = A.ctx;
  const src = ctx.createBufferSource();
  src.buffer = A.noise;
  src.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 1200;
  const g = ctx.createGain();
  g.gain.value = trk().noiseFloor;
  src.connect(hp); hp.connect(g); g.connect(A.musicGain);
  src.start();
  A.floorGain = g;
}

function schedule() {
  const ctx = A.ctx;
  if (!ctx || !A.started) return;
  while (A.nextTime < ctx.currentTime + LOOKAHEAD) {
    if (A.step % 16 === 0 && A.pending) applyTrack(A.nextTime);
    playStep(A.step, A.nextTime);
    A.nextTime += stepDur();
    A.step = (A.step + 1) % STEPS;
  }
}

function applyTrack(t) {
  A.track = A.pending;
  A.pending = null;
  const k = trk();
  // Ramp rather than jump: a filter cutoff snapping 1200Hz is a click.
  A.musicBus.frequency.setTargetAtTime(k.lowpass, t, 0.08);
  if (A.floorGain) A.floorGain.gain.setTargetAtTime(k.noiseFloor, t, 0.1);
}

function playStep(step, time) {
  const k = trk();
  const bar = Math.floor(step / 16);
  const chord = k.chords[bar % k.chords.length];
  const beat = step % 16;
  const d = stepDur();
  const t = time + (k.swing && step % 2 === 1 ? d * k.swing : 0);
  const M = A.musicBus;

  if (k.kick(step)) {
    // `heavy` drops it an octave and lets it ring: a war drum rather than a
    // dance kick. The click is dropped with it -- the attack transient is what
    // makes a kick sound like a machine.
    if (k.heavy) {
      // Short enough not to smear. At 164bpm a four-on-the-floor kick lands
      // every 0.37s, and the long decay this started with ran straight into
      // the next one -- the low end turned to a continuous rumble with no
      // pulse left in it.
      tone(t, 74, 0.30, { type: 'sine', gain: 0.78, glide: 30, dest: M, attack: 0.005 });
      noiseHit(t, 0.07, { gain: 0.08, hp: 90, lp: 1100, dest: M });
    } else {
      tone(t, 150, 0.20, { type: 'sine', gain: 0.62, glide: 46, dest: M, attack: 0.004 });
      noiseHit(t, 0.02, { gain: 0.09, hp: 1000, lp: 7000, dest: M });   // beater click
    }
  }
  if (k.clap(step)) {
    // three closely spaced bursts read as a clap where one reads as a snare
    for (let i = 0; i < 3; i++) {
      noiseHit(t + i * 0.008, 0.11, { gain: 0.13, hp: 1500, lp: 6500, dest: M });
    }
  }
  // Hats are what make a groove feel like a groove, which is the last thing
  // the Ruin's theme wants -- it opts out entirely and keeps the space.
  if (k.hats !== false) {
    if (k.openHat(step)) {
      noiseHit(t, 0.11, { gain: 0.06, hp: 7000, dest: M });
    } else if (step % 2 === 0) {
      noiseHit(t, 0.022, { gain: 0.03, hp: 8000, dest: M });
    }
  }

  // A sub pedal under the whole bar. Felt more than heard, and the reason the
  // Ruin's theme sits on the chest rather than in the ears.
  if (k.drone && beat === 0) {
    tone(t, midi(chord.bass - 12), d * 17,
         { type: 'sine', gain: 0.30, filter: 160, dest: M, attack: 0.30 });
  }

  // A struck bell, two partials and a long tail. This is the clock running
  // out: slow, unhurried, and it does not care what the player is doing.
  if (k.toll && k.toll(step)) {
    // Tail kept just under the bar so each strike clears before the next --
    // overlapping bells stack into a drone and stop reading as a count.
    tone(t, midi(chord.bass + 12), 1.35,
         { type: 'triangle', gain: 0.17, filter: 1100, dest: M, attack: 0.003 });
    tone(t, midi(chord.bass + 19), 1.05,
         { type: 'triangle', gain: 0.06, filter: 1500, detune: 7, dest: M, attack: 0.003 });
  }

  // Bass: a sixteenth pulse doing most of the movement. 0 = root, 12 = octave.
  const bp = k.bassPattern[beat];
  if (bp !== undefined && bp !== null) {
    tone(t, midi(chord.bass + bp), d * 0.9,
         { type: 'sawtooth', gain: 0.17, filter: 520, dest: M, attack: 0.006 });
  }

  // Pad: held across the bar, quiet, just to give the bass a key to sit in.
  if (beat === 0) {
    chord.keys.forEach((n, i) => {
      tone(t + i * 0.01, midi(n), d * 15,
           { type: 'triangle', gain: 0.055, filter: 2400, detune: (i - 1) * 4,
             dest: M, attack: 0.06 });
    });
  }

  if (k.lead) {
    const L = k.leadStyle || {};
    const every = L.every || 2;
    const n = k.lead[beat % k.lead.length];
    if (beat % every === 0) {
      tone(t, midi(chord.keys[0] + (L.octave === undefined ? 12 : L.octave) + n),
           d * (L.hold || 1.6),
           { type: L.type || 'sawtooth', gain: L.gain || 0.05,
             filter: L.filter || 3000, attack: L.attack || 0.01,
             detune: L.detune || 0, dest: M });
      // A second voice a fifth under, which is what separates "a melody" from
      // "a horn section". Only the Ruin asks for it.
      if (L.fifth) {
        tone(t, midi(chord.keys[0] + (L.octave === undefined ? 12 : L.octave) + n - 5),
             d * (L.hold || 1.6),
             { type: L.type || 'sawtooth', gain: (L.gain || 0.05) * 0.55,
               filter: L.filter || 3000, attack: L.attack || 0.01,
               detune: -6, dest: M });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// effects
// ---------------------------------------------------------------------------
//
// Rate limiting is not an optimisation here, it is the feature. `cast` and
// `pickup` fire many times a second in a late run, and each effect declares the
// closest together it may be heard, with pitch drifting a little per shot so
// repeats do not comb.
//
// There is deliberately NO sound for an enemy being hit, an enemy dying, or a
// freeze landing. Those are the three most frequent events in the game -- a
// late run lands hundreds of hits a second -- and even gated they amounted to a
// constant tick under everything without telling the player anything the
// damage numbers and the freeze burst did not already show.

const lastAt = Object.create(null);

function gate(name, gap) {
  if (!A.ctx) return false;
  const t = A.ctx.currentTime;
  const prev = lastAt[name];
  if (prev !== undefined && t - prev < gap) return false;
  lastAt[name] = t;
  return true;
}

const vary = (n) => n * (0.94 + Math.random() * 0.12);

export const sfx = {
  /** A spell went out. Very soft: this is the most frequent sound in the game. */
  cast() {
    if (!gate('cast', 0.10)) return;
    tone(A.ctx.currentTime, vary(620), 0.06, { type: 'square', gain: 0.028, filter: 3000 });
  },

  hurt() {
    if (!gate('hurt', 0.18)) return;
    tone(A.ctx.currentTime, 160, 0.26, { type: 'sawtooth', gain: 0.18, glide: 58, filter: 800 });
  },

  pickup() {
    if (!gate('pickup', 0.05)) return;
    tone(A.ctx.currentTime, vary(1040), 0.05, { type: 'square', gain: 0.04, filter: 4000 });
  },

  levelUp() {
    if (!gate('levelUp', 0.30)) return;
    const t = A.ctx.currentTime;
    [0, 4, 7, 12].forEach((s, i) => {
      tone(t + i * 0.05, midi(72 + s), 0.42, { type: 'square', gain: 0.075, filter: 3600 });
    });
  },

  chest() {
    if (!gate('chest', 0.25)) return;
    const t = A.ctx.currentTime;
    [0, 7, 12, 16, 19].forEach((s, i) => {
      tone(t + i * 0.035, midi(76 + s), 0.3, { type: 'square', gain: 0.055, filter: 5000 });
    });
  },

  /** A boss is coming. Long and low, under the banner. */
  bossWarn() {
    if (!gate('bossWarn', 2.0)) return;
    const t = A.ctx.currentTime;
    tone(t, 58, 1.6, { type: 'sawtooth', gain: 0.18, glide: 88, filter: 500 });
    tone(t + 0.02, 87, 1.6, { type: 'square', gain: 0.09, filter: 700 });
  },

  bossDie() {
    if (!gate('bossDie', 1.0)) return;
    const t = A.ctx.currentTime;
    tone(t, 150, 0.9, { type: 'sawtooth', gain: 0.26, glide: 38, filter: 1100 });
    noiseHit(t, 0.7, { gain: 0.17, hp: 200, lp: 3400 });
  },

  gameOver() {
    if (!gate('gameOver', 1.0)) return;
    const t = A.ctx.currentTime;
    [0, -3, -7, -12].forEach((s, i) => {
      tone(t + i * 0.16, midi(64 + s), 1.1, { type: 'sawtooth', gain: 0.11, filter: 1200 });
    });
  },
};
