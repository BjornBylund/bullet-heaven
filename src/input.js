/** Keyboard input. Movement is polled; everything else is dispatched on press. */

const down = new Set();
const pressHandlers = [];

const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];

const anyDown = (codes) => codes.some((c) => down.has(c));

export function initInput() {
  window.addEventListener('keydown', (e) => {
    // stop arrows and space from scrolling the page underneath the canvas
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    down.add(e.code);
    for (const h of pressHandlers) h(e.code);
  });

  window.addEventListener('keyup', (e) => down.delete(e.code));

  // Losing focus mid-run would otherwise leave a movement key stuck down.
  window.addEventListener('blur', () => down.clear());
}

export function onPress(handler) {
  pressHandlers.push(handler);
}

/** Normalised movement vector, so diagonals are not faster than cardinals. */
export function getAxis() {
  let x = (anyDown(RIGHT) ? 1 : 0) - (anyDown(LEFT) ? 1 : 0);
  let y = (anyDown(DOWN) ? 1 : 0) - (anyDown(UP) ? 1 : 0);
  if (x !== 0 && y !== 0) {
    const inv = Math.SQRT1_2;
    x *= inv; y *= inv;
  }
  return [x, y];
}
