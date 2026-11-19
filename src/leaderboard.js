// Read-only leaderboard page. No wallet needed: everything here comes straight off the chain.
import { CHAINS, CHAIN, CHAIN_KEY, setChain } from './config.js';
import { chain } from './chain.js';

const $ = (id) => document.getElementById(id);
const sel = $('netSel');
for (const [k, c] of Object.entries(CHAINS)) sel.add(new Option(c.name + (c.contract ? '' : ' (soon)'), k, false, k === CHAIN_KEY));
sel.addEventListener('change', () => setChain(sel.value));

const SHARE = ['40% of the pot', '20% of the pot', '10% of the pot'];
const PLAY = '<a class="btn" href="/">Play today&rsquo;s maze</a>';

function empty(text, withPlay) {
  $('rows').hidden = true;
  const e = $('emptyV');
  e.hidden = false;
  e.innerHTML = `<p>${text}</p>${withPlay ? PLAY : ''}`;
}

// time left on today's maze, which retires at 00:00 UTC
function tickEnds() {
  const left = 86400000 - (Date.now() % 86400000);
  const h = Math.floor(left / 3600000), m = Math.floor(left / 60000) % 60;
  $('endsV').textContent = `Today’s maze ends in ${h}h ${String(m).padStart(2, '0')}m`;
}

async function refresh() {
  const status = $('statusV');
  if (!chain.enabled()) {
    $('potV').textContent = 'Not live yet';
    $('metaV').textContent = CHAIN.name;
    empty(`The pot isn’t live on ${CHAIN.name} yet. You can still play the maze.`, true);
    $('pastS').hidden = true;
    return;
  }
  document.body.classList.add('refreshing');
  try {
    const t = await chain.today();
    $('potV').innerHTML = `${Number(t.pot).toFixed(4)}<small>ETH</small>`;
    $('metaV').textContent = `${t.entries.toLocaleString('en-US')} run${t.entries === 1 ? '' : 's'} today on ${CHAIN.name}`;
    if (t.top.length) {
      $('rows').innerHTML = t.top.map((p, i) => `<li>
        <span class="place">${i + 1}</span>
        <span class="who">${chain.short(p.who)}<small>${(p.timeMs / 1000).toFixed(2)}s to the monolith</small></span>
        <span class="pts">${p.points.toLocaleString('en-US')}<small>${SHARE[i]}</small></span>
      </li>`).join('');
      $('rows').hidden = false;
      $('emptyV').hidden = true;
    } else {
      empty('No finished runs yet today. The top spot is open.', true);
    }
    status.textContent = '';
    status.className = 'status';
    loadPast(t.day);
  } catch (e) {
    status.textContent = 'Can’t reach the chain right now. Trying again in a moment.';
    status.className = 'status bad';
  } finally {
    document.body.classList.remove('refreshing');
  }
}

