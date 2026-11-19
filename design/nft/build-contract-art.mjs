// Builds the on-chain side of the NFT art from design/nft/ham-art.js, so the contracts and the
// preview pages can never draw different things:
//   contracts/src/HamScoreArt.sol      the Score renderer, with every fixed fragment taken from ham-art.js
//   contracts/art/<kind>.head.svg/.tail.svg   each Power-Up's fixed art around its per-token line
//   contracts/test/fixtures/score-*.svg + ScoreArtCases.sol   expected Scores, checked byte for byte
// Run: node design/nft/build-contract-art.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(here, 'ham-art.js'), 'utf8'), ctx);
const A = ctx.window.HAMArt, P = A.scoreParts;
const out = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

const U = 's';
const lit = (s) => {
  if (/[^\x20-\x7e]/.test(s)) throw new Error('non-ASCII in fragment: ' + s.slice(0, 40));
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
};
const MARK = '#@@@@@@';

// ── fixed fragments, cut from real ham-art.js output ──────────────────────────
const ISO = 'translate(300 316) scale(1 0.5774) rotate(45) translate(-156 -156)';
const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs>`;
const pool = `<radialGradient id="${U}pool"><stop offset="0" stop-color="#ff8a3d" stop-opacity="0.85"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/></radialGradient>`;
const monoF = P.scoreMonolith(U, false), monoL = P.scoreMonolith(U, true);
const blur = [2, 3, 10, 16, 24].map((n) => `<filter id="${U}b${n}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${n}"/></filter>`).join('');
const grain = `<filter id="${U}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" seed="@"/><feColorMatrix type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 0.07"/></filter>`;
const [grainA, grainB] = grain.split('@');
const slabDef = `<g id="${U}slab"><rect transform="${ISO}" x="-14" y="-14" width="340" height="340" rx="6"/></g>`;
const f1 = (n) => Math.round(n * 10) / 10;
let slabStack = '';
for (let i = 22; i >= 1; i--) slabStack += `<use href="#${U}slab" y="${i}" fill="${MARK}" opacity="${f1(1 - (i / 22) * 0.82)}"/>`;
const lat = [];
for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) lat.push(`M${i * 26} ${j * 26}h0.01`);
const lattice = `<path transform="${ISO}" d="${lat.join('')}" stroke="${MARK}" stroke-width="2.2" stroke-linecap="round"/>`;
const poolCircle = `<circle transform="${ISO}" cx="169" cy="143" r="67.60000000000001" fill="url(#${U}pool)"/>`;
const FONT = `font-family="Jost, Futura, 'Avenir Next', 'Century Gothic', sans-serif"`;
const marks = [-1, 0, 1, 2, 3, 4, 5].map((k) => P.scoreFloorMarks(U, k));
const figs = [-1, 0, 1, 2, 3, 4, 5].map((k) => P.scoreFigure(U, k));

// split marks and figures into a shared part and the per-position part
const markA = marks[0].slice(0, marks[0].indexOf('L') + 1);
const markEnd = marks.map((m) => { if (!m.startsWith(markA)) throw new Error('marks'); return m.slice(markA.length, m.indexOf('"', markA.length)); });
const markRest = [marks[0], marks[1]].map((m) => m.slice(m.indexOf('"', markA.length)));
marks.forEach((m, i) => { if (m !== markA + markEnd[i] + markRest[i === 0 ? 0 : 1]) throw new Error('marks rebuild'); });
const FA = '<g transform="translate(';
const figAt = figs.map((g) => g.slice(FA.length, g.indexOf('>')));
const figRest = [figs[0], figs[1]].map((g) => g.slice(g.indexOf('>')));
figs.forEach((g, i) => { if (g !== FA + figAt[i] + figRest[i === 0 ? 0 : 1]) throw new Error('figs rebuild'); });

