/**
 * Headless stand-in for PixiJS.
 *
 * `src/pixi.js` re-exports the real library from a CDN, which Node cannot
 * fetch and which needs a GPU anyway. The loader hook in `hooks.mjs` rewrites
 * that CDN specifier to this file, so every game module imports this instead
 * WITHOUT ANY CHANGE TO GAME SOURCE. Tests therefore exercise the shipping
 * code, not a parallel copy of it.
 *
 * The simulation only ever writes to sprites -- position, tint, rotation,
 * visibility -- and never reads anything back to make a decision. So these
 * objects can be inert property bags: the one thing they must not do is throw.
 * If the sim ever starts branching on a sprite's value, a test will notice
 * because the recorded behaviour will change when this stub is wrong.
 */

class Vec {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y = x) { this.x = x; this.y = y; return this; }
  copyFrom(p) { this.x = p.x; this.y = p.y; return this; }
}

class Node {
  constructor() {
    this.x = 0; this.y = 0;
    this.alpha = 1;
    this.rotation = 0;
    this.visible = true;
    this.tint = 0xffffff;
    this.width = 0; this.height = 0;
    this.blendMode = 'normal';
    this.scale = new Vec(1, 1);
    this.pivot = new Vec();
    this.anchor = new Vec(0.5, 0.5);
    this.children = [];
    this.parent = null;
    this.sortableChildren = false;
    this.zIndex = 0;
    this.label = '';
  }
  addChild(...kids) {
    for (const k of kids) { k.parent = this; this.children.push(k); }
    return kids[0];
  }
  removeChild(...kids) {
    for (const k of kids) {
      const i = this.children.indexOf(k);
      if (i >= 0) { this.children.splice(i, 1); k.parent = null; }
    }
    return kids[0];
  }
  removeChildren() { for (const k of this.children) k.parent = null; this.children.length = 0; }
  destroy() { this.destroyed = true; }
}

export class Container extends Node {}

export class Sprite extends Node {
  constructor(texture) { super(); this.texture = texture || Texture.EMPTY; }
}

export class TilingSprite extends Sprite {
  constructor(opts) { super(opts && opts.texture); this.tilePosition = new Vec(); }
}

export class Texture {
  constructor(opts) {
    this.source = (opts && opts.source) || { scaleMode: 'linear', resource: null };
    this.width = 1; this.height = 1;
  }
}
Texture.EMPTY = new Texture();
Texture.WHITE = new Texture();

export class Graphics extends Node {
  constructor() { super(); }
  clear() { return this; } rect() { return this; } circle() { return this; }
  fill() { return this; } stroke() { return this; } poly() { return this; }
  moveTo() { return this; } lineTo() { return this; }
}

export class Text extends Node {
  constructor(opts) { super(); this.text = (opts && opts.text) || ''; this.style = (opts && opts.style) || {}; }
}

/** Never used by the simulation -- only `main.js` boots an Application. */
export class Application {
  constructor() { this.stage = new Container(); this.ticker = { add() {}, update() {} }; this.canvas = null; }
  async init() { return this; }
}
