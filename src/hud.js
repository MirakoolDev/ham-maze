// HUD (compass + goal marker, objective/timer, ammo, integrity, hit markers, damage arcs) and menu screens.
export const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

export function createHud({ magSize = 30 } = {}) {
  const $ = (id) => document.getElementById(id);
  const menu = $('menu'), hud = $('hud'), timer = $('timer'), sub = $('sub'), msg = $('msg');
  const compass = $('compass'), ctx = compass.getContext('2d');
  const cross = $('cross'), hitm = $('hitm'), hurt = $('hurt'), arcs = $('arcs');
  const health = $('health'), hpn = $('hpn'), hpbar = $('hpbar');
  const ammo = $('ammo'), magEl = $('mag'), resEl = $('res'), pipsEl = $('pips'), cue = $('cue'), killsEl = $('kills');
  const handlers = {};
  let msgTimer = 0, hitT = 0, hurtT = 0, hp = 100, hpShowT = 0;

  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && handlers[b.dataset.act]) handlers[b.dataset.act]();
  });
  const fields = (name, value) => menu.querySelectorAll(`[data-f="${name}"]`).forEach((el) => { el.textContent = value; });

  hpbar.innerHTML = '<i></i>'.repeat(10);
  pipsEl.innerHTML = '<i></i>'.repeat(magSize);
  const pips = [...pipsEl.children], bars = [...hpbar.children];

  // pooled damage-direction arcs
  const arcPool = [];
  for (let i = 0; i < 4; i++) {
    const el = document.createElement('div'); el.className = 'h-arc';
    el.innerHTML = '<svg viewBox="-50 -50 100 100"><path d="M -14 -46 A 48 48 0 0 1 14 -46"/></svg>';
    arcs.appendChild(el); arcPool.push({ el, t: 0, ang: 0 });
  }

  let cw = 0, ch = 0, dpr = 1;
  function sizeCompass() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const r = compass.getBoundingClientRect();
    cw = r.width; ch = r.height;
    compass.width = Math.round(cw * dpr); compass.height = Math.round(ch * dpr);
  }
  addEventListener('resize', sizeCompass);

  const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  function drawCompass(heading, goalBearing, goalDist) {
    if (!cw) sizeCompass();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const span = 120, ppd = cw / span, cx = cw / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(40,32,60,.55)'; ctx.shadowBlur = 4;
    for (let d = Math.ceil((heading - span / 2) / 5) * 5; d <= heading + span / 2; d += 5) {
      const rel = d - heading, x = cx + rel * ppd, dd = ((d % 360) + 360) % 360;
      ctx.globalAlpha = Math.max(0, 1 - Math.pow(Math.abs(rel) / (span / 2), 3));
      ctx.fillStyle = '#fffaf2';
      const major = dd % 45 === 0, mid = dd % 15 === 0;
      const th = major ? 9 : mid ? 6 : 3;
      ctx.fillRect(x - (major ? 1 : 0.5), 24 - th, major ? 2 : 1, th);
      if (CARD[dd]) {
        ctx.font = dd % 90 === 0 ? '700 16px "Cabinet Grotesk", sans-serif' : '600 11px "Cabinet Grotesk", sans-serif';
        ctx.fillText(CARD[dd], x, dd % 90 === 0 ? 0 : 3);
      } else if (mid) {
        ctx.font = '400 9px "Cabinet Grotesk", sans-serif'; ctx.fillStyle = 'rgba(232,228,218,.64)';
        ctx.fillText(String(dd), x, 4);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ff9db0'; ctx.fillRect(cx - 1, 14, 2, 14);
    let rel = ((goalBearing - heading + 540) % 360) - 180;
    const edge = Math.abs(rel) > span / 2 - 4;
    rel = Math.max(-(span / 2 - 4), Math.min(span / 2 - 4, rel));
    const gx = cx + rel * ppd, gy = 33;
    ctx.globalAlpha = edge ? 0.6 : 1;
    ctx.strokeStyle = '#ff9db0'; ctx.lineWidth = 1.5; ctx.fillStyle = 'rgba(40,36,52,.45)';
    ctx.beginPath(); ctx.moveTo(gx, gy - 5); ctx.lineTo(gx + 5, gy); ctx.lineTo(gx, gy + 5); ctx.lineTo(gx - 5, gy); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = '400 10px "Cabinet Grotesk", sans-serif'; ctx.fillStyle = '#fffaf2'; ctx.textAlign = edge ? (rel < 0 ? 'left' : 'right') : 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(goalDist)}m`, gx + (edge && rel > 0 ? -9 : 9), gy);
    ctx.globalAlpha = 1;
  }

  return {
    on(name, fn) { handlers[name] = fn; },
    setScreen(s) {
      menu.dataset.screen = s || '';
      menu.classList.toggle('open', !!s);
      if (s) setTimeout(() => menu.querySelector(`[data-s="${s}"] .btn.primary, .m-title .btn.primary`)?.focus?.(), 60);
    },
    show(on) { hud.classList.toggle('on', on); if (on) sizeCompass(); },
    setSeed(seed) { fields('seed', String(seed)); },
    message(text, secs = 3) { msg.textContent = text; msg.classList.add('on'); msgTimer = secs; },
    debrief({ time, walked, retries, kills, acc, score }) {
      if (score) {
        fields('points', score.total.toLocaleString('en-US'));
        fields('breakdown', `Speed ${score.time.toLocaleString('en-US')} · Route ${score.route.toLocaleString('en-US')} · Sentries ${score.sentries.toLocaleString('en-US')}${score.rivals ? ` · Rivals ${score.rivals.toLocaleString('en-US')}` : ''}`);
      }
      fields('time', fmtTime(time)); fields('walked', `${Math.round(walked)} m`); fields('retries', String(retries));
      fields('kills', String(kills)); fields('acc', `${Math.round(acc * 100)}%`);
    },
    dead({ time, kills }) { fields('dtime', fmtTime(time)); fields('dkills', String(kills)); },
    hit(kind) { hitm.className = `h-hit ${kind}`; hitm.style.opacity = 1; hitT = kind === 'kill' ? 0.35 : 0.16; },
    /** relAngle: radians, 0 = in front, positive = to the left. */
    damage(relAngle, amount) {
      hurtT = Math.min(1, hurtT + amount / 30);
      const a = arcPool.reduce((m, x) => (x.t < m.t ? x : m), arcPool[0]);
      a.t = 1.1; a.ang = -relAngle;
      hpShowT = 4;
    },
    setKills(k, total) { killsEl.textContent = `${k}/${total}`; },
    hurtLevel: 0, lowHp: 0,
    reset() { hurtT = 0; hitT = 0; for (const a of arcPool) a.t = 0; hpShowT = 0; this.hurtLevel = 0; this.lowHp = 0; },
    update(dt, s) {
      timer.textContent = fmtTime(s.elapsed);
      sub.style.opacity = s.timerOn ? 0 : 1;
      drawCompass(s.heading, s.goalBearing, s.goalDist);
      if (msgTimer > 0 && (msgTimer -= dt) <= 0) msg.classList.remove('on');

      // crosshair: opens with spread, hidden when aiming through the sight
      cross.style.setProperty('--gap', `${(6 + s.spread * 900).toFixed(1)}px`);
      cross.classList.toggle('off', s.ads > 0.6 || s.sprinting);
      if (hitT > 0 && (hitT -= dt) <= 0) hitm.style.opacity = 0;

      // ammo
      magEl.textContent = s.mag; resEl.textContent = s.reserve;
      pips.forEach((p, i) => p.classList.toggle('off', i >= s.mag));
      const low = s.mag <= magSize * 0.25;
      ammo.classList.toggle('low', low);
      cue.textContent = s.reloading ? 'Reloading' : s.mag === 0 && s.reserve === 0 ? 'No ammo' : 'Reload';
      cue.classList.toggle('on', s.reloading || low);
      cue.classList.toggle('urgent', !s.reloading && s.mag === 0);

      // integrity
      if (s.hp !== hp) { hp = s.hp; hpn.textContent = Math.ceil(hp); bars.forEach((b, i) => b.classList.toggle('off', i >= Math.ceil(hp / 10))); }
      hpShowT -= dt;
      health.classList.toggle('on', hp < 100 || hpShowT > 0);
      health.classList.toggle('crit', hp <= 30);
      hurtT = Math.max(0, hurtT - dt * 1.4);
      this.hurtLevel = hurtT; this.lowHp = hp <= 30 ? 1 : 0;

      for (const a of arcPool) {
        if (a.t <= 0) { a.el.style.opacity = 0; continue; }
        a.t -= dt;
        a.el.style.opacity = Math.min(1, a.t);
        a.el.style.transform = `translate(-50%, -50%) rotate(${a.ang}rad)`;
      }
    },
    /** keep damage arcs pointing at their source while you turn */
    rotateArcs(dyaw) { for (const a of arcPool) a.ang += dyaw; },
  };
}
