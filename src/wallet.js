// Picks an injected wallet properly instead of grabbing window.ethereum directly. With more than one
// wallet extension active (MetaMask plus Brave's own wallet, Coinbase Wallet, Phantom, Rabby...), the
// browser can end up with several providers fighting over window.ethereum, and reading it directly can
// throw ("could not coalesce" is one real example) or hand back the wrong wallet. EIP-6963 fixes this:
// every wallet announces itself as its own distinct object instead of overwriting one shared global, so
// we can list exactly what's installed and ask the user to pick when there's more than one.
const found = new Map(); // rdns -> { info, provider }

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const { info, provider } = e.detail || {};
    if (info?.rdns) found.set(info.rdns, { info, provider });
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

function waitForAnnouncements(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showPicker(options) {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,9,13,.72);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#2a2733;border-radius:16px;padding:22px;width:min(320px,90vw);box-shadow:0 20px 60px rgba(0,0,0,.5);';
    box.innerHTML = '<div style="color:#f3efe4;font-size:15px;font-weight:600;margin-bottom:4px">Choose a wallet</div>'
      + '<div style="color:#8d89a0;font-size:12px;margin-bottom:14px">More than one is installed in this browser.</div>';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#f3efe4;font-size:14px;cursor:pointer;text-align:left;width:100%;';
      if (opt.info.icon) {
        const img = document.createElement('img');
        img.src = opt.info.icon; img.width = 22; img.height = 22; img.style.borderRadius = '5px';
        btn.appendChild(img);
      }
      const label = document.createElement('span'); label.textContent = opt.info.name;
      btn.appendChild(label);
      btn.addEventListener('click', () => { document.body.removeChild(overlay); resolve(opt.provider); });
      list.appendChild(btn);
    }
    box.appendChild(list);
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.style.cssText = 'margin-top:14px;width:100%;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:none;color:#8d89a0;font-size:13px;cursor:pointer;';
    cancel.addEventListener('click', () => { document.body.removeChild(overlay); reject(Object.assign(new Error('Cancelled'), { code: 'ACTION_REJECTED' })); });
    box.appendChild(cancel);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

/**
 * Returns an EIP-1193 provider to connect with. Waits briefly for EIP-6963 wallets to announce
 * themselves; if exactly one is found, uses it; if several, asks the user to pick; if none
 * announced (an older wallet that only sets window.ethereum), falls back to that.
 */
export async function pickProvider() {
  await waitForAnnouncements();
  const options = [...found.values()];
  if (options.length === 1) return options[0].provider;
  if (options.length > 1) return showPicker(options);
  if (typeof window !== 'undefined' && window.ethereum) return window.ethereum;
  throw new Error('No wallet found. Install MetaMask (or another wallet) and reload the page.');
}
