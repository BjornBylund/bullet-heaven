/**
 * Local high scores.
 *
 * Kept in `localStorage`, because the game is static files on GitHub Pages with
 * no backend to talk to. That has two consequences worth stating rather than
 * discovering: the table is per browser, and its contents are editable by
 * anyone who opens devtools. Nothing here is a leaderboard; it is a record of
 * what this browser has managed.
 *
 * RANKED BY TIME SURVIVED, with kills as the tiebreak. There is no winning:
 * THE RUIN ends every run and cannot be killed, so how long you lasted is the
 * only question a run answers, and the table answers it. Scoring on kills or
 * gold instead would reward farming a safe corner over surviving, which is the
 * opposite of what the run asks for.
 *
 * Every read is defensive. `localStorage` can be absent (private mode), throw
 * on access (blocked storage), or hold whatever a player typed into it, and a
 * high score table is never worth breaking a run over -- a corrupt entry is
 * dropped, a corrupt table reads as empty, and the game carries on.
 */
import { CFG } from './config.js';

const KEY = 'bh.scores';
const VERSION = 1;

/** How many runs the table remembers. */
export const MAX_SCORES = 10;

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

function storage() {
  try {
    // Touching the property can itself throw when storage is blocked, so the
    // whole access is guarded, not just the call.
    return globalThis.localStorage || null;
  } catch { return null; }
}

/** One stored row, or null if it is not shaped like one. */
function clean(row) {
  if (!row || typeof row !== 'object') return null;
  const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
  };
  const seconds = num(row.seconds, 0, CFG.maxRunSeconds);
  if (seconds === null) return null;
  return {
    seconds,
    level: num(row.level, 1, 9999) ?? 1,
    kills: num(row.kills, 0, 9e9) ?? 0,
    gold: num(row.gold, 0, 9e9) ?? 0,
    focus: typeof row.focus === 'string' ? row.focus.slice(0, 24) : '',
    at: num(row.at, 0, 9e15) ?? 0,
  };
}

/** Best first: longer survival wins, then more kills. */
function order(a, b) {
  return b.seconds - a.seconds || b.kills - a.kills || a.at - b.at;
}

export function loadScores() {
  const s = storage();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(KEY) || 'null');
    // Accept a bare array too: it costs one line and means a table written by
    // an older build is kept rather than silently wiped.
    const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.scores) ? raw.scores : []);
    return rows.map(clean).filter(Boolean).sort(order).slice(0, MAX_SCORES);
  } catch { return []; }
}

function save(scores) {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify({ v: VERSION, scores }));
    return true;
  } catch { return false; }        // quota, private mode: the run still counts
}

export function clearScores() {
  const s = storage();
  if (!s) return;
  try { s.removeItem(KEY); } catch { /* nothing to do about it */ }
}

// ---------------------------------------------------------------------------
// recording
// ---------------------------------------------------------------------------

/**
 * Files a finished run and reports where it landed.
 *
 * `rank` is 1-based, or 0 when the run did not make the table. The caller gets
 * the new table back so it never has to re-read storage to draw the result --
 * which also means the screen is right even when saving failed.
 */
export function recordRun(run) {
  const row = clean({ ...run, at: Date.now() });
  if (!row) return { rank: 0, isBest: false, scores: loadScores(), saved: false };

  const before = loadScores();
  const after = [...before, row].sort(order).slice(0, MAX_SCORES);
  // Identity, not equality: two runs can tie on every number, and only the one
  // just played should be highlighted.
  const rank = after.indexOf(row) + 1;
  const saved = save(after);

  return { rank, isBest: rank === 1, scores: after, saved, entry: row };
}