// sanity: the pool circle literal must equal what ham-art.js draws
const probe = A.scoreSVG({ seed: 20261118, completed: true, timeMs: 1000, kills: 0, tokenId: 1, points: 1 });
for (const frag of [poolCircle, slabDef, lattice.split(MARK)[0], marks[0], figs[0], monoF.body, monoF.defs]) {
  if (!probe.includes(frag)) throw new Error('fragment drifted from ham-art.js: ' + frag.slice(0, 60));
}

const startXY = probe.match(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="end" font-size="9"/).slice(1);

// colour tables
const rooms = A.ROOMS;
const pal = rooms.map((r) => [false, true].map((lost) => P.scorePalette(r, lost)));
const HB = [16, 10, 5];
const stackCols = [false, true].map((lost) => {
  const p = P.scorePalette(rooms[0], lost);
  let s = '';
  for (let o2 = 0; o2 < 2; o2++) for (let b = 0; b < 3; b++) for (let h = 0; h <= HB[b]; h++) s += P.stackColour(p, o2, b, h);
  return s;
});
// offset of (o2, b, 0) in a stack table, in colours
const stackOff = (o2, b) => o2 * 34 + [0, 17, 28][b];
const roomCols = rooms.map((r, i) => r.top + r.bottom + pal[i][0].slabTop + pal[i][0].slabSide + pal[i][0].lattice + pal[i][0].ink + pal[i][1].slabTop + pal[i][1].slabSide + pal[i][1].lattice + pal[i][1].ink).join('');

const sol = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// GENERATED by design/nft/build-contract-art.mjs from design/nft/ham-art.js. Do not edit by hand:
// change ham-art.js and run the script, so the contract and the preview pages draw the same Score.

