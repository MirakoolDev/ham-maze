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
      box.innerHTML = days.map((d) => `<div class="day">
        <div class="day-h">
          <span class="day-d">${fmtDay(d.day)}<span class="tag ${d.settled ? 'paid' : 'open'}">${d.settled ? 'Paid out' : 'Not paid out yet'}</span></span>
          <span class="day-m"><b>${Number(d.pot).toFixed(4)} ETH</b> &middot; ${d.entries.toLocaleString('en-US')} run${d.entries === 1 ? '' : 's'}</span>
        </div>
        ${d.top.length
          ? `<ol>${d.top.map((p, i) => `<li><span class="n">${i + 1}</span><span class="w">${chain.short(p.who)}</span><span class="p">${p.points.toLocaleString('en-US')} pts &middot; ${(p.timeMs / 1000).toFixed(2)}s</span></li>`).join('')}</ol>`
          : '<p class="none">Runs were played, but nobody reached the monolith.</p>'}
      </div>`).join('');
    }
    $('pastS').hidden = false;
  } catch (e) {
    pastFor = -1; // try again on the next refresh
  }
}

tickEnds();
setInterval(tickEnds, 30000);
refresh();
setInterval(refresh, 15000);
