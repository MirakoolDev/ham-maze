/* HAM art: the Score and Power-Up drawings, prototyped in JS.
   Everything is deterministic from fields the contract already stores (day, points, time, kills,
   completed, token id), so tokenURI() can emit the same SVG on chain. */
(function () {
  'use strict';

  // Same .NET System.Random port the game uses (src/rng.js), so the drawn maze is the maze people ran.
  const MBIG = 2147483647, MSEED = 161803398;
  function DotNetRandom(seed) {
    const a = new Array(56).fill(0);
    const sub = seed === -2147483648 ? MBIG : Math.abs(seed);
    let mj = MSEED - sub, mk = 1;
    a[55] = mj;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      a[ii] = mk; mk = mj - mk; if (mk < 0) mk += MBIG; mj = a[ii];
    }
    for (let k = 1; k < 5; k++) for (let i = 1; i < 56; i++) { a[i] -= a[1 + ((i + 30) % 55)]; if (a[i] < 0) a[i] += MBIG; }
    let inext = 0, inextp = 21;
    this.next = function (max) {
      if (++inext >= 56) inext = 1;
      if (++inextp >= 56) inextp = 1;
      let r = a[inext] - a[inextp];
      if (r === MBIG) r--;
      if (r < 0) r += MBIG;
      a[inext] = r;
      return Math.floor(r * (1.0 / MBIG) * max);
    };
  }

  // Recursive backtracker, identical to src/maze.js (0 loops).
  function generateMaze(w, d, seed) {
    const rng = new DotNetRandom(seed);
    const cells = [];
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) cells.push({ x, z, v: false, L: true, R: true, F: true, B: true });
    const cell = (x, z) => cells[x * d + z];
    const unvisited = (c) => {
      const o = [];
      if (c.x + 1 < w && !cell(c.x + 1, c.z).v) o.push(cell(c.x + 1, c.z));
      if (c.x - 1 >= 0 && !cell(c.x - 1, c.z).v) o.push(cell(c.x - 1, c.z));
      if (c.z + 1 < d && !cell(c.x, c.z + 1).v) o.push(cell(c.x, c.z + 1));
      if (c.z - 1 >= 0 && !cell(c.x, c.z - 1).v) o.push(cell(c.x, c.z - 1));
      return o;
    };
    const clear = (p, c) => {
      if (!p) return;
      if (p.x < c.x) { p.R = false; c.L = false; }
      else if (p.x > c.x) { p.L = false; c.R = false; }
      else if (p.z < c.z) { p.F = false; c.B = false; }
      else if (p.z > c.z) { p.B = false; c.F = false; }
    };
    const visit = (p, c) => {
      c.v = true; clear(p, c);
      let n;
      do { const u = unvisited(c); n = u.length ? u[rng.next(u.length)] : null; if (n) visit(c, n); } while (n);
    };
    visit(null, cell(0, 0));
    return { w, d, cells, cell, goal: { x: Math.floor(w / 2), z: Math.floor(d / 2) } };
  }

  function walk(m) {
    const n = m.w * m.d, dist = new Array(n).fill(-1), prev = new Array(n).fill(-1);
    const idx = (x, z) => x * m.d + z;
    const q = [0]; dist[0] = 0;
    while (q.length) {
      const i = q.shift(), x = Math.floor(i / m.d), z = i % m.d, c = m.cells[i];
      const go = (nx, nz) => { const j = idx(nx, nz); if (dist[j] < 0) { dist[j] = dist[i] + 1; prev[j] = i; q.push(j); } };
      if (!c.R) go(x + 1, z);
      if (!c.L) go(x - 1, z);
      if (!c.F) go(x, z + 1);
      if (!c.B) go(x, z - 1);
    }
    const routeTo = (t) => { const r = []; for (let i = t; i >= 0; i = prev[i]) r.unshift(i); return r; };
    return { dist, prev, idx, routeTo };
  }

  // Five rooms, one per day, taken from the portfolio: the red room, a dusk sky, the pool, iris, the dunes.
  const ROOMS = [
    { name: 'Red Room', top: '#d24a37', bottom: '#8d2119', ink: '#fff2ec', slab: '#f6e6e3' },
    { name: 'Dusk', top: '#7c9fd9', bottom: '#f4d0bb', ink: '#1d1b27', slab: '#f5f0f1' },
    { name: 'Pool', top: '#58b8b0', bottom: '#d7efe9', ink: '#0f2f2c', slab: '#eff5f3' },
    { name: 'Iris', top: '#9985de', bottom: '#f3d1e4', ink: '#221a3c', slab: '#f4eff7' },
    { name: 'Dunes', top: '#d99770', bottom: '#f7e5d4', ink: '#3b2417', slab: '#f7f0e9' },
  ];
  const roomOf = (seed) => ROOMS[new DotNetRandom(seed ^ 0x4841).next(ROOMS.length)];

  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const f1 = (n) => Math.round(n * 10) / 10;
  const FONT = `font-family="Jost, Futura, 'Avenir Next', 'Century Gothic', sans-serif"`;

  const seedFromDate = (d) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const dateLabel = (seed) => `${Math.floor(seed / 10000)}.${String(Math.floor(seed / 100) % 100).padStart(2, '0')}.${String(seed % 100).padStart(2, '0')}`;
  const clock = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function blurDefs(uid, list) {
    return list.map((n) => `<filter id="${uid}b${n}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${n}"/></filter>`).join('');
  }
  function grain(uid, seed) {
    return `<filter id="${uid}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" seed="${seed % 97}"/><feColorMatrix type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 0.07"/></filter>`;
  }

  /* Integer geometry, so the contract's renderer (HamScoreArt.sol) can match this drawing byte for byte.
     Reach is measured in thousandths of a cell, as a straight-line radius from the entrance corner.
     The monolith sits 8.5 cells away. A finished run reaches it; a lost one grows with time and kills.
     It is a radius, not a path: the drawing reveals a round patch of walls, never the route through them. */
  function reachOf(o) {
    if (o.completed) return 9300;
    return Math.max(2000, Math.min(7400, 1500 + Math.floor(o.timeMs / 20) + o.kills * 500));
  }
  // While the day is live every Score is sealed: only the entrance corner shows, which every player
  // sees the moment they spawn. The rest develops once that maze is retired at 00:00 UTC.
  const SEALED_REACH = 2200;
  // within(q, R, t): is a wall whose squared distance is q/4 cells² inside radius (R - t)/1000?
  const within = (q, R, t) => R > t && 1e6 * q <= 4 * (R - t) * (R - t);
  // A lost run's figure stands on diagonal cell k: round((R - 600) / (1000·√2)), at most 5.
  function lostCell(R) {
    for (let k = 5; k >= 1; k--) if (R > 600 && 2 * ((2 * k - 1) * 1000) ** 2 <= 4 * (R - 600) ** 2) return k;
    return 0;
  }

  function describe(seed) {
    const m = generateMaze(12, 12, seed), w = walk(m);
    return { room: roomOf(seed), toGoal: w.dist[w.idx(m.goal.x, m.goal.z)] };
  }

  // Fixed geometry of the 12 x 12 model.
  const SW = 12, SD = 12, SU = 26, SP = SW * SU, STH = 6, SH = 16, SHB = [16, 10, 5];
  const SCX = 300, SCY = 316, SK = 0.5774, SC = Math.SQRT1_2, SMH = 292;
  const ISO = `translate(${SCX} ${SCY}) scale(1 ${SK}) rotate(45) translate(${-SP / 2} ${-SP / 2})`;
  const sproj = (px, pz) => { const x = px - SP / 2, y = pz - SP / 2; return [SCX + (x - y) * SC, SCY + (x + y) * SC * SK]; };
  const cellXY = (x, z) => [(x + 0.5) * SU, (SD - z - 0.5) * SU];
  const GC = cellXY(6, 6), START = cellXY(0, 0);
  // where the figure stands (iso-plane coords); k = -1 means found, beside the monolith
  const figXYOf = (k) => (k < 0 ? [GC[0] + 0.46 * SU, GC[1] + 0.1 * SU] : cellXY(k, k));
  // walls are banded against the actors by depth; depth on screen grows with px + pz
  const FIG_DEPTH100 = (k) => { const f = figXYOf(k); return Math.round((f[0] + f[1]) * 100); };
  const MONO_DEPTH100 = (GC[0] + GC[1]) * 100;

  const DARK = '#262842';
  function scorePalette(room, lost) {
    const dim = (c) => (lost ? mix(c, DARK, 0.34) : c);
    const slabTop = dim(room.slab);
    return {
      slabTop, slabSide: dim(mix(room.slab, '#6d6577', 0.38)), lattice: mix(slabTop, '#7d7489', 0.38),
      wallTop: dim('#fbfaff'), side: [dim('#a9d0f3'), dim('#f2b6c8')], shade: dim('#5b5170'),
      ink: lost ? '#f4f1f8' : room.ink,
    };
  }
  const stackColour = (pal, o2, b, k) => (k === SHB[b] ? pal.wallTop : mix(pal.side[o2], pal.shade, 0.24 * (1 - k / SHB[b])));

  function scoreMonolith(uid, lost) {
    const hw = 0.24 * SU;
    const cs = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]].map((p) => sproj(GC[0] + p[0], GC[1] + p[1]));
    const Lp = cs.reduce((a, p) => (p[0] < a[0] ? p : a)), Rp = cs.reduce((a, p) => (p[0] > a[0] ? p : a)), Fp = cs.reduce((a, p) => (p[1] > a[1] ? p : a));
    const base = sproj(GC[0], GC[1]);
    const at = (p) => `${f1(p[0])},${f1(p[1])}`, up = (p) => `${f1(p[0])},${f1(p[1] - SMH)}`, out = [];
    if (!lost) {
      out.push(`<rect x="${f1(Fp[0] - 36)}" y="${f1(Fp[1] - SMH)}" width="72" height="${SMH}" fill="url(#${uid}mg)" opacity="0.4" filter="url(#${uid}b16)"/>`);
      out.push(`<ellipse cx="${f1(base[0])}" cy="${f1(base[1])}" rx="50" ry="21" fill="#ff8a3d" opacity="0.7" filter="url(#${uid}b10)"/>`);
    }
    out.push(`<polygon points="${at(Lp)} ${at(Fp)} ${up(Fp)} ${up(Lp)}" fill="url(#${uid}ml)"/>`);
    out.push(`<polygon points="${at(Fp)} ${at(Rp)} ${up(Rp)} ${up(Fp)}" fill="url(#${uid}mr)"/>`);
    if (!lost) {
      out.push(`<rect x="${f1(Fp[0] - 3)}" y="${f1(Fp[1] - SMH)}" width="6" height="${SMH}" fill="url(#${uid}mc)" filter="url(#${uid}b3)"/>`);
      out.push(`<line x1="${f1(Fp[0])}" y1="${f1(Fp[1])}" x2="${f1(Fp[0])}" y2="${f1(Fp[1] - SMH)}" stroke="url(#${uid}mc)" stroke-width="0.8"/>`);
    }
    const vg = (id, stops) => `<linearGradient id="${uid}${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(Fp[1])}" x2="0" y2="${f1(Fp[1] - SMH)}">${stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}" stop-opacity="${s[2]}"/>`).join('')}</linearGradient>`;
    const defs = lost
      ? vg('ml', [[0, '#cfa894', 0.5], [0.5, '#cfa894', 0.16], [1, '#cfa894', 0]]) + vg('mr', [[0, '#a8877a', 0.55], [0.5, '#a8877a', 0.18], [1, '#a8877a', 0]])
      : vg('ml', [[0, '#ff7a2e', 0.95], [0.16, '#ff8a3d', 0.75], [0.6, '#ffa56a', 0.26], [1, '#ffc39a', 0]]) + vg('mr', [[0, '#e8500f', 0.97], [0.18, '#f0662a', 0.7], [0.6, '#f58a50', 0.22], [1, '#ffb27a', 0]]) +
        vg('mc', [[0, '#fff6ec', 1], [0.45, '#ffc497', 0.65], [1, '#ffb27a', 0]]) + vg('mg', [[0, '#ff7a2e', 0.9], [1, '#ff7a2e', 0]]);
    return { defs, body: out.join('') };
  }

  function scoreFigure(uid, k) {
    const lost = k >= 0, f = figXYOf(k), fig = sproj(f[0], f[1]);
    const rim = lost ? '#d8f4ff' : '#ffe2c6';
    const body = 'M-5,-16.8C-2.2,-18.6 2.2,-18.6 5,-16.8L5.6,-7.4L4,-7.2L3.4,0L1,0L0.5,-6.6L-0.5,-6.6L-1,0L-3.4,0L-4,-7.2L-5.6,-7.4Z';
    const shape = (attr) => `<path d="${body}" ${attr}/><circle cx="0" cy="-21.6" r="3.5" ${attr}/>`;
    return `<g transform="translate(${f1(fig[0])} ${f1(fig[1] + 1)})">` +
      `<ellipse cx="0" cy="0.4" rx="6.5" ry="2.4" fill="#000" opacity="0.3"/>` +
      `<g filter="url(#${uid}b2)">${shape(`fill="none" stroke="${rim}" stroke-width="2.6"`)}</g>` +
      shape(`fill="#0b0a10" stroke="${rim}" stroke-width="0.7" stroke-opacity="0.9"`) + '</g>';
  }

  // the floor's sightline from START to the figure, and the entrance ring
  function scoreFloorMarks(uid, k) {
    const lost = k >= 0, f = figXYOf(k), col = lost ? '#e9f6ff' : '#ff5f9e';
    return `<path transform="${ISO}" d="M${START[0]} ${START[1]}L${f1(f[0])} ${f1(f[1])}" fill="none" stroke="${lost ? '#e9f6ff' : '#ff8a3d'}" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="0.1 7" opacity="0.75"/>` +
      `<circle transform="${ISO}" cx="${START[0]}" cy="${START[1]}" r="${SU * 0.3}" fill="none" stroke="${col}" stroke-width="2.2" opacity="0.9"/>` +
      `<circle transform="${ISO}" cx="${START[0]}" cy="${START[1]}" r="${SU * 0.09}" fill="${col}"/>`;
  }

  /** The Score: the day's maze as a floating model, walls standing as far as the run reached. */
  function scoreSVG(o) {
    const uid = o.uid || 's', seed = o.seed;
    const m = generateMaze(SW, SD, seed);
    const lost = !o.completed, sealed = !!o.sealed, R = reachOf(o), room = roomOf(seed);
    const reach = sealed ? SEALED_REACH : R;
    const pal = scorePalette(room, lost);

    // Who stands where. Found: beside the monolith. Lost: on the straight line from the entrance to the
    // monolith, as far in as the run got. Neither position depends on the maze's walls.
    const k = lost ? lostCell(R) : -1, short = lost ? 6 - k : 0;
    const figD = FIG_DEPTH100(k);
    const actors = [{ d: MONO_DEPTH100, kind: 'mono' }, { d: figD, kind: 'fig' }].sort((a, b) => a.d - b.d);

    // Sort every wall by orientation, how risen it is (by straight-line distance from the entrance,
    // so the revealed patch is round and says nothing about the route) and which side of the actors it is on.
    const segs = {}, ao = [];
    const add = (o2, q, d, depth100) => {
      const b = within(q, reach, 1400) ? 0 : within(q, reach, 700) ? 1 : within(q, reach, 0) ? 2 : 3;
      if (b === 3) return;
      ao.push(d);
      const band = actors.filter((a) => a.d < depth100).length, key = `${o2}${b}${band}`;
      (segs[key] = segs[key] || []).push(d);
    };
    for (let j = 0; j <= SD; j++) for (let x = 0; x < SW; x++) {
      if (!(j < SD ? m.cell(x, j).B : m.cell(x, SD - 1).F)) continue;
      const pz = (SD - j) * SU;
      add(0, 4 * x * x + (2 * j - 1) ** 2, `M${x * SU} ${pz}h${SU}`, (x * SU + SU / 2 + pz) * 100);
    }
    for (let i = 0; i <= SW; i++) for (let z = 0; z < SD; z++) {
      if (!(i < SW ? m.cell(i, z).L : m.cell(SW - 1, z).R)) continue;
      add(1, (2 * i - 1) ** 2 + 4 * z * z, `M${i * SU} ${(SD - z) * SU}v${-SU}`, (i * SU + (SD - z) * SU - SU / 2) * 100);
    }
    const keys = [];
    for (let o2 = 0; o2 < 2; o2++) for (let b = 0; b < 3; b++) for (let band = 0; band < 3; band++) if (segs[`${o2}${b}${band}`]) keys.push(`${o2}${b}${band}`);

    const mono = scoreMonolith(uid, lost);
    const s = [];
    s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">`);
    s.push('<defs>');
    s.push(`<linearGradient id="${uid}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${room.top}"/><stop offset="1" stop-color="${room.bottom}"/></linearGradient>`);
    s.push(`<radialGradient id="${uid}pool"><stop offset="0" stop-color="#ff8a3d" stop-opacity="0.85"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/></radialGradient>`);
    s.push(mono.defs);
    s.push(blurDefs(uid, [2, 3, 10, 16, 24]));
    s.push(grain(uid, seed));
    s.push(`<g id="${uid}slab"><rect transform="${ISO}" x="-14" y="-14" width="${SP + 28}" height="${SP + 28}" rx="6"/></g>`);
    for (const key of keys) s.push(`<g id="${uid}w${key}"><path transform="${ISO}" d="${segs[key].join('')}" fill="none" stroke-width="${STH}" stroke-linecap="square"/></g>`);
    s.push('</defs>');

    // room and the model's shadow
    s.push(`<rect width="600" height="600" fill="url(#${uid}bg)"/>`);
    if (lost) s.push(`<rect width="600" height="600" fill="#11143a" opacity="0.52"/>`);
    s.push(`<ellipse cx="300" cy="${SCY + 208}" rx="200" ry="24" fill="#000" opacity="${lost ? 0.4 : 0.2}" filter="url(#${uid}b24)"/>`);

    // the slab: stacked so its edge thins out underneath
    const T = 22;
    for (let i = T; i >= 1; i--) s.push(`<use href="#${uid}slab" y="${i}" fill="${pal.slabSide}" opacity="${f1(1 - (i / T) * 0.82)}"/>`);
    s.push(`<use href="#${uid}slab" fill="${pal.slabTop}"/>`);

    // Floor. No plan of the unseen walls and no route: only a plain cell lattice (the same for every
    // maze), soft contact shadows under standing walls, the entrance, and a straight sightline to the figure.
    const lat = [];
    for (let i = 1; i < SW; i++) for (let j = 1; j < SD; j++) lat.push(`M${i * SU} ${j * SU}h0.01`);
    s.push(`<path transform="${ISO}" d="${lat.join('')}" stroke="${pal.lattice}" stroke-width="2.2" stroke-linecap="round"/>`);
    s.push(`<path transform="${ISO}" d="${ao.join('')}" fill="none" stroke="#2a2233" stroke-opacity="0.22" stroke-width="${STH + 4}" stroke-linecap="square" filter="url(#${uid}b3)"/>`);
    if (!lost) s.push(`<circle transform="${ISO}" cx="${GC[0]}" cy="${GC[1]}" r="${SU * 2.6}" fill="url(#${uid}pool)"/>`);
    s.push(scoreFloorMarks(uid, k));

    const stack = (band) => {
      const out = [];
      for (let h = 0; h <= SH; h++) for (let b = 0; b < 3; b++) {
        if (h > SHB[b]) continue;
        for (let o2 = 0; o2 < 2; o2++) {
          const key = `${o2}${b}${band}`;
          if (!segs[key]) continue;
          out.push(`<use href="#${uid}w${key}" y="${-h}" stroke="${stackColour(pal, o2, b, h)}"/>`);
        }
      }
      return out.join('');
    };
    for (let band = 0; band <= actors.length; band++) {
      s.push(stack(band));
      if (band < actors.length) s.push(actors[band].kind === 'mono' ? mono.body : scoreFigure(uid, k));
    }

    s.push(`<rect width="600" height="600" filter="url(#${uid}n)"/>`);

    // the label, kept as quiet as the portfolio's
    const pts$ = Number(o.points).toLocaleString('en-US');
    s.push(`<g ${FONT} fill="${pal.ink}">`);
    s.push(`<text x="40" y="56" font-size="15" font-weight="600" letter-spacing="4.5">HAM</text>`);
    s.push(`<text x="40" y="76" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">${room.name.toUpperCase()}</text>`);
    s.push(`<text x="560" y="56" text-anchor="end" font-size="13" font-weight="500" letter-spacing="2">${dateLabel(seed)}</text>`);
    s.push(`<text x="560" y="76" text-anchor="end" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">NO. ${o.tokenId}</text>`);
    s.push(`<text x="38" y="542" font-size="46" font-weight="500" letter-spacing="-1">${pts$}</text>`);
    s.push(`<text x="40" y="568" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.75">POINTS &#183; ${o.kills} KILLS &#183; ${clock(o.timeMs)}</text>`);
    const st = sproj(START[0], START[1]);
    s.push(`<text x="${f1(st[0] - 16)}" y="${f1(st[1] + 4)}" text-anchor="end" font-size="9" font-weight="600" letter-spacing="2.2" opacity="0.8">START</text>`);
    s.push(`<text x="560" y="568" text-anchor="end" font-size="11" font-weight="600" letter-spacing="2.6">${lost ? `SIGNAL LOST &#183; ${short} ${short === 1 ? 'CELL' : 'CELLS'} SHORT` : 'MONOLITH FOUND'}</text>`);
    if (sealed) s.push(`<text x="560" y="548" text-anchor="end" font-size="10" font-weight="500" letter-spacing="2.4" opacity="0.72">SEALED &#183; DEVELOPS 00:00 UTC</text>`);
    s.push('</g></svg>');
    return s.join('');
  }
  const scoreParts = { scorePalette, stackColour, scoreMonolith, scoreFigure, scoreFloorMarks, reachOf, lostCell, SEALED_REACH };


  /* The Power-Ups are the guns (design/royale.src.html: "guns are power-ups you keep").
     Everyone starts with the K-7. Each gun NFT trades raw damage for one move, with a few charges per run.
     Every HAM gun carries the same small orange glass sight: a piece of the monolith. */
  const GUNS = {
    marker: {
      name: 'Marker', rarity: 'COMMON', room: 'Dunes', charges: -1, chargeText: 'UNLIMITED PAINT',
      move: 'PAINTS DEAD ENDS PINK, ALL DAY', dmg: 12,
      body: ['#fff6f8', '#f7c3d3', '#cf8aa3'], metal: ['#fdf3f6', '#ead6e2', '#b89cb3'], grip: ['#fff0f5', '#f3a9c2', '#c46f8f'],
      accent: '#ff4f97', glow: '#ff7db4', barrel: 34,
    },
    frost: {
      name: 'Frost dart', rarity: 'RARE', room: 'Pool', charges: 3, chargeText: '3 CHARGES / RUN',
      move: 'FREEZES A RIVAL OR SENTRY FOR 3 S',
      body: ['#ffffff', '#dcf1ff', '#94bfdf'], metal: ['#f4fbff', '#c6e2f4', '#7fa7c6'], grip: ['#eef8ff', '#a9d4f2', '#6d9cc2'],
      accent: '#5fd0ff', glow: '#9fe6ff', barrel: 118,
    },
    pulse: {
      name: 'Pulse', rarity: 'RARE', room: 'Iris', charges: 4, chargeText: '4 CHARGES / RUN',
      move: 'SHOWS RIVALS THROUGH WALLS FOR 4 S',
      body: ['#fbf8ff', '#ddd2fb', '#9e90d6'], metal: ['#f6f3ff', '#d4ccf2', '#8f86c0'], grip: ['#f4efff', '#bfb0f0', '#7d6fbd'],
      accent: '#b58cff', glow: '#cdb0ff', barrel: 52,
    },
    blinker: {
      name: 'Blinker', rarity: 'EPIC', room: 'Dusk', charges: 1, chargeText: '1 CHARGE / RUN',
      move: 'TELEPORTS YOU TO WHERE THE BOLT LANDS',
      body: ['#fffaf4', '#f6dcd2', '#c6a1b4'], metal: ['#fffaf0', '#f1dcc4', '#c49a7c'], grip: ['#f3f0ff', '#c9c3ef', '#8b84bd'],
      accent: '#ff7a2e', glow: '#ff9a5c', barrel: 74, pearl: true,
    },
    snare: {
      name: 'Snare', rarity: 'EPIC', room: 'Red Room', charges: 2, chargeText: '2 TRAPS / RUN',
      move: 'LAYS A TRAP THAT HOLDS A RIVAL 4 S',
      body: ['#f4fffb', '#bfeadf', '#6fae9f'], metal: ['#f1fffa', '#cdeee4', '#7bb3a5'], grip: ['#effff9', '#9fdccc', '#5c9a8b'],
      accent: '#7dffe0', glow: '#9ffff0', barrel: 40,
    },
    k7: {
      name: 'K-7 carbine', rarity: 'FREE', room: 'Studio', charges: -1, chargeText: '30 ROUNDS &#183; 620 RPM',
      move: 'EVERYONE STARTS WITH ONE',
      body: ['#fffdf6', '#f4e9d4', '#cbb894'], metal: ['#f5f2ff', '#d2c9f1', '#8f86c0'], grip: ['#eef6ff', '#a9cdf0', '#6c95c4'],
      accent: '#ff7aa8', glow: '#ff6f9f', barrel: 92,
    },
  };
  const STUDIO = { name: 'Studio', top: '#cfd2dc', bottom: '#f3efea', ink: '#24222c', slab: '#f6f3f1' };
  const roomByName = (n) => (n === 'Studio' ? STUDIO : ROOMS.find((r) => r.name === n));

  function figureAt(x, y, sc, rim, uid, mode) {
    const body = 'M-5,-16.8C-2.2,-18.6 2.2,-18.6 5,-16.8L5.6,-7.4L4,-7.2L3.4,0L1,0L0.5,-6.6L-0.5,-6.6L-1,0L-3.4,0L-4,-7.2L-5.6,-7.4Z';
    const shape = (attr) => `<path d="${body}" ${attr}/><circle cx="0" cy="-21.6" r="3.5" ${attr}/>`;
    const g = `<g transform="translate(${f1(x)} ${f1(y)}) scale(${sc})">`;
    if (mode === 'ghost') return g + `<g filter="url(#${uid}b2)" opacity="0.7">${shape(`fill="none" stroke="${rim}" stroke-width="2"`)}</g>` + shape(`fill="${rim}" fill-opacity="0.12" stroke="${rim}" stroke-width="0.8" stroke-dasharray="1.6 1.6"`) + '</g>';
    if (mode === 'xray') return g + `<g filter="url(#${uid}b2)">${shape(`fill="none" stroke="${rim}" stroke-width="2.4"`)}</g>` + shape(`fill="none" stroke="#ffffff" stroke-width="0.7"`) + '</g>';
    return g + `<ellipse cx="0" cy="0.4" rx="6.5" ry="2.4" fill="#000" opacity="0.3"/>` +
      `<g filter="url(#${uid}b2)">${shape(`fill="none" stroke="${rim}" stroke-width="2.6"`)}</g>` +
      shape(`fill="#0b0a10" stroke="${rim}" stroke-width="0.7"`) + '</g>';
  }

  /** A Power-Up: one gun floating over a plinth of maze concrete, with its move acted out on the plinth. */
  function powerUpSVG(o) {
    const uid = o.uid || 'p', key = o.gun || 'k7', g = GUNS[key], room = roomByName(g.room);
    const OX = 300, PY = 408, PH = 40, half = 96, C = Math.SQRT1_2, K = 0.5774;
    const ip = (x, z, h = 0) => [OX + (x - z) * C, PY + (x + z) * C * K - h];
    const P3 = (x, z, h = 0) => ip(x, z, PH + h);
    const pp = (p) => `${f1(p[0])},${f1(p[1])}`;
    const poly = (pts, attr) => `<polygon points="${pts.map(pp).join(' ')}" ${attr}/>`;
    const topIso = (h = 0) => `translate(${OX} ${PY - PH - h}) scale(1 ${K}) rotate(45)`;
    const WALL = { top: '#fbfaff', z: '#a9d0f3', x: '#f2b6c8' };
    const box = (x1, x2, z1, z2, h, col = WALL, attr = '') =>
      poly([P3(x1, z2), P3(x2, z2), P3(x2, z2, h), P3(x1, z2, h)], `fill="${col.z}" ${attr}`) +
      poly([P3(x2, z1), P3(x2, z2), P3(x2, z2, h), P3(x2, z1, h)], `fill="${col.x}" ${attr}`) +
      poly([P3(x1, z1, h), P3(x2, z1, h), P3(x2, z2, h), P3(x1, z2, h)], `fill="${col.top}" ${attr}`);

    const s = [];
    s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs>`);
    s.push(`<linearGradient id="${uid}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${room.top}"/><stop offset="1" stop-color="${room.bottom}"/></linearGradient>`);
    const vgrad = (id, c) => `<linearGradient id="${uid}${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="0.42" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient>`;
    s.push(vgrad('gb', g.body), vgrad('gm', g.metal), vgrad('gg', g.grip));
    s.push(`<linearGradient id="${uid}sight" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6a1f" stop-opacity="0.95"/><stop offset="1" stop-color="#ffc39a" stop-opacity="0.45"/></linearGradient>`);
    s.push(`<radialGradient id="${uid}glow"><stop offset="0" stop-color="${g.glow}" stop-opacity="0.9"/><stop offset="1" stop-color="${g.glow}" stop-opacity="0"/></radialGradient>`);
    if (g.pearl) {
      s.push(`<linearGradient id="${uid}pearl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ff3ff" stop-opacity="0.55"/><stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.6" stop-color="#ff8fd6" stop-opacity="0.5"/><stop offset="1" stop-color="#fff1a0" stop-opacity="0.55"/></linearGradient>`);
    }
    s.push(blurDefs(uid, [2, 4, 8, 14, 24]));
    s.push(grain(uid, (Object.keys(GUNS).indexOf(key) + 1) * 13));
    s.push('</defs>');
    s.push(`<rect width="600" height="600" fill="url(#${uid}bg)"/>`);
    s.push(`<ellipse cx="300" cy="${PY + 92}" rx="170" ry="20" fill="#000" opacity="0.2" filter="url(#${uid}b14)"/>`);

    // plinth, faced like the maze walls
    const l = ip(-half, half), f = ip(half, half), r = ip(half, -half);
    const lt = ip(-half, half, PH), ft = ip(half, half, PH), rt = ip(half, -half, PH), bt = ip(-half, -half, PH);
    s.push(poly([l, f, ft, lt], `fill="#a9d0f3"`), poly([f, r, rt, ft], `fill="#f2b6c8"`), poly([lt, ft, rt, bt], `fill="#fbfaff"`));
    s.push(`<path d="M${pp(lt)}L${pp(ft)}L${pp(rt)}" fill="none" stroke="#ffffff" stroke-width="1.2" opacity="0.9"/>`);

    // the gun's shadow on the plinth, then its move acted out on top
    s.push(`<ellipse transform="${topIso()}" cx="0" cy="0" rx="70" ry="70" fill="#3a2f45" opacity="0.18" filter="url(#${uid}b8)"/>`);
    const fx = [];
    const ring = (cx, cz, rr, attr, h = 0) => `<circle transform="${topIso(h)}" cx="${cx}" cy="${cz}" r="${rr}" ${attr}/>`;
    if (key === 'marker') {
      // a dead-end corner of the maze, marked
      fx.push(box(-70, -58, -60, 30, 46), box(-58, 50, 18, 30, 46));
      const fp = (x, y) => P3(x, 30, y);
      const line = (a, b, w, attr) => `<path d="M${pp(fp(...a))}L${pp(fp(...b))}" stroke="${g.accent}" stroke-width="${w}" stroke-linecap="round" ${attr}/>`;
      fx.push(`<g filter="url(#${uid}b4)" opacity="0.7">${line([-20, 10], [22, 38], 9, '')}${line([-20, 38], [22, 10], 9, '')}</g>`);
      fx.push(line([-20, 10], [22, 38], 6, ''), line([-20, 38], [22, 10], 6, ''));
      fx.push(`<path d="M${pp(fp(-14, 10))}L${pp(fp(-14, 2))}M${pp(fp(16, 10))}L${pp(fp(16, 0.5))}" stroke="${g.accent}" stroke-width="3" stroke-linecap="round"/>`);
      fx.push(ring(-5, 44, 10, `fill="${g.accent}" opacity="0.75"`), ring(22, 52, 5, `fill="${g.accent}" opacity="0.6"`), ring(-30, 40, 4, `fill="${g.accent}" opacity="0.55"`));
    } else if (key === 'frost') {
      // a sentry block, frozen where it stood
      const SENT = { top: '#4a4566', z: '#2e2a45', x: '#3a3554' };
      fx.push(box(-26, 22, -16, 32, 44, SENT));
      const eye = P3(-2, 32, 26);
      fx.push(`<ellipse cx="${f1(eye[0] - 10)}" cy="${f1(eye[1] - 4)}" rx="9" ry="4" fill="#ff5f9e" transform="rotate(30 ${f1(eye[0] - 10)} ${f1(eye[1] - 4)})"/>`);
      fx.push(box(-30, 26, -20, 36, 50, { top: '#ffffff', z: '#d8f3ff', x: '#c4ebff' }, 'opacity="0.42"'));
      fx.push(`<ellipse transform="${topIso()}" cx="0" cy="8" rx="56" ry="56" fill="url(#${uid}glow)" opacity="0.6"/>`);
      const shard = (x, z, hh, lean) => { const b = P3(x, z); return poly([[b[0] - 6, b[1]], [b[0] + lean, b[1] - hh], [b[0] + 6, b[1]], [b[0], b[1] + 3]], `fill="#eefaff" fill-opacity="0.85" stroke="#ffffff" stroke-width="0.8"`); };
      [[-44, 30, 26, -6], [36, 40, 30, 5], [-38, 48, 18, -3], [44, 10, 22, 6], [10, 56, 24, 2], [-52, 6, 16, -5]].forEach((a) => fx.push(shard(...a)));
    } else if (key === 'pulse') {
      // a rival behind a wall, seen anyway
      for (let i = 0; i < 4; i++) fx.push(ring(0, 0, 26 + i * 22, `fill="none" stroke="${g.accent}" stroke-width="${2.4 - i * 0.4}" opacity="${f1(0.85 - i * 0.18)}"`, 1));
      const rv = P3(-6, -34);
      fx.push(figureAt(rv[0], rv[1], 2.2, '#0b0a10', uid, 'solid'));
      fx.push(box(-64, 48, 4, 16, 42));
      fx.push(figureAt(rv[0], rv[1], 2.2, '#8a5cff', uid, 'xray'));
    } else if (key === 'blinker') {
      // here, then there
      const a = P3(-62, 34), b = P3(46, -24);
      fx.push(ring(46, -24, 22, `fill="url(#${uid}glow)"`), ring(46, -24, 16, `fill="none" stroke="${g.accent}" stroke-width="1.6" opacity="0.9"`));
      fx.push(ring(-62, 34, 14, `fill="none" stroke="#ffb27a" stroke-width="1" stroke-dasharray="2 3" opacity="0.8"`));
      fx.push(figureAt(a[0], a[1], 2, '#ff9a5c', uid, 'ghost'));
      const arc = `M${f1(a[0])},${f1(a[1] - 40)} Q${f1((a[0] + b[0]) / 2)},${f1(Math.min(a[1], b[1]) - 110)} ${f1(b[0])},${f1(b[1] - 6)}`;
      fx.push(`<path d="${arc}" fill="none" stroke="${g.accent}" stroke-width="6" opacity="0.55" filter="url(#${uid}b4)"/>`);
      fx.push(`<path d="${arc}" fill="none" stroke="#fff4e6" stroke-width="1.6" stroke-linecap="round"/>`);
      fx.push(figureAt(b[0], b[1], 2, '#ffe2c6', uid, 'solid'));
    } else if (key === 'snare') {
      // a trap, set and humming
      fx.push(ring(0, 6, 60, `fill="url(#${uid}glow)" opacity="0.7"`));
      fx.push(`<g filter="url(#${uid}b4)">${ring(0, 6, 40, `fill="none" stroke="${g.accent}" stroke-width="6"`, 2)}</g>`);
      fx.push(ring(0, 6, 40, `fill="none" stroke="#ffffff" stroke-width="1.6"`, 2));
      fx.push(ring(0, 6, 40, `fill="none" stroke="#5c9a8b" stroke-width="5" opacity="0.6"`));
      const prongs = [];
      for (let i = 0; i < 9; i++) {
        const t = (i / 9) * Math.PI * 2, bx = 40 * Math.cos(t), bz = 6 + 40 * Math.sin(t), b = P3(bx, bz), h = 22;
        prongs.push({ y: b[1], d: poly([[b[0] - 4, b[1]], [b[0], b[1] - h], [b[0] + 4, b[1]]], `fill="url(#${uid}gm)" stroke="#ffffff" stroke-width="0.6"`) });
      }
      prongs.sort((p, q) => p.y - q.y).forEach((p) => fx.push(p.d));
    } else {
      fx.push(ring(0, 0, 44, `fill="url(#${uid}glow)" opacity="0.35"`));
    }
    s.push(fx.join(''));

    // the gun, side on, floating
    const L = g.barrel, bx = 70, gs = [];
    gs.push(`<ellipse cx="${bx + L * 0.4}" cy="0" rx="${60 + L * 0.6}" ry="54" fill="url(#${uid}glow)" opacity="0.38" filter="url(#${uid}b14)"/>`);
    // stock and grip
    gs.push(`<rect x="-152" y="-17" width="56" height="40" rx="18" fill="url(#${uid}gg)"/>`);
    gs.push(`<path d="M-74,14 L-40,14 L-50,82 Q-52,90 -62,90 L-78,90 Q-88,90 -86,80 Z" fill="url(#${uid}gg)" stroke="url(#${uid}gg)" stroke-width="6" stroke-linejoin="round"/>`);
    // trigger guard and trigger
    gs.push(`<path d="M-40,26 Q-38,52 -14,52 L4,52 Q8,40 4,26" fill="none" stroke="url(#${uid}gm)" stroke-width="5" stroke-linecap="round"/>`);
    gs.push(`<path d="M-20,26 Q-22,36 -16,42" fill="none" stroke="${g.accent}" stroke-width="4.5" stroke-linecap="round"/>`);
    if (key === 'k7') gs.push(`<path d="M22,22 L48,22 L58,82 Q60,88 52,88 L40,88 Q34,88 33,82 Z" fill="url(#${uid}gg)" stroke="url(#${uid}gg)" stroke-width="5" stroke-linejoin="round"/>`);
    // barrel, then the body over its root
    gs.push(`<rect x="${bx - 20}" y="-13" width="${L + 20}" height="26" rx="13" fill="url(#${uid}gm)"/>`);
    gs.push(`<rect x="${bx + L - 30}" y="-18" width="14" height="36" rx="6" fill="${g.accent}"/>`);
    gs.push(`<rect x="${bx + L - 28}" y="-16" width="4" height="32" rx="2" fill="#ffffff" opacity="0.45"/>`);
    gs.push(`<rect x="-112" y="-28" width="196" height="56" rx="26" fill="url(#${uid}gb)"/>`);
    if (g.pearl) gs.push(`<rect x="-112" y="-28" width="196" height="56" rx="26" fill="url(#${uid}pearl)" style="mix-blend-mode:screen"/>`);
    gs.push(`<path d="M-96,6 L70,6" stroke="${g.accent}" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>`);
    gs.push(`<rect x="-92" y="-22" width="150" height="9" rx="4.5" fill="#ffffff" opacity="0.55"/>`);
    // muzzle glow
    gs.push(`<circle cx="${bx + L + 4}" cy="0" r="14" fill="${g.glow}" opacity="0.85" filter="url(#${uid}b8)"/>`);
    gs.push(`<circle cx="${bx + L + 1}" cy="0" r="4.5" fill="#ffffff"/>`);

    // what makes each one itself
    if (key === 'marker') {
      gs.push(`<rect x="${bx + L - 4}" y="-20" width="20" height="40" rx="8" fill="url(#${uid}gb)"/>`);
      gs.push(`<rect x="-86" y="-66" width="118" height="34" rx="17" fill="#ffffff" fill-opacity="0.5" stroke="#ffffff" stroke-width="1.4"/>`);
      gs.push(`<rect x="-82" y="-52" width="110" height="17" rx="8.5" fill="${g.accent}" opacity="0.9"/>`);
      gs.push(`<rect x="-78" y="-62" width="80" height="5" rx="2.5" fill="#ffffff" opacity="0.8"/>`);
    } else if (key === 'frost') {
      for (let i = 0; i < 3; i++) {
        const cx = -66 + i * 40;
        gs.push(`<g filter="url(#${uid}b4)"><polygon points="${cx - 13},-40 ${cx},-58 ${cx + 13},-40 ${cx},-30" fill="${g.glow}"/></g>`);
        gs.push(`<polygon points="${cx - 13},-40 ${cx},-58 ${cx + 13},-40 ${cx},-30" fill="#f2fbff" stroke="#ffffff" stroke-width="1"/>`);
        gs.push(`<polygon points="${cx},-58 ${cx + 13},-40 ${cx},-30" fill="${g.accent}" opacity="0.45"/>`);
      }
    } else if (key === 'pulse') {
      gs.push(`<g filter="url(#${uid}b4)"><ellipse cx="${bx + L + 6}" cy="0" rx="12" ry="38" fill="none" stroke="${g.glow}" stroke-width="8"/></g>`);
      gs.push(`<ellipse cx="${bx + L + 6}" cy="0" rx="12" ry="38" fill="none" stroke="url(#${uid}gm)" stroke-width="7"/>`);
      gs.push(`<ellipse cx="${bx + L + 6}" cy="0" rx="12" ry="38" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.8"/>`);
      gs.push(`<circle cx="-40" cy="-40" r="16" fill="url(#${uid}gm)" stroke="#ffffff" stroke-width="1.2"/>`);
      gs.push(`<path d="M-40,-40 L-30,-50" stroke="${g.accent}" stroke-width="2.4" stroke-linecap="round"/>`);
      gs.push(`<circle cx="-40" cy="-40" r="2.4" fill="#ffffff"/>`);
    } else if (key === 'blinker') {
      gs.push(`<rect x="-84" y="-58" width="112" height="26" rx="13" fill="#ffffff" fill-opacity="0.45" stroke="#ffffff" stroke-width="1.4"/>`);
      gs.push(`<rect x="-80" y="-50" width="104" height="14" rx="7" fill="#fff1c4" opacity="0.75"/>`);
      gs.push(`<g filter="url(#${uid}b4)"><ellipse cx="-24" cy="-45" rx="14" ry="7" fill="${g.accent}"/></g>`);
      gs.push(`<ellipse cx="-24" cy="-45" rx="11" ry="5.5" fill="${g.accent}"/><ellipse cx="-27" cy="-47" rx="4" ry="1.8" fill="#ffffff" opacity="0.85"/>`);
      gs.push(`<path d="M-50,-58 v26 M2,-58 v26" stroke="#ffffff" stroke-width="1.2" opacity="0.8"/>`);
    } else if (key === 'snare') {
      [-1, 0, 1].forEach((k) => gs.push(`<path d="M${bx + L - 4},${k * 11} Q${bx + L + 22},${k * 18 - 2} ${bx + L + 30},${k * 26}" fill="none" stroke="url(#${uid}gm)" stroke-width="5" stroke-linecap="round"/>`));
      for (let i = 0; i < 4; i++) gs.push(`<ellipse cx="${-60 + i * 22}" cy="-36" rx="9" ry="12" fill="none" stroke="url(#${uid}gm)" stroke-width="4"/>`);
    } else {
      gs.push(`<rect x="-46" y="-48" width="40" height="22" rx="7" fill="url(#${uid}gm)"/>`);
      gs.push(`<circle cx="-20" cy="-37" r="5" fill="${g.accent}"/><circle cx="-20" cy="-37" r="9" fill="${g.glow}" opacity="0.6" filter="url(#${uid}b4)"/>`);
    }
    // the sight every HAM gun carries: a sliver of the monolith
    if (key !== 'k7') {
      gs.push(`<rect x="34" y="-62" width="12" height="36" rx="2" fill="#ff8a3d" opacity="0.55" filter="url(#${uid}b4)"/>`);
      gs.push(`<rect x="35" y="-58" width="10" height="32" rx="1.5" fill="url(#${uid}sight)"/>`);
      gs.push(`<rect x="39" y="-56" width="2" height="28" fill="#fff6ec" opacity="0.8"/>`);
    }
    const lift = key === 'k7' ? 196 : 200;
    s.push(`<g transform="translate(${f1(286 - L * 0.32)} ${lift}) rotate(-7)">${gs.join('')}</g>`);

    s.push(`<rect width="600" height="600" filter="url(#${uid}n)"/>`);

    // label
    s.push(`<g ${FONT} fill="${room.ink}">`);
    s.push(`<text x="40" y="56" font-size="15" font-weight="600" letter-spacing="4.5">HAM</text>`);
    s.push(`<text x="40" y="76" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">${key === 'k7' ? 'STARTER GUN' : 'POWER-UP'}</text>`);
    s.push(`<text x="560" y="56" text-anchor="end" font-size="13" font-weight="600" letter-spacing="3">${g.rarity}</text>`);
    const tally = o.runs != null ? ` &#183; ${o.runs} RUNS` : '';
    // The one line that changes per token. Everything before and after it is fixed per gun, which is
    // how the contract stores the art (see powerUpParts).
    s.push(SPLIT);
    if (key !== 'k7') s.push(`<text x="560" y="76" text-anchor="end" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">NO. ${o.tokenId}${tally}</text>`);
    s.push(SPLIT);
    s.push(`<text x="38" y="542" font-size="42" font-weight="500" letter-spacing="-0.5">${g.name}</text>`);
    s.push(`<text x="40" y="568" font-size="10.5" font-weight="500" letter-spacing="2.2" opacity="0.78">${g.move}</text>`);
    s.push(`<text x="560" y="542" text-anchor="end" font-size="10.5" font-weight="600" letter-spacing="2.2">${g.chargeText}</text>`);
    if (g.charges > 0) for (let i = 0; i < g.charges; i++) s.push(`<circle cx="${554 - i * 15}" cy="562" r="4.5"/>`);
    s.push('</g></svg>');
    const parts = s.join('').split(SPLIT);
    return o.parts ? parts : parts.join('');
  }
  const SPLIT = '\u0000';
  /** The fixed head and tail of a gun's art, around the per-token "NO. 12 · 40 RUNS" line. */
  const powerUpParts = (gun) => { const p = powerUpSVG({ gun, tokenId: 0, runs: 0, parts: true }); return { head: p[0], tail: p[2] }; };

  /** A sealed pack: every Power-Up is sold like this. A box wrapped in frosted film over the same plinth,
      the monolith's orange glass glowing through it, and a pink tear strip to pull. Strip it to see the gun. */
  function packSVG(o) {
    const uid = o.uid || 'k', room = STUDIO, ACC = '#ff4f97';
    const OX = 300, PY = 408, PH = 40, half = 96, C = Math.SQRT1_2, K = 0.5774;
    const ip = (x, z, h = 0) => [OX + (x - z) * C, PY + (x + z) * C * K - h];
    const P3 = (x, z, h = 0) => ip(x, z, PH + h);
    const pp = (p) => `${f1(p[0])},${f1(p[1])}`;
    const poly = (pts, attr) => `<polygon points="${pts.map(pp).join(' ')}" ${attr}/>`;
    const topIso = (h = 0) => `translate(${OX} ${PY - PH - h}) scale(1 ${K}) rotate(45)`;
    // a box from height h0 to h1: the two faces we see and its top
    const cube = (x1, x2, z1, z2, h0, h1, z, x, top, attr = '') =>
      poly([P3(x1, z2, h0), P3(x2, z2, h0), P3(x2, z2, h1), P3(x1, z2, h1)], `fill="${z}" ${attr}`) +
      poly([P3(x2, z1, h0), P3(x2, z2, h0), P3(x2, z2, h1), P3(x2, z1, h1)], `fill="${x}" ${attr}`) +
      poly([P3(x1, z1, h1), P3(x2, z1, h1), P3(x2, z2, h1), P3(x1, z2, h1)], `fill="${top}" ${attr}`);

    const s = [];
    s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs>`);
    s.push(`<linearGradient id="${uid}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${room.top}"/><stop offset="1" stop-color="${room.bottom}"/></linearGradient>`);
    s.push(`<linearGradient id="${uid}fz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.6"/><stop offset="1" stop-color="#cfe6fa" stop-opacity="0.5"/></linearGradient>`);
    s.push(`<linearGradient id="${uid}fx" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.56"/><stop offset="1" stop-color="#f8d2de" stop-opacity="0.48"/></linearGradient>`);
    s.push(`<linearGradient id="${uid}sight" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6a1f" stop-opacity="0.95"/><stop offset="1" stop-color="#ffc39a" stop-opacity="0.5"/></linearGradient>`);
    s.push(`<linearGradient id="${uid}pearl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ff3ff" stop-opacity="0.4"/><stop offset="0.4" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.65" stop-color="#ff8fd6" stop-opacity="0.35"/><stop offset="1" stop-color="#fff1a0" stop-opacity="0.4"/></linearGradient>`);
    s.push(blurDefs(uid, [2, 4, 8, 14, 24]));
    s.push(grain(uid, 91));
    s.push('</defs>');
    s.push(`<rect width="600" height="600" fill="url(#${uid}bg)"/>`);
    s.push(`<ellipse cx="300" cy="${PY + 92}" rx="170" ry="20" fill="#000" opacity="0.2" filter="url(#${uid}b14)"/>`);

    // the plinth, faced like the maze walls
    const l = ip(-half, half), f = ip(half, half), r = ip(half, -half);
    const lt = ip(-half, half, PH), ft = ip(half, half, PH), rt = ip(half, -half, PH), bt = ip(-half, -half, PH);
    s.push(poly([l, f, ft, lt], `fill="#a9d0f3"`), poly([f, r, rt, ft], `fill="#f2b6c8"`), poly([lt, ft, rt, bt], `fill="#fbfaff"`));
    s.push(`<path d="M${pp(lt)}L${pp(ft)}L${pp(rt)}" fill="none" stroke="#ffffff" stroke-width="1.2" opacity="0.9"/>`);
    // its shadow and the orange light it throws down
    s.push(`<ellipse transform="${topIso()}" cx="0" cy="0" rx="66" ry="66" fill="#3a2f45" opacity="0.16" filter="url(#${uid}b8)"/>`);
    s.push(`<ellipse transform="${topIso()}" cx="0" cy="0" rx="40" ry="40" fill="#ff8a3d" opacity="0.28" filter="url(#${uid}b14)"/>`);

    const B = 58, H0 = 74, H1 = 206, MID = 140;
    // inside: the monolith's glass, glowing through the film
    const core = P3(0, 0, MID);
    s.push(`<ellipse cx="${f1(core[0])}" cy="${f1(core[1])}" rx="62" ry="88" fill="#ff7a2e" opacity="0.85" filter="url(#${uid}b24)"/>`);
    s.push(cube(-12, 12, -12, 12, H0 + 16, H1 - 14, '#ff7a2e', '#ff9a5c', '#ffd2ad'));
    // the film: translucent faces, pearl sheen, bright edges
    s.push(cube(-B, B, -B, B, H0, H1, `url(#${uid}fz)`, `url(#${uid}fx)`, '#ffffff" fill-opacity="0.62'));
    s.push(cube(-B, B, -B, B, H0, H1, `url(#${uid}pearl)`, `url(#${uid}pearl)`, `url(#${uid}pearl)`, 'style="mix-blend-mode:screen"'));
    const e = (a, b) => `M${pp(a)}L${pp(b)}`;
    s.push(`<path d="${e(P3(-B, B, H1), P3(B, B, H1))}${e(P3(B, B, H1), P3(B, -B, H1))}${e(P3(B, B, H0), P3(B, B, H1))}${e(P3(-B, -B, H1), P3(-B, B, H1))}${e(P3(-B, -B, H1), P3(B, -B, H1))}" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" opacity="0.95"/>`);
    // creases where the film folds over the top
    s.push(`<path d="${e(P3(-B + 10, B, H1), P3(0, 0, H1))}${e(P3(B, -B + 10, H1), P3(0, 0, H1))}" stroke="#d6dcec" stroke-width="1" opacity="0.8"/>`);

    // the tear strip, all the way round, with its tab lifted at the front corner
    const band = (h, w, attr) => `<path d="${e(P3(-B, B, h), P3(B, B, h))}L${pp(P3(B, -B, h))}" fill="none" stroke-width="${w}" ${attr}/>`;
    s.push(`<g filter="url(#${uid}b4)" opacity="0.55">${band(MID, 12, `stroke="${ACC}"`)}</g>`);
    s.push(band(MID, 8, `stroke="${ACC}"`), band(MID + 2.4, 1.6, `stroke="#ffffff" opacity="0.7"`));
    const c = P3(B, B, MID);
    s.push(`<path d="M${f1(c[0] - 2)},${f1(c[1] - 4)} q16,-2 26,10 q6,8 -2,14 l-6,-6 q2,-6 -6,-10 q-6,-2 -12,0 Z" fill="${ACC}" stroke="#ffffff" stroke-width="0.8"/>`);
    s.push(`<circle cx="${f1(c[0] + 22)}" cy="${f1(c[1] + 16)}" r="10" fill="${ACC}" opacity="0.4" filter="url(#${uid}b8)"/>`);

    s.push(`<rect width="600" height="600" filter="url(#${uid}n)"/>`);
    s.push(`<g ${FONT} fill="${room.ink}">`);
    s.push(`<text x="40" y="56" font-size="15" font-weight="600" letter-spacing="4.5">HAM</text>`);
    s.push(`<text x="40" y="76" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">POWER-UP</text>`);
    s.push(`<text x="560" y="56" text-anchor="end" font-size="13" font-weight="600" letter-spacing="3">SEALED</text>`);
    s.push(SPLIT);
    s.push(`<text x="560" y="76" text-anchor="end" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">NO. ${o.tokenId} OF 10,000</text>`);
    s.push(SPLIT);
    s.push(`<text x="38" y="542" font-size="42" font-weight="500" letter-spacing="-0.5">Sealed pack</text>`);
    s.push(`<text x="40" y="568" font-size="10.5" font-weight="500" letter-spacing="2.2" opacity="0.78">STRIP IT TO SEE WHICH GUN IS INSIDE</text>`);
    s.push(`<text x="560" y="542" text-anchor="end" font-size="10.5" font-weight="600" letter-spacing="2.2">ONE OF FIVE</text>`);
    for (let i = 0; i < 5; i++) s.push(`<circle cx="${554 - i * 15}" cy="562" r="4.5" fill="none" stroke="${room.ink}" stroke-width="1.2"/>`);
    s.push('</g></svg>');
    const parts = s.join('').split(SPLIT);
    return o.parts ? parts : parts.join('');
  }
  const packParts = () => { const p = packSVG({ tokenId: 0, parts: true }); return { head: p[0], tail: p[2] }; };

  window.HAMArt = { scoreSVG, powerUpSVG, powerUpParts, packSVG, packParts, GUNS, scoreParts, ROOMS, roomOf, describe, seedFromDate, dateLabel, DotNetRandom, mix };
})();