/// @title HamScoreArt
/// @notice Draws a HAM Score fully on chain: the day's real maze (the same .NET Random backtracker
/// the game uses) as a floating isometric model. It never draws the route. While the day is live
/// the drawing is sealed to the entrance corner every player sees at spawn; once the day is over it
/// develops a round patch of walls, a straight-line radius from START, as far as the run got.
contract HamScoreArt {
    struct Buf {
        bytes data;
        uint256 len;
    }

    uint256 private constant MBIG = 2147483647;
    uint256 private constant MSEED = 161803398;
    uint256 private constant SEALED_REACH = ${P.SEALED_REACH};
    uint256 private constant MONO_DEPTH = 31200;

    /// @param day UTC day number (block.timestamp / 1 days) the run was played on
    /// @param isSealed true while that day is still live
    function render(uint256 tokenId, uint256 day, uint32 points, uint32 timeMs, uint32 kills, bool completed, bool isSealed)
        external
        pure
        returns (string memory)
    {
        (uint256 y, uint256 mo, uint256 d) = _civil(day);
        return _render(tokenId, y * 10000 + mo * 100 + d, points, timeMs, kills, completed, isSealed);
    }

    /// @notice Same drawing, keyed by the game's own seed (YYYYMMDD). Used by the tests.
    function renderSeed(uint256 tokenId, uint256 seed, uint32 points, uint32 timeMs, uint32 kills, bool completed, bool isSealed)
        external
        pure
        returns (string memory)
    {
        return _render(tokenId, seed, points, timeMs, kills, completed, isSealed);
    }

    struct Run {
        uint256 tokenId;
        uint256 seed;
        uint256 points;
        uint256 timeMs;
        uint256 kills;
        bool lost;
        bool isSealed;
        uint256 room;
        uint256 k; // the figure's diagonal cell on a lost run; 6 = found, beside the monolith
        uint256 rc; // this room's colour row, found or lost
        uint256 n; // walls
        uint256 present; // bitmap of wall groups that have any standing wall
    }

    function _render(uint256 tokenId, uint256 seed, uint32 points, uint32 timeMs, uint32 kills, bool completed, bool isSealed)
        internal
        pure
        returns (string memory)
    {
        Run memory r;
        r.tokenId = tokenId;
        r.seed = seed;
        r.points = points;
        r.timeMs = timeMs;
        r.kills = kills;
        r.lost = !completed;
        r.isSealed = isSealed;
        r.room = _next(_rng(seed ^ 0x4841), 5);
        r.rc = r.room * 10 + (r.lost ? 6 : 2);
        uint256 reachFull = completed ? 9300 : _clamp(1500 + uint256(timeMs) / 20 + uint256(kills) * 500, 2000, 7400);
        r.k = r.lost ? _lostCell(reachFull) : 6;
        // which walls stand, how high, and on which side of the monolith and figure
        uint16[312] memory wall;
        (wall, r.n, r.present) = _walls(_maze(seed), isSealed ? SEALED_REACH : reachFull, r.lost ? 31200 : 32656);

        Buf memory b = Buf(new bytes(65536), 0);
        _drawModel(b, r, wall);
        _drawLabel(b, r);
        bytes memory data = b.data;
        uint256 len = b.len;
        assembly {
            mstore(data, len)
        }
        return string(data);
    }

    function _drawModel(Buf memory b, Run memory r, uint16[312] memory wall) internal pure {
        bool lost = r.lost;
        uint256 n = r.n;
        uint256 present = r.present;
        uint256 rc = r.rc;

        _a(b, ${lit(head)});
        _a(b, ${lit('<linearGradient id="' + U + 'bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="')});
        _col(b, r.room * 10, 0);
        _a(b, ${lit('"/><stop offset="1" stop-color="')});
        _col(b, r.room * 10 + 1, 0);
        _a(b, ${lit('"/></linearGradient>' + pool)});
        _a(b, _pick(lost, ${lit(monoL.defs)}, ${lit(monoF.defs)}));
        _a(b, ${lit(blur + grainA)});
        _a(b, _u(r.seed % 97));
        _a(b, ${lit(grainB + slabDef)});
        for (uint256 key; key < 18; ++key) {
            if (present & (1 << key) == 0) continue;
            _a(b, ${lit('<g id="' + U + 'w')});
            _a(b, _key(key));
            _a(b, ${lit('"><path transform="' + ISO + '" d="')});
            _frags(b, wall, n, key);
            _a(b, ${lit('" fill="none" stroke-width="6" stroke-linecap="square"/></g>')});
        }
        _a(b, ${lit('</defs><rect width="600" height="600" fill="url(#' + U + 'bg)"/>')});
        _a(b, _pick(lost,
            ${lit('<rect width="600" height="600" fill="#11143a" opacity="0.52"/><ellipse cx="300" cy="524" rx="200" ry="24" fill="#000" opacity="0.4" filter="url(#' + U + 'b24)"/>')},
            ${lit('<ellipse cx="300" cy="524" rx="200" ry="24" fill="#000" opacity="0.2" filter="url(#' + U + 'b24)"/>')}));

        _tmpl(b, ${lit(slabStack)}, rc + 1);
        _a(b, ${lit('<use href="#' + U + 'slab" fill="')});
        _col(b, rc, 0);
        _a(b, '"/>');
        _tmpl(b, ${lit(lattice)}, rc + 2);
        _a(b, ${lit('<path transform="' + ISO + '" d="')});
        _frags(b, wall, n, 99);
        _a(b, ${lit('" fill="none" stroke="#2a2233" stroke-opacity="0.22" stroke-width="10" stroke-linecap="square" filter="url(#' + U + 'b3)"/>')});
        if (!lost) _a(b, ${lit(poolCircle)});
        _a(b, _marks(r.k));

        _stack(b, present, 0, lost);
        _a(b, _pick(lost, ${lit(monoL.body)}, ${lit(monoF.body)}));
        _stack(b, present, 1, lost);
        _a(b, _figure(r.k));
        _stack(b, present, 2, lost);
    }

    function _drawLabel(Buf memory b, Run memory r) internal pure {
        uint256 seed = r.seed;
        bool lost = r.lost;
        uint256 rc = r.rc;

        _a(b, ${lit('<rect width="600" height="600" filter="url(#' + U + 'n)"/><g ' + FONT + ' fill="')});
        _col(b, rc + 3, 0);
        _a(b, ${lit('"><text x="40" y="56" font-size="15" font-weight="600" letter-spacing="4.5">HAM</text><text x="40" y="76" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">')});
        _a(b, _roomName(r.room));
        _a(b, ${lit('</text><text x="560" y="56" text-anchor="end" font-size="13" font-weight="500" letter-spacing="2">')});
        _a(b, string.concat(_u(seed / 10000), ".", _pad2((seed / 100) % 100), ".", _pad2(seed % 100)));
        _a(b, ${lit('</text><text x="560" y="76" text-anchor="end" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">NO. ')});
        _a(b, _u(r.tokenId));
        _a(b, ${lit('</text><text x="38" y="542" font-size="46" font-weight="500" letter-spacing="-1">')});
        _a(b, _commas(r.points));
        _a(b, ${lit('</text><text x="40" y="568" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.75">POINTS &#183; ')});
        uint256 secs = (r.timeMs + 500) / 1000;
        _a(b, string.concat(_u(r.kills), " KILLS &#183; ", _u(secs / 60), ":", _pad2(secs % 60)));
        _a(b, ${lit('</text><text x="' + startXY[0] + '" y="' + startXY[1] + '" text-anchor="end" font-size="9" font-weight="600" letter-spacing="2.2" opacity="0.8">START</text><text x="560" y="568" text-anchor="end" font-size="11" font-weight="600" letter-spacing="2.6">')});
        if (lost) {
            uint256 short_ = 6 - r.k;
            _a(b, string.concat("SIGNAL LOST &#183; ", _u(short_), _pick(short_ == 1, " CELL SHORT", " CELLS SHORT")));
        } else {
            _a(b, "MONOLITH FOUND");
        }
        _a(b, "</text>");
        if (r.isSealed) _a(b, ${lit('<text x="560" y="548" text-anchor="end" font-size="10" font-weight="500" letter-spacing="2.4" opacity="0.72">SEALED &#183; DEVELOPS 00:00 UTC</text>')});
        _a(b, "</g></svg>");
    }

    // ── the maze ────────────────────────────────────────────────────────────────
    // cell bits: 1 = L, 2 = R, 4 = F, 8 = B wall present; 16 = visited. Index is x * 12 + z.
    function _maze(uint256 seed) internal pure returns (uint8[144] memory c) {
        uint256[57] memory r = _rng(seed);
        for (uint256 i; i < 144; ++i) c[i] = 15;
        uint8[144] memory stack;
        uint256 sp = 1;
        c[0] |= 16;
        while (sp > 0) {
            uint256 cur = stack[sp - 1];
            uint256 x = cur / 12;
            uint256 z = cur % 12;
            uint256[4] memory u;
            uint256 m;
            if (x + 1 < 12 && c[cur + 12] & 16 == 0) u[m++] = cur + 12;
            if (x >= 1 && c[cur - 12] & 16 == 0) u[m++] = cur - 12;
            if (z + 1 < 12 && c[cur + 1] & 16 == 0) u[m++] = cur + 1;
            if (z >= 1 && c[cur - 1] & 16 == 0) u[m++] = cur - 1;
            if (m == 0) {
                --sp;
                continue;
            }
            uint256 nx = u[_next(r, m)];
            if (nx == cur + 12) { c[cur] &= ~uint8(2); c[nx] &= ~uint8(1); }
            else if (nx + 12 == cur) { c[cur] &= ~uint8(1); c[nx] &= ~uint8(2); }
            else if (nx == cur + 1) { c[cur] &= ~uint8(4); c[nx] &= ~uint8(8); }
            else { c[cur] &= ~uint8(8); c[nx] &= ~uint8(4); }
            c[nx] |= 16;
            stack[sp++] = uint8(nx);
        }
    }

    /// @dev Port of .NET System.Random (as in src/rng.js). Slots 0..55 are the table, 56 packs inext/inextp.
    function _rng(uint256 seed) internal pure returns (uint256[57] memory a) {
        uint256 mj = MSEED - seed;
        uint256 mk = 1;
        a[55] = mj;
        for (uint256 i = 1; i < 55; ++i) {
            uint256 ii = (21 * i) % 55;
            a[ii] = mk;
            mk = mj >= mk ? mj - mk : mj + MBIG - mk;
            mj = a[ii];
        }
        for (uint256 k = 1; k < 5; ++k) {
            for (uint256 i = 1; i < 56; ++i) {
                uint256 o = a[1 + ((i + 30) % 55)];
                a[i] = a[i] >= o ? a[i] - o : a[i] + MBIG - o;
            }
        }
        a[56] = 21; // inext = 0, inextp = 21
    }

    function _next(uint256[57] memory a, uint256 max) internal pure returns (uint256) {
        uint256 inext = (a[56] >> 8) + 1;
        uint256 inextp = (a[56] & 0xff) + 1;
        if (inext >= 56) inext = 1;
        if (inextp >= 56) inextp = 1;
        uint256 x = a[inext];
        uint256 y = a[inextp];
        uint256 v = x >= y ? x - y : x + MBIG - y;
        if (v == MBIG) v--;
        a[inext] = v;
        a[56] = (inext << 8) | inextp;
        return v * max / MBIG;
    }

    // ── walls ──────────────────────────────────────────────────────────────────
    // wall word: bit 15 = vertical, bits 10..14 = key (31 = hidden), bits 5..9 = a, bits 0..4 = b
    function _walls(uint8[144] memory c, uint256 reach, uint256 figDepth)
        internal
        pure
        returns (uint16[312] memory w, uint256 n, uint256 present)
    {
        for (uint256 j; j <= 12; ++j) {
            for (uint256 x; x < 12; ++x) {
                if (j < 12 ? c[x * 12 + j] & 8 == 0 : c[x * 12 + 11] & 4 == 0) continue;
                uint256 q = 4 * x * x + (j == 0 ? 1 : (2 * j - 1) * (2 * j - 1));
                uint256 depth = (x * 26 + 13 + (12 - j) * 26) * 100;
                uint256 key = _keyOf(0, q, reach, depth, figDepth);
                if (key < 31) present |= 1 << key;
                w[n++] = uint16((key << 10) | (x << 5) | j);
            }
        }
        for (uint256 i; i <= 12; ++i) {
            for (uint256 z; z < 12; ++z) {
                if (i < 12 ? c[i * 12 + z] & 1 == 0 : c[132 + z] & 2 == 0) continue;
                uint256 q = (i == 0 ? 1 : (2 * i - 1) * (2 * i - 1)) + 4 * z * z;
                uint256 depth = (i * 26 + (12 - z) * 26 - 13) * 100;
                uint256 key = _keyOf(1, q, reach, depth, figDepth);
                if (key < 31) present |= 1 << key;
                w[n++] = uint16(0x8000 | (key << 10) | (i << 5) | z);
            }
        }
    }

    function _keyOf(uint256 o2, uint256 q, uint256 reach, uint256 depth, uint256 figDepth) internal pure returns (uint256) {
        uint256 b;
        if (_within(q, reach, 1400)) b = 0;
        else if (_within(q, reach, 700)) b = 1;
        else if (_within(q, reach, 0)) b = 2;
        else return 31;
        uint256 band = (MONO_DEPTH < depth ? 1 : 0) + (figDepth < depth ? 1 : 0);
        return o2 * 9 + b * 3 + band;
    }

    function _within(uint256 q, uint256 r, uint256 t) internal pure returns (bool) {
        return r > t && 1e6 * q <= 4 * (r - t) * (r - t);
    }

    function _lostCell(uint256 r) internal pure returns (uint256) {
        for (uint256 k = 5; k >= 1; --k) {
            if (r > 600 && 2 * ((2 * k - 1) * 1000) ** 2 <= 4 * (r - 600) ** 2) return k;
        }
        return 0;
    }

    /// @dev key 99 = every standing wall (the contact shadow path)
    function _frags(Buf memory b, uint16[312] memory w, uint256 n, uint256 key) internal pure {
        for (uint256 i; i < n; ++i) {
            uint256 v = w[i];
            uint256 k = (v >> 10) & 31;
            if (k == 31 || (key != 99 && k != key)) continue;
            uint256 a = (v >> 5) & 31;
            uint256 c = v & 31;
            if (v & 0x8000 == 0) _a(b, string.concat("M", _u(a * 26), " ", _u((12 - c) * 26), "h26"));
            else _a(b, string.concat("M", _u(a * 26), " ", _u((12 - c) * 26), "v-26"));
        }
    }

    function _stack(Buf memory b, uint256 present, uint256 band, bool lost) internal pure {
        uint8[3] memory hb = [16, 10, 5];
        for (uint256 h; h <= 16; ++h) {
            for (uint256 bk; bk < 3; ++bk) {
                if (h > hb[bk]) continue;
                for (uint256 o2; o2 < 2; ++o2) {
                    uint256 key = o2 * 9 + bk * 3 + band;
                    if (present & (1 << key) == 0) continue;
                    _a(b, ${lit('<use href="#' + U + 'w')});
                    _a(b, _key(key));
                    if (h == 0) _a(b, '" y="0" stroke="');
                    else _a(b, string.concat('" y="-', _u(h), '" stroke="'));
                    _col(b, o2 * 34 + (bk == 0 ? 0 : bk == 1 ? 17 : 28) + h, lost ? 2 : 1);
                    _a(b, '"/>');
                }
            }
        }
    }

    function _key(uint256 key) internal pure returns (string memory) {
        bytes memory s = new bytes(3);
        s[0] = bytes1(uint8(48 + key / 9));
        s[1] = bytes1(uint8(48 + (key / 3) % 3));
        s[2] = bytes1(uint8(48 + key % 3));
        return string(s);
    }

    // ── fixed pieces ────────────────────────────────────────────────────────────
    // The figure and the floor marks differ only by where the figure stands and found/lost colours.
    function _marks(uint256 k) internal pure returns (string memory) {
        return string.concat(${lit(markA)}, _at(k, true), _pick(k == 6, ${lit(markRest[0])}, ${lit(markRest[1])}));
    }

    function _figure(uint256 k) internal pure returns (string memory) {
        return string.concat(${lit(FA)}, _at(k, false), _pick(k == 6, ${lit(figRest[0])}, ${lit(figRest[1])}));
    }

    function _at(uint256 k, bool mark) internal pure returns (string memory) {
${[0, 1, 2, 3, 4, 5].map((k) => `        if (k == ${k}) return _pick(mark, ${lit(markEnd[k + 1])}, ${lit(figAt[k + 1])});`).join('\n')}
        return _pick(mark, ${lit(markEnd[0])}, ${lit(figAt[0])});
    }

    function _roomName(uint256 i) internal pure returns (string memory) {
${rooms.map((r, i) => `        if (i == ${i}) return ${lit(r.name.toUpperCase())};`).join('\n')}
        return "";
    }

    // table 0: per room [top, bottom, then found slabTop, slabSide, lattice, ink, then lost the same]
    // tables 1 and 2: wall stack colours, found and lost, by (side, bucket, height)
    bytes private constant ROOM_COLS = ${lit(roomCols.replace(/#/g, ''))};
    bytes private constant STACK_FOUND = ${lit(stackCols[0].replace(/#/g, ''))};
    bytes private constant STACK_LOST = ${lit(stackCols[1].replace(/#/g, ''))};

    function _col(Buf memory b, uint256 i, uint256 table) internal pure {
        bytes memory t = table == 0 ? ROOM_COLS : table == 1 ? STACK_FOUND : STACK_LOST;
        bytes memory s = new bytes(7);
        s[0] = "#";
        for (uint256 j; j < 6; ++j) s[j + 1] = t[i * 6 + j];
        _a(b, string(s));
    }

    /// @dev Appends a template, swapping each ${MARK} for room colour i.
    function _tmpl(Buf memory b, string memory tmpl, uint256 i) internal pure {
        uint256 start = b.len;
        _a(b, tmpl);
        bytes memory d = b.data;
        for (uint256 p = start; p + 7 <= b.len; ++p) {
            if (d[p] == "#" && d[p + 1] == "@") {
                for (uint256 j; j < 6; ++j) d[p + 1 + j] = ROOM_COLS[i * 6 + j];
                p += 6;
            }
        }
    }

    // ── text and buffer helpers ─────────────────────────────────────────────────
    function _a(Buf memory b, string memory s) internal pure {
        bytes memory x = bytes(s);
        bytes memory d = b.data;
        uint256 l = b.len;
        uint256 n = x.length;
        require(l + n <= d.length, "art: buffer");
        assembly {
            mcopy(add(add(d, 32), l), add(x, 32), n)
        }
        b.len = l + n;
    }

    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 t = v;
        uint256 len;
        while (t != 0) { len++; t /= 10; }
        bytes memory s = new bytes(len);
        while (v != 0) { s[--len] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(s);
    }

    function _pick(bool c, string memory x, string memory y) internal pure returns (string memory) {
        return c ? x : y;
    }

    function _pad2(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("0", _u(v)) : _u(v);
    }

    function _commas(uint256 v) internal pure returns (string memory) {
        if (v < 1000) return _u(v);
        return string.concat(_commas(v / 1000), ",", _pick(v % 1000 < 10, "00", _pick(v % 1000 < 100, "0", "")), _u(v % 1000));
    }

    function _clamp(uint256 v, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    /// @dev Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
    function _civil(uint256 day) internal pure returns (uint256 y, uint256 m, uint256 d) {
        uint256 z = day + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    }
}
`;
out('contracts/src/HamScoreArt.sol', sol);

// ── expected Scores, for a byte-for-byte test against the contract ─────────────
const cases = [];
for (const seed of [20261118, 20261119, 20250101, 20240806]) {
  for (const [completed, timeMs, kills] of [[true, 112000, 4], [false, 95000, 6], [false, 18000, 0], [false, 300000, 12], [true, 61499, 0]]) {
    for (const sealed of [false, true]) cases.push({ seed, completed, timeMs, kills, sealed, tokenId: cases.length + 1, points: 950 + cases.length * 1777 });
  }
}
fs.rmSync(path.join(root, 'contracts/test/fixtures'), { recursive: true, force: true });
cases.forEach((c, i) => out(`contracts/test/fixtures/score-${i}.svg`, A.scoreSVG({ ...c, uid: U })));
out('contracts/test/fixtures/cases.txt', cases.map((c) => [c.tokenId, c.seed, c.points, c.timeMs, c.kills, c.completed ? 1 : 0, c.sealed ? 1 : 0].join(' ')).join('\n') + '\n');

// ── Power-Up art: fixed head and tail per kind, uploaded to the contract once ────
const KINDS = ['marker', 'frost', 'pulse', 'blinker', 'snare'];
for (const k of KINDS) {
  const p = A.powerUpParts(k);
  out(`contracts/art/${k}.head.svg`, p.head);
  out(`contracts/art/${k}.tail.svg`, p.tail);
  const expect = A.powerUpSVG({ gun: k, tokenId: 7, runs: 12 });
  out(`contracts/test/fixtures/powerup-${k}-7-12.svg`, expect);
}
// the sealed pack every Power-Up is sold in
const pack = A.packParts();
out('contracts/art/pack.head.svg', pack.head);
out('contracts/art/pack.tail.svg', pack.tail);
out('contracts/test/fixtures/pack-7.svg', A.packSVG({ tokenId: 7 }));
console.log(`HamScoreArt.sol ${sol.length} chars, ${cases.length} Score cases, ${KINDS.length} Power-Up kinds`);
