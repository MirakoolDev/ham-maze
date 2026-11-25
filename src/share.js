// Streaks and the share card.
// Streak: the days (UTC maze numbers, YYYYMMDD) this browser reached the monolith, kept in localStorage.
// It counts back from today, or from yesterday if today's maze isn't done yet, so it doesn't drop to 0
// at 00:00 UTC before you've had a chance to play.
// Share card: a 1200x675 PNG in the look of the Backer Pass and the daily posts: the maze from the title
// screen's orbit (the view everyone already sees, so it gives nothing of the route away), the time, the
// numbers and the streak.

const KEY = 'ham.days';
const dayKey = (d) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
const prevDay = (n) => {
  const d = new Date(Date.UTC(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100));
  d.setUTCDate(d.getUTCDate() - 1);
  return dayKey(d);
};

function readDays() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(Number.isInteger) : []; } catch { return []; }
}

/** Record that today's maze (`seed`) was finished, and return the streak including it. */
export function recordFinish(seed) {
  const days = new Set(readDays());
  days.add(seed);
  const keep = [...days].sort((a, b) => b - a).slice(0, 400);
  try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch {}
  return streak(seed);
}

/** { count, today }: consecutive finished days ending today (or yesterday, if today isn't finished yet). */
export function streak(seed) {
  const days = new Set(readDays());
  const today = days.has(seed);
  let n = 0, d = today ? seed : prevDay(seed);
  while (days.has(d)) { n++; d = prevDay(d); }
  return { count: n, today };
}

/** The post text for a finished run. */
export function shareText({ seed, time, kills, points, streakCount }) {
  const bits = [`HAM daily maze No. ${seed}: home in ${time}`];
  if (kills) bits.push(`${kills} ${kills === 1 ? 'sentry' : 'sentries'} down`);
  if (points) bits.push(`${points} points`);
  let t = bits.join(', ') + '.';
  if (streakCount > 1) t += ` Day ${streakCount} in a row.`;
  return `${t}\nFind your way home: ham3d.fun`;
}

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/** Draw the card. plate: a data URL of the maze frame (or null). Resolves to a PNG Blob. */
export async function drawCard({ plate, seed, time, kills, points, route, streakCount }) {
  const W = 1200, H = 675, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  try { await document.fonts.ready; } catch {}
  const LABEL = "'Cabinet Grotesk', 'Segoe UI', system-ui, sans-serif";
  const INK = '#24212c';

  // dusk field
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#dfe3ef'); bg.addColorStop(0.55, '#ece4da'); bg.addColorStop(1, '#efd9c8');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  // the maze, on the right, fading in from the text side
  if (plate) {
    try {
      const img = await loadImg(plate);
      const x0 = 470, w = W - x0, s = Math.max(w / img.width, H / img.height);
      const dw = img.width * s, dh = img.height * s;
      const off = document.createElement('canvas'); off.width = w; off.height = H;
      const o = off.getContext('2d');
      o.drawImage(img, (w - dw) / 2, (H - dh) / 2, dw, dh);
      o.globalCompositeOperation = 'destination-in';
      const m = o.createLinearGradient(0, 0, 220, 0); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)');
      o.fillStyle = m; o.fillRect(0, 0, w, H);
      g.drawImage(off, x0, 0);
    } catch { /* no plate: the field alone */ }
  }

  const caps = (text, x, y, size, weight = 600, alpha = 1, spacing = 0.22, align = 'left') => {
    g.save(); g.globalAlpha = alpha; g.fillStyle = INK; g.textAlign = align;
    g.font = `${weight} ${size}px ${LABEL}`;
    try { g.letterSpacing = `${size * spacing}px`; } catch {}
    g.fillText(text.toUpperCase(), x, y); g.restore();
  };

  caps('HAM', 56, 70, 18, 700, 1, 0.32);
  caps(`Daily maze No. ${seed}`, 56, 98, 13, 500, 0.7);
  caps('Monolith found', 56, 178, 14, 700, 0.85);

  g.fillStyle = INK; g.font = `300 104px ${LABEL}`; g.fillText(time, 50, 290);

  // the numbers
  const stats = [[points, 'Points'], [kills, kills === 1 ? 'Sentry' : 'Sentries'], [route, 'Route']].filter(([v]) => v != null && v !== '');
  let sx = 56;
  g.strokeStyle = 'rgba(36,33,44,.18)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(56, 340); g.lineTo(410, 340); g.stroke();
  for (const [v, k] of stats) {
    g.fillStyle = INK; g.font = `500 38px ${LABEL}`; g.fillText(String(v), sx, 396);
    caps(k, sx, 424, 11, 600, 0.65);
    sx += 130;
  }

  if (streakCount > 1) {
    g.fillStyle = 'rgba(255,255,255,.6)';
    const y = 470, label = `Day ${streakCount} in a row`;
    g.font = `700 15px ${LABEL}`;
    let tw; try { g.letterSpacing = '3px'; tw = g.measureText(label.toUpperCase()).width; g.letterSpacing = '0px'; } catch { tw = g.measureText(label).width * 1.25; }
    g.beginPath(); g.roundRect(56, y, tw + 44, 40, 20); g.fill();
    g.fillStyle = '#ff6a1f'; g.beginPath(); g.arc(78, y + 20, 5, 0, Math.PI * 2); g.fill();
    caps(label, 94, y + 26, 15, 700, 1, 0.2);
  }

  caps('Find your way home', 56, 612, 13, 500, 0.7);
  caps('ham3d.fun', 56, 636, 15, 700, 1);

  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
