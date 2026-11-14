// Read-only leaderboard page. No wallet needed: everything here comes straight off the chain.
import { CHAINS, CHAIN, CHAIN_KEY, setChain } from './config.js';
import { chain } from './chain.js';

const $ = (id) => document.getElementById(id);
const sel = $('netSel');
for (const [k, c] of Object.entries(CHAINS)) sel.add(new Option(c.name + (c.contract ? '' : ' (soon)'), k, false, k === CHAIN_KEY));
sel.addEventListener('change', () => setChain(sel.value));

async function refresh() {
  const table = $('table'), rows = $('rows'), empty = $('emptyV'), status = $('statusV');
  if (!chain.enabled()) {
    $('potV').textContent = 'Not live yet'; $('metaV').textContent = '';
    table.hidden = true; empty.hidden = false; empty.textContent = `${CHAIN.name} doesn't have the game deployed yet.`;
    return;
  }
  try {
    const t = await chain.today();
    $('potV').textContent = `${Number(t.pot).toFixed(4)} ETH`;
    $('metaV').textContent = `${t.entries.toLocaleString('en-US')} run${t.entries === 1 ? '' : 's'} today · ${CHAIN.name}`;
    if (t.top.length) {
      rows.innerHTML = t.top.map((p, i) => `<tr><td class="rank">${i + 1}</td><td class="who">${chain.short(p.who)}</td><td>${p.points.toLocaleString('en-US')}</td><td>${(p.timeMs / 1000).toFixed(2)}s</td></tr>`).join('');
      table.hidden = false; empty.hidden = true;
    } else {
      table.hidden = true; empty.hidden = false; empty.textContent = 'No finished runs yet today. Be the first.';
    }
    status.textContent = ''; status.className = 'status';
  } catch (e) {
    status.textContent = 'Could not reach the chain. Retrying…'; status.className = 'status bad';
  }
}

refresh();
setInterval(refresh, 15000);
