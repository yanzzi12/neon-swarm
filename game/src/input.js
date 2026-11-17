// Twin-stick input: WASD or the arrow keys steer, the mouse aims, holding the mouse button
// (or Space) fires. One-shot presses (start, pause, restart, mute) are queued as bit flags
// and taken once by the loop, so a press between two frames is never lost or counted twice.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;
export const ACTION_MUTE = 8;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RESTART = new Set(['KeyR']);
const MUTE = new Set(['KeyM']);

export function createInput(target) {
  const held = { up: false, down: false, left: false, right: false };
  let actions = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerDown = false;
  let spaceDown = false;

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code)) held.up = true;
    else if (DOWN.has(event.code)) held.down = true;
    else if (LEFT.has(event.code)) held.left = true;
    else if (RIGHT.has(event.code)) held.right = true;
    else if (CONFIRM.has(event.code)) {
      if (event.code === 'Space') spaceDown = true;
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (RESTART.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (UP.has(event.code)) held.up = false;
    else if (DOWN.has(event.code)) held.down = false;
    else if (LEFT.has(event.code)) held.left = false;
    else if (RIGHT.has(event.code)) held.right = false;
    else if (event.code === 'Space') spaceDown = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.up = false;
    held.down = false;
    held.left = false;
    held.right = false;
    pointerDown = false;
    spaceDown = false;
  });
  target.addEventListener('pointermove', (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
  });
  target.addEventListener('pointerdown', (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerDown = true;
    actions |= ACTION_CONFIRM;
  });
  window.addEventListener('pointerup', () => {
    pointerDown = false;
  });
  target.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** Steering in -1..1 on each axis (the world normalises the diagonal). */
    moveX() {
      return (held.right ? 1 : 0) - (held.left ? 1 : 0);
    },
    moveY() {
      return (held.down ? 1 : 0) - (held.up ? 1 : 0);
    },
    /** The pointer in client (CSS pixel) coordinates; the loop converts it to world space. */
    pointer() {
      return { x: pointerX, y: pointerY };
    },
    /** True while the trigger is held: mouse button or Space. */
    firing() {
      return pointerDown || spaceDown;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
