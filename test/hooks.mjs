/**
 * Module-resolution hook: redirects the PixiJS CDN import to the local stub.
 *
 * This is the whole reason the game can be tested headlessly without a test
 * build, a bundler, or dependency injection threaded through the source. The
 * game keeps its single pinned CDN import; Node is simply told, at resolution
 * time, that this one specifier lives somewhere else.
 */
const STUB = new URL('./stub/pixi.js', import.meta.url).href;
const CDN = 'https://cdn.jsdelivr.net/npm/pixi.js';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(CDN)) return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
