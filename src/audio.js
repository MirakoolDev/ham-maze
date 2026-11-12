// All sound is synthesized with Web Audio (nothing downloaded). Started from the Enter click (browsers need a gesture).
export function createAudio() {
  let ctx = null, master = null, noiseBuf = null;
  let listener = { x: 0, z: 0, yaw: 0 };
  const a = { volume: 0.7 };

  a.init = () => {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = a.volume;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ctx = null; }
  };
  a.setListener = (x, z, yaw) => { listener = { x, z, yaw }; };
  a.setVolume = (v) => { a.volume = v; if (master) master.gain.value = v; };

  /** Gain + pan node for a sound at world position p (or null for "in your head"). */
  function out(p, vol = 1, range = 50) {
    const g = ctx.createGain();
    let gain = vol, pan = 0;
    if (p) {
      const dx = p.x - listener.x, dz = p.z - listener.z, dist = Math.hypot(dx, dz);
      gain *= Math.max(0, 1 - dist / range) ** 1.5;
      const ang = Math.atan2(-dx, -dz) - listener.yaw;
      pan = -Math.sin(ang) * 0.8;
    }
    g.gain.value = gain;
    if (ctx.createStereoPanner) { const s = ctx.createStereoPanner(); s.pan.value = pan; g.connect(s).connect(master); } else g.connect(master);
    return g;
  }
  function noise(dest, { t = 0, dur = 0.2, type = 'lowpass', f = 1000, f2 = null, q = 0.8, gain = 1 }) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    const now = ctx.currentTime + t;
    fl.frequency.setValueAtTime(f, now); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    s.connect(fl).connect(g).connect(dest);
    s.start(now, Math.random() * 0.5); s.stop(now + dur + 0.02);
  }
  function tone(dest, { t = 0, dur = 0.2, type = 'sine', f = 440, f2 = null, gain = 1 }) {
    const o = ctx.createOscillator(); o.type = type;
    const now = ctx.currentTime + t;
    o.frequency.setValueAtTime(f, now); if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g).connect(dest); o.start(now); o.stop(now + dur + 0.02);
  }
  const ok = () => !!ctx;

  a.shot = () => {
    if (!ok()) return;
    const d = out(null, 0.9);
    const k = 0.92 + Math.random() * 0.16;
    noise(d, { dur: 0.09, type: 'bandpass', f: 2600 * k, f2: 700, q: 0.6, gain: 1.1 });
    tone(d, { dur: 0.14, type: 'triangle', f: 150 * k, f2: 45, gain: 1.2 });
    noise(d, { t: 0.02, dur: 0.35, type: 'lowpass', f: 900, f2: 200, gain: 0.35 }); // corridor slap
    noise(d, { t: 0.11, dur: 0.5, type: 'bandpass', f: 600, f2: 250, q: 0.5, gain: 0.12 }); // echo off the walls
  };
  a.empty = () => { if (!ok()) return; tone(out(null, 0.5), { dur: 0.03, type: 'square', f: 1800, gain: 0.4 }); };
  a.reload = () => {
    if (!ok()) return;
    const d = out(null, 0.6);
    noise(d, { t: 0.15, dur: 0.05, type: 'highpass', f: 2500, gain: 0.7 });
    tone(d, { t: 0.16, dur: 0.04, type: 'square', f: 900, gain: 0.25 });
    noise(d, { t: 1.05, dur: 0.06, type: 'highpass', f: 1800, gain: 0.8 });
    tone(d, { t: 1.55, dur: 0.05, type: 'square', f: 600, f2: 1200, gain: 0.3 });
    noise(d, { t: 1.6, dur: 0.05, type: 'highpass', f: 3000, gain: 0.6 });
  };
  a.hit = (crit) => { if (!ok()) return; tone(out(null, 0.45), { dur: 0.05, type: 'square', f: crit ? 2400 : 1600, f2: crit ? 1800 : 1200, gain: 0.35 }); };
  a.kill = (p) => {
    if (!ok()) return;
    const d = out(p, 1, 70);
    noise(d, { dur: 0.7, type: 'lowpass', f: 2400, f2: 120, gain: 1 });
    tone(d, { dur: 0.5, type: 'sawtooth', f: 520, f2: 60, gain: 0.35 });
  };
  a.enemyShot = (p) => {
    if (!ok()) return;
    const d = out(p, 0.8, 60);
    tone(d, { dur: 0.22, type: 'sawtooth', f: 1100, f2: 180, gain: 0.35 });
    noise(d, { dur: 0.15, type: 'bandpass', f: 1500, f2: 400, gain: 0.5 });
  };
  a.charge = (p) => { if (!ok()) return; tone(out(p, 0.5, 45), { dur: 0.45, type: 'sine', f: 300, f2: 1400, gain: 0.3 }); };
  a.alert = (p) => {
    if (!ok()) return;
    const d = out(p, 0.6, 45);
    tone(d, { dur: 0.09, type: 'square', f: 880, gain: 0.18 }); tone(d, { t: 0.12, dur: 0.12, type: 'square', f: 1320, gain: 0.18 });
  };
  a.hurt = () => {
    if (!ok()) return;
    const d = out(null, 0.8);
    tone(d, { dur: 0.25, type: 'sine', f: 110, f2: 50, gain: 1 });
    noise(d, { dur: 0.2, type: 'lowpass', f: 700, f2: 200, gain: 0.6 });
  };
  a.win = () => {
    if (!ok()) return;
    const d = out(null, 0.7);
    // a low swell that rises into the monolith, then a bright open chord that rings out
    tone(d, { dur: 1.2, type: 'sine', f: 55, f2: 110, gain: 0.55 });
    noise(d, { dur: 1.1, type: 'bandpass', f: 300, f2: 2400, q: 1.4, gain: 0.25 });
    [261.6, 392, 523.3, 659.3, 784].forEach((f, i) => {
      tone(d, { t: 0.55 + i * 0.07, dur: 2.6, type: 'sine', f, gain: 0.22 });
      tone(d, { t: 0.55 + i * 0.07, dur: 1.6, type: 'triangle', f: f * 2.003, gain: 0.05 });
    });
  };
  let stepT = 0;
  a.step = (dt, speed, grounded) => {
    if (!ok() || !grounded || speed < 1) { stepT = 0; return; }
    stepT -= dt * (speed / 3.2);
    if (stepT <= 0) { stepT = 1; noise(out(null, 0.25), { dur: 0.08, type: 'bandpass', f: 400 + Math.random() * 200, q: 1.2, gain: 0.5 }); }
  };
  return a;
}
