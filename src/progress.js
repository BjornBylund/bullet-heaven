import { G } from './state.js';
import { xpForLevel } from './config.js';
import { damageNumber, burst, shake } from './fx.js';

/**
 * Character progression: XP, levels, healing, gold.
 *
 * Lives in its own module so the pickup system can award XP without importing
 * the player module, which would close a cycle
 * (enemy -> pickups -> player -> weapons -> enemy).
 */

export function gainXp(amount) {
  const p = G.player;
  p.xp += amount * p.stats.xpMul;
  while (p.xp >= p.xpNeed) {
    p.xp -= p.xpNeed;
    p.level++;
    p.xpNeed = xpForLevel(p.level);
    G.pendingLevels++;
    G.statsDirty = true;
  }
}

/**
 * Grants levels outright (chests). Queued, so multi-level chests show one card
 * screen each, and the level itself counts toward automatic stat growth.
 */
export function grantLevels(n) {
  G.player.level += n;
  G.pendingLevels += n;
  G.statsDirty = true;
}

export function heal(amount) {
  const p = G.player;
  const before = p.hp;
  p.hp = Math.min(p.stats.maxHp, p.hp + amount);
  const healed = p.hp - before;
  if (healed > 0.5) {
    damageNumber(p.x, p.y - 18, healed, 0x6ee7a0);
    burst(p.x, p.y, 0x6ee7a0, 10, 130);
  }
}

export function addGold(n) {
  G.gold += n;
}

export function killCredit(isBoss) {
  G.kills++;
  G.gold += isBoss ? 25 : 1;
  if (isBoss) shake(14);
}
