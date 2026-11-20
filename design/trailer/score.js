// The trailer's sound, rendered offline (OfflineAudioContext) so it lines up with the picture to the
// sample: a synthesized score (drone, heartbeat, braams, risers, a 130 BPM pulse) under the gun and
// impact sounds from the same event list the picture uses, and the game's own theme opening up through a
// filter as she reaches home.
const SR = 48000;

export async function renderScore({ duration, events, cues, musicUrl }) {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);
  // a white-noise buffer and a long dark room for everything to sit in
  const noiseBuf = ctx.createBuffer(1, SR * 2, SR);
  { const d = noiseBuf.getChannelData(0); let s = 1; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; } }
  const room = ctx.createConvolver();
  { const n = SR * 3.2, ir = ctx.createBuffer(2, n, SR); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let s = 7 + c; for (let i = 0; i < n; i++) { s = (s * 48271) % 2147483647; d[i] = ((s / 2147483647) * 2 - 1) * Math.pow(1 - i / n, 2.6); } } room.buffer = ir; }
  const master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
  const limit = ctx.createDynamicsCompressor(); limit.threshold.value = -2; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
  master.connect(comp).connect(limit).connect(ctx.destination);
  const wet = ctx.createGain(); wet.gain.value = 0.32; room.connect(wet).connect(master);
  const bus = (dry = 1, rev = 0.3) => { const g = ctx.createGain(); g.gain.value = dry; g.connect(master); if (rev) { const r = ctx.createGain(); r.gain.value = rev; g.connect(r).connect(room); } return g; };

  const env = (g, t, a, peak, d, sustain = 0, rel = 0.05, hold = 0) => {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
    if (sustain) { g.gain.exponentialRampToValueAtTime(sustain, t + a + d); g.gain.setValueAtTime(sustain, t + a + d + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + hold + rel); }
    else g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  function osc(type, f, t, dur, out, { gain = 0.3, a = 0.005, d = dur, f2 = null, detune = 0 } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); env(g, t, a, gain, d); o.connect(g).connect(out); o.start(t); o.stop(t + a + d + 0.05);
    return o;
  }
  function noise(t, dur, out, { type = 'bandpass', f = 1000, f2 = null, q = 1, gain = 0.3, a = 0.003 } = {}) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); env(g, t, a, gain, dur); s.connect(fl).connect(g).connect(out); s.start(t, (t * 7.3) % 1.5); s.stop(t + a + dur + 0.05);
  }
  const drive = (amount) => { const w = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(x * amount); } w.curve = c; return w; };

  // ---- score ----
  const sfx = bus(1, 0.25), score = bus(1, 0.45), low = bus(1, 0.15);
  // a low drone: detuned saws through a slow lowpass swell
  function drone(t0, t1, f, peak = 0.12, cutoff = 420) {
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff; fl.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(2.5, (t1 - t0) * 0.5));
    g.gain.setValueAtTime(peak, t1 - 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t1);
    fl.connect(g).connect(score);
    for (const [m, dt] of [[1, -7], [1, 6], [2, 3], [1.5, -4]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * m; o.detune.value = dt; const og = ctx.createGain(); og.gain.value = m === 1 ? 0.5 : 0.22; o.connect(og).connect(fl); o.start(t0); o.stop(t1 + 0.1); }
  }
  // heartbeat: two low thumps
  function beat(t, gain = 0.6) { for (const [dt, k] of [[0, 1], [0.17, 0.7]]) { osc('sine', 62, t + dt, 0.28, low, { gain: gain * k, f2: 34 }); noise(t + dt, 0.05, low, { type: 'lowpass', f: 300, gain: 0.08 * k }); } }
  // braam: a wall of distorted brass-like saws, the filter opening then closing
  function braam(t, f = 55, len = 2.6, gain = 0.5) {
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 2; fl.frequency.setValueAtTime(140, t); fl.frequency.exponentialRampToValueAtTime(1900, t + 0.18); fl.frequency.exponentialRampToValueAtTime(220, t + len);
    const g = ctx.createGain(); env(g, t, 0.02, gain, len);
    const sh = drive(2.4); fl.connect(sh).connect(g).connect(score);
    for (const [m, dt] of [[1, -9], [1, 9], [2, -5], [2, 6], [3, 0], [0.5, 0]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * m; o.detune.value = dt; o.connect(fl); o.start(t); o.stop(t + len + 0.1); }
    impact(t, 0.9);
  }
  // impact: a sub drop, a cracking transient and a long tail
  function impact(t, gain = 0.8) { osc('sine', 90, t, 1.6, low, { gain, f2: 28 }); noise(t, 0.4, score, { type: 'lowpass', f: 2600, f2: 120, gain: 0.5 * gain }); noise(t, 0.08, sfx, { type: 'highpass', f: 2500, gain: 0.25 * gain }); }
  // riser: noise and a pitch climbing into the next hit
  function riser(t0, t1, gain = 0.22) { const d = t1 - t0; noise(t0, d, score, { type: 'bandpass', f: 300, f2: 6000, q: 2.5, gain, a: d * 0.9 }); osc('sawtooth', 110, t0, d, score, { gain: gain * 0.35, a: d * 0.9, f2: 880 }); }
  function whoosh(t, gain = 0.18) { noise(t - 0.18, 0.3, sfx, { type: 'bandpass', f: 500, f2: 3500, q: 1.4, gain, a: 0.17 }); }
  // the pulse: 8th notes at 130 BPM, an A minor figure on a filtered pluck
  function pulse(t0, t1, gain = 0.16, bright = 900) {
    const step = 60 / 130 / 2, notes = [55, 55, 55, 65.4, 55, 55, 82.4, 73.4];
    for (let i = 0, t = t0; t < t1 - 0.01; i++, t += step) {
      const f = notes[i % 8], fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 4; fl.frequency.setValueAtTime(bright * 2.2, t); fl.frequency.exponentialRampToValueAtTime(bright * 0.3, t + step);
      const g = ctx.createGain(); env(g, t, 0.004, gain, step * 0.95); fl.connect(g).connect(score);
      for (const dt of [-6, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * 2; o.detune.value = dt; o.connect(fl); o.start(t); o.stop(t + step + 0.05); }
      if (i % 4 === 0) { osc('sine', 70, t, 0.22, low, { gain: 0.45, f2: 40 }); }
      if (i % 4 === 2) noise(t, 0.12, sfx, { type: 'bandpass', f: 1800, q: 0.8, gain: 0.12 });
      if (i % 2 === 1) noise(t, 0.03, sfx, { type: 'highpass', f: 7000, gain: 0.05 });
    }
  }
  // high strings: slow tremolo on detuned triangles
  function strings(t0, t1, f = 440, gain = 0.035) {
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 1.5); g.gain.setValueAtTime(gain, t1 - 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t1);
    const trem = ctx.createGain(); trem.gain.value = 0.7; const lfo = ctx.createOscillator(); lfo.frequency.value = 7; const lg = ctx.createGain(); lg.gain.value = 0.3; lfo.connect(lg).connect(trem.gain); lfo.start(t0); lfo.stop(t1);
    trem.connect(g).connect(score);
    for (const [m, dt] of [[1, -8], [1, 8], [1.189, 0], [1.498, 4]]) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f * m; o.detune.value = dt; o.connect(trem); o.start(t0); o.stop(t1 + 0.1); }
  }

  for (const c of cues) {
    if (c.k === 'drone') drone(c.t0, c.t1, c.f || 55, c.gain, c.cutoff);
    else if (c.k === 'beats') { for (let t = c.t0, i = 0; t < c.t1; i++) { beat(t, c.gain || 0.55); t += Math.max(c.min || 0.45, (c.every || 1) - i * (c.accel || 0)); } }
    else if (c.k === 'braam') braam(c.t, c.f, c.len, c.gain);
    else if (c.k === 'impact') impact(c.t, c.gain);
    else if (c.k === 'riser') riser(c.t0, c.t1, c.gain);
    else if (c.k === 'whoosh') whoosh(c.t, c.gain);
    else if (c.k === 'pulse') pulse(c.t0, c.t1, c.gain, c.bright);
    else if (c.k === 'strings') strings(c.t0, c.t1, c.f, c.gain);
    else if (c.k === 'tick') { osc('sine', 1760, c.t, 0.06, sfx, { gain: 0.05 }); }
  }

  // ---- sound effects, from the picture's own events ----
  for (const e of events) {
    const t = e.t;
    if (t < 0 || t > duration) continue;
    if (e.type === 'pop') { // the Marker: a wet paint pop
      noise(t, 0.09, sfx, { type: 'bandpass', f: 1400, f2: 500, q: 1.2, gain: 0.45 });
      osc('square', 520, t, 0.07, sfx, { gain: 0.08, f2: 160 }); osc('sine', 120, t, 0.12, low, { gain: 0.35, f2: 60 });
    } else if (e.type === 'zap') { // the Blinker: an ember crack
      noise(t, 0.12, sfx, { type: 'highpass', f: 1800, gain: 0.3 }); osc('sawtooth', 1300, t, 0.13, sfx, { gain: 0.09, f2: 180 }); osc('sine', 90, t, 0.15, low, { gain: 0.3, f2: 45 });
    } else if (e.type === 'bolt') { // a sentry bolt
      osc('sine', 880, t, 0.35, sfx, { gain: 0.07, f2: 220 }); noise(t, 0.2, sfx, { type: 'bandpass', f: 1200, f2: 400, q: 3, gain: 0.08 });
    } else if (e.type === 'spark') noise(t, 0.06, sfx, { type: 'highpass', f: 3200, gain: 0.12 * (e.gain || 1) });
    else if (e.type === 'boom') { // a sentry breaking up
      osc('sine', 75, t, 1.1, low, { gain: 0.7, f2: 30 }); noise(t, 0.7, sfx, { type: 'lowpass', f: 1800, f2: 150, gain: 0.55 });
      for (let i = 0; i < 6; i++) noise(t + 0.05 + i * 0.07, 0.04, sfx, { type: 'highpass', f: 4000, gain: 0.08 });
    } else if (e.type === 'thud') { osc('sine', 60, t, 0.4, low, { gain: 0.55, f2: 35 }); noise(t, 0.25, sfx, { type: 'lowpass', f: 900, gain: 0.25 }); }
    else if (e.type === 'step') noise(t, 0.05, sfx, { type: 'bandpass', f: 600, q: 1, gain: 0.06 * (e.gain || 1) });
    else if (e.type === 'jump') { noise(t, 0.35, sfx, { type: 'bandpass', f: 400, f2: 1400, q: 1, gain: 0.12 }); }
    else if (e.type === 'shake') { for (let i = 0; i < 9; i++) noise(t + 0.15 + i * 0.09, 0.05, sfx, { type: 'bandpass', f: 2600 + (i % 2) * 700, q: 3, gain: 0.08 }); }
    else if (e.type === 'charge') osc('sine', 300, t, 0.6, sfx, { gain: 0.06, f2: 1600, a: 0.5 });
    else if (e.type === 'dissolve') { noise(t, 2.2, score, { type: 'bandpass', f: 6000, f2: 900, q: 0.7, gain: 0.12, a: 0.2 }); osc('sine', 220, t, 2, score, { gain: 0.05, f2: 880 }); }
    else if (e.type === 'surge') { impact(t, 1); noise(t, 3.2, score, { type: 'bandpass', f: 400, f2: 5000, q: 0.6, gain: 0.18, a: 0.05 }); for (const f of [220, 330, 440, 660]) osc('sine', f, t, 3.4, score, { gain: 0.035, a: 0.4 }); }
  }

  // ---- the game's theme, opening through a lowpass as she nears the monolith ----
  if (musicUrl && cues.music) {
    const { t0, open, end } = cues.music;
    const ab = await (await fetch(musicUrl)).arrayBuffer();
    const buf = await ctx.decodeAudioData(ab);
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 0.8;
    fl.frequency.setValueAtTime(260, t0); fl.frequency.exponentialRampToValueAtTime(900, open - 0.4); fl.frequency.exponentialRampToValueAtTime(18000, open);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 1.5); g.gain.setValueAtTime(0.5, open - 0.05); g.gain.linearRampToValueAtTime(0.8, open);
    g.gain.setValueAtTime(0.8, end - 2.2); g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(fl).connect(g).connect(master); src.start(t0); src.stop(end + 0.1);
  }
  const buf = await ctx.startRendering();
  // the WebAudio limiter can overshoot on hard transients: round off anything above 0.75 so peaks stay under -0.5 dBFS
  const K = 0.75, room2 = 0.94 - K;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const x = d[i], a = Math.abs(x); if (a > K) d[i] = Math.sign(x) * (K + room2 * Math.tanh((a - K) / room2)); }
  }
  return buf;
}
