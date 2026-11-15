// input.js — keyboard + mouse state and pointer lock. Sim code reads held
// keys from `keys`, one-frame presses from `pressed` (cleared by main.js at
// the end of each sim step), and mouse motion by consuming the accumulators.
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    pressed: new Set(),
    mouseDX: 0,
    mouseDY: 0,
    firing: false,      // left mouse held
    aiming: false,      // right mouse held (sniper scope)
    locked: false,
    wheel: 0,           // accumulated wheel delta, consumed by weapons.js

    consumeMouse() {
      const dx = this.mouseDX, dy = this.mouseDY;
      this.mouseDX = 0; this.mouseDY = 0;
      return [dx, dy];
    },
    lock() { canvas.requestPointerLock(); },
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.pressed.add(e.code);
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => { input.keys.clear(); input.firing = false; input.aiming = false; });

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) { input.firing = false; input.aiming = false; }
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  canvas.addEventListener('wheel', (e) => { input.wheel += Math.sign(e.deltaY); }, { passive: true });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  return input;
}
