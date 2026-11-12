// Keyboard + mouse, with pointer lock when the browser allows it (otherwise hold a button and drag to look),
// plus touch: left thumb moves (floating stick), right thumb looks, on-screen Fire / Aim / Jump / Reload / Pause.
export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const look = { dx: 0, dy: 0 };
  let dragging = false, mouseFire = false, mouseAds = false, firePressed = false;
  const inp = { keys, locked: false, onUnlock: null, onPause: null, enabled: false, touch: false, sensitivity: 1 };

  addEventListener('keydown', (e) => {
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    if (inp.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); dragging = mouseFire = mouseAds = false; });

  document.addEventListener('pointerlockchange', () => {
    const was = inp.locked;
    inp.locked = document.pointerLockElement === canvas;
    if (was && !inp.locked && inp.onUnlock) inp.onUnlock();
  });
  document.addEventListener('mousemove', (e) => {
    if (inp.locked || dragging) { look.dx += e.movementX || 0; look.dy += e.movementY || 0; }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (!inp.enabled || inp.touch) return;
    if (!inp.locked) { inp.lock(); dragging = true; }
    if (e.button === 0) { mouseFire = true; firePressed = true; }
    if (e.button === 2) mouseAds = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseFire = false;
    if (e.button === 2) mouseAds = false;
    if (!e.buttons) dragging = false;
  });

  inp.lock = () => {
    if (inp.touch) return;
    try {
      const p = canvas.requestPointerLock && canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* sandboxed: drag-to-look fallback */ }
  };
  inp.unlock = () => { if (document.pointerLockElement) document.exitPointerLock(); };

  // ---- touch ----
  const ui = document.getElementById('touch'), stickEl = document.getElementById('tstick'), nub = document.getElementById('tnub');
  const t = { stickId: null, sx: 0, sy: 0, ax: 0, ay: 0, lookId: null, lx: 0, ly: 0, fire: false, ads: false };
  inp.enableTouch = () => {
    if (inp.touch) return;
    inp.touch = true; ui.classList.add('on'); document.getElementById('app').classList.add('is-touch');
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    inp.enableTouch();
    if (!inp.enabled) return;
    if (e.clientX < innerWidth * 0.42 && t.stickId === null) {
      t.stickId = e.pointerId; t.sx = e.clientX; t.sy = e.clientY; t.ax = t.ay = 0;
      stickEl.style.transform = `translate(${t.sx}px, ${t.sy}px)`; stickEl.classList.add('on'); nub.style.transform = '';
    } else if (t.lookId === null) { t.lookId = e.pointerId; t.lx = e.clientX; t.ly = e.clientY; }
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === t.stickId) {
      let dx = e.clientX - t.sx, dy = e.clientY - t.sy;
      const L = Math.hypot(dx, dy), R = 52;
      if (L > R) { dx *= R / L; dy *= R / L; }
      t.ax = dx / R; t.ay = -dy / R;
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === t.lookId) {
      look.dx += (e.clientX - t.lx) * 1.5; look.dy += (e.clientY - t.ly) * 1.5;
      t.lx = e.clientX; t.ly = e.clientY;
    }
  });
  const release = (e) => {
    if (e.pointerId === t.stickId) { t.stickId = null; t.ax = t.ay = 0; stickEl.classList.remove('on'); }
    if (e.pointerId === t.lookId) t.lookId = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  ui.querySelectorAll('[data-t]').forEach((b) => {
    const act = b.dataset.t;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); b.setPointerCapture?.(e.pointerId); inp.enableTouch();
      if (act === 'fire') { t.fire = true; firePressed = true; b.classList.add('active'); }
      if (act === 'ads') { t.ads = !t.ads; b.classList.toggle('active', t.ads); }
      if (act === 'jump') pressed.add('Space');
      if (act === 'reload') pressed.add('KeyR');
      if (act === 'pause' && inp.onPause) inp.onPause();
    });
    const up = () => { if (act === 'fire') { t.fire = false; b.classList.remove('active'); } };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
  inp.resetTouch = () => { t.ads = false; t.fire = false; ui.querySelector('[data-t="ads"]').classList.remove('active'); };
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) inp.enableTouch();

  const k = (...c) => c.some((x) => keys.has(x));
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  /** Read and clear this frame's input. */
  inp.consume = () => {
    const out = {
      keys,
      pressed: new Set(pressed),
      look: { dx: look.dx * inp.sensitivity, dy: look.dy * inp.sensitivity * (inp.invertY ? -1 : 1) },
      axis: {
        x: clamp((k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0) + t.ax),
        y: clamp((k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0) + t.ay),
      },
      sprint: k('ShiftLeft', 'ShiftRight') || (t.stickId !== null && t.ay > 0.92),
      crouch: k('KeyC', 'ControlLeft'),
      fire: mouseFire || t.fire,
      firePressed,
      ads: mouseAds || t.ads,
    };
    pressed.clear(); look.dx = look.dy = 0; firePressed = false;
    return out;
  };
  return inp;
}
