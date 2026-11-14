// Sandbox page: connect your own wallet, sign and send the HamDailyRun deploy transaction.
// No private key is ever read or stored here. The wallet extension signs; this page only builds the transaction.
import { BrowserProvider, ContractFactory, parseEther, isAddress, getAddress } from 'ethers';
import { CHAINS } from './config.js';
import artifact from './contract-artifact.json';
import nftArtifact from './nft-artifact.json';
import { pickProvider } from './wallet.js';

const $ = (id) => document.getElementById(id);
const say = (el, msg, kind = '') => { el.textContent = msg; el.className = 'status ' + kind; };
const net = () => CHAINS[$('netSel').value];
const isMainnet = () => $('netSel').value !== 'aurora-testnet';

let signer = null, account = null;

function onChainChange() {
  signer = null; account = null;
  $('dot').classList.remove('on');
  $('netLabel').textContent = 'Not connected';
  $('connectBtn').textContent = 'Connect wallet'; $('connectBtn').disabled = false;
  $('mainnetWarn').textContent = isMainnet() ? `This is ${net().name}, a live mainnet. Deploying here costs real ETH for gas, and the pot it starts collecting is real money.` : '';
  $('confirmRow').classList.toggle('hidden', !isMainnet());
  $('mainnetConfirm').checked = false;
  refreshDeployButton();
}
function refreshDeployButton() {
  const ready = !!signer && (!isMainnet() || $('mainnetConfirm').checked);
  $('deployBtn').disabled = !ready;
  $('deployBtn').textContent = !signer ? 'Connect your wallet first' : (isMainnet() && !$('mainnetConfirm').checked) ? 'Check the box above to continue' : 'Deploy HamDailyRun';
  $('deployNftBtn').disabled = !ready;
  $('deployNftBtn').textContent = !signer ? 'Connect your wallet first' : (isMainnet() && !$('mainnetConfirm').checked) ? 'Check the box above to continue' : 'Deploy HamPowerUp';
}

async function connect() {
  const NET = net(), HEX = '0x' + NET.id.toString(16);
  try {
    say($('walletStatus'), 'Connecting…');
    const eth = await pickProvider();
    let provider = new BrowserProvider(eth, 'any');
    const [acc] = await provider.send('eth_requestAccounts', []);
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: HEX }]);
    } catch (e) {
      if (e?.error?.code === 4902 || e?.code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message || '')) {
        await provider.send('wallet_addEthereumChain', [{ chainId: HEX, chainName: NET.name, rpcUrls: [NET.rpc], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [NET.explorer] }]);
      } else throw e;
    }
    provider = new BrowserProvider(eth, 'any');
    signer = await provider.getSigner();
    account = getAddress(acc);
    $('dot').classList.add('on');
    $('netLabel').textContent = `${account.slice(0, 6)}…${account.slice(-4)} on ${NET.name}`;
    $('connectBtn').textContent = 'Connected';
    $('connectBtn').disabled = true;
    if (!$('owner').value) $('owner').value = account;
    if (!$('treasury').value) $('treasury').value = account;
    refreshDeployButton();
    say($('walletStatus'), '', '');
  } catch (e) {
    say($('walletStatus'), e?.code === 'ACTION_REJECTED' || e?.code === 4001 ? 'You declined the connection in your wallet.' : (e?.shortMessage || e?.message || String(e)), 'bad');
  }
}

async function deploy() {
  const addr = (id) => { const v = $(id).value.trim(); if (!isAddress(v)) throw new Error(`"${$(id).previousElementSibling.textContent}" is not a valid address.`); return getAddress(v); };
  const num = (id) => { const v = Number($(id).value); if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`"${$(id).previousElementSibling.textContent}" must be a whole number from 0 to 255.`); return v; };
  if (isMainnet() && !$('mainnetConfirm').checked) return; // belt and braces - the button is disabled for this already
  const NET = net();
  $('deployBtn').disabled = true;
  try {
    const owner = addr('owner'), referee = addr('referee'), treasury = addr('treasury');
    const fee = parseEther(String($('fee').value || '0'));
    const cfg = [num('mazeSize'), num('cellSize'), num('sentries'), num('sentryHealth'), num('sentryDamage'), num('playerHealth'), num('magSize'), num('loops')];
    say($('deployStatus'), 'Confirm the deployment in your wallet…');
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const contract = await factory.deploy(owner, referee, treasury, fee, cfg);
    say($('deployStatus'), 'Waiting for it to be mined…');
    await contract.waitForDeployment();
    const a = await contract.getAddress();
    const tx = contract.deploymentTransaction();
    say($('deployStatus'), 'Deployed.', 'ok');
    $('addrOut').textContent = `${a} on ${NET.name}`;
    $('explorerLink').innerHTML = tx ? `<a href="${NET.explorer}/tx/${tx.hash}" target="_blank" rel="noopener">View the deploy transaction</a>` : '';
    $('result').classList.remove('hidden');
  } catch (e) {
    say($('deployStatus'), e?.code === 'ACTION_REJECTED' || e?.code === 4001 ? 'You declined the transaction in your wallet.' : (e?.shortMessage || e?.reason || e?.message || String(e)), 'bad');
  } finally {
    refreshDeployButton();
  }
}

async function deployNft() {
  if (isMainnet() && !$('mainnetConfirm').checked) return; // belt and braces - the button is disabled for this already
  const NET = net();
  $('deployNftBtn').disabled = true;
  try {
    say($('deployNftStatus'), 'Confirm the deployment in your wallet…');
    const factory = new ContractFactory(nftArtifact.abi, nftArtifact.bytecode, signer);
    const contract = await factory.deploy();
    say($('deployNftStatus'), 'Waiting for it to be mined…');
    await contract.waitForDeployment();
    const a = await contract.getAddress();
    const tx = contract.deploymentTransaction();
    say($('deployNftStatus'), 'Deployed.', 'ok');
    $('nftAddrOut').textContent = `${a} on ${NET.name}`;
    $('nftExplorerLink').innerHTML = tx ? `<a href="${NET.explorer}/tx/${tx.hash}" target="_blank" rel="noopener">View the deploy transaction</a>` : '';
    $('nftResult').classList.remove('hidden');
  } catch (e) {
    say($('deployNftStatus'), e?.code === 'ACTION_REJECTED' || e?.code === 4001 ? 'You declined the transaction in your wallet.' : (e?.shortMessage || e?.reason || e?.message || String(e)), 'bad');
  } finally {
    refreshDeployButton();
  }
}

$('netSel').addEventListener('change', onChainChange);
$('mainnetConfirm').addEventListener('change', refreshDeployButton);
$('connectBtn').addEventListener('click', connect);
$('deployBtn').addEventListener('click', deploy);
$('deployNftBtn').addEventListener('click', deployNft);
onChainChange();