// Previous days: read once per load (they don't change, except a day settling)
const fmtDay = (d) => new Date(d * 86400000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
let pastFor = -1;
async function loadPast(today) {
  if (pastFor === today) return;
  pastFor = today;
  try {
    const days = (await chain.pastDays(today, 14)).filter((d) => d.entries > 0);
    const box = $('pastV');
    if (!days.length) {
      box.innerHTML = '<p class="day none">No earlier days with runs yet.</p>';
    } else {
      box.innerHTML = days.map(dayHTML).join('');
    }
    $('pastS').hidden = false;
  } catch (e) {
    pastFor = -1; // try again on the next refresh
  }
}

// A day's prizes only move once someone calls settle (anyone can, from 00:15 UTC the next day; it
// costs a little gas). After that each winner has 7 days to claim; unclaimed prizes go back into the pot.
const SETTLE_DELAY = 15 * 60, CLAIM_WINDOW = 7 * 86400;
const eth = (v) => `${Number(v).toFixed(4)} ETH`;
function dayHTML(d) {
  const now = Date.now() / 1000;
  const canSettle = !d.settled && now >= (d.day + 1) * 86400 + SETTLE_DELAY;
  const claimOpen = d.settled && now <= d.settledAt + CLAIM_WINDOW;
  const owed = d.settled ? d.top.filter((p) => Number(p.prize) > 0) : [];
  const tag = !d.settled ? '<span class="tag open">Not paid out yet</span>'
    : owed.length && claimOpen ? '<span class="tag open">Prizes to claim</span>'
    : '<span class="tag paid">Paid out</span>';
  const prizeCell = (p) => {
    if (!d.settled) return '';
    if (Number(p.prize) === 0) return '<span class="claimed">Claimed</span>';
    if (!claimOpen) return '<span class="claimed">Not claimed in time</span>';
    return `<button class="mini hot" data-claim="${d.day}" data-who="${p.who}">Claim ${eth(p.prize)}</button>`;
  };
  return `<div class="day">
    <div class="day-h">
      <span class="day-d">${fmtDay(d.day)}${tag}</span>
      <span class="day-m"><b>${eth(d.pot)}</b> &middot; ${d.entries.toLocaleString('en-US')} run${d.entries === 1 ? '' : 's'}</span>
    </div>
    ${d.top.length
      ? `<ol>${d.top.map((p, i) => `<li><span class="n">${i + 1}</span><span class="w">${chain.short(p.who)}</span><span class="p">${p.points.toLocaleString('en-US')} pts &middot; ${(p.timeMs / 1000).toFixed(2)}s</span>${prizeCell(p) ? `<span class="c">${prizeCell(p)}</span>` : ''}</li>`).join('')}</ol>`
      : '<p class="none">Runs were played, but nobody reached the monolith.</p>'}
    ${canSettle ? `<div class="settle"><button class="mini" data-settle="${d.day}">${d.top.length ? 'Pay out this day' : 'Roll this pot into today'}</button>
      <span>${d.top.length ? 'Locks in the prizes so the top three can claim.' : 'Nobody won, so the pot carries over.'} Anyone can do this; it costs a little gas.</span></div>` : ''}
    <p class="act" hidden></p>
  </div>`;
}

const WHY = {
  NothingToClaim: (who) => `Only ${chain.short(who)} can claim this prize. Switch your wallet to that address and try again.`,
  ClaimClosed: () => 'The 7-day claim window for this day has closed.',
  AlreadySettled: () => 'Someone already paid this day out. Refreshing.',
  TooEarly: () => 'This day can be paid out from 00:15 UTC the next day.',
  NotSettled: () => 'Pay this day out first.',
};
$('pastV').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-settle], button[data-claim]');
  if (!b || b.disabled) return;
  const msg = b.closest('.day').querySelector('.act');
  const day = Number(b.dataset.settle ?? b.dataset.claim);
  const claiming = 'claim' in b.dataset;
  b.disabled = true;
  const label = b.textContent;
  b.textContent = 'Check your wallet…';
  msg.hidden = false; msg.className = 'act';
  msg.textContent = claiming ? 'Claiming the prize to your wallet.' : 'Paying out the day.';
  try {
    const hash = await (claiming ? chain.claimDay(day) : chain.settleDay(day));
    msg.innerHTML = `${claiming ? 'Claimed. The ETH is in your wallet.' : 'Paid out. Winners can claim now.'} <a href="${chain.explorerTx(hash)}" target="_blank" rel="noopener">View transaction</a>`;
    pastFor = -1;
    refresh();
  } catch (err) {
    const name = err?.revert?.name;
    msg.className = 'act bad';
    msg.textContent = WHY[name] ? WHY[name](b.dataset.who) : err?.code === 'ACTION_REJECTED' ? 'Cancelled in the wallet.' : (err?.shortMessage || err?.message || 'That didn’t go through.');
    b.disabled = false; b.textContent = label;
    if (name === 'AlreadySettled') { pastFor = -1; refresh(); }
  }
});

tickEnds();
setInterval(tickEnds, 30000);
refresh();
setInterval(refresh, 15000);
