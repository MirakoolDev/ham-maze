// Player settings + the Settings / Controls panel. Saved per browser (localStorage, guarded: it can be unavailable).
const KEY = 'hammaze.settings.v1';
export const QUALITIES = ['low', 'medium', 'high'];

export function createSettings({ touch }) {
  const defaults = { quality: 'medium', autoQuality: true, sensitivity: 1, invertY: false, fov: 78, volume: 70, music: 60 };
  let s = { ...defaults };
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage blocked */ }
  if (!QUALITIES.includes(s.quality)) s.quality = defaults.quality;
  const listeners = [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };
  const emit = () => { for (const fn of listeners) fn(s); save(); };

  const panel = document.getElementById('panel');
  const $ = (sel) => panel.querySelector(sel);
  const seg = $('#q-seg'), sens = $('#s-sens'), fov = $('#s-fov'), vol = $('#s-vol'), mus = $('#s-mus'), inv = $('#t-inv'), auto = $('#t-auto');
  seg.innerHTML = QUALITIES.map((q) => `<button type="button" data-q="${q}" aria-pressed="false">${q}</button>`).join('');

  function render() {
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === s.quality)));
    sens.value = s.sensitivity; $('[data-o="sens"]').textContent = `${Number(s.sensitivity).toFixed(2)}×`;
    fov.value = s.fov; $('[data-o="fov"]').textContent = `${s.fov}°`;
    vol.value = s.volume; $('[data-o="vol"]').textContent = `${s.volume}%`;
    mus.value = s.music; $('[data-o="mus"]').textContent = `${s.music}%`;
    inv.setAttribute('aria-pressed', String(s.invertY)); inv.querySelector('span').textContent = s.invertY ? 'On' : 'Off';
    auto.setAttribute('aria-pressed', String(s.autoQuality)); auto.querySelector('span').textContent = s.autoQuality ? 'On' : 'Off';
    $('[data-f="qnote"]').textContent = {
      low: 'Low: no bloom, no shadows, lower resolution. For older phones.',
      medium: 'Medium: bloom and shadows at moderate resolution. Good for most phones and laptops.',
      high: 'High: full resolution, 4× multisampling, sharp shadows. For desktops.',
    }[s.quality];
  }
  seg.addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) { s.quality = b.dataset.q; render(); emit(); } });
  sens.addEventListener('input', () => { s.sensitivity = Number(sens.value); render(); emit(); });
  fov.addEventListener('input', () => { s.fov = Number(fov.value); render(); emit(); });
  vol.addEventListener('input', () => { s.volume = Number(vol.value); render(); emit(); });
  mus.addEventListener('input', () => { s.music = Number(mus.value); render(); emit(); });
  inv.addEventListener('click', () => { s.invertY = !s.invertY; render(); emit(); });
  auto.addEventListener('click', () => { s.autoQuality = !s.autoQuality; render(); emit(); });

  // tabs
  panel.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
    panel.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    panel.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; });
  }));

  let onClose = null;
  const api = {
    get: () => s,
    set(patch) { Object.assign(s, patch); render(); emit(); },
    onChange(fn) { listeners.push(fn); fn(s); },
    open(tab = 'settings', closed) {
      onClose = closed; render();
      panel.querySelector(`[data-tab="${tab}"]`).click();
      panel.hidden = false; panel.focus();
    },
    close() { if (panel.hidden) return; panel.hidden = true; const f = onClose; onClose = null; f && f(); },
    get isOpen() { return !panel.hidden; },
  };
  $('[data-act="close-panel"]').addEventListener('click', api.close);
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && api.isOpen) { e.stopPropagation(); api.close(); } }, true);
  render();
  return api;
}
